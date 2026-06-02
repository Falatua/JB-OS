#!/usr/bin/env python3
"""Daily Musubi content-idea drip. Free, no API key.

Each run adds a few fresh, on-brand ideas from a curated pool to
musubi-content.json (skipping any already present), so the Content Ideas board
gets a "daily designer" top-up. Auto entries are capped so the file can't grow
unbounded. To upgrade to true AI generation later, swap this for a Claude API
call (needs ANTHROPIC_API_KEY secret + ~pennies/day) — see the /musubi-ideas command.
"""
import json, random, datetime, os, sys

PATH = "musubi-content.json"
ADD_PER_RUN = 4
MAX_AUTO = 30  # keep at most this many auto-generated ideas in the file

# Curated, on-brand pool (Westside Oʻahu voice, ohana, throwbacks, real models, local).
POOL = [
    ("Sunrise spam-musubi run — film the Westside drive + first light", "local", "Lifestyle reel; pair with the conditions/golden-hour times in JB OS."),
    ("\"Auntie's favorite tee\" — let a real auntie style it her way", "models", "Real person, real fit. No model posing."),
    ("Throwback Thursday: the Kalohe Kai song that defined the summer", "throwback", "Tie the era to a current drop. Island-reggae nostalgia."),
    ("Carousel: 3 ways to wear one Musubi tee, Westside edition", "carousel", "Beach → town → pau hana. Saveable styling content."),
    ("Reel: how the tee is folded + packed (no voiceover, brand soundtrack)", "bts", "Process content builds trust faster than product shots."),
    ("Archie ohana mini-shoot — kid-sized gear at the beach park", "ohana", "Community/family angle. Genuine, not staged."),
    ("Region-real mockup: tee on a Waiʻanae backdrop, not a studio", "local", "Previews should read local and authentic."),
    ("Story poll: which colorway drops next? Let followers pick", "story", "High engagement, signals you listen to the community."),
    ("Reel: 'POV you pull up to a Westside potluck in Musubi'", "reel", "Relatable local humor. Highly shareable."),
    ("Carousel: the meaning behind the design — slide-by-slide", "carousel", "Cultural context earns product posts their place."),
    ("Throwback: old-school flyer aesthetic recreated with the new tee", "throwback", "Nostalgia + product in one frame."),
    ("Models call: feature 3 community members + their why", "models", "UGC-style. Real faces over flat-lays."),
    ("Reel: golden-hour shoot timed to tonight's exact golden hour", "reel", "Use the JB OS conditions widget to nail the light."),
    ("Story series: a day on the Westside, tagged Musubi", "story", "Behind-the-life content keeps you top of feed."),
    ("Product drop teaser — close-ups, no full reveal, countdown sticker", "product", "Build anticipation before the drop."),
    ("Carousel: 'made for the cousins' — the ohana line concept", "ohana", "Family/community as the brand's core."),
    ("Reel: unboxing from a real customer (repost UGC)", "ugc", "Social proof. Ask permission, credit them."),
    ("Local spotlight: shout out a Westside small biz wearing Musubi", "local", "Community-first. Builds real relationships."),
    ("Throwback Thursday: first-ever Musubi photo vs now", "throwback", "Growth story. People love an origin arc."),
    ("BTS: picking fabric / approving a sample on camera", "bts", "Show the craft and the standards."),
    ("Reel: 'things that hit different on the Westside' + tee cameo", "reel", "Trend-style listicle, local flavor."),
    ("Story Q&A: ask me anything about the brand / next drops", "story", "Direct connection; surfaces what people want."),
    ("Carousel: care guide — keep your Musubi tee fresh for years", "carousel", "Useful = saveable. Subtle quality flex."),
    ("Product: the banyan / heritage tee with its story line", "product", "Lead with meaning, then the link."),
    ("Models: pau-hana crew shot, everyone in a different piece", "models", "Group energy; shows range without flat-lays."),
    ("Reel: spam musubi recipe with the tee on the counter", "reel", "Food + brand crossover, very local."),
    ("Throwback: childhood Westside spot revisited in current gear", "throwback", "Place-based nostalgia."),
    ("Story: tide + surf check of the morning (use the JB OS data)", "story", "Daily ritual content followers return for."),
    ("Ohana: matching parent + keiki fits at the beach", "ohana", "Heart-tug content; great for shares."),
    ("BTS: the rejected designs — what didn't make the cut and why", "bts", "Transparency builds taste and trust."),
    ("Carousel: 5 Westside spots to shoot your Musubi fit", "local", "Useful + on-brand; invites UGC."),
    ("Reel: 'getting ready' get-ready-with-me in a Musubi tee", "reel", "GRWM format adapted to the brand."),
    ("Product: restock alert with a 'last time it sold out in X' line", "product", "Scarcity + social proof."),
    ("Models: feature a local athlete / waterman in the gear", "models", "Aspirational but real to the community."),
    ("Throwback Thursday: island-reggae playlist that fits the brand", "throwback", "Pair with the JB OS Vibe player."),
    ("Story: poll two caption options, use the winner on the next post", "story", "Co-create with the audience."),
]


def main():
    if not os.path.exists(PATH):
        print("no", PATH); return
    data = json.load(open(PATH, encoding="utf-8"))
    have = {(i.get("text") or "").strip().lower() for i in data}
    cands = [p for p in POOL if p[0].strip().lower() not in have]
    if not cands:
        print("Pool exhausted — board already has all curated ideas. Nothing to add.")
        return
    random.shuffle(cands)
    add = cands[:ADD_PER_RUN]
    today = datetime.date.today().isoformat()
    for n, (text, cat, note) in enumerate(add):
        data.insert(0, {"id": f"mc-auto-{today}-{n}", "text": text, "cat": cat, "note": note})
    # cap auto entries (keep newest = those nearest the front)
    kept, seen_auto = [], 0
    for item in data:
        if str(item.get("id", "")).startswith("mc-auto-"):
            seen_auto += 1
            if seen_auto > MAX_AUTO:
                continue
        kept.append(item)
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(kept, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Added {len(add)} idea(s):")
    for a in add:
        print("  -", a[0])


if __name__ == "__main__":
    main()
