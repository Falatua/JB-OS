#!/usr/bin/env python3
"""Reminder push → phone via ntfy (free, no account, works when the app is closed).

Fires from the reminders.yml workflow at the 5 daily times. Builds a reminder from
JB OS data (what's due/overdue) + a Redondo Beach weather line, and pushes it to your
ntfy topic. No-ops cleanly if NTFY_TOPIC isn't set.

Setup (one time):
  1. Install the free "ntfy" app (iOS/Android), pick a hard-to-guess topic, subscribe.
  2. Repo → Settings → Secrets and variables → Actions → New secret
     name: NTFY_TOPIC   value: <your topic>
"""
import json, os, sys, datetime, urllib.request, urllib.parse

LAT, LON = 33.8492, -118.3884  # Redondo Beach, CA
APP_URL = "https://falatua.github.io/JB-OS/"
WMO = {0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog",
       48: "Fog", 51: "Drizzle", 61: "Rain", 63: "Rain", 65: "Heavy rain",
       80: "Showers", 81: "Showers", 95: "Storms"}


def now_pt():
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo("America/Los_Angeles"))
    except Exception:
        return datetime.datetime.utcnow() - datetime.timedelta(hours=7)


def get_json(url):
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            return json.load(r)
    except Exception as e:
        print("weather fetch failed:", e); return None


def weather_line():
    d = get_json("https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s"
                 "&current=temperature_2m,weather_code&temperature_unit=fahrenheit"
                 "&timezone=America/Los_Angeles&forecast_days=1" % (LAT, LON))
    if not d:
        return None
    cur = d.get("current", {})
    t = cur.get("temperature_2m")
    if t is None:
        return None
    return "%s°F %s, Redondo Beach" % (round(t), WMO.get(cur.get("weather_code"), ""))


def main():
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    n = now_pt()
    today = n.date().isoformat()
    greet = "Morning" if n.hour < 11 else "Midday" if n.hour < 14 else "Afternoon" if n.hour < 18 else "Evening"
    try:
        items = json.load(open("todos.json", encoding="utf-8"))
    except Exception:
        items = []
    act = [i for i in items if not i.get("archived") and not i.get("done")]
    overdue = [i for i in act if i.get("dueDate") and i["dueDate"] < today]
    due = [i for i in act if i.get("dueDate") == today]
    high = [i for i in act if i.get("priority") == "high" and i not in due and i not in overdue]

    lines = []
    if due:
        lines.append("📌 Due today: " + ", ".join(i.get("text", "?") for i in due[:5]))
    if overdue:
        lines.append("⚠️ Overdue (%d): %s" % (len(overdue), ", ".join(i.get("text", "?") for i in overdue[:4])))
    if high and not due and not overdue:
        lines.append("⭐ High priority: " + ", ".join(i.get("text", "?") for i in high[:3]))
    if not due and not overdue and not high:
        lines.append("✅ Nothing due right now — nice.")
    w = weather_line()
    if w:
        lines.append("☀️ " + w)
    body = "\n".join(lines)
    title = "JB OS - %s reminder" % greet

    print("=== %s ===\n%s" % (title, body))
    if not topic:
        print("\nNTFY_TOPIC not set — printed only (no push). See script header for setup.")
        return
    try:
        req = urllib.request.Request(
            "https://ntfy.sh/" + urllib.parse.quote(topic),
            data=body.encode("utf-8"), method="POST",
            headers={"Title": title, "Tags": "bell", "Click": APP_URL, "Priority": "default"})
        urllib.request.urlopen(req, timeout=15)
        print("\nPushed to ntfy.")
    except Exception as e:
        print("ntfy push failed:", e)
    sys.exit(0)  # never fail the workflow


if __name__ == "__main__":
    main()
