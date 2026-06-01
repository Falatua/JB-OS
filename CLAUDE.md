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
  "priority": "normal",            // normal | high
  "category": "work",              // see §3
  "source": "chat",                // chat (default for me) | telegram | browser
  "done": false,
  "archived": false,
  "createdAt": "2026-06-01T00:00:00Z"   // ISO-8601 UTC
}
```

Optional fields: `dueDate` ("YYYY-MM-DD"), `links` ([]), `attachments` ([]), `updatedAt`,
`archivedAt`. Keep `description` to the things that aren't obvious from the title; don't pad.

### ID rules
- Chat-sourced: `c-<short-slug>` (e.g. `c-coins-cash`, `c-heber-designs`).
- **Always verify the `id` is unique** against the current file before writing.
- Never reuse or renumber another item's `id`.

---

## 3. Classification rubric (be rigid)

### `type`
- **task** — a concrete action with a clear done-state. *"Buy more tuna", "Pay birth bill".*
- **idea** — a possibility to explore later; no commitment yet. *"Auntie's-favorite-tee concept".*
- **note** — reference info, an FYI, or "look into X". *"Dad in town Jun 7–11", "Look into Obsidian".*
- **project** — a multi-step ongoing effort. Use sparingly; prefer discrete tasks unless JB
  asks for an umbrella item. *(Currently none in use — confirm before introducing.)*

### `category` (fixed set — never invent new ones)
| Category | Use for |
|----------|---------|
| `musubi` | Anything for the **Musubi Strong** brand (product, content, IG, store, designs, shoots) |
| `work` | JB's day job (**Ancer Lab**) and other non-Musubi work |
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
- **normal** — everything else (the default).

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

- **Location:** Westside Oʻahu, Hawai‘i. Local/island voice matters for Musubi.
- **Partner:** Mackenzie ("Kenzie").
- **Kids:** Archie (baby — appears in baby-gear and Musubi photo-shoot items).
- **Business:** **Musubi Strong** — a local Hawai‘i apparel brand. Shopify store + Instagram
  growth + original designs. Has its own tab and `musubi` category. Content directions on file:
  use more real models, region-realistic mockups, "auntie's favorite tee", Throwback Thursdays.
- **Day job:** **Ancer Lab** (writes reports / end-of-day updates).
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
- Keep the 13 categories and 4 types fixed. If a new category seems needed, **ask first** —
  adding one also requires a matching entry in `CATS` in `index.html`.
- Keep this file accurate. When the system or JB's preferences change, update it in the same push.
