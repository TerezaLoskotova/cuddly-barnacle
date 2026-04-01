/* ──────────────────────────────────────────────────────────
   Hlasový deník úkolů — app.js
   ────────────────────────────────────────────────────────── */

// ── State ─────────────────────────────────────────────────
const state = {
    tasks:          JSON.parse(localStorage.getItem('vd_tasks')  || '[]'),
    notes:          JSON.parse(localStorage.getItem('vd_notes')  || '[]'),
    settings:       JSON.parse(localStorage.getItem('vd_settings') || '{"summaryTime":"20:00"}'),
    currentDate:    todayStr(),   // YYYY-MM-DD string being viewed
    activeTab:      'tasks',      // 'tasks' | 'notes'
    parsedVoice:    null,         // { text, reminder, type }
    reminderTimers: {},
};

// ── Helpers ────────────────────────────────────────────────
function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const days   = ['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
    const months = ['ledna','února','března','dubna','května','června',
                    'července','srpna','září','října','listopadu','prosince'];
    return `${days[d.getDay()]} ${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function save() {
    localStorage.setItem('vd_tasks',    JSON.stringify(state.tasks));
    localStorage.setItem('vd_notes',    JSON.stringify(state.notes));
    localStorage.setItem('vd_settings', JSON.stringify(state.settings));
}

// ── Voice parsing ──────────────────────────────────────────
/*
 * Detects reminder time from Czech transcript.
 * Understood patterns (case-insensitive):
 *   "připomeň ve 14:30"   "připomínka v 9 hodin"
 *   "připomeň za 30 minut" (relative)
 *   "v osm hodin"  "ve čtyři"
 *   If starts with "nápad:" / "poznámka:" → note
 */
const CZECH_HOURS = {
    'jednu':1,'jedné':1,'jedna':1,
    'dvě':2,'dvou':2,'dva':2,
    'tři':3,'třech':3,
    'čtyři':4,'čtyřech':4,
    'pět':5,'pěti':5,
    'šest':6,'šesti':6,
    'sedm':7,'sedmi':7,
    'osm':8,'osmi':8,
    'devět':9,'devíti':9,
    'deset':10,'deseti':10,
    'jedenáct':11,'jedenácti':11,
    'dvanáct':12,'dvanácti':12,
    'třináct':13,'třinácti':13,
    'čtrnáct':14,'čtrnácti':14,
    'patnáct':15,'patnácti':15,
    'šestnáct':16,'šestnácti':16,
    'sedmnáct':17,'sedmnácti':17,
    'osmnáct':18,'osmnácti':18,
    'devatenáct':19,'devatenácti':19,
    'dvacet':20,'dvaceti':20,
    'jednadvacet':21, 'dvaadvacet':22, 'třiadvacet':23,
};

function parseVoiceInput(transcript) {
    const raw  = transcript.trim();
    let   text = raw.toLowerCase();

    // Detect note intent
    if (/^(nápad|poznámka|pozn\.?)\s*[:–-]?\s*/i.test(raw)) {
        const noteText = raw.replace(/^(nápad|poznámka|pozn\.?)\s*[:–-]?\s*/i, '').trim();
        return { type: 'note', text: capitalize(noteText), reminder: null };
    }

    // Try to extract reminder time ─────────────────────────
    let reminder = null;
    let matchedStr = '';

    // Relative: "za N minut" / "za N hodin"
    const relMatch = text.match(/za\s+(\d+)\s*(minut|hodin|hodiny?|minuty?)/);
    if (relMatch) {
        const val  = parseInt(relMatch[1]);
        const unit = relMatch[2];
        const now  = new Date();
        if (unit.startsWith('minut')) now.setMinutes(now.getMinutes() + val);
        else                          now.setHours(now.getHours()    + val);
        reminder   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        matchedStr = relMatch[0];
    }

    // Absolute with keyword: "připomeň ve X" / "připomínka v X"
    if (!reminder) {
        const kwMatch = text.match(
            /(?:připomeň(?:te)?|připomínka)\s+(?:ve?|v)\s+(\d{1,2})(?:[:.h](\d{2}))?(?:\s*hodin[ay]?)?/
        );
        if (kwMatch) {
            const h = parseInt(kwMatch[1]);
            const m = kwMatch[2] ? parseInt(kwMatch[2]) : 0;
            if (h >= 0 && h <= 23) {
                reminder   = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                matchedStr = kwMatch[0];
            }
        }
    }

    // Absolute word hours: "připomeň v osm hodin"
    if (!reminder) {
        const wordHourPattern = new RegExp(
            `(?:připomeň(?:te)?|připomínka)\\s+(?:ve?|v)\\s+(${Object.keys(CZECH_HOURS).join('|')})(?:\\s*hodin[ay]?)?`
        );
        const wMatch = text.match(wordHourPattern);
        if (wMatch) {
            const h = CZECH_HOURS[wMatch[1]];
            if (h !== undefined) {
                reminder   = `${String(h).padStart(2,'0')}:00`;
                matchedStr = wMatch[0];
            }
        }
    }

    // Bare "v/ve X hodin" at end
    if (!reminder) {
        const bareMatch = text.match(/\bve?\s+(\d{1,2})(?:[:.h](\d{2}))?\s*hodin[ay]?\s*$/);
        if (bareMatch) {
            const h = parseInt(bareMatch[1]);
            const m = bareMatch[2] ? parseInt(bareMatch[2]) : 0;
            if (h >= 0 && h <= 23) {
                reminder   = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                matchedStr = bareMatch[0];
            }
        }
    }

    // Remove the matched reminder phrase from task text
    let taskText = raw;
    if (matchedStr) {
        // Remove case-insensitively
        const safeMatch = matchedStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        taskText = raw.replace(new RegExp(safeMatch, 'i'), '')
                      .replace(/\s*,\s*$/, '')
                      .replace(/^\s*,\s*/, '')
                      .trim();
    }

    return { type: 'task', text: capitalize(taskText), reminder };
}

function capitalize(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Reminders ──────────────────────────────────────────────
function scheduleAllReminders() {
    const today = state.tasks.filter(t => t.date === todayStr() && t.reminder && !t.reminderFired && !t.done);
    today.forEach(scheduleReminder);
}

function scheduleReminder(task) {
    if (state.reminderTimers[task.id]) {
        clearTimeout(state.reminderTimers[task.id]);
    }
    if (!task.reminder) return;

    const [h, m]  = task.reminder.split(':').map(Number);
    const now     = new Date();
    const target  = new Date();
    target.setHours(h, m, 0, 0);

    const ms = target - now;
    if (ms <= 0) return; // already passed

    state.reminderTimers[task.id] = setTimeout(() => {
        fireReminder(task);
    }, ms);
}

function fireReminder(task) {
    // Mark as fired
    const t = state.tasks.find(x => x.id === task.id);
    if (t) { t.reminderFired = true; save(); renderTasks(); }

    if (Notification.permission === 'granted') {
        try {
            new Notification('Připomínka', {
                body: task.text,
                icon: 'icon-192.png',
                tag:  task.id,
                requireInteraction: true,
            });
        } catch (e) { console.warn('Notification failed', e); }
    } else {
        // Fallback: highlight in UI
        showInAppAlert(`⏰ Připomínka: ${task.text}`);
    }
}

function showInAppAlert(msg) {
    const el = document.createElement('div');
    el.className = 'inapp-alert';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 400);
    }, 5000);
}

// ── Auto summary ───────────────────────────────────────────
let summaryCheckInterval = null;

function startSummaryCheck() {
    if (summaryCheckInterval) clearInterval(summaryCheckInterval);
    summaryCheckInterval = setInterval(() => {
        const now    = new Date();
        const hh     = String(now.getHours()).padStart(2,'0');
        const mm     = String(now.getMinutes()).padStart(2,'0');
        const curStr = `${hh}:${mm}`;
        if (curStr === state.settings.summaryTime && state.currentDate === todayStr()) {
            openSummaryModal();
        }
    }, 30_000); // check every 30 s
}

// ── CRUD – Tasks ───────────────────────────────────────────
function addTask(text, reminder, date) {
    if (!text.trim()) return;
    const task = {
        id:           uid(),
        text:         text.trim(),
        done:         false,
        reminder:     reminder || null,
        reminderFired:false,
        date:         date || state.currentDate,
        createdAt:    Date.now(),
    };
    state.tasks.push(task);
    save();
    if (task.date === todayStr()) scheduleReminder(task);
    renderTasks();
}

function toggleTask(id) {
    const t = state.tasks.find(x => x.id === id);
    if (t) { t.done = !t.done; save(); renderTasks(); }
}

function deleteTask(id) {
    if (state.reminderTimers[id]) clearTimeout(state.reminderTimers[id]);
    state.tasks = state.tasks.filter(x => x.id !== id);
    save();
    renderTasks();
}

// ── CRUD – Notes ───────────────────────────────────────────
function addNote(text, date) {
    if (!text.trim()) return;
    state.notes.push({
        id:        uid(),
        text:      text.trim(),
        date:      date || state.currentDate,
        createdAt: Date.now(),
    });
    save();
    renderNotes();
}

function deleteNote(id) {
    state.notes = state.notes.filter(x => x.id !== id);
    save();
    renderNotes();
}

// ── Rollover ───────────────────────────────────────────────
function rolloverPendingTasks() {
    const tomorrow = addDays(state.currentDate, 1);
    const pending  = state.tasks.filter(t => t.date === state.currentDate && !t.done);
    pending.forEach(t => {
        addTask(t.text, t.reminder, tomorrow);
    });
    // Mark originals as "carried over"
    pending.forEach(t => { t.carried = true; });
    save();
    renderTasks();
    closeSummaryModal();
    showInAppAlert(`${pending.length} úkol${pending.length === 1 ? '' : 'ů'} přesunuto na zítra.`);
}

// ── Render: Date nav ───────────────────────────────────────
function renderDateNav() {
    const isToday = state.currentDate === todayStr();
    document.getElementById('date-display').textContent =
        isToday ? `Dnes — ${formatDate(state.currentDate)}` : formatDate(state.currentDate);
}

// ── Render: Tasks ──────────────────────────────────────────
function renderTasks() {
    const list   = document.getElementById('task-list');
    const empty  = document.getElementById('empty-state');
    const count  = document.getElementById('task-count');
    const tasks  = state.tasks.filter(t => t.date === state.currentDate);

    list.innerHTML = '';

    if (tasks.length === 0) {
        empty.classList.remove('hidden');
        count.textContent = '';
        return;
    }

    empty.classList.add('hidden');
    const done    = tasks.filter(t => t.done).length;
    count.textContent = `${done}/${tasks.length}`;

    // Sort: undone first, then done
    const sorted = [...tasks].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return a.createdAt - b.createdAt;
    });

    sorted.forEach(task => {
        const li = document.createElement('li');
        li.className = `task-item${task.done ? ' done' : ''}`;
        li.dataset.id = task.id;

        const reminderHtml = task.reminder
            ? `<div class="task-reminder${task.reminderFired ? ' fired' : ''}">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                   <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                   <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                 </svg>
                 ${task.reminderFired ? 'Připomenuto' : 'Připomínka'} v ${task.reminder}
               </div>`
            : '';

        li.innerHTML = `
            <button class="task-check" data-id="${task.id}" aria-label="Splněno">
                <svg class="check-svg" viewBox="0 0 12 12"><polyline points="1.5 6 4.5 9 10.5 3"/></svg>
            </button>
            <div class="task-body">
                <div class="task-text">${escHtml(task.text)}</div>
                ${reminderHtml}
            </div>
            <button class="task-delete" data-id="${task.id}" aria-label="Smazat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4h6v2"/>
                </svg>
            </button>
        `;
        list.appendChild(li);
    });

    // Delegate events
    list.querySelectorAll('.task-check').forEach(btn => {
        btn.addEventListener('click', () => toggleTask(btn.dataset.id));
    });
    list.querySelectorAll('.task-delete').forEach(btn => {
        btn.addEventListener('click', () => deleteTask(btn.dataset.id));
    });
}

// ── Render: Notes ──────────────────────────────────────────
function renderNotes() {
    const list  = document.getElementById('note-list');
    const empty = document.getElementById('note-empty-state');
    if (!list) return;

    const notes = state.notes.filter(n => n.date === state.currentDate);
    list.innerHTML = '';

    if (notes.length === 0) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    const sorted = [...notes].sort((a, b) => a.createdAt - b.createdAt);
    sorted.forEach(note => {
        const li = document.createElement('li');
        li.className = 'note-item';
        li.dataset.id = note.id;

        const time = new Date(note.createdAt);
        const timeStr = `${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}`;

        li.innerHTML = `
            <div class="note-body">
                <div class="note-text">${escHtml(note.text)}</div>
                <div class="note-time">${timeStr}</div>
            </div>
            <button class="task-delete" data-id="${note.id}" aria-label="Smazat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4h6v2"/>
                </svg>
            </button>
        `;
        list.appendChild(li);
    });

    list.querySelectorAll('.task-delete').forEach(btn => {
        btn.addEventListener('click', () => deleteNote(btn.dataset.id));
    });
}

function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Tab switching ──────────────────────────────────────────
function switchTab(tab) {
    state.activeTab = tab;
    document.getElementById('tab-tasks').classList.toggle('active', tab === 'tasks');
    document.getElementById('tab-notes').classList.toggle('active', tab === 'notes');
    document.getElementById('tasks-section').classList.toggle('hidden', tab !== 'tasks');
    document.getElementById('notes-section').classList.toggle('hidden', tab !== 'notes');
}

// ── Voice recognition ──────────────────────────────────────
let recognition = null;
let isListening = false;

function initRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;

    const r = new SR();
    r.lang           = 'cs-CZ';
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.continuous     = false;

    r.onstart = () => {
        isListening = true;
        document.getElementById('mic-btn').classList.add('listening');
        document.getElementById('voice-status').textContent = 'Poslouchám…';
        document.getElementById('transcript-box').classList.add('hidden');
        document.getElementById('transcript-text').textContent = '';
    };

    r.onresult = (e) => {
        const transcript = Array.from(e.results)
            .map(r => r[0].transcript)
            .join('');
        document.getElementById('transcript-text').textContent = transcript;

        if (e.results[e.results.length - 1].isFinal) {
            showParsedPreview(transcript);
        }
    };

    r.onerror = (e) => {
        console.error('Speech error:', e.error);
        stopListening();
        if (e.error === 'not-allowed') {
            document.getElementById('voice-status').textContent = 'Přístup k mikrofonu byl odmítnut.';
        } else if (e.error === 'no-speech') {
            document.getElementById('voice-status').textContent = 'Nic jsem neslyšela. Zkus to znovu.';
        } else {
            document.getElementById('voice-status').textContent = 'Chyba rozpoznávání. Zkus to znovu.';
        }
    };

    r.onend = () => {
        stopListening();
        if (!state.parsedVoice) {
            const transcript = document.getElementById('transcript-text').textContent;
            if (transcript.trim()) showParsedPreview(transcript);
        }
    };

    return r;
}

function startListening() {
    if (!recognition) {
        recognition = initRecognition();
        if (!recognition) {
            document.getElementById('voice-status').textContent =
                'Rozpoznávání hlasu není v tomto prohlížeči dostupné. Zkus Chrome nebo Edge.';
            return;
        }
    }
    state.parsedVoice = null;
    try {
        recognition.start();
    } catch (e) {
        // already started
    }
}

function stopListening() {
    isListening = false;
    document.getElementById('mic-btn').classList.remove('listening');
    if (!state.parsedVoice) {
        document.getElementById('voice-status').textContent = 'Klikni na mikrofon a nadiktuj úkol';
    }
    try { recognition && recognition.stop(); } catch(e) {}
}

function showParsedPreview(transcript) {
    const parsed = parseVoiceInput(transcript);
    state.parsedVoice = parsed;

    const box     = document.getElementById('transcript-box');
    const preview = document.getElementById('parsed-preview');
    const taskEl  = document.getElementById('parsed-task');
    const remEl   = document.getElementById('parsed-reminder');

    document.getElementById('transcript-text').textContent = transcript;

    taskEl.textContent = parsed.text;
    if (parsed.reminder) {
        remEl.textContent = `Připomínka v ${parsed.reminder}`;
        remEl.classList.remove('hidden');
    } else {
        remEl.textContent = '';
        remEl.classList.add('hidden');
    }

    if (parsed.type === 'note') {
        taskEl.textContent = `Nápad: ${parsed.text}`;
    }

    preview.classList.remove('hidden');
    box.classList.remove('hidden');

    document.getElementById('voice-status').textContent =
        parsed.type === 'note' ? 'Uložit jako nápad?' : 'Přidat jako úkol?';
}

function confirmVoice() {
    if (!state.parsedVoice) return;
    const { type, text, reminder } = state.parsedVoice;

    if (type === 'note') {
        addNote(text);
        switchTab('notes');
    } else {
        addTask(text, reminder);
        switchTab('tasks');
    }

    state.parsedVoice = null;
    document.getElementById('transcript-box').classList.add('hidden');
    document.getElementById('transcript-text').textContent = '';
    document.getElementById('voice-status').textContent = 'Klikni na mikrofon a nadiktuj úkol';
}

function discardVoice() {
    state.parsedVoice = null;
    document.getElementById('transcript-box').classList.add('hidden');
    document.getElementById('transcript-text').textContent = '';
    document.getElementById('voice-status').textContent = 'Klikni na mikrofon a nadiktuj úkol';
}

// ── Summary modal ──────────────────────────────────────────
function openSummaryModal() {
    const tasks   = state.tasks.filter(t => t.date === state.currentDate);
    const done    = tasks.filter(t => t.done);
    const pending = tasks.filter(t => !t.done);

    // Done list
    const doneList  = document.getElementById('summary-done-list');
    const doneEmpty = document.getElementById('summary-done-empty');
    doneList.innerHTML = '';
    doneList.className = 'summary-list done-list';

    if (done.length === 0) {
        doneEmpty.classList.remove('hidden');
    } else {
        doneEmpty.classList.add('hidden');
        done.forEach(t => {
            const li = document.createElement('li');
            li.innerHTML = `<span>✓</span> ${escHtml(t.text)}`;
            doneList.appendChild(li);
        });
    }

    // Pending list
    const pendingList  = document.getElementById('summary-pending-list');
    const pendingEmpty = document.getElementById('summary-pending-empty');
    pendingList.innerHTML = '';
    pendingList.className = 'summary-list pending-list';

    if (pending.length === 0) {
        pendingEmpty.classList.remove('hidden');
    } else {
        pendingEmpty.classList.add('hidden');
        pending.forEach(t => {
            const li = document.createElement('li');
            li.innerHTML = `<span>✗</span> ${escHtml(t.text)}`;
            pendingList.appendChild(li);
        });
    }

    // Show rollover only if there are pending tasks
    const rollover = document.getElementById('rollover-section');
    rollover.classList.toggle('hidden', pending.length === 0);

    document.getElementById('summary-modal').classList.remove('hidden');
}

function closeSummaryModal() {
    document.getElementById('summary-modal').classList.add('hidden');
}

// ── Settings modal ─────────────────────────────────────────
function openSettingsModal() {
    document.getElementById('summary-time-input').value = state.settings.summaryTime;
    document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
}

function saveSettings() {
    state.settings.summaryTime = document.getElementById('summary-time-input').value || '20:00';
    save();
    closeSettingsModal();
    startSummaryCheck();
    showInAppAlert('Nastavení uloženo.');
}

// ── Notifications ──────────────────────────────────────────
function checkNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        document.getElementById('notif-banner').classList.remove('hidden');
    }
}

// ── Date navigation ────────────────────────────────────────
function navigateDate(delta) {
    state.currentDate = addDays(state.currentDate, delta);
    renderDateNav();
    renderTasks();
    renderNotes();
    // Show/hide "go to today" hint
    const isToday = state.currentDate === todayStr();
    document.getElementById('go-today-btn').classList.toggle('hidden', isToday);
}

// ── Init ───────────────────────────────────────────────────
function init() {
    renderDateNav();
    renderTasks();
    renderNotes();
    scheduleAllReminders();
    startSummaryCheck();
    checkNotificationPermission();
    switchTab('tasks');

    // Mic button
    document.getElementById('mic-btn').addEventListener('click', () => {
        if (isListening) stopListening();
        else             startListening();
    });

    // Transcript actions
    document.getElementById('confirm-voice').addEventListener('click', confirmVoice);
    document.getElementById('discard-voice').addEventListener('click',  discardVoice);

    // Manual add
    document.getElementById('add-manual-btn').addEventListener('click', () => {
        document.getElementById('manual-form').classList.toggle('hidden');
        document.getElementById('manual-task-input').focus();
    });

    document.getElementById('confirm-manual').addEventListener('click', () => {
        const text     = document.getElementById('manual-task-input').value.trim();
        const reminder = document.getElementById('manual-time-input').value || null;
        if (!text) return;
        // Check if we're in notes tab
        if (state.activeTab === 'notes') {
            addNote(text);
        } else {
            addTask(text, reminder);
        }
        document.getElementById('manual-task-input').value = '';
        document.getElementById('manual-time-input').value = '';
        document.getElementById('manual-form').classList.add('hidden');
    });

    document.getElementById('manual-task-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('confirm-manual').click();
    });

    document.getElementById('cancel-manual').addEventListener('click', () => {
        document.getElementById('manual-form').classList.add('hidden');
    });

    // Date nav
    document.getElementById('prev-day-btn').addEventListener('click', () => navigateDate(-1));
    document.getElementById('next-day-btn').addEventListener('click', () => navigateDate(+1));
    document.getElementById('go-today-btn').addEventListener('click',  () => {
        state.currentDate = todayStr();
        renderDateNav();
        renderTasks();
        renderNotes();
        document.getElementById('go-today-btn').classList.add('hidden');
    });

    // Tab switching
    document.getElementById('tab-tasks').addEventListener('click', () => switchTab('tasks'));
    document.getElementById('tab-notes').addEventListener('click', () => switchTab('notes'));

    // Summary button
    document.getElementById('summary-btn').addEventListener('click', openSummaryModal);
    document.getElementById('close-summary').addEventListener('click', closeSummaryModal);
    document.getElementById('rollover-btn').addEventListener('click', rolloverPendingTasks);
    document.getElementById('dismiss-btn').addEventListener('click',  closeSummaryModal);

    // Settings
    document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
    document.getElementById('close-settings').addEventListener('click', closeSettingsModal);
    document.getElementById('save-settings').addEventListener('click',  saveSettings);

    // Notification banner
    document.getElementById('allow-notif').addEventListener('click', () => {
        Notification.requestPermission().then(() => {
            document.getElementById('notif-banner').classList.add('hidden');
        });
    });
    document.getElementById('deny-notif').addEventListener('click', () => {
        document.getElementById('notif-banner').classList.add('hidden');
    });

    // Close modals on overlay click
    document.getElementById('summary-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeSummaryModal();
    });
    document.getElementById('settings-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeSettingsModal();
    });
}

document.addEventListener('DOMContentLoaded', init);

// ── Service Worker registration ────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.warn('SW registration failed:', err);
        });
    });
}
