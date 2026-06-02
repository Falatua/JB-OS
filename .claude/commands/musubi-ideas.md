---
description: "Brainstorm on-brand Musubi Strong Instagram content ideas and file them into the Content Ideas board (musubi-content.json), then push live."
argument-hint: [optional theme, count, or angle — e.g. "5 throwback reels"]
---
Generate fresh **Musubi Strong** Instagram content ideas and add them to JB's Content Ideas board.

## Context to honor (JB's brand)
- Local Hawaiʻi apparel brand, **Westside Oʻahu** voice. Authentic island/local tone — never touristy or generic.
- On-file direction: **"auntie's favorite tee"**, **use real community models** (not flat-lays), **region-realistic mockups**, **Throwback Thursdays tied to Kalohe Kai / island-reggae era**, **ohana/family angle** (Archie appears in shoots).
- Keep it real and specific — each idea should pass: *"Would someone send this to a person they care about?"*

## What to do
1. Read `musubi-content.json` to see what's already there and avoid duplicates; note the existing `id`s.
2. Brainstorm the requested ideas (default: **5** if no count given). Weave in JB's brand direction above; tailor to any theme/angle in: $ARGUMENTS
3. For each idea, write an object: `{ "id": "mc-<short-slug>", "text": "<scroll-stopping idea>", "cat": "<category>", "note": "<one-line why/how>" }`.
   - `cat` must be one of: `reel`, `carousel`, `story`, `throwback`, `product`, `models`, `local`, `ohana`, `bts`, `other` (these match the board's categories).
   - Ensure every `id` is unique vs. the existing file.
4. Append them to `musubi-content.json`, then **validate** (`python3 -m json.tool musubi-content.json`).
5. Commit to `main` and push (no PR) — the board syncs them in on next load.
6. Recap the ideas you added in 1–2 lines each (title + format).

Keep ideas concrete and produceable, not vague themes. Quality over quantity.
