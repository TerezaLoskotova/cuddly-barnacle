/* ── Service Worker — Můj itinerář ── */
const CACHE  = 'mi-v2';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});

// ── Notification action handling ──────────────────────────
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const taskId = e.notification.tag;
    const action = e.action; // 'done' | 'snooze1' | 'snooze3' | ''

    e.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            // Try to find an open window and post a message to it
            const openClient = clients.find(c => c.visibilityState === 'visible') || clients[0];
            if (openClient) {
                if (action === 'done') {
                    openClient.postMessage({ type: 'sw_task_done', taskId });
                } else if (action === 'snooze1') {
                    openClient.postMessage({ type: 'sw_snooze', taskId, hours: 1 });
                } else if (action === 'snooze3') {
                    openClient.postMessage({ type: 'sw_snooze', taskId, hours: 3 });
                } else {
                    openClient.focus();
                }
            } else {
                // No open window — open the app
                self.clients.openWindow('/');
            }
        })
    );
});
