/* ── Service Worker — Můj itinerář ── */
const CACHE      = 'mi-v4';   // bump version → old cache cleared on activate
const APP_SHELL  = ['/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(APP_SHELL))
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

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;

    const url = new URL(e.request.url);
    const isAppShell = APP_SHELL.includes(url.pathname) || url.pathname === '/';

    if (isAppShell) {
        // Network first for HTML/CSS/JS → always load latest code
        // Fall back to cache only when offline
        e.respondWith(
            fetch(e.request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                    return response;
                })
                .catch(() => caches.match(e.request))
        );
    } else {
        // Cache first for icons and other static assets
        e.respondWith(
            caches.match(e.request).then(cached => cached || fetch(e.request))
        );
    }
});

// ── Notification action handling ──────────────────────────
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const taskId = e.notification.tag;
    const action = e.action;

    e.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            const openClient = clients.find(c => c.visibilityState === 'visible') || clients[0];
            if (openClient) {
                if (action === 'done')    openClient.postMessage({ type: 'sw_task_done', taskId });
                else if (action === 'snooze1') openClient.postMessage({ type: 'sw_snooze', taskId, hours: 1 });
                else if (action === 'snooze3') openClient.postMessage({ type: 'sw_snooze', taskId, hours: 3 });
                else openClient.focus();
            } else {
                self.clients.openWindow('/');
            }
        })
    );
});
