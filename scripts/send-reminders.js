/**
 * send-reminders.js
 * Run by GitHub Actions every 5 minutes.
 * Checks Firestore for due reminders and sends FCM push notifications.
 */

const admin = require('firebase-admin');

// Service account injected as GitHub Secret
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db        = admin.firestore();
const messaging = admin.messaging();

// ── Prague local time helpers ──────────────────────────────
function getPragueTime() {
    const now  = new Date();
    const fmt  = new Intl.DateTimeFormat('cs-CZ', {
        timeZone: 'Europe/Prague',
        year:     'numeric',
        month:    '2-digit',
        day:      '2-digit',
        hour:     '2-digit',
        minute:   '2-digit',
        hour12:   false,
    });
    const parts  = fmt.formatToParts(now);
    const get    = type => parts.find(p => p.type === type).value;
    const todayStr = `${get('year')}-${get('month')}-${get('day')}`;
    const hh     = get('hour');
    const mm     = get('minute');
    const totalMinutes = parseInt(hh, 10) * 60 + parseInt(mm, 10);
    return { todayStr, hh, mm, totalMinutes };
}

// ── Main ───────────────────────────────────────────────────
async function main() {
    const { todayStr, totalMinutes } = getPragueTime();
    console.log(`Running at Prague time: ${todayStr} ${Math.floor(totalMinutes/60).toString().padStart(2,'0')}:${(totalMinutes%60).toString().padStart(2,'0')}`);

    // Fetch all incomplete reminders (filter fired client-side to handle missing field)
    const snapshot = await db.collection('reminders')
        .where('done', '==', false)
        .get();

    if (snapshot.empty) {
        console.log('No pending reminders.');
        return;
    }

    const sends = [];

    snapshot.forEach(doc => {
        const r = doc.data();
        if (!r.token || !r.reminderTime || !r.date) return;

        if (r.fired === true) return;  // already sent, skip regardless of query
        const [rHH, rMM]      = r.reminderTime.split(':').map(Number);
        const reminderMinutes = rHH * 60 + rMM;

        // Fire if reminder time has already passed today, or date is in the past.
        // The fired:true flag prevents duplicates.
        const isToday    = r.date === todayStr;
        const isPastDate = r.date < todayStr;
        const timePassed = isToday && reminderMinutes <= totalMinutes;

        if (!timePassed && !isPastDate) return;

        const message = {
            token: r.token,
            notification: {
                title: 'Připomínka',
                body:  r.text,
            },
            data: {
                taskId: r.taskId || doc.id,
                type:   'reminder',
            },
            webpush: {
                notification: {
                    icon:     '/cuddly-barnacle/icon-192.png',
                    badge:    '/cuddly-barnacle/icon-192.png',
                    actions: [
                        { action: 'done',    title: '✓ Splněno' },
                        { action: 'snooze1', title: '+1 hod'    },
                        { action: 'snooze3', title: '+3 hod'    },
                    ],
                    requireInteraction: true,
                },
                fcm_options: {
                    link: 'https://terezaloskotova.github.io/cuddly-barnacle/',
                },
            },
        };

        const send = messaging.send(message)
            .then(() => {
                console.log(`✓ Sent reminder for task "${r.text}" (${doc.id})`);
                return db.collection('reminders').doc(doc.id).update({ fired: true });
            })
            .catch(err => {
                console.error(`✗ Failed for ${doc.id}:`, err.message);
                // Remove stale tokens
                if (err.code === 'messaging/registration-token-not-registered') {
                    return db.collection('reminders').doc(doc.id).delete();
                }
            });

        sends.push(send);
    });

    if (sends.length === 0) {
        console.log('No reminders due in this window.');
        return;
    }

    await Promise.all(sends);
    console.log(`Done — processed ${sends.length} reminder(s).`);

    // Daily summary push
    await sendDailySummary(todayStr, totalMinutes);
}

async function sendDailySummary(todayStr, totalMinutes) {
    const settingsDoc = await db.collection('settings').doc('user').get();
    if (!settingsDoc.exists) return;

    const s = settingsDoc.data();
    if (!s.token || !s.summaryTime) return;
    if (s.summaryFiredDate === todayStr) return; // already sent today

    const [sHH, sMM]    = s.summaryTime.split(':').map(Number);
    const summaryMinutes = sHH * 60 + sMM;
    if (totalMinutes < summaryMinutes) return; // not yet time

    await messaging.send({
        token: s.token,
        notification: {
            title: 'Shrnutí dne 📋',
            body:  'Jak ti šel dnešní den? Klikni pro přehled úkolů.',
        },
        webpush: {
            notification: {
                icon:  '/cuddly-barnacle/icon-192.png',
                badge: '/cuddly-barnacle/icon-192.png',
                requireInteraction: false,
            },
            fcm_options: {
                link: 'https://terezaloskotova.github.io/cuddly-barnacle/',
            },
        },
    }).catch(err => console.error('✗ Summary push failed:', err.message));

    await db.collection('settings').doc('user').update({ summaryFiredDate: todayStr });
    console.log(`✓ Sent daily summary notification (summaryTime: ${s.summaryTime}).`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
