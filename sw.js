/* ── Service Worker — Můj itinerář v5 ── */
/* Network-only: no caching, clears all old caches on activate */

const CACHE_VERSION = 'mi-v5';

self.addEventListener('install', e => {
    // Skip waiting immediately — replace old SW without delay
    e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
    // Delete every old cache, then claim all clients
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// No fetch handler — all requests go straight to the network.
// This means the app always loads the latest files from GitHub Pages.

self.addEventListener('notificationclick', e => {
    e.notification.close();
    const taskId = e.notification.tag;
    const action = e.action;

    e.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            const openClient = clients.find(c => c.visibilityState === 'visible') || clients[0];
            if (openClient) {
                if (action === 'done')         openClient.postMessage({ type: 'sw_task_done', taskId });
                else if (action === 'snooze1') openClient.postMessage({ type: 'sw_snooze', taskId, hours: 1 });
                else if (action === 'snooze3') openClient.postMessage({ type: 'sw_snooze', taskId, hours: 3 });
                else openClient.focus();
            } else {
                self.clients.openWindow('/');
            }
        })
    );
});
