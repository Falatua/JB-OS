// JB OS — AI Edge Function (Screenshot Capture + Brain Dump)
// Holds the Anthropic key server-side (never in the client). Three callers / modes:
//   • Screenshot, web client -> Supabase JWT, body {image}, persist:false (client saves the item)
//   • Screenshot, iOS Shortcut -> x-jbos-token header, body {image}, persist:true (function writes it)
//   • Brain dump, web client -> Supabase JWT, body {text} -> returns {items:[...]} to preview & save
// All modes share the same Haiku model + the $1.00/day cost cap (main:ss_budget).
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

const CATEGORIES = "work | personal | family | finance | tech | gaming | shopping | grocery | errands | lifestyle | health | musubi | general";

// Entity rules JB set — applied identically to screenshots and brain dumps.
const ENTITY_RULES = `ENTITY RULES (always apply, they override generic guesses):
- AnswerLab or "AL" -> work.
- Kenzie/Mackenzie, Archie, or Gigi -> family.
- Musubi, Musubi Strong, or Instagram -> musubi.
- Pokémon, ROM/ROMs, emulation, game consoles or handhelds (Nintendo/Switch/PlayStation/Xbox/3DS/AYN Thor), Roman TD, or World of Warcraft -> gaming.`;

const SYSTEM_PROMPT = `You are a screenshot analysis assistant embedded in JB OS, a personal productivity operating system. Read one iOS screenshot and decide whether it should become a NOTE or a TASK, then generate its content.

ROUTING RULES:
- Default to NOTE. Notes are reference material, inspiration, things to revisit at leisure, content to consume, places to check out, ideas — anything with no required action and no urgency.
- Only choose TASK when the screenshot clearly shows a specific action to do: a purchase to make, a reservation/booking, a form/signup to complete, a bill to pay, or a reply to send. If in doubt, choose NOTE.

CATEGORY: pick the single best fit from exactly this set: ${CATEGORIES}.
${ENTITY_RULES}
- musubi = the Musubi Strong apparel brand. work = AnswerLab + freelance design (Heber). family = partner/kids/parents (includes Archie & Gigi). gaming = video games, consoles, PC gaming, ROMs. tech = coding/AI/devices/JB OS. grocery = food. shopping = non-food goods. errands = run-around-town chores. Use general only as a last resort.

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

// ===== Brain-dump: split one plain-text ramble into multiple clean items =====
const DUMP_PROMPT = (today: string) => `You are the capture assistant inside JB OS, a personal productivity OS. The user brain-dumps several things at once in plain language (often messy or voice-dictated). Split it into discrete items.

RULES:
- Split ONLY genuinely separate things. If it's clearly one thing, return one item. Don't over-split a single multi-clause thought.
- TYPE: "task" if it's actionable (something to do — pay, order, call, buy, fix, schedule), "note" if it's reference/info/an idea/an event to remember ("dad's in town", "idea for...").
- CATEGORY: the single best fit from exactly this set: ${CATEGORIES}.
  ${ENTITY_RULES}
  Also: work = AnswerLab + freelance design (Heber); family includes kids (Archie/Gigi); gaming = video games/consoles/PC gaming/ROMs; tech = coding/AI/devices/JB OS; grocery = food; shopping = non-food goods; errands = run-around-town chores. Use general only as a last resort.
- PRIORITY: "high" ONLY if money is at stake, there's a hard deadline, or it blocks something; otherwise "normal". Never mark a grocery or errands item "high" — those are always low priority (the app sets that automatically).
- DUEDATE: resolve any time phrase ("today","tomorrow","Friday","next week","the 9th","Jun 9-11") to an absolute YYYY-MM-DD using today=${today}. For a range, use the START date. If no date is implied, null.
- NOTES: a SHORT extra detail ONLY if the user gave more than the title needs — no padding, never restate the title. Usually "".
- TITLE: clean, short, scannable.

Respond with ONLY valid JSON — no preamble, no markdown fences:
{"items":[{"title":"...","type":"task|note","category":"<one of the set>","priority":"normal|high","dueDate":"YYYY-MM-DD or null","notes":"short or empty"}]}`;

async function brainDump(text: string, admin: any, ANTHROPIC_KEY: string) {
  const today = todayKey();
  // shared daily cost cap
  const budgetId = `${SPACE}:ss_budget`;
  const { data: bRow } = await admin.from("jbos_sync").select("payload").eq("id", budgetId).maybeSingle();
  let budget = (bRow?.payload as { date?: string; spend?: number }) || { date: today, spend: 0 };
  if (budget.date !== today) budget = { date: today, spend: 0 };
  if ((budget.spend || 0) + PRECALL_GUARD > DAILY_CAP) return json({ error: "cap", budget: { spend: budget.spend || 0, cap: DAILY_CAP } });

  let items: any[] = [];
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: DUMP_PROMPT(today),
        messages: [{ role: "user", content: String(text).slice(0, 4000) }],
      }),
    });
    const data = await res.json();
    if (!res.ok) { console.error("anthropic-dump", data); return json({ error: "ai", budget: { spend: budget.spend || 0, cap: DAILY_CAP } }); }
    usage = data.usage || usage;
    const t = (data.content?.[0]?.text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(t);
    items = Array.isArray(parsed.items) ? parsed.items : (Array.isArray(parsed) ? parsed : []);
  } catch (e) {
    console.error("dump-parse", e);
    return json({ error: "ai" });
  }

  // record cost
  const cost = usage.input_tokens * IN_COST + usage.output_tokens * OUT_COST;
  budget = { date: today, spend: +((budget.spend || 0) + cost).toFixed(6) };
  await admin.from("jbos_sync").upsert({ id: budgetId, payload: budget, updated_at: new Date().toISOString() });

  // sanitize/normalize each item
  const cats = CATEGORIES.split(" | ");
  const clean = items.slice(0, 30).map((it: any) => ({
    title: String(it.title || "").slice(0, 120).trim(),
    type: it.type === "task" ? "task" : "note",
    category: cats.includes(it.category) ? it.category : "general",
    priority: it.priority === "high" ? "high" : "normal",
    dueDate: (typeof it.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)) ? it.dueDate : null,
    notes: String(it.notes || "").slice(0, 300).trim(),
  })).filter((it: any) => it.title);

  return json({ items: clean, budget: { spend: budget.spend, cap: DAILY_CAP } });
}

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

  let payload: { image?: string; persist?: boolean; source_hint?: string; text?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad-json" }, 200); }

  // ===== Brain-dump mode: split a plain-text ramble into multiple items =====
  if (payload.text && !payload.image) return await brainDump(payload.text, admin, ANTHROPIC_KEY!);

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
        type: out.type, priority: (validCat === "grocery" || validCat === "errands") ? "low" : out.priority, source: "screenshot", category: validCat,
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
