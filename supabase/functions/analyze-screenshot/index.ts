// JB OS — Screenshot Capture Edge Function
// Reads an iOS screenshot with Claude Haiku 4.5 (vision) and routes it to a Note (default) or
// Task inside JB OS. Holds the Anthropic key server-side (never in the client). Two callers:
//   • In-app web client  -> Supabase JWT in Authorization header, persist:false (client saves the item)
//   • iOS "Save to JB OS" Shortcut -> x-jbos-token header, persist:true (this function writes the item)
//
// Deploy:  supabase functions deploy analyze-screenshot --no-verify-jwt
// Secrets: supabase secrets set ANTHROPIC_API_KEY=...   JBOS_SHORTCUT_TOKEN=...
//          (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically)
// Storage: create a public bucket named `screenshots`
//
// Returns HTTP 200 for handled outcomes; the body carries {error:'cap'|'...'} so the client can
// show a friendly message without parsing non-2xx responses.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SPACE = "main";
const DAILY_CAP = 1.00;
const MODEL = "claude-haiku-4-5-20251001";
// Haiku 4.5 pricing (USD per token)
const IN_COST = 1.0 / 1_000_000;
const OUT_COST = 5.0 / 1_000_000;
const PRECALL_GUARD = 0.003; // conservative per-call reservation

const CATEGORIES = "work | personal | family | kids | finance | tech | shopping | grocery | errands | lifestyle | health | musubi | general";

const SYSTEM_PROMPT = `You are a screenshot analysis assistant embedded in JB OS, a personal productivity operating system. Read one iOS screenshot and decide whether it should become a NOTE or a TASK, then generate its content.

ROUTING RULES:
- Default to NOTE. Notes are reference material, inspiration, things to revisit at leisure, content to consume, places to check out, ideas — anything with no required action and no urgency.
- Only choose TASK when the screenshot clearly shows a specific action to do: a purchase to make, a reservation/booking, a form/signup to complete, a bill to pay, or a reply to send. If in doubt, choose NOTE.

CATEGORY: pick the single best fit from exactly this set: ${CATEGORIES}.
- musubi = anything for the Musubi Strong apparel brand. tech = coding/AI/devices. grocery = food. shopping = non-food goods. errands = run-around-town chores. Use general only as a last resort.

TYPE: "note" for reference/info, "idea" for a concept/inspiration to explore, "task" for an action, "project" only for a clearly multi-step effort.

LINK: if the screenshot shows or implies a useful URL, return it. For a place/restaurant with no URL, return a Google Maps search URL like "https://www.google.com/maps/search/?api=1&query=NAME+CITY". Otherwise return "".

Respond with ONLY a valid JSON object — no preamble, no markdown fences, no commentary — matching exactly:
{"routing":"note|task","type":"note|idea|task|project","title":"<=60 chars","body":"1-3 sentence summary of what it contains and why it matters","category":"<one of the set>","priority":"normal|high","confidence":"high|medium|low","source_hint":"e.g. Instagram post, Google Maps, product page","link":"a URL or empty string"}`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jbos-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const todayKey = () => new Date().toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  const SHORTCUT_TOKEN = Deno.env.get("JBOS_SHORTCUT_TOKEN");
  if (!ANTHROPIC_KEY) return json({ error: "config" }, 200);

  const admin = createClient(SB_URL, SERVICE_KEY);

  // --- Auth: a valid Supabase JWT (web client) OR the shared shortcut token (iOS) ---
  let authed = false;
  const shortcutToken = req.headers.get("x-jbos-token");
  if (SHORTCUT_TOKEN && shortcutToken && shortcutToken === SHORTCUT_TOKEN) {
    authed = true;
  } else {
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (!error && data?.user) authed = true;
    }
  }
  if (!authed) return json({ error: "auth" }, 401);

  let payload: { image?: string; persist?: boolean; source_hint?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad-json" }, 200); }
  const image = (payload.image || "").replace(/^data:[^,]+,/, "");
  if (!image) return json({ error: "no-image" }, 200);

  // --- Server-side daily cost cap (authoritative; survives client localStorage wipes) ---
  const budgetId = `${SPACE}:ss_budget`;
  const { data: bRow } = await admin.from("jbos_sync").select("payload").eq("id", budgetId).maybeSingle();
  let budget = (bRow?.payload as { date?: string; spend?: number }) || { date: todayKey(), spend: 0 };
  if (budget.date !== todayKey()) budget = { date: todayKey(), spend: 0 };
  if ((budget.spend || 0) + PRECALL_GUARD > DAILY_CAP) {
    return json({ error: "cap", budget: { spend: budget.spend || 0, cap: DAILY_CAP } });
  }

  // --- Claude Haiku 4.5 vision call ---
  let result: Record<string, unknown>;
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            { type: "text", text: "Analyze this screenshot and route it to a note or task. JSON only." },
          ],
        }],
      }),
    });
    const data = await res.json();
    if (!res.ok) { console.error("anthropic", data); return json({ error: "ai", budget: { spend: budget.spend || 0, cap: DAILY_CAP } }); }
    usage = data.usage || usage;
    let text = (data.content?.[0]?.text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    result = JSON.parse(text);
  } catch (e) {
    console.error("ai-parse", e);
    return json({ error: "ai" });
  }

  // --- Record cost ---
  const cost = usage.input_tokens * IN_COST + usage.output_tokens * OUT_COST;
  budget = { date: todayKey(), spend: +((budget.spend || 0) + cost).toFixed(6) };
  await admin.from("jbos_sync").upsert({ id: budgetId, payload: budget, updated_at: new Date().toISOString() });

  // --- Store the resized image in Supabase Storage; reference it by URL (keeps the synced payload lean) ---
  const id = uid();
  let imageUrl = "";
  try {
    const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
    const path = `${SPACE}/${id}.jpg`;
    const up = await admin.storage.from("screenshots").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (!up.error) imageUrl = admin.storage.from("screenshots").getPublicUrl(path).data.publicUrl;
  } catch (e) { console.error("storage", e); }

  const out = {
    id,
    routing: result.routing === "task" ? "task" : "note",
    type: ["note", "idea", "task", "project"].includes(result.type as string) ? result.type : (result.routing === "task" ? "task" : "note"),
    title: String(result.title || "Screenshot").slice(0, 120),
    body: String(result.body || ""),
    category: String(result.category || "general"),
    priority: result.priority === "high" ? "high" : "normal",
    confidence: result.confidence || "medium",
    source_hint: String(result.source_hint || payload.source_hint || ""),
    link: typeof result.link === "string" ? result.link : "",
    imageUrl,
    budget: { spend: budget.spend, cap: DAILY_CAP },
  };

  // --- Shortcut path: write the item straight into the todos store (the web client merges it live) ---
  if (payload.persist) {
    try {
      const todosId = `${SPACE}:todos`;
      const { data: tRow } = await admin.from("jbos_sync").select("payload").eq("id", todosId).maybeSingle();
      const items = Array.isArray(tRow?.payload) ? tRow!.payload as any[] : [];
      const now = new Date().toISOString();
      const validCat = CATEGORIES.split(" | ").includes(out.category) ? out.category : "general";
      items.unshift({
        id, text: out.title, notes: "", description: out.body,
        type: out.type, priority: out.priority, source: "screenshot", category: validCat,
        emoji: "📸",
        links: /^https?:\/\//i.test(out.link) ? [{ label: out.source_hint ? "Open — " + out.source_hint : "Open link", url: out.link }] : [],
        attachments: imageUrl ? [{ name: "screenshot.jpg", type: "image/jpeg", url: imageUrl }] : [],
        done: false, archived: false, createdAt: now, updatedAt: now,
      });
      await admin.from("jbos_sync").upsert({ id: todosId, payload: items, updated_at: new Date().toISOString() });
    } catch (e) { console.error("persist", e); }
  }

  return json(out);
});
