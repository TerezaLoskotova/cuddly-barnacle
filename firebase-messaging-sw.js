/* Firebase Cloud Messaging service worker
   Handles background push notifications for Můj itinerář
   ──────────────────────────────────────────────────────── */

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey:            'AIzaSyDJRXZqGP3OC43kCr1dgBbOpAt7C60qNhU',
    authDomain:        'muj-itinerar.firebaseapp.com',
    projectId:         'muj-itinerar',
    storageBucket:     'muj-itinerar.firebasestorage.app',
    messagingSenderId: '44845352403',
    appId:             '1:44845352403:web:4c90a250aaf198acc7db26',
});

const messaging = firebase.messaging();
const APP_URL   = 'https://terezaloskotova.github.io/cuddly-barnacle/';

// Background messages (app is closed or tab not focused)
messaging.onBackgroundMessage(payload => {
    const title  = payload.notification?.title || 'Připomínka';
    const body   = payload.notification?.body  || '';
    const taskId = payload.data?.taskId        || '';

    return self.registration.showNotification(title, {
        body,
        icon:     '/cuddly-barnacle/icon-192.png',
        badge:    '/cuddly-barnacle/icon-192.png',
        tag:      `reminder-${taskId}`,
        renotify: true,
        data:     { taskId, url: APP_URL },
        actions:  [
            { action: 'done',    title: '✓ Splněno' },
            { action: 'snooze1', title: '+1 hod'    },
            { action: 'snooze3', title: '+3 hod'    },
        ],
    });
});

// Notification button click
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const { taskId, url } = e.notification.data || {};
    const target = url || APP_URL;

    const postOrOpen = (msg) => e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
            const visible = cls.find(c => c.visibilityState === 'visible') || cls[0];
            if (visible) {
                if (msg) visible.postMessage(msg);
                return visible.focus();
            }
            const nav = msg
                ? `${target}?action=${msg.type}&taskId=${taskId}`
                : target;
            return clients.openWindow(nav);
        })
    );

    if (e.action === 'done'    && taskId) return postOrOpen({ type: 'sw_task_done', taskId });
    if (e.action === 'snooze1' && taskId) return postOrOpen({ type: 'sw_snooze', taskId, hours: 1 });
    if (e.action === 'snooze3' && taskId) return postOrOpen({ type: 'sw_snooze', taskId, hours: 3 });
    return postOrOpen(null);
});
