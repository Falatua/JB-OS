#!/usr/bin/env node
/* Web push sender — runs from reminders.yml at the 5 daily times.
   Reads push subscriptions from Supabase and sends a native push to each device
   (works when JB OS is closed, no third-party app). No-ops if secrets are unset.

   Required GitHub secrets:
     SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC, VAPID_PRIVATE
   Optional: VAPID_SUBJECT (mailto:..., defaults below)
*/
const fs = require('fs');
const https = require('https');

const { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC, VAPID_PRIVATE } = process.env;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:jbguyton16@gmail.com';
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !VAPID_PUBLIC || !VAPID_PRIVATE) {
  console.log('web-push: secrets not set — skipping.'); process.exit(0);
}
let webpush;
try { webpush = require('web-push'); } catch (e) { console.log('web-push lib missing — skipping.'); process.exit(0); }
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE_URL.replace(/\/+$/, '') + path);
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      method, hostname: u.hostname, path: u.pathname + u.search,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

function todayPT() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); }

(async () => {
  let items = [];
  try { items = JSON.parse(fs.readFileSync('todos.json', 'utf8')); } catch (e) {}
  const today = todayPT();
  const act = items.filter(i => !i.archived && !i.done);
  const due = act.filter(i => i.dueDate === today);
  const over = act.filter(i => i.dueDate && i.dueDate < today);
  const parts = [];
  if (due.length) parts.push('Due today: ' + due.slice(0, 4).map(i => i.text).join(', '));
  if (over.length) parts.push(over.length + ' overdue');
  if (!parts.length) parts.push('Nothing due right now — nice.');
  const payload = JSON.stringify({ title: 'JB OS reminder', body: parts.join(' · ') });

  let subs = [];
  try { subs = JSON.parse(await req('GET', '/rest/v1/push_subs?select=id,sub') || '[]'); } catch (e) { console.log('fetch subs failed:', e.message); }
  if (!Array.isArray(subs) || !subs.length) { console.log('No push subscriptions.'); return; }

  for (const row of subs) {
    try { await webpush.sendNotification(row.sub, payload); console.log('pushed →', row.id); }
    catch (e) {
      console.log('push failed', row.id, e.statusCode || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) { // stale subscription — clean up
        try { await req('DELETE', '/rest/v1/push_subs?id=eq.' + encodeURIComponent(row.id)); } catch (_) {}
      }
    }
  }
})().catch(e => { console.error(e); process.exit(0); });
