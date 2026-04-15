/* ──────────────────────────────────────────────────────────
   social.js  –  Automatizace sociálních sítí
   Reads/writes to Firestore collection "social_posts" and
   "social_settings" (same Firebase project as main app).
   ────────────────────────────────────────────────────────── */

// ── Firebase (same project as main app) ───────────────────
const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyDJRXZqGP3OC43kCr1dgBbOpAt7C60qNhU',
    authDomain:        'muj-itinerar.firebaseapp.com',
    projectId:         'muj-itinerar',
    storageBucket:     'muj-itinerar.firebasestorage.app',
    messagingSenderId: '44845352403',
    appId:             '1:44845352403:web:4c90a250aaf198acc7db26',
};

let db = null;

function initFirebase() {
    if (typeof firebase === 'undefined') return;
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
}

// ── Default sources ────────────────────────────────────────
const DEFAULT_SOURCES = [
    { id: 'ct24',       name: 'ČT24',        url: 'https://ct24.ceskatelevize.cz/rss/hlavni-zpravy', active: true  },
    { id: 'idnes',      name: 'iDnes',        url: 'https://servis.idnes.cz/rss.aspx?c=zpravodaj',    active: true  },
    { id: 'novinky',    name: 'Novinky.cz',   url: 'https://www.novinky.cz/rss',                       active: true  },
    { id: 'lupa',       name: 'Lupa.cz',      url: 'https://www.lupa.cz/rss/clanky/',                  active: false },
    { id: 'technet',    name: 'Technet',       url: 'https://technet.idnes.cz/rss.aspx',                active: false },
];

// ── State ──────────────────────────────────────────────────
let settings = loadLocalSettings();

function loadLocalSettings() {
    const stored = localStorage.getItem('social_settings');
    if (stored) {
        try { return JSON.parse(stored); } catch (_) {}
    }
    return {
        sources: DEFAULT_SOURCES,
        platforms: { twitter: false, linkedin: false, facebook: false, instagram: false },
        scheduleTime: '09:00',
        timezone: 'Europe/Prague',
        autoGenerate: false,
        postsPerDay: 3,
    };
}

function saveLocalSettings() {
    localStorage.setItem('social_settings', JSON.stringify(settings));
}

// ── Helpers ────────────────────────────────────────────────
function todayStr() {
    const now = new Date();
    return now.toISOString().slice(0, 10);
}

function formatDatetime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function showToast(msg, duration = 2500) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), duration);
}

// ── DOM ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
    initTabs();
    renderSources();
    renderPlatformSettings();
    loadAndRenderQueue();
    updateStats();
    bindEvents();
});

// ── Tabs ───────────────────────────────────────────────────
function initTabs() {
    document.querySelectorAll('.social-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.social-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });
}

// ── Queue ──────────────────────────────────────────────────
async function loadAndRenderQueue() {
    if (!db) {
        renderQueueFromLocal();
        return;
    }
    try {
        const snap = await db.collection('social_posts').orderBy('scheduledAt', 'asc').limit(50).get();
        const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderQueue(posts);
    } catch (_) {
        renderQueueFromLocal();
    }
}

function renderQueueFromLocal() {
    const stored = JSON.parse(localStorage.getItem('social_posts') || '[]');
    renderQueue(stored);
}

function renderQueue(posts) {
    const queueList = document.getElementById('queue-list');
    const queueEmpty = document.getElementById('queue-empty');
    const sentList  = document.getElementById('sent-list');
    const sentEmpty = document.getElementById('sent-empty');

    const pending = posts.filter(p => p.status === 'pending' || p.status === 'draft');
    const sent    = posts.filter(p => p.status === 'posted' || p.status === 'failed');

    // pending
    if (pending.length === 0) {
        queueList.innerHTML = '';
        queueEmpty.classList.remove('hidden');
    } else {
        queueEmpty.classList.add('hidden');
        queueList.innerHTML = pending.map(postCard).join('');
    }

    // sent
    const recentSent = sent.slice(-10).reverse();
    if (recentSent.length === 0) {
        sentList.innerHTML = '';
        sentEmpty.classList.remove('hidden');
    } else {
        sentEmpty.classList.add('hidden');
        sentList.innerHTML = recentSent.map(postCard).join('');
    }

    // stats
    const today = todayStr();
    const sentToday = sent.filter(p => (p.scheduledAt || '').startsWith(today)).length;
    document.getElementById('stat-today').textContent = sentToday;
    document.getElementById('stat-queue').textContent = pending.length;

    // click handlers
    document.querySelectorAll('.post-card').forEach(el => {
        el.addEventListener('click', () => openEditPostModal(el.dataset.id, posts));
    });
}

function postCard(p) {
    const platformsHtml = (p.platforms || []).map(pl =>
        `<span class="platform-pill ${pl}">${pl}</span>`
    ).join('');

    const statusLabel = { pending: 'Plánováno', posted: 'Odesláno', failed: 'Chyba', draft: 'Koncept' };
    const status = p.status || 'draft';

    const text = (p.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const when = formatDatetime(p.scheduledAt);
    const src  = p.sourceTitle ? `<span>&#128279; ${escHtml(p.sourceTitle)}</span>` : '';

    return `
    <div class="post-card" data-id="${p.id}">
        <div class="post-card-header">
            <div class="platform-pills">${platformsHtml}</div>
            <span class="status-badge ${status}">${statusLabel[status] || status}</span>
        </div>
        <p class="post-text">${text}</p>
        <div class="post-meta">
            ${when ? `<span>&#128337; ${when}</span>` : ''}
            ${src}
        </div>
    </div>`;
}

function escHtml(s) {
    return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Stats ──────────────────────────────────────────────────
function updateStats() {
    const active = Object.values(settings.platforms).filter(Boolean).length;
    document.getElementById('stat-platforms').textContent = active;
}

// ── Sources ────────────────────────────────────────────────
function renderSources() {
    const list = document.getElementById('sources-list');
    list.innerHTML = settings.sources.map((s, i) => `
        <div class="source-card">
            <div class="source-icon">&#128240;</div>
            <div class="source-info">
                <div class="source-name">${escHtml(s.name)}</div>
                <div class="source-url">${escHtml(s.url)}</div>
            </div>
            <div class="source-toggle" style="gap:8px">
                <input type="checkbox" id="src-toggle-${i}" class="toggle-input" ${s.active ? 'checked' : ''}
                    onchange="toggleSource(${i}, this.checked)">
                <label for="src-toggle-${i}" class="toggle-label"></label>
                <button onclick="removeSource(${i})" class="icon-btn" style="padding:4px" title="Odebrat">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14H6L5 6"/>
                        <path d="M10 11v6M14 11v6"/>
                        <path d="M9 6V4h6v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');

    document.getElementById('auto-generate-toggle').checked = settings.autoGenerate;
    document.getElementById('posts-per-day').value = settings.postsPerDay || 3;
}

window.toggleSource = function(index, active) {
    settings.sources[index].active = active;
    saveLocalSettings();
    syncSettingsToFirestore();
};

window.removeSource = function(index) {
    settings.sources.splice(index, 1);
    saveLocalSettings();
    syncSettingsToFirestore();
    renderSources();
};

// ── Platform settings ──────────────────────────────────────
function renderPlatformSettings() {
    const p = settings.platforms;

    const ids = ['twitter', 'linkedin', 'facebook', 'instagram'];
    ids.forEach(id => {
        const el = document.getElementById(id + '-enabled');
        if (el) el.checked = !!p[id];
        const statusEl = document.getElementById(id + '-status');
        if (statusEl) {
            statusEl.textContent = p[id] ? 'Aktivní' : 'Nepřipojeno';
            statusEl.className   = p[id] ? 'connected-badge' : 'not-connected-badge';
        }
    });

    const timeEl = document.getElementById('schedule-time');
    if (timeEl) timeEl.value = settings.scheduleTime || '09:00';

    const tzEl = document.getElementById('schedule-tz');
    if (tzEl) tzEl.value = settings.timezone || 'Europe/Prague';
}

// ── Firestore sync ─────────────────────────────────────────
async function syncSettingsToFirestore() {
    if (!db) return;
    try {
        await db.collection('social_settings').doc('user').set(settings, { merge: true });
    } catch (_) {}
}

async function loadSettingsFromFirestore() {
    if (!db) return;
    try {
        const doc = await db.collection('social_settings').doc('user').get();
        if (doc.exists) {
            settings = { ...settings, ...doc.data() };
            saveLocalSettings();
            renderSources();
            renderPlatformSettings();
            updateStats();
        }
    } catch (_) {}
}

// ── Post modal ─────────────────────────────────────────────
function openNewPostModal() {
    document.getElementById('post-modal-title').textContent = 'Nový příspěvek';
    document.getElementById('edit-post-id').value = '';
    document.getElementById('post-text-input').value = '';
    document.getElementById('post-date-input').value = todayStr();
    document.getElementById('post-time-input').value = settings.scheduleTime || '09:00';
    document.getElementById('delete-post-btn').classList.add('hidden');
    document.getElementById('post-source-row').classList.add('hidden');
    updateCharCount();
    resetPlatformCheckboxes();
    document.getElementById('post-modal').classList.remove('hidden');
}

function openEditPostModal(id, posts) {
    const post = posts.find(p => p.id === id);
    if (!post) return;

    document.getElementById('post-modal-title').textContent = 'Upravit příspěvek';
    document.getElementById('edit-post-id').value = id;
    document.getElementById('post-text-input').value = post.text || '';
    document.getElementById('delete-post-btn').classList.remove('hidden');

    if (post.scheduledAt) {
        const dt = new Date(post.scheduledAt);
        document.getElementById('post-date-input').value = dt.toISOString().slice(0, 10);
        document.getElementById('post-time-input').value = dt.toTimeString().slice(0, 5);
    } else {
        document.getElementById('post-date-input').value = todayStr();
        document.getElementById('post-time-input').value = '09:00';
    }

    if (post.sourceUrl) {
        document.getElementById('post-source-row').classList.remove('hidden');
        const link = document.getElementById('post-source-link');
        link.href        = post.sourceUrl;
        link.textContent = post.sourceTitle || post.sourceUrl;
    } else {
        document.getElementById('post-source-row').classList.add('hidden');
    }

    resetPlatformCheckboxes(post.platforms || []);
    updateCharCount();
    document.getElementById('post-modal').classList.remove('hidden');
}

function resetPlatformCheckboxes(selected = []) {
    document.querySelectorAll('.platform-check-label').forEach(label => {
        const cb  = label.querySelector('input');
        const pl  = label.dataset.platform;
        const on  = selected.length ? selected.includes(pl) : !!settings.platforms[pl];
        cb.checked = on;
        label.classList.toggle('checked', on);
    });
}

function updateCharCount() {
    const len = document.getElementById('post-text-input').value.length;
    const el  = document.getElementById('char-count-num');
    el.textContent = len;
    el.parentElement.classList.toggle('over', len > 280);
}

async function savePost() {
    const id       = document.getElementById('edit-post-id').value;
    const text     = document.getElementById('post-text-input').value.trim();
    const dateVal  = document.getElementById('post-date-input').value;
    const timeVal  = document.getElementById('post-time-input').value;

    if (!text) { showToast('Zadej text příspěvku.'); return; }

    const platforms = [];
    document.querySelectorAll('.platform-check-label input:checked').forEach(cb => {
        platforms.push(cb.value);
    });
    if (platforms.length === 0) { showToast('Vyber aspoň jednu platformu.'); return; }

    const scheduledAt = `${dateVal}T${timeVal}:00`;

    const post = {
        text,
        platforms,
        scheduledAt,
        status: 'pending',
        updatedAt: new Date().toISOString(),
    };

    if (id) {
        // update
        await updatePostRecord(id, post);
        showToast('Příspěvek uložen.');
    } else {
        // create
        post.id        = uid();
        post.createdAt = new Date().toISOString();
        await createPostRecord(post);
        showToast('Příspěvek přidán do fronty.');
    }

    closePostModal();
    loadAndRenderQueue();
}

async function deletePost() {
    const id = document.getElementById('edit-post-id').value;
    if (!id) return;
    if (!confirm('Smazat příspěvek?')) return;
    await deletePostRecord(id);
    showToast('Příspěvek smazán.');
    closePostModal();
    loadAndRenderQueue();
}

function closePostModal() {
    document.getElementById('post-modal').classList.add('hidden');
}

// ── Firestore CRUD ─────────────────────────────────────────
function localPosts() {
    return JSON.parse(localStorage.getItem('social_posts') || '[]');
}
function saveLocalPosts(posts) {
    localStorage.setItem('social_posts', JSON.stringify(posts));
}

async function createPostRecord(post) {
    if (db) {
        try {
            await db.collection('social_posts').doc(post.id).set(post);
            return;
        } catch (_) {}
    }
    const posts = localPosts();
    posts.push(post);
    saveLocalPosts(posts);
}

async function updatePostRecord(id, data) {
    if (db) {
        try {
            await db.collection('social_posts').doc(id).update(data);
            return;
        } catch (_) {}
    }
    const posts = localPosts().map(p => p.id === id ? { ...p, ...data } : p);
    saveLocalPosts(posts);
}

async function deletePostRecord(id) {
    if (db) {
        try {
            await db.collection('social_posts').doc(id).delete();
            return;
        } catch (_) {}
    }
    saveLocalPosts(localPosts().filter(p => p.id !== id));
}

// ── Add source ─────────────────────────────────────────────
function addSource() {
    const nameEl = document.getElementById('source-name-input');
    const urlEl  = document.getElementById('source-url-input');
    const name   = nameEl.value.trim();
    const url    = urlEl.value.trim();

    if (!name || !url) { showToast('Zadej název a URL.'); return; }
    if (!url.startsWith('http')) { showToast('URL musí začínat http.'); return; }

    settings.sources.push({ id: uid(), name, url, active: true });
    saveLocalSettings();
    syncSettingsToFirestore();
    renderSources();
    nameEl.value = '';
    urlEl.value  = '';
    showToast('Zdroj přidán.');
}

// ── Save settings ──────────────────────────────────────────
function saveSettings() {
    ['twitter', 'linkedin', 'facebook', 'instagram'].forEach(id => {
        const el = document.getElementById(id + '-enabled');
        if (el) settings.platforms[id] = el.checked;
    });

    const timeEl = document.getElementById('schedule-time');
    if (timeEl) settings.scheduleTime = timeEl.value;

    const tzEl = document.getElementById('schedule-tz');
    if (tzEl) settings.timezone = tzEl.value;

    settings.autoGenerate = document.getElementById('auto-generate-toggle').checked;
    settings.postsPerDay  = parseInt(document.getElementById('posts-per-day').value, 10);

    saveLocalSettings();
    syncSettingsToFirestore();
    renderPlatformSettings();
    updateStats();
    showToast('Nastavení uloženo.');
}

// ── Run modal ──────────────────────────────────────────────
async function openRunModal() {
    document.getElementById('run-modal').classList.remove('hidden');

    if (db) {
        try {
            const doc = await db.collection('social_settings').doc('automation_log').get();
            if (doc.exists) {
                const log = doc.data();
                document.getElementById('last-run-time').textContent  = formatDatetime(log.lastRun)  || '—';
                document.getElementById('last-run-posts').textContent = log.generated ?? '—';
                document.getElementById('last-run-sent').textContent  = log.sent ?? '—';
            }
        } catch (_) {}
    }
}

// ── Events ─────────────────────────────────────────────────
function bindEvents() {
    // FAB — new post
    document.getElementById('fab-btn').addEventListener('click', openNewPostModal);

    // Run now button
    document.getElementById('run-now-btn').addEventListener('click', openRunModal);
    document.getElementById('close-run-modal').addEventListener('click', () =>
        document.getElementById('run-modal').classList.add('hidden'));

    // Post modal
    document.getElementById('close-post-modal').addEventListener('click', closePostModal);
    document.getElementById('cancel-post-btn').addEventListener('click', closePostModal);
    document.getElementById('save-post-btn').addEventListener('click', savePost);
    document.getElementById('delete-post-btn').addEventListener('click', deletePost);

    // Char counter
    document.getElementById('post-text-input').addEventListener('input', updateCharCount);

    // Platform checkboxes
    document.querySelectorAll('.platform-check-label').forEach(label => {
        label.addEventListener('click', () => {
            const cb = label.querySelector('input');
            // the checkbox toggles on click naturally — just sync the class
            requestAnimationFrame(() => {
                label.classList.toggle('checked', cb.checked);
            });
        });
    });

    // Add source
    document.getElementById('add-source-btn').addEventListener('click', addSource);
    document.getElementById('source-url-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') addSource();
    });

    // Auto-generate toggle
    document.getElementById('auto-generate-toggle').addEventListener('change', e => {
        settings.autoGenerate = e.target.checked;
        saveLocalSettings();
        syncSettingsToFirestore();
    });

    // Posts per day
    document.getElementById('posts-per-day').addEventListener('change', e => {
        settings.postsPerDay = parseInt(e.target.value, 10);
        saveLocalSettings();
        syncSettingsToFirestore();
    });

    // Save settings
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

    // Platform toggles
    ['twitter', 'linkedin', 'facebook', 'instagram'].forEach(id => {
        const el = document.getElementById(id + '-enabled');
        if (el) el.addEventListener('change', () => { saveSettings(); });
    });

    // Close modals on backdrop click
    ['post-modal', 'run-modal'].forEach(id => {
        document.getElementById(id).addEventListener('click', e => {
            if (e.target.id === id) e.target.classList.add('hidden');
        });
    });

    // Load settings from Firestore once ready
    loadSettingsFromFirestore();
}
