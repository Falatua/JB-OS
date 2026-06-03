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
| `todos.json` | tasks / ideas / notes / projects | List, Calendar, Dashboard |
| `daily.json` | recurring **daily** routines (streak-tracked) | Daily tab |
| `monthly.json` | recurring **monthly** items | Monthly tab |
| `journal-prompts.json` | journaling prompts | Journal tab |
| `calendar.ics` | calendar events | Calendar tab |

**Most things go in `todos.json`.** Only use the others when the item is genuinely a daily
habit, a monthly recurring item, a journaling prompt, or a dated calendar event.

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
  "priority": "normal",            // high | in_progress | normal | low
  "category": "work",              // see §3
  "source": "chat",                // chat (default for me) | telegram | browser
  "done": false,
  "archived": false,
  "createdAt": "2026-06-01T00:00:00Z"   // ISO-8601 UTC
}
```

Optional fields: `dueDate` ("YYYY-MM-DD"), `links` ([]), `attachments` ([]), `updatedAt`,
`archivedAt`. Keep `description` to the things that aren't obvious from the title; don't pad.

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
- **task** — a concrete action with a clear done-state. *"Buy more tuna", "Pay birth bill".*
- **task** also includes investigation/action prompts such as *"Look into Obsidian"*,
  *"Research second-brain tools"*, or *"Check out X"*.
- **idea** — a possibility to explore later; no commitment yet. *"Auntie's-favorite-tee concept".*
- **note** — reference info, an FYI, context, or an event/fact without a direct done-state.
  *"Dad in town Jun 7–11"* is a note, not a task.
- **project** — a multi-step ongoing effort. **JB's preference: do NOT create umbrella
  project items.** Big efforts (Musubi Strong, JB OS, Roman TD) are tracked as discrete
  tasks/ideas/notes tagged to a category instead. Only use `project` if JB explicitly asks.

### `category` (fixed set — never invent new ones)
| Category | Use for |
|----------|---------|
| `musubi` | Anything for the **Musubi Strong** brand (product, content, IG, store, designs, shoots). All Musubi brand work lives here — **not** in `work`. |
| `work` | **AnswerLab** (day job) + JB's side/freelance **design** work (e.g. Heber). Nothing Musubi-related. |
| `tech` | Coding, AI tools, devices, emulation/ROMs, the JB OS app, Roman TD, servers |
| `finance` | Bills, taxes, investing, rent, payments |
| `family` | Mackenzie (partner), JB's dad, extended family |
| `kids` | Archie / baby gear, pumps, nursery, kid stuff |
| `health` | Training/hypertrophy, diet, medical, appointments |
| `shopping` | Buying non-food goods |
| `grocery` | Food/grocery items |
| `errands` | Run-around-town chores (coins to cash, key fob batteries) |
| `personal` | Self, relationships, personal growth, admin |
| `lifestyle` | Leisure, hobbies, vibe/identity |
| `general` | Only when nothing else fits |

### `priority`
- **high** — money is at stake, there's a hard deadline, or it blocks something else.
- **in_progress** — actively being worked, handed off, or waiting on a current next step.
- **normal** — everything else (the default).
- **low** — someday, nice-to-have, or intentionally de-emphasized.

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
2. **Classify** with §3 (type, category, priority, dueDate, emoji).
3. **Write** a clean `text` + `notes` (+ `description` if there's useful context). Use JB's
   context (§5) to enrich — e.g. tie a Musubi idea to existing Musubi direction.
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
- **Side dev:** **Roman TD** (a tower-defense game he ships) and **JB OS** itself.
- **Fitness:** hypertrophy / weight training; follows Mike Israetel / RP.
- **Tech stack & interests:** Claude Code, GitHub Pages, VPS, Obsidian, AI agents (Manus),
  retro-game emulation (3DS/Switch ROMs, Dropbox backups).
- **Family:** Dad visits periodically.

> If any of the above is wrong, JB will correct it — update this section when he does.

---

## 6. Conventions & guardrails

- All dates JB gives are interpreted in his local (Hawai‘i) context; store `dueDate` as the
  plain calendar date. Use UTC ISO-8601 for `createdAt`/`updatedAt`.
- Don't delete or archive items unless JB asks. To mark something done, set `done: true`
  (the app will archive it on sync).
- Keep the 13 categories, 4 types, and 4 priorities fixed. If a new category/type/priority
  seems needed, **ask first** — adding one also requires matching UI support in `index.html`.
- Keep this file accurate. When the system or JB's preferences change, update it in the same push.
