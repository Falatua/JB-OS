/* JB OS service worker — offline support via network-first with cache fallback.
   Network-first keeps the live GitHub Pages sync intact (fresh data when online),
   and falls back to the last cached copy when offline. */
const CACHE = 'jbos-v6';
const SHELL = [
  './', './index.html', './manifest.json',
  './todos.json', './daily.json', './weekly.json', './monthly.json',
  './journal-prompts.json', './calendar.ics',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Web push: show the notification pushed by the reminders Action (works when app is closed)
self.addEventListener('push', e => {
  let data = { title: 'JB OS reminder', body: 'Tap to open your tasks.' };
  try { if (e.data) data = Object.assign(data, e.data.json()); }
  catch (err) { if (e.data) data.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'jbos-push', renotify: true, data: { url: './' }
  }));
});

// Focus (or open) the app when a reminder notification is tapped
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cl => {
      for (const c of cl) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Cache under a query-stripped key so the app's ?v=<timestamp> cache-busting
  // doesn't accumulate a new entry on every launch (each fetch would otherwise
  // be a unique URL). Offline lookups use ignoreSearch, so they still match.
  const key = req.url.split('?')[0];
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(r => r || caches.match('./index.html')))
  );
});
