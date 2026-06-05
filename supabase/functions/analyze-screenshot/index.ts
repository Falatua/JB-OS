// JB OS — AI Edge Function (Screenshot Capture + Brain Dump)
// Holds the Anthropic key server-side (never in the client). Three callers / modes:
//   • Screenshot, web client -> Supabase JWT, body {image}, persist:false (client saves the item)
//   • Screenshot, iOS Shortcut -> x-jbos-token header, body {image}, persist:true (function writes it)
//   • Brain dump, web client -> Supabase JWT, body {text} -> returns {items:[...]} to preview & save
//   • Graph connections, web client -> Supabase JWT, body {connections:[{id,text,category}]}
//        -> returns {connections:[{a,b,reason}]} (non-obvious links for the knowledge graph)
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

const CATEGORIES = "work | personal | family | finance | tech | gaming | shopping | grocery | errands | health | musubi";

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
- musubi = the Musubi Strong apparel brand. work = AnswerLab + freelance design (Heber). family = partner/kids/parents (includes Archie & Gigi). gaming = video games, consoles, PC gaming, ROMs. tech = coding/AI/devices/JB OS. health = Health and Fitness (training, diet, medical, leisure-sport). grocery = food. shopping = non-food goods. errands = run-around-town chores. personal = self, relationships, admin, and leisure/hobbies/travel. There is NO general/catch-all — always pick the single best-fitting area; if nothing else fits, use personal.

TYPE: "note" for reference/info, "idea" for a concept/inspiration to explore, "task" for an action, "project" only for a clearly multi-step effort.

LINK: if the screenshot shows or implies a useful URL, return it. For a place/restaurant with no URL, return a Google Maps search URL like "https://www.google.com/maps/search/?api=1&query=NAME+CITY". Otherwise return "".

BODY: a fuller 1-3 sentence description of what it contains and why it matters to JB — add genuinely useful context or a sensible next step. You MAY make an EDUCATED GUESS using what we know about JB (below). If you inferred anything beyond what the screenshot literally shows, set "guess":true; otherwise "guess":false.

DATES: if the screenshot clearly shows a date or date range (an event, reservation, appointment, deadline), set dueDate=YYYY-MM-DD. For a RANGE (e.g. a trip or multi-day event) also set endDate=YYYY-MM-DD (≥ dueDate) so it becomes a calendar span. Resolve relative wording against the "Today is ..." date provided. If no clear date, both null.

Respond with ONLY a valid JSON object — no preamble, no markdown fences, no commentary — matching exactly:
{"routing":"note|task","type":"note|idea|task|project","title":"<=60 chars","body":"1-3 sentence context","category":"<one of the set>","priority":"normal|high","confidence":"high|medium|low","source_hint":"e.g. Instagram post, Google Maps, product page","link":"a URL or empty string","dueDate":"YYYY-MM-DD or null","endDate":"YYYY-MM-DD or null","guess":true|false}`;

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
  Also: work = AnswerLab + freelance design (Heber); family includes kids (Archie/Gigi); gaming = video games/consoles/PC gaming/ROMs; tech = coding/AI/devices/JB OS; health = Health and Fitness (training/diet/medical/leisure-sport); grocery = food; shopping = non-food goods; errands = run-around-town chores; personal = self/relationships/admin/leisure/hobbies/travel. There is NO general/catch-all — always pick the single best-fitting area; if nothing else fits, use personal.
- PRIORITY: "high" ONLY if money is at stake, there's a hard deadline, or it blocks something; otherwise "normal". Never mark a grocery or errands item "high" — those are always low priority (the app sets that automatically).
- DUEDATE / ENDDATE: resolve any time phrase to an absolute YYYY-MM-DD using today=${today}. For a DATE RANGE ("June 7 to June 11", "Jun 7-11", "next Mon–Wed", "the 9th through the 11th"), set dueDate=START and endDate=END — this makes it a multi-day calendar span. For a single date, set dueDate and leave endDate null. If no date is implied, both null. endDate must be ≥ dueDate.
- NOTES: a SHORT one-line extra detail ONLY if the user gave more than the title needs — no padding. Usually "".
- DESCRIPTION: a fuller 1-2 sentence description that adds genuinely useful context — what it likely means, why it matters to JB, or a sensible next step. You MAY make an EDUCATED GUESS using what we know about JB (below). Don't restate the title and don't pad. If you inferred anything beyond what the text literally says, set "guess":true; if it's purely literal, "guess":false.
- TITLE: clean, short, scannable.

Respond with ONLY valid JSON — no preamble, no markdown fences:
{"items":[{"title":"...","type":"task|note","category":"<one of the set>","priority":"normal|high","dueDate":"YYYY-MM-DD or null","endDate":"YYYY-MM-DD or null","notes":"short or empty","description":"1-2 sentence context","guess":true|false}]}`;

async function brainDump(text: string, admin: any, ANTHROPIC_KEY: string, profile?: string) {
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
        system: DUMP_PROMPT(today) + (profile ? "\n\nWHAT WE ALREADY KNOW ABOUT JB (use it to categorize accurately):\n" + String(profile).slice(0, 2000) : ""),
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
    category: cats.includes(it.category) ? it.category : "personal",
    priority: it.priority === "high" ? "high" : "normal",
    dueDate: (typeof it.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)) ? it.dueDate : null,
    endDate: (typeof it.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.endDate) && typeof it.dueDate === "string" && it.endDate >= it.dueDate) ? it.endDate : null,
    notes: String(it.notes || "").slice(0, 300).trim(),
    description: String(it.description || "").slice(0, 400).trim(),
    guess: it.guess === true,
  })).filter((it: any) => it.title);

  return json({ items: clean, budget: { spend: budget.spend, cap: DAILY_CAP } });
}

// ===== Graph connections: surface non-obvious links across JB's items (knowledge-graph insight) =====
const CONNECTIONS_PROMPT = `You are mapping the deep structure of JB's personal task/note system to surface NON-OBVIOUS connections — pairs of items that relate thematically, could be done together, build on one another, or reveal a pattern in how he works and who he is.

About JB: runs Musubi Strong (a Hawaiʻi / Pacific-Islander apparel brand — Shopify + Instagram growth + original designs). Day job at AnswerLab (UX research; writes reports/end-of-day updates). Builds Roman TD (a tower-defense game) and JB OS (this very app). Into hypertrophy training (Mike Israetel / RP). Heavy on AI tooling (Claude, Manus, Higgsfield), Obsidian, and retro gaming/emulation (AYN Thor, 3DS/Switch ROMs). Family: partner Mackenzie, kids Archie & Gigi.

Given the items (each: id, text, category), return up to 12 of the STRONGEST connections. Favor links that cross categories or reveal a real insight (e.g. an AI tool that could serve Musubi, two tasks that share a hidden dependency, a recurring theme). Skip trivial same-topic pairings unless genuinely illuminating. Each connection = the two item ids + a SHORT reason (≤ 10 words, concrete).

Respond with ONLY valid JSON — no preamble, no fences:
{"connections":[{"a":"<id>","b":"<id>","reason":"..."}]}`;

async function analyzeConnections(items: any[], admin: any, ANTHROPIC_KEY: string, profile?: string) {
  const today = todayKey();
  const budgetId = `${SPACE}:ss_budget`;
  const { data: bRow } = await admin.from("jbos_sync").select("payload").eq("id", budgetId).maybeSingle();
  let budget = (bRow?.payload as { date?: string; spend?: number }) || { date: today, spend: 0 };
  if (budget.date !== today) budget = { date: today, spend: 0 };
  if ((budget.spend || 0) + PRECALL_GUARD > DAILY_CAP) return json({ error: "cap", budget: { spend: budget.spend || 0, cap: DAILY_CAP } });

  const clean = items.slice(0, 60).map((it: any) => ({ id: String(it.id || ""), text: String(it.text || "").slice(0, 160), category: String(it.category || "personal") })).filter((it: any) => it.id && it.text);
  const ids = new Set(clean.map((it: any) => it.id));
  let connections: any[] = [];
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: CONNECTIONS_PROMPT + (profile ? "\n\nLIVE PROFILE FACTS (current — trust these about JB):\n" + String(profile).slice(0, 2000) : ""), messages: [{ role: "user", content: JSON.stringify(clean) }] }),
    });
    const data = await res.json();
    if (!res.ok) { console.error("anthropic-conn", data); return json({ error: "ai", budget: { spend: budget.spend || 0, cap: DAILY_CAP } }); }
    usage = data.usage || usage;
    const t = (data.content?.[0]?.text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(t);
    connections = Array.isArray(parsed.connections) ? parsed.connections : (Array.isArray(parsed) ? parsed : []);
  } catch (e) { console.error("conn-parse", e); return json({ error: "ai" }); }

  const cost = usage.input_tokens * IN_COST + usage.output_tokens * OUT_COST;
  budget = { date: today, spend: +((budget.spend || 0) + cost).toFixed(6) };
  await admin.from("jbos_sync").upsert({ id: budgetId, payload: budget, updated_at: new Date().toISOString() });

  const out = connections
    .filter((c: any) => c && ids.has(c.a) && ids.has(c.b) && c.a !== c.b)
    .slice(0, 12)
    .map((c: any) => ({ a: String(c.a), b: String(c.b), reason: String(c.reason || "").slice(0, 80) }));
  return json({ connections: out, budget: { spend: budget.spend, cap: DAILY_CAP } });
}

// ===== "About JB" living memory: distill + tidy a durable profile from his data =====
const MEM_CATS = ["identity", "work", "musubi", "family", "health", "gaming", "tech", "finance", "personal", "patterns"];
const MEMORY_PROMPT = `You maintain JB's living profile inside JB OS (his personal operating system) — a compact set of DURABLE facts about who he is and how he works, used to make the app smarter (categorization, a knowledge graph, and AI features).

You're given JSON: "known" (facts already pinned by the user — never drop or reword these, just avoid duplicating them), "items" (his current tasks/notes), and "journal" (recent personal entries).

Return the UPDATED auto-derived profile:
- Extract DURABLE facts: identity, location, family & people, roles/day-job, businesses & projects, tools he relies on, health/training, gaming, finances, and recurring patterns in how he works.
- MERGE duplicates, rewrite vague facts into one crisp sentence, and DROP transient task-specific noise, one-offs, and anything no longer true.
- Do NOT repeat anything already in "known".
- Keep it tight: at most 32 facts, highest-signal first. Write each in third person ("JB ...").
- Each fact: {"text": "...", "category": "<one of: ${MEM_CATS.join("|")}>", "source": "items" | "journal" | "history"}.

ALSO return "entities": the distinct people, tools, and efforts JB mentions repeatedly (for a knowledge graph). Each: {"name": "<short label>", "kind": "person" | "tool" | "effort", "match": "<lowercase keyword or phrase that detects it in text>"}.

Respond with ONLY valid JSON — no preamble, no fences:
{"facts":[...], "entities":[...]}`;

async function extractMemory(mem: any, admin: any, ANTHROPIC_KEY: string) {
  const today = todayKey();
  const budgetId = `${SPACE}:ss_budget`;
  const { data: bRow } = await admin.from("jbos_sync").select("payload").eq("id", budgetId).maybeSingle();
  let budget = (bRow?.payload as { date?: string; spend?: number }) || { date: today, spend: 0 };
  if (budget.date !== today) budget = { date: today, spend: 0 };
  if ((budget.spend || 0) + PRECALL_GUARD > DAILY_CAP) return json({ error: "cap", budget: { spend: budget.spend || 0, cap: DAILY_CAP } });

  const known = Array.isArray(mem?.known) ? mem.known.slice(0, 40) : [];
  const items = Array.isArray(mem?.items) ? mem.items.slice(0, 200) : [];
  const journal = Array.isArray(mem?.journal) ? mem.journal.slice(0, 120) : [];
  let facts: any[] = [], entities: any[] = [];
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: MEMORY_PROMPT, messages: [{ role: "user", content: JSON.stringify({ known, items, journal }).slice(0, 24000) }] }),
    });
    const data = await res.json();
    if (!res.ok) { console.error("anthropic-mem", data); return json({ error: "ai", budget: { spend: budget.spend || 0, cap: DAILY_CAP } }); }
    usage = data.usage || usage;
    const t = (data.content?.[0]?.text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(t);
    facts = Array.isArray(parsed.facts) ? parsed.facts : [];
    entities = Array.isArray(parsed.entities) ? parsed.entities : [];
  } catch (e) { console.error("mem-parse", e); return json({ error: "ai" }); }

  const cost = usage.input_tokens * IN_COST + usage.output_tokens * OUT_COST;
  budget = { date: today, spend: +((budget.spend || 0) + cost).toFixed(6) };
  await admin.from("jbos_sync").upsert({ id: budgetId, payload: budget, updated_at: new Date().toISOString() });

  const cleanFacts = facts.slice(0, 32).map((f: any) => ({
    text: String(f.text || "").slice(0, 200).trim(),
    category: MEM_CATS.includes(f.category) ? f.category : "personal",
    source: ["items", "journal", "history"].includes(f.source) ? f.source : "items",
  })).filter((f: any) => f.text.length > 2);
  const cleanEnts = entities.slice(0, 30).map((e: any) => ({
    name: String(e.name || "").slice(0, 40).trim(),
    kind: ["person", "tool", "effort"].includes(e.kind) ? e.kind : "effort",
    match: String(e.match || e.name || "").slice(0, 40).toLowerCase().trim(),
  })).filter((e: any) => e.name && e.match);
  return json({ facts: cleanFacts, entities: cleanEnts, budget: { spend: budget.spend, cap: DAILY_CAP } });
}

// ===== Describe: write a richer description for one manually-added item =====
const DESCRIBE_PROMPT = `You write a concise, useful DESCRIPTION for a single item JB just added to JB OS (his personal productivity OS). You're given the item's title, type, and life area, plus what we know about JB.
Write 1-2 sentences that add genuinely useful context — what it likely means, why it matters to JB, or a sensible next step. You MAY make an EDUCATED GUESS using the profile. Don't restate the title, don't pad, no preamble.
If you inferred anything beyond the literal title, set "guess":true; otherwise "guess":false.
Respond with ONLY valid JSON — no fences: {"description":"...","guess":true|false}`;

async function describeItem(d: any, admin: any, ANTHROPIC_KEY: string, profile?: string) {
  const today = todayKey();
  const budgetId = `${SPACE}:ss_budget`;
  const { data: bRow } = await admin.from("jbos_sync").select("payload").eq("id", budgetId).maybeSingle();
  let budget = (bRow?.payload as { date?: string; spend?: number }) || { date: today, spend: 0 };
  if (budget.date !== today) budget = { date: today, spend: 0 };
  if ((budget.spend || 0) + PRECALL_GUARD > DAILY_CAP) return json({ error: "cap", budget: { spend: budget.spend || 0, cap: DAILY_CAP } });

  const title = String(d?.title || "").slice(0, 200).trim();
  if (!title) return json({ description: "", guess: false });
  const ctx = `Title: ${title}\nType: ${String(d?.type || "task")}\nLife area: ${String(d?.category || "personal")}`;
  let description = "", guess = false;
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, system: DESCRIBE_PROMPT + (profile ? "\n\nWHAT WE KNOW ABOUT JB:\n" + String(profile).slice(0, 2000) : ""), messages: [{ role: "user", content: ctx }] }),
    });
    const data = await res.json();
    if (!res.ok) { console.error("anthropic-desc", data); return json({ error: "ai" }); }
    usage = data.usage || usage;
    const t = (data.content?.[0]?.text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(t);
    description = String(parsed.description || "").slice(0, 400).trim();
    guess = parsed.guess === true;
  } catch (e) { console.error("desc-parse", e); return json({ error: "ai" }); }

  const cost = usage.input_tokens * IN_COST + usage.output_tokens * OUT_COST;
  budget = { date: today, spend: +((budget.spend || 0) + cost).toFixed(6) };
  await admin.from("jbos_sync").upsert({ id: budgetId, payload: budget, updated_at: new Date().toISOString() });
  return json({ description, guess, budget: { spend: budget.spend, cap: DAILY_CAP } });
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

  let payload: { image?: string; persist?: boolean; source_hint?: string; text?: string; connections?: any[]; memory?: any; describe?: any; profile?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad-json" }, 200); }

  // ===== "About JB" memory mode: distill + tidy the living profile =====
  if (payload.memory && typeof payload.memory === "object") return await extractMemory(payload.memory, admin, ANTHROPIC_KEY!);

  // ===== Describe mode: richer description for one manually-added item =====
  if (payload.describe && typeof payload.describe === "object") return await describeItem(payload.describe, admin, ANTHROPIC_KEY!, payload.profile);

  // ===== Graph connections mode: find non-obvious links across the items =====
  if (Array.isArray(payload.connections) && payload.connections.length) return await analyzeConnections(payload.connections, admin, ANTHROPIC_KEY!, payload.profile);

  // ===== Brain-dump mode: split a plain-text ramble into multiple items =====
  if (payload.text && !payload.image) return await brainDump(payload.text, admin, ANTHROPIC_KEY!, payload.profile);

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
        system: SYSTEM_PROMPT + (payload.profile ? "\n\nWHAT WE KNOW ABOUT JB (use it for the body's educated guesses):\n" + String(payload.profile).slice(0, 2000) : ""),
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            { type: "text", text: "Today is " + todayKey() + ". Analyze this screenshot and route it to a note or task. JSON only." },
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
    guess: result.guess === true,
    category: String(result.category || "personal"),
    priority: result.priority === "high" ? "high" : "normal",
    confidence: result.confidence || "medium",
    source_hint: String(result.source_hint || payload.source_hint || ""),
    link: typeof result.link === "string" ? result.link : "",
    dueDate: (typeof result.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(result.dueDate)) ? result.dueDate : "",
    endDate: (typeof result.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(result.endDate)) ? result.endDate : "",
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
      const validCat = CATEGORIES.split(" | ").includes(out.category) ? out.category : "personal";
      items.unshift({
        id, text: out.title, notes: "", description: out.body, descGuess: out.guess,
        type: out.type, priority: (validCat === "grocery" || validCat === "errands") ? "low" : out.priority, source: "screenshot", category: validCat,
        emoji: "📸",
        ...(out.dueDate ? { dueDate: out.dueDate } : {}),
        ...(out.endDate && out.endDate >= out.dueDate ? { endDate: out.endDate } : {}),
        links: /^https?:\/\//i.test(out.link) ? [{ label: out.source_hint ? "Open — " + out.source_hint : "Open link", url: out.link }] : [],
        attachments: imageUrl ? [{ name: "screenshot.jpg", type: "image/jpeg", url: imageUrl }] : [],
        done: false, archived: false, createdAt: now, updatedAt: now,
      });
      await admin.from("jbos_sync").upsert({ id: todosId, payload: items, updated_at: new Date().toISOString() });
    } catch (e) { console.error("persist", e); }
  }

  return json(out);
});
