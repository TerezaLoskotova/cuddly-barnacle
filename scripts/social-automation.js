/**
 * social-automation.js
 * ─────────────────────────────────────────────────────────────
 * Spouštěno GitHub Actions (každý den v nastavený čas).
 *
 * Co dělá:
 *  1. Načte nastavení z Firestore (zdroje, platformy, čas)
 *  2. Stáhne RSS kanály z aktivních zdrojů
 *  3. Vybere nejzajímavější články (scoring)
 *  4. Vygeneruje příspěvky pro každou platformu
 *  5. Uloží příspěvky do Firestore jako "pending"
 *  6. Odešle příspěvky naplánované na dnešek na sítě
 *  7. Zapíše log do Firestore
 *
 * Vyžaduje GitHub Secrets:
 *   FIREBASE_SERVICE_ACCOUNT   – JSON klíč Firebase Admin
 *   TWITTER_API_KEY            – (volitelné) Twitter/X API
 *   TWITTER_API_SECRET
 *   TWITTER_ACCESS_TOKEN
 *   TWITTER_ACCESS_SECRET
 *   LINKEDIN_ACCESS_TOKEN      – (volitelné) LinkedIn
 *   LINKEDIN_PERSON_URN
 *   FACEBOOK_PAGE_ACCESS_TOKEN – (volitelné) Facebook
 *   FACEBOOK_PAGE_ID
 *   INSTAGRAM_ACCESS_TOKEN     – (volitelné) Instagram
 *   INSTAGRAM_ACCOUNT_ID
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const admin   = require('firebase-admin');
const Parser  = require('rss-parser');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const crypto  = require('crypto');
const OAuth   = require('oauth-1.0a');

// ── Firebase init ─────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Prague time helper ────────────────────────────────────
function getPragueDate() {
    const fmt = new Intl.DateTimeFormat('cs-CZ', {
        timeZone: 'Europe/Prague',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts  = fmt.formatToParts(new Date());
    const get    = type => parts.find(p => p.type === type).value;
    return {
        dateStr:     `${get('year')}-${get('month')}-${get('day')}`,
        timeStr:     `${get('hour')}:${get('minute')}`,
        totalMinutes: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10),
    };
}

// ── Load settings ─────────────────────────────────────────
async function loadSettings() {
    const doc = await db.collection('social_settings').doc('user').get();
    const defaults = {
        sources: [
            { id: 'ct24',    name: 'ČT24',      url: 'https://ct24.ceskatelevize.cz/rss/hlavni-zpravy', active: true },
            { id: 'idnes',   name: 'iDnes',      url: 'https://servis.idnes.cz/rss.aspx?c=zpravodaj',   active: true },
            { id: 'novinky', name: 'Novinky.cz', url: 'https://www.novinky.cz/rss',                      active: true },
        ],
        platforms:    { twitter: false, linkedin: false, facebook: false, instagram: false },
        scheduleTime: '09:00',
        timezone:     'Europe/Prague',
        autoGenerate: true,
        postsPerDay:  3,
    };
    return doc.exists ? { ...defaults, ...doc.data() } : defaults;
}

// ── RSS fetch ─────────────────────────────────────────────
async function fetchFeed(source) {
    const parser = new Parser({ timeout: 10000, headers: { 'User-Agent': 'SocialAutomation/1.0' } });
    try {
        const feed  = await parser.parseURL(source.url);
        return (feed.items || []).slice(0, 20).map(item => ({
            title:       item.title || '',
            link:        item.link  || item.guid || '',
            summary:     item.contentSnippet || item.summary || item.content || '',
            pubDate:     item.pubDate ? new Date(item.pubDate) : new Date(),
            sourceName:  source.name,
            sourceId:    source.id,
        }));
    } catch (err) {
        console.warn(`⚠ Feed ${source.name} selhal: ${err.message}`);
        return [];
    }
}

// ── Score article ─────────────────────────────────────────
// Higher = more interesting. Combines recency + keyword relevance.
const BOOST_KEYWORDS = [
    'nový', 'nová', 'nové', 'spouštíme', 'spustit', 'přichází', 'přichází',
    'trendy', 'AI', 'umělá inteligence', 'technologie', 'inovace', 'startup',
    'výsledky', 'rekord', 'průlom', 'revoluce', 'budoucnost',
    'jak', 'průvodce', 'tipy', 'návod', 'top', 'nejlepší',
];

function scoreArticle(article) {
    const ageHours = (Date.now() - article.pubDate.getTime()) / 3_600_000;
    const recency  = Math.max(0, 100 - ageHours * 2);                       // decays over 50 h
    const text     = (article.title + ' ' + article.summary).toLowerCase();
    const keywords = BOOST_KEYWORDS.reduce((acc, kw) =>
        acc + (text.includes(kw.toLowerCase()) ? 10 : 0), 0);
    return recency + keywords;
}

// ── Post generator ────────────────────────────────────────
// Platform limits: Twitter 280, LinkedIn 3000, Facebook 63206, Instagram 2200

const TEMPLATES = {
    twitter: [
        (a) => `${trimTo(a.title, 200)}\n\n${a.link} #${a.sourceName.replace(/\s/g,'')}`,
        (a) => `Zajímavé: ${trimTo(a.title, 180)}\n${a.link}`,
        (a) => `${trimTo(a.title, 230)}\n\nZdroj: ${a.sourceName} ${a.link}`,
    ],
    linkedin: [
        (a) => `${a.title}\n\n${trimTo(a.summary, 400)}\n\n${a.link}\n\n#${a.sourceName.replace(/\s/g,'')} #zpravy`,
        (a) => `Přečtěte si:\n\n${a.title}\n\n${trimTo(a.summary, 500)}\n\n${a.link}`,
    ],
    facebook: [
        (a) => `${a.title}\n\n${trimTo(a.summary, 600)}\n\n${a.link}`,
        (a) => `Zajímavý článek ze zdroje ${a.sourceName}:\n\n${a.title}\n\n${a.link}`,
    ],
    instagram: [
        (a) => `${a.title}\n\n${trimTo(a.summary, 300)}\n\n#${a.sourceName.replace(/\s/g,'')} #zpravy #aktuality`,
        (a) => `Věděli jste?\n\n${trimTo(a.title, 200)}\n\n${trimTo(a.summary, 350)}\n\n#aktuality`,
    ],
};

function trimTo(str, max) {
    const s = (str || '').trim();
    return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function generatePost(article, platform) {
    const tpls = TEMPLATES[platform] || TEMPLATES.facebook;
    const tpl  = tpls[Math.floor(Math.random() * tpls.length)];
    return tpl(article);
}

// ── Build scheduled posts ──────────────────────────────────
function buildScheduledPosts(articles, settings, dateStr, scheduleTime) {
    const activePlatforms = Object.entries(settings.platforms)
        .filter(([, on]) => on)
        .map(([name]) => name);

    if (activePlatforms.length === 0 || articles.length === 0) return [];

    const posts = [];
    const count = Math.min(settings.postsPerDay || 3, articles.length);

    for (let i = 0; i < count; i++) {
        const article = articles[i];
        // Stagger posts by 2 hours from schedule time
        const [h, m]  = scheduleTime.split(':').map(Number);
        const mins    = h * 60 + m + i * 120;
        const postH   = String(Math.min(Math.floor(mins / 60), 23)).padStart(2, '0');
        const postM   = String(mins % 60).padStart(2, '0');

        // Generate platform-specific variants or one text for all platforms
        const primaryPlatform = activePlatforms[0];
        const text = generatePost(article, primaryPlatform);

        posts.push({
            id:          `auto_${dateStr}_${i}_${Date.now().toString(36)}`,
            text,
            platforms:   activePlatforms,
            scheduledAt: `${dateStr}T${postH}:${postM}:00`,
            status:      'pending',
            sourceTitle: article.title,
            sourceUrl:   article.link,
            sourceName:  article.sourceName,
            createdAt:   new Date().toISOString(),
            autoGenerated: true,
        });
    }

    return posts;
}

// ── Save posts to Firestore ───────────────────────────────
async function savePosts(posts) {
    const batch = db.batch();
    for (const post of posts) {
        const ref = db.collection('social_posts').doc(post.id);
        batch.set(ref, post);
    }
    await batch.commit();
    console.log(`✓ Uloženo ${posts.length} příspěvků do fronty.`);
}

// ── Platform posting ──────────────────────────────────────

async function postToTwitter(text) {
    const apiKey       = process.env.TWITTER_API_KEY;
    const apiSecret    = process.env.TWITTER_API_SECRET;
    const accessToken  = process.env.TWITTER_ACCESS_TOKEN;
    const accessSecret = process.env.TWITTER_ACCESS_SECRET;

    if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
        console.log('  Twitter: přeskočeno (chybí secrets)');
        return false;
    }

    const oauth = OAuth({
        consumer: { key: apiKey, secret: apiSecret },
        signature_method: 'HMAC-SHA1',
        hash_function(baseString, key) {
            return crypto.createHmac('sha1', key).update(baseString).digest('base64');
        },
    });

    const url     = 'https://api.twitter.com/2/tweets';
    const reqData = { url, method: 'POST' };
    const token   = { key: accessToken, secret: accessSecret };
    const headers = { ...oauth.toHeader(oauth.authorize(reqData, token)), 'Content-Type': 'application/json' };

    try {
        const res  = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ text: text.slice(0, 280) }) });
        const json = await res.json();
        if (json.data?.id) {
            console.log(`  ✓ Twitter: tweet ${json.data.id}`);
            return true;
        }
        console.warn(`  ✗ Twitter: ${JSON.stringify(json)}`);
        return false;
    } catch (err) {
        console.error(`  ✗ Twitter chyba: ${err.message}`);
        return false;
    }
}

async function postToLinkedIn(text) {
    const token     = process.env.LINKEDIN_ACCESS_TOKEN;
    const personUrn = process.env.LINKEDIN_PERSON_URN;

    if (!token || !personUrn) {
        console.log('  LinkedIn: přeskočeno (chybí secrets)');
        return false;
    }

    const body = {
        author:     personUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary:    { text },
                shareMediaCategory: 'NONE',
            },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };

    try {
        const res  = await fetch('https://api.linkedin.com/v2/ugcPosts', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
            body: JSON.stringify(body),
        });
        if (res.ok) {
            const json = await res.json();
            console.log(`  ✓ LinkedIn: post ${json.id}`);
            return true;
        }
        const err = await res.text();
        console.warn(`  ✗ LinkedIn: ${err}`);
        return false;
    } catch (err) {
        console.error(`  ✗ LinkedIn chyba: ${err.message}`);
        return false;
    }
}

async function postToFacebook(text) {
    const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    const pageId    = process.env.FACEBOOK_PAGE_ID;

    if (!pageToken || !pageId) {
        console.log('  Facebook: přeskočeno (chybí secrets)');
        return false;
    }

    try {
        const res  = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, access_token: pageToken }),
        });
        const json = await res.json();
        if (json.id) {
            console.log(`  ✓ Facebook: post ${json.id}`);
            return true;
        }
        console.warn(`  ✗ Facebook: ${JSON.stringify(json.error || json)}`);
        return false;
    } catch (err) {
        console.error(`  ✗ Facebook chyba: ${err.message}`);
        return false;
    }
}

async function postToInstagram(text, imageUrl) {
    const token     = process.env.INSTAGRAM_ACCESS_TOKEN;
    const accountId = process.env.INSTAGRAM_ACCOUNT_ID;

    if (!token || !accountId) {
        console.log('  Instagram: přeskočeno (chybí secrets)');
        return false;
    }
    if (!imageUrl) {
        console.log('  Instagram: přeskočeno (chybí obrázek)');
        return false;
    }

    try {
        // Step 1: create container
        const containerRes = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: imageUrl, caption: text.slice(0, 2200), access_token: token }),
        });
        const container = await containerRes.json();
        if (!container.id) {
            console.warn(`  ✗ Instagram container: ${JSON.stringify(container)}`);
            return false;
        }

        // Step 2: publish
        const publishRes = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id: container.id, access_token: token }),
        });
        const published = await publishRes.json();
        if (published.id) {
            console.log(`  ✓ Instagram: post ${published.id}`);
            return true;
        }
        console.warn(`  ✗ Instagram publish: ${JSON.stringify(published)}`);
        return false;
    } catch (err) {
        console.error(`  ✗ Instagram chyba: ${err.message}`);
        return false;
    }
}

// ── Dispatch post to all its platforms ───────────────────
async function dispatchPost(post) {
    const platforms = post.platforms || [];
    const results   = {};

    for (const pl of platforms) {
        let ok = false;
        if (pl === 'twitter')   ok = await postToTwitter(post.text);
        if (pl === 'linkedin')  ok = await postToLinkedIn(post.text);
        if (pl === 'facebook')  ok = await postToFacebook(post.text);
        if (pl === 'instagram') ok = await postToInstagram(post.text, post.imageUrl || null);
        results[pl] = ok;
    }

    const allOk = Object.values(results).every(Boolean);
    return { results, status: allOk ? 'posted' : (Object.values(results).some(Boolean) ? 'posted' : 'failed') };
}

// ── Mark post as sent in Firestore ────────────────────────
async function markPostSent(postId, status, platformResults) {
    await db.collection('social_posts').doc(postId).update({
        status,
        sentAt:          new Date().toISOString(),
        platformResults,
    });
}

// ── Main ─────────────────────────────────────────────────
async function main() {
    const { dateStr, timeStr, totalMinutes } = getPragueDate();
    console.log(`\n══ Social Automation — ${dateStr} ${timeStr} ══\n`);

    const settings = await loadSettings();
    console.log(`Nastavení: autoGenerate=${settings.autoGenerate}, platforms=${JSON.stringify(settings.platforms)}`);

    let generated = 0;
    let sent      = 0;

    // ── 1. Generate new posts from RSS (once per day) ──────
    if (settings.autoGenerate) {
        // Check we haven't already generated for today
        const todayLog = await db.collection('social_settings').doc('automation_log').get();
        const lastRun  = todayLog.exists ? todayLog.data().lastGenerateDate : null;

        if (lastRun !== dateStr) {
            console.log('Stahuji RSS zdroje…');
            const activeSources = (settings.sources || []).filter(s => s.active);
            const allArticles   = [];

            for (const source of activeSources) {
                const items = await fetchFeed(source);
                allArticles.push(...items);
                console.log(`  ${source.name}: ${items.length} článků`);
            }

            // Score and sort
            allArticles.sort((a, b) => scoreArticle(b) - scoreArticle(a));

            const posts = buildScheduledPosts(allArticles, settings, dateStr, settings.scheduleTime || '09:00');
            if (posts.length > 0) {
                await savePosts(posts);
                generated = posts.length;
                console.log(`Vygenerováno ${generated} příspěvků.`);
            } else {
                console.log('Žádné příspěvky k vygenerování (žádné aktivní platformy nebo zdroje).');
            }

            // Update log
            await db.collection('social_settings').doc('automation_log').set({
                lastGenerateDate: dateStr,
                lastRun:          new Date().toISOString(),
                generated,
            }, { merge: true });
        } else {
            console.log(`Příspěvky pro ${dateStr} už byly vygenerovány.`);
        }
    }

    // ── 2. Send posts due now ──────────────────────────────
    console.log('\nKontroluji příspěvky ke zveřejnění…');

    const snap = await db.collection('social_posts')
        .where('status', '==', 'pending')
        .get();

    const due = [];
    snap.forEach(doc => {
        const post = { id: doc.id, ...doc.data() };
        if (!post.scheduledAt) return;
        const scheduled = new Date(post.scheduledAt);
        // consider "due" if scheduled time ≤ now (within this UTC run)
        if (scheduled <= new Date()) {
            due.push(post);
        }
    });

    console.log(`Nalezeno ${due.length} příspěvků ke zveřejnění.`);

    for (const post of due) {
        console.log(`\nPublikuji: "${post.text.slice(0, 60)}…"`);
        const { status, results } = await dispatchPost(post);
        await markPostSent(post.id, status, results);
        if (status === 'posted') sent++;
        console.log(`  Status: ${status}`);
    }

    // ── 3. Update run log ──────────────────────────────────
    await db.collection('social_settings').doc('automation_log').set({
        lastRun:   new Date().toISOString(),
        generated,
        sent,
    }, { merge: true });

    console.log(`\n══ Hotovo — vygenerováno: ${generated}, odesláno: ${sent} ══\n`);
}

main().catch(err => {
    console.error('Fatální chyba:', err);
    process.exit(1);
});
