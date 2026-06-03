# Screenshot Capture — setup

Turns an iOS screenshot into an auto-classified **Note** (default) or **Task** in JB OS.
The web client is already wired up (the **Capture** camera button in the header, plus paste/drag-drop).
Two one-time setup steps remain: the Supabase backend, and the iOS Shortcut.

The Anthropic API key lives **only** in Supabase (never in the web app). Model: **Claude Haiku 4.5**.
Hard cap: **$1.00/day**, enforced server-side (≈ $0.001–0.002 per screenshot → ~500–1000/day).

---

## 1. Supabase backend (one time)

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) and the project ref
(`jdkfafvfczzgtzhtynjr`).

```bash
# from repo root
supabase link --project-ref jdkfafvfczzgtzhtynjr

# secrets (Anthropic key + a random token you invent for the iOS Shortcut)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
supabase secrets set JBOS_SHORTCUT_TOKEN=$(openssl rand -hex 24)   # copy this value for step 2
# (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)

# deploy the function (no-verify-jwt: the Shortcut authenticates with the token instead of a JWT;
# the function still verifies the web client's JWT internally)
supabase functions deploy analyze-screenshot --no-verify-jwt
```

Create the Storage bucket (Dashboard → Storage → New bucket):
- **Name:** `screenshots`
- **Public:** yes (images are referenced by public URL on note cards)

That's it for the in-app path — open JB OS, hit **Capture**, and paste/drop a screenshot.

> Print the shortcut token any time with `supabase secrets list` (value is hidden) — keep the one
> you generated above; you'll paste it into the Shortcut next.

---

## 2. iOS Shortcut "Save to JB OS" (one time)

> Why a Shortcut and not the share sheet directly? iOS Safari doesn't support the Web Share Target
> API, so a PWA can't register in the share sheet. A Shortcut can — and gives the exact
> "screenshot → Share → Save to JB OS" gesture.

In the **Shortcuts** app → **+** → name it **Save to JB OS** → enable
**Show in Share Sheet** (i in the top bar) and set **Accept: Images**. Then add these actions:

1. **Repeat with Each** — `Shortcut Input` (handles batch shares; each screenshot becomes its own note)
2. Inside the repeat:
   - **Resize Image** → `Repeat Item`, Width **1200** (Longest Edge)
   - **Base64 Encode** → the resized image (turn **Line Breaks: None**)
   - **Get Contents of URL**
     - URL: `https://jdkfafvfczzgtzhtynjr.supabase.co/functions/v1/analyze-screenshot`
     - Method: **POST**
     - Headers:
       - `x-jbos-token` = *(the JBOS_SHORTCUT_TOKEN from step 1)*
       - `Content-Type` = `application/json`
     - Request Body: **JSON**
       - `image` = *(Base64 Encoded text from above)*
       - `persist` = `true` (Boolean)
   - *(optional)* **Get Dictionary Value** `title` from `Contents of URL` → **Show Notification** with it
3. *(optional, outside the repeat)* **Show Notification** "Saved to JB OS"

Now: take a screenshot → tap **Share** (or the screenshot preview → Share) → **Save to JB OS**.
The note appears in JB OS automatically (live if the app is open, otherwise on next load).
Select multiple screenshots and share them all at once — the Repeat loop handles the batch.

---

## How it routes (so you know what to expect)

- **Default is a Note.** Restaurants, articles, inspiration, products to maybe-someday look at,
  places, ideas → notes you revisit at leisure (land in the **Notes** bucket).
- **Task only on a clear action** — a checkout/cart, a reservation, a bill to pay, a reply to send →
  lands in the **Tasks** bucket.
- It also extracts a **useful link** when it can (a Maps link for a place, the product/article URL).
- Everything is editable after the fact — recategorize by dragging onto a Life Area, or convert
  note↔task in the detail panel. Each captured item keeps the original screenshot attached and a
  📸 "via screenshot" marker.

## Files
- `supabase/functions/analyze-screenshot/index.ts` — the Edge Function (proxy + vision + routing + cap + storage)
- `index.html` — Capture button, capture modal, resize/paste/drag, `captureScreenshots` / `createCapturedItem`
