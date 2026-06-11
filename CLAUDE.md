# JB OS — Operating Guide for Claude

This file is the **rubric Claude uses to organize JB's "OS."** It is not consumed by the
app — it exists so that every Claude session files things the same rigid way, even across
context resets. Read this fully before adding, editing, or organizing anything.

JB OS is a personal operating system: a structured collection of **tasks, ideas, notes,
projects, routines, and journaling** that JB feeds to Claude in plain language. Claude's job
is to **classify it precisely, write it up cleanly, and push it straight to `main`** so it
goes live and JB can reference and finish it later.

---

## 1. How the system works (architecture)

- **Frontend:** `index.html` — a single-page app hosted on **GitHub Pages**. No backend; it
  persists to the browser's `localStorage` and treats the repo's data files as seed/source.
- **Deploy:** `.github/workflows/pages.yml` deploys the whole repo on every push to `main`.
  So: **commit to `main` → push → live in ~1–2 min.** No PR/draft step is wanted.
- **Sync model** (`fetchServerTodos`, ~line 1515 of `index.html`): on each load the app
  fetches the data files and merges by `id`.
  - A **new `id`** is added to JB's list automatically.
  - For an **existing `id`**, server edits to `text, notes, description, priority, category,
    type, emoji, dueDate` are picked up — **unless** JB edited that item in-app (a
    `userEdited` flag protects in-browser changes). A server `done: true` archives the item.
  - **Implication:** to add something, append an object with a **fresh unique `id`**. To
    update something, edit the object with the **same `id`** (it will sync unless JB locked it).

### Data files (what Claude writes to)

| File | Holds | Shows in |
|------|-------|----------|
| `todos.json` | tasks / ideas / notes / projects | Tasks **or** Notes area (by `type`), Calendar, Dashboard |
| `daily.json` | recurring **daily** routines (streak-tracked) | Daily tab |
| `weekly.json` | recurring **weekly** chores (weeks run Sun–Sat; resets Sunday) | Weekly tab |
| `monthly.json` | recurring **monthly** items | Monthly tab |
| `journal-prompts.json` | journaling prompts | Journal tab |
| `calendar.ics` | calendar events | Calendar tab |

**Most things go in `todos.json`.** Only use the others when the item is genuinely a daily
habit, a weekly chore, a monthly recurring item, a journaling prompt, or a dated calendar event.
Routine seed ids are prefixed by scope: `d-` daily, `w-` weekly, `m-` monthly. A day-anchored
weekly chore ("water plants on Sundays") keeps the day in `notes` (e.g. "Sundays").

### Tasks vs Notes are two distinct areas

`todos.json` powers **two separate top-level areas**, and an item's **`type` decides which one it lands
in** — so picking `type` correctly is now what files it in the right home:
- **Tasks area** = `type: task` or `project` (things to *do*). Identity color: brand **amber**.
- **Notes area** = `type: note` or `idea` (things to *know* / reference). Identity color: a calm **blue**
  (subtle per-area tint so JB always knows which mode he's in).
- Both areas keep the **same** machinery — priority, due dates, life areas, work-in-progress/steps,
  search, archive — just scoped to their own type.
- **Cross-cutting views stay unified:** the **Calendar** shows tasks + notes together, and the **Today**
  dashboard is a comprehensive launchpad across both. (Daily/Weekly/Monthly/Journal are their own data files.)
- Brain dump, screenshot capture, and manual entry all route by `type`, so a mis-typed item lands in the
  wrong area — be deliberate about task vs note (see §3).

---

## 2. Item schema (`todos.json`)

```json
{
  "id": "c-archie-gear",          // unique. "c-" = via this chat, "tg-" = via Telegram
  "text": "Short, scannable title",
  "type": "task",                  // task | idea | note | project
  "emoji": "🛍️",                   // always set one explicitly
  "notes": "One-line summary shown under the title",
  "description": "Fuller context: what it means, why, and any open questions",
  "priority": "normal",            // high | normal | low
  "wip": false,                    // Work-in-progress status — a SEPARATE flag, coexists with any priority
  "category": "work",              // see §3
  "source": "chat",                // chat (default for me) | telegram | browser
  "done": false,
  "archived": false,
  "createdAt": "2026-06-01T00:00:00Z"   // ISO-8601 UTC
}
```

Optional fields: `dueDate` ("YYYY-MM-DD"), `endDate` ("YYYY-MM-DD"), `descGuess` (bool), `links` ([]),
`attachments` ([]), `updatedAt`, `archivedAt`.

**`description` (write it richer now).** Give every item a genuinely useful 1–2 sentence
description — what it means, why it matters to JB, or a sensible next step — drawing on §5 and the
living "About JB" memory (below). It's fine to make an **educated guess**; when the description
infers beyond the literal input, set **`descGuess: true`** (the app shows a subtle "✦ inferred"
chip). Don't pad or restate the title. (The brain-dump / screenshot Edge Function already does this
on capture; match its depth when you file things by hand.)

**Date spans (always set both for a range).** When JB names a **date range** ("Dad in town Jun
7–11", "Maui Jul 3–9", "the 9th through the 11th"), set BOTH `dueDate` = start AND `endDate` = end
(≥ `dueDate`) so it becomes a multi-day calendar bar — don't just capture the start. For a single
day, leave `endDate` unset. Spans are color-coded by category, stack into lanes, and export to the
Google feed (`.ics`) as multi-day events.

**Progress steps** — any item (task/idea/note/project) can carry an optional ordered
`steps` array for phasic, multi-stage things (e.g. "emailed → waiting → shipped → received"):

```json
"steps": [
  { "text": "Emailed LARQ to start the request", "done": true },
  { "text": "Waiting on their reply", "done": false }
]
```

The app shows a progress bar + `done/total` + the next pending step on the list card, and an
**In progress** card on the dashboard (items with steps that aren't fully complete). `steps`
syncs like other fields (server updates apply unless JB locked the item in-app). The item's own
`done`/archive is **separate** from steps — finishing all steps does NOT auto-archive it; JB
checks the item off himself. Add `steps` when JB describes a process with phases; otherwise omit it.

### ID rules
- Chat-sourced: `c-<short-slug>` (e.g. `c-coins-cash`, `c-heber-designs`).
- **Always verify the `id` is unique** against the current file before writing.
- Never reuse or renumber another item's `id`.

---

## 3. Classification rubric (be rigid)

### `type`
**`type` now decides the item's home** — `task`/`project` → the **Tasks** area, `note`/`idea` → the
**Notes** area (see §1). Getting task-vs-note right is therefore what files it in the correct place, so
be deliberate: if there's a clear thing-to-do, it's a **task**; if it's reference/knowledge to revisit,
it's a **note**.
- **Gaming → note by default.** Anything in the `gaming` category defaults to `type: note` (hobby/
  reference, low priority). It's a default, not a force — flip a specific gaming item back to `task` if
  it's genuinely actionable, and it sticks.
- **task** — a concrete action with a clear done-state. *"Buy more tuna", "Pay birth bill".*
- **task** also includes investigation/action prompts such as *"Look into Obsidian"*,
  *"Research second-brain tools"*, or *"Check out X"*.
- **idea** — a possibility to explore later; no commitment yet. *"Auntie's-favorite-tee concept".*
- **note** — reference info, an FYI, context, or an event/fact without a direct done-state.
  *"Dad in town Jun 7–11"* is a note, not a task.
- **project** — a multi-step ongoing effort. **JB's preference: do NOT create umbrella
  project items.** Big efforts (Musubi Strong, JB OS, Rome TD) are tracked as discrete
  tasks/ideas/notes tagged to a category instead. Only use `project` if JB explicitly asks.

### `category` (fixed set — never invent new ones)
| Category | Use for |
|----------|---------|
| `musubi` | Anything for the **Musubi Strong** brand (product, content, IG/Instagram, store, designs, shoots). All Musubi brand work lives here — **not** in `work`. |
| `work` | **AnswerLab** (day job) + JB's side/freelance **design** work (e.g. Heber). Nothing Musubi-related. |
| `tech` | Coding, AI tools (Claude/Manus), devices, the JB OS app, servers/VPS, Obsidian. *(Games/ROMs/Rome TD now live in `gaming`.)* |
| `gaming` | Video games, consoles & handhelds, PC gaming, **ROMs**/emulation, Pokémon, **AYN Thor**, **Rome TD**, World of Warcraft. **Gaming items default to `type: note`** (hobby/reference → Notes area, low priority) — overridable per item if something is genuinely a task. |
| `finance` | Bills, taxes, investing, rent, payments |
| `family` | Mackenzie/Kenzie (partner), **Archie & Gigi** (kids), baby gear/pumps/nursery, JB's dad, extended family |
| `health` | **Health and Fitness** — training/hypertrophy, diet, medical, appointments, leisure-sport |
| `shopping` | Buying non-food goods |
| `grocery` | Food/grocery items |
| `errands` | Run-around-town chores (coins to cash, key fob batteries) |
| `personal` | Self, relationships, personal growth, admin, **leisure/hobbies/travel** |

There is **no `general` and no `lifestyle`** category — every item must land in a real, specific
area above (leisure/hobbies/vibe → `personal`; fitness/sport → `health`). The engine never falls
back to a catch-all; if nothing else fits, choose `personal`. (`general` survives in code only as an
invisible render fallback — never assign it.)

**Entity shortcuts (always apply — for task/note entry, brain dump, AND screenshots):**
- **AnswerLab** or **"AL"** → `work`
- **Kenzie / Mackenzie, Archie, or Gigi** → `family`
- **Musubi / Musubi Strong / Instagram** → `musubi`
- **Pokémon · ROM/ROMs · emulation · consoles/handhelds (Nintendo/Switch/PlayStation/Xbox/3DS/AYN Thor) · Rome TD · World of Warcraft** → `gaming`

When a Musubi brand task also names a kid (e.g. *"Musubi: order Archie's shoot gear"*) it stays `musubi` — the brand is the subject. The keyword engine lives in `index.html`'s `guessCategory()`; the screenshot/brain-dump rules live in the `analyze-screenshot` Edge Function. Update **all three** together when these rules change.

### `priority` (high · normal · low)
- **high** — money is at stake, there's a hard deadline, or it blocks something else.
- **normal** — the default for **tasks** (`task`/`project`) — things to *do*.
- **low** — someday, nice-to-have, de-emphasized — and the default for **notes** (`note`/`idea`), since
  notes are a reference/knowledge base, not action items.
- **Type defaults (a creation-time default, "unless changed").** Notes/ideas default to **low**, tasks/
  projects to **normal**; an explicit **high** is respected. Implemented by `defaultPriorityForType()` in
  `index.html` and applied at every entry point (manual add, brain dump, screenshots, sync). A user/Claude
  edit can still set any priority and it sticks. When filing a note by hand, set `priority: low` unless
  it's genuinely high.

### `wip` (Work in progress) — a separate status, NOT a priority
Work-in-progress is its own boolean flag that **coexists with any priority**, so an item can be **High
*and* in progress** at once. Set `"wip": true` when JB is actively working/handing off/waiting on a next
step. It shows its own teal "In progress" badge, has its own **Status** filter in the sidebar, and is
independent of high/normal/low. (Previously `in_progress` was a priority value, which forced items to lose
their real priority — that's fixed.)
- **Grocery & errands are always `low`.** Any item in the `grocery` or `errands` category is set to
  `priority: low` automatically (it's a hard force that wins over the type default). Don't mark them higher.

### `dueDate`
- Set it whenever JB names a date or window. A range → use the **start** date
  (e.g. "Jun 7–11" → `2026-06-07`). Vague timing with no date ("before my next haircut",
  "beginning of next month") → capture it in `notes`, leave `dueDate` unset unless a real
  date is implied.

### `emoji`
- Always set a fitting one. `index.html`'s `guessEmoji()` (~line 1435) shows the house style;
  match its vocabulary (💧 water, 🏋️ training, 💰 finance, 🛒 shopping, 🎨 design, 💻 tech, etc.).

---

## 4. Workflow per request (default: "just do it + brief recap")

1. **Parse & smart-split.** If JB's message contains several distinct things, file each as its
   own item. If it's clearly one thing, keep it one. When genuinely unsure whether it's one or
   many, ask.
2. **Classify** with §3 (type, category, priority, `dueDate`+`endDate` for ranges, emoji).
3. **Write** a clean `text` + a **richer `description`** (1–2 sentences of real context / why it
   matters / next step), using §5 **and the living "About JB" memory** to make educated guesses —
   set `descGuess: true` when you infer beyond the literal input. Tie things to existing direction
   (e.g. a Musubi idea to the on-file Musubi directions). `notes` stays a short one-liner.
4. **Append** to the right file with a unique `id`; **validate the JSON** (`python3 -m json.tool`).
5. **Commit to `main` and push** (no PR). Use a clear commit message.
6. **Recap** in 1–2 lines: what was filed, its type/category, and that it's live.
7. **Ask** only when something is genuinely ambiguous or architecturally significant.

Never push malformed JSON — it breaks the whole list render.

---

## 5. About JB (context for smarter filing)

- **Location:** **Redondo Beach, CA** (South Bay LA) — JB's actual home base. This is what the
  dashboard conditions widget tracks. (Westside Oʻahu / Hawaiʻi is **Musubi's** identity, not JB's home.)
- **Partner:** Mackenzie ("Kenzie").
- **Kids:** Gigi (daughter) and Archie (son). Archie appears in Musubi photo-shoot gear items.
- **Business:** **Musubi Strong** — a Hawaiʻi / Pacific-Islander-rooted apparel brand, run by JB
  from South Bay LA. Its cultural heart is **Westside Oʻahu / island + PI culture**, and it also
  speaks to the **SoCal PI community** (Gardena/Torrance/Carson). The local/island voice matters
  for all Musubi content — that's the brand's region, separate from where JB lives. Shopify store +
  Instagram growth + original designs; own tab and `musubi` category. Content directions on file:
  more real models, region-realistic (island) mockups, "auntie's favorite tee", Throwback Thursdays.
- **Day job:** **AnswerLab** (writes reports / end-of-day updates).
- **Side dev:** **Rome TD** (a tower-defense game he ships) and **JB OS** itself.
- **Fitness:** hypertrophy / weight training; follows Mike Israetel / RP.
- **Tech stack & interests:** Claude Code, GitHub Pages, VPS, Obsidian, AI agents (Manus),
  retro-game emulation (3DS/Switch ROMs, Dropbox backups).
- **Family:** Dad visits periodically.

> If any of the above is wrong, JB will correct it — update this section when he does.

**Living "About JB" memory.** The app also keeps an *auto-distilled* profile of JB (durable facts +
entities + patterns, in the `memory` Supabase store, refreshed by the `analyze-screenshot` Edge
Function). It's what powers smarter categorization, the graph's concept nodes, and the educated-guess
descriptions. §5 here is the hand-maintained anchor; the living memory is the dynamic layer on top.

---

## 6. Conventions & guardrails

- All dates JB gives are interpreted in his local (Hawai‘i) context; store `dueDate` as the
  plain calendar date. Use UTC ISO-8601 for `createdAt`/`updatedAt`.
- Don't delete or archive items unless JB asks. To mark something done, set `done: true`
  (the app will archive it on sync). **Archived items auto-expire ~1 month after `archivedAt`**
  (`purgeOldArchived()` in `index.html`) and are tombstoned so they're gone for good — the
  archive never grows without bound.
- Keep the 13 categories, 4 types, and 4 priorities fixed. If a new category/type/priority
  seems needed, **ask first** — adding one also requires matching UI support in `index.html`.
- Keep this file accurate. When the system or JB's preferences change, update it in the same push.
