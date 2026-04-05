/* ──────────────────────────────────────────────────────────
   Hlasový deník úkolů — app.js
   ────────────────────────────────────────────────────────── */

// ── State ─────────────────────────────────────────────────
const state = {
    tasks:          JSON.parse(localStorage.getItem('vd_tasks')     || '[]'),
    notes:          JSON.parse(localStorage.getItem('vd_notes')     || '[]'),
    recurring:      JSON.parse(localStorage.getItem('vd_recurring') || '[]'),
    settings:       JSON.parse(localStorage.getItem('vd_settings')  || '{"summaryTime":"21:00","autoRollover":true}'),
    currentDate:    todayStr(),   // YYYY-MM-DD string being viewed
    activeTab:      'tasks',      // 'tasks' | 'notes'
    parsedVoice:    null,         // { text, reminder, type, days? }
    reminderTimers: {},
};

// ── Helpers ────────────────────────────────────────────────
function todayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function save() {
    localStorage.setItem('vd_tasks',      JSON.stringify(state.tasks));
    localStorage.setItem('vd_notes',      JSON.stringify(state.notes));
    localStorage.setItem('vd_recurring',  JSON.stringify(state.recurring));
    localStorage.setItem('vd_settings',   JSON.stringify(state.settings));
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

// Day number: 0 = Sunday … 6 = Saturday (matches JS Date.getDay())
const CZECH_DAYS = {
    'pondělí':1, 'pondeli':1, 'pondělí':1,
    'úterý':2,   'utery':2,   'úterý':2,
    'středu':3,  'středa':3,  'streda':3,  'středu':3,
    'čtvrtek':4, 'ctvrtek':4,
    'pátek':5,   'patek':5,   'pátku':5,
    'sobotu':6,  'sobota':6,
    'neděli':0,  'neděle':0,  'nedeli':0,  'nedele':0,
};

const DAY_NAMES_SHORT = ['Ne','Po','Út','St','Čt','Pá','So'];
const DAY_NAMES_FULL  = ['Neděle','Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota'];

/**
 * Returns { days: number[], time: 'HH:MM', taskText: string } or null.
 * Detects patterns like "každý pondělí v 9", "každý den ve 14:30",
 * "každý pracovní den v 17", "každý víkend v 10".
 */
function parseRecurringPattern(text) {
    const t = text.toLowerCase().trim();

    // Must contain "každý" / "každou" to be recurring
    if (!t.includes('každ')) return null;

    // ── Determine days ──────────────────────────────────────
    let days = null;

    if (/každ[yý]\s+den\b|denně/.test(t)) {
        days = [0,1,2,3,4,5,6];
    } else if (/každ[yý]\s+pracovní\s+den|každ[yý]\s+pracovní/.test(t)) {
        days = [1,2,3,4,5];
    } else if (/každ[yý]\s+víkend|každ[ou]\s+sobotu\s+a\s+neděl|každ[ou]\s+neděl\S+\s+a\s+sobotu/.test(t)) {
        days = [0,6];
    } else {
        // Specific day name
        for (const [name, num] of Object.entries(CZECH_DAYS)) {
            const re = new RegExp(`každ[youé]+\\s+${name}\\b`);
            if (re.test(t)) { days = [num]; break; }
        }
    }

    if (!days) return null;

    // ── Extract time ────────────────────────────────────────
    let time = null;

    // Digit time: "v 9", "ve 14:30", "v 9 hodin"
    const digitMatch = t.match(/\bve?\s+(\d{1,2})(?:[:.h](\d{2}))?(?:\s*hodin[ay]?)?/);
    if (digitMatch) {
        const h = parseInt(digitMatch[1]);
        const m = digitMatch[2] ? parseInt(digitMatch[2]) : 0;
        if (h >= 0 && h <= 23) time = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }

    // Word hour fallback
    if (!time) {
        const wordRe = new RegExp(`\\bve?\\s+(${Object.keys(CZECH_HOURS).join('|')})(?:\\s*hodin[ay]?)?`);
        const wm = t.match(wordRe);
        if (wm) {
            const h = CZECH_HOURS[wm[1]];
            if (h !== undefined) time = `${String(h).padStart(2,'0')}:00`;
        }
    }

    // ── Strip scheduling words to get task text ─────────────
    let taskText = text
        .replace(/každ[youé]+\s+(?:pracovní\s+)?(?:den|víkend|pondělí|úterý|středu|středa|čtvrtek|pátek|sobotu|sobota|neděli|neděle)\b/gi, '')
        .replace(/denně/gi, '')
        .replace(/\bve?\s+\d{1,2}(?:[:.h]\d{2})?\s*(?:hodin[ay]?)?\b/gi, '')
        .replace(/\bve?\s+(?:jednu|dvě|tři|čtyři|pět|šest|sedm|osm|devět|deset|jedenáct|dvanáct)\s*(?:hodin[ay]?)?\b/gi, '')
        .replace(/připomínk[ay]\s*/gi, '')
        .replace(/^\s*[,–-]\s*|\s*[,–-]\s*$/g, '')
        .trim();

    taskText = capitalize(taskText) || 'Připomínka';

    return { days, time, taskText };
}

function parseVoiceInput(transcript) {
    const raw  = transcript.trim();
    let   text = raw.toLowerCase();

    // Detect recurring intent ("každý pondělí v 9 napsat report")
    const recurring = parseRecurringPattern(raw);
    if (recurring) {
        return { type: 'recurring', text: recurring.taskText, reminder: recurring.time, days: recurring.days };
    }

    // Detect priority intent ("důležité: zavolat doktorovi" / "priorita: report")
    const priorityMatch = raw.match(/^(?:důležité?|priorita|urgentní?|naléhavé?)\s*[:–-]?\s*/i);
    if (priorityMatch) {
        const taskText = capitalize(raw.slice(priorityMatch[0].length).trim());
        return { type: 'task', text: taskText, reminder: null, priority: true };
    }

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
    const t = state.tasks.find(x => x.id === task.id);
    if (t) { t.reminderFired = true; save(); renderTasks(); }

    // Always show the in-app snooze panel (works even when tab is open)
    showSnoozeAlert(task);

    if (Notification.permission === 'granted') {
        const notifOpts = {
            body: task.text,
            icon: 'icon-192.png',
            tag:  task.id,
            requireInteraction: true,
            actions: [
                { action: 'done',    title: '✓ Hotovo' },
                { action: 'snooze1', title: '+1 hodina' },
                { action: 'snooze3', title: '+3 hodiny' },
            ],
        };
        // SW notification supports action buttons; plain Notification does not
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready
                .then(reg => reg.showNotification(`⏰ ${task.text}`, notifOpts))
                .catch(() => { try { new Notification(`⏰ ${task.text}`, notifOpts); } catch(e){} });
        } else {
            try { new Notification(`⏰ ${task.text}`, notifOpts); } catch(e) {}
        }
    }
}

let activeSnoozeAlert = null;

function showSnoozeAlert(task) {
    if (activeSnoozeAlert) { activeSnoozeAlert.remove(); activeSnoozeAlert = null; }

    const el = document.createElement('div');
    el.className = 'snooze-alert';
    el.innerHTML = `
        <div class="snooze-alert-title">⏰ Připomínka</div>
        <div class="snooze-alert-text">${escHtml(task.text)}</div>
        <div class="snooze-alert-actions">
            <button class="btn btn-primary" data-action="done">✓ Hotovo</button>
            <button class="btn btn-outline" data-action="snooze1">+1 hodina</button>
            <button class="btn btn-outline" data-action="snooze3">+3 hodiny</button>
        </div>
    `;

    el.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            if (action === 'done')    toggleTask(task.id);
            if (action === 'snooze1') snoozeTask(task.id, 1);
            if (action === 'snooze3') snoozeTask(task.id, 3);
            el.classList.remove('show');
            setTimeout(() => el.remove(), 350);
            activeSnoozeAlert = null;
        });
    });

    document.body.appendChild(el);
    activeSnoozeAlert = el;
    setTimeout(() => el.classList.add('show'), 10);
    // Auto-dismiss after 30 s
    setTimeout(() => {
        if (el.parentNode) {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 350);
            if (activeSnoozeAlert === el) activeSnoozeAlert = null;
        }
    }, 30_000);
}

function snoozeTask(id, hours) {
    const task = state.tasks.find(x => x.id === id);
    if (!task) return;

    const newTime = new Date();
    newTime.setHours(newTime.getHours() + hours);
    const hh = String(newTime.getHours()).padStart(2, '0');
    const mm = String(newTime.getMinutes()).padStart(2, '0');

    task.reminder      = `${hh}:${mm}`;
    task.reminderFired = false;
    task.postponeCount = (task.postponeCount || 0) + 1;
    save();
    scheduleReminder(task);
    renderTasks();
    showInAppAlert(`Odloženo na ${hh}:${mm}`);
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

function checkAndShowSummary() {
    const today = todayStr();
    if (state.currentDate !== today) return;
    if (state.settings.lastSummaryDate === today) return; // already shown today

    const now = new Date();
    const hh  = String(now.getHours()).padStart(2,'0');
    const mm  = String(now.getMinutes()).padStart(2,'0');
    const cur = `${hh}:${mm}`;

    // Show if current time is at or past the configured summary time
    if (cur >= state.settings.summaryTime) {
        state.settings.lastSummaryDate = today;
        save();
        openSummaryModal();
    }
}

function startSummaryCheck() {
    if (summaryCheckInterval) clearInterval(summaryCheckInterval);
    summaryCheckInterval = setInterval(() => {
        checkAndShowSummary();
        checkAutoRollover();
    }, 60_000);
}

// ── Auto-rollover ──────────────────────────────────────────
function checkAutoRollover() {
    if (!state.settings.autoRollover) return;

    const today = todayStr();

    // Move any incomplete tasks from PAST days to today (missed rollovers)
    const pastPending = state.tasks.filter(t => t.date < today && !t.done);
    if (pastPending.length > 0) {
        pastPending.forEach(t => {
            t.date = today;
            t.postponeCount = (t.postponeCount || 0) + 1;
            t.reminderFired = false;
        });
        save();
        renderTasks();
        renderWeekStrip();
    }

    // Roll over today's tasks to tomorrow once we pass the summary time
    if (state.settings.lastRolloverDate === today) return;

    const now = new Date();
    const cur = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    if (cur < state.settings.summaryTime) return;

    const tomorrow = addDays(today, 1);
    const todayPending = state.tasks.filter(t => t.date === today && !t.done);

    state.settings.lastRolloverDate = today;
    save();

    if (todayPending.length > 0) {
        todayPending.forEach(t => {
            t.date = tomorrow;
            t.postponeCount = (t.postponeCount || 0) + 1;
            t.reminderFired = false;
        });
        save();
        renderTasks();
        renderWeekStrip();
        showInAppAlert(`${todayPending.length} nesplněných úkolů přesunuto na zítra.`);
    }
}

// ── CRUD – Tasks ───────────────────────────────────────────
function addTask(text, reminder, date, recurringId, priority) {
    if (!text.trim()) return;
    const task = {
        id:           uid(),
        text:         text.trim(),
        done:         false,
        priority:     !!priority,
        reminder:     reminder || null,
        reminderFired:false,
        date:         date || state.currentDate,
        recurringId:  recurringId || null,
        createdAt:    Date.now(),
    };
    state.tasks.push(task);
    save();
    if (task.date === todayStr()) scheduleReminder(task);
    renderTasks();
}

function toggleTask(id) {
    const t = state.tasks.find(x => x.id === id);
    if (t) { t.done = !t.done; save(); renderTasks(); renderWeekStrip(); }
}

function togglePriority(id) {
    const t = state.tasks.find(x => x.id === id);
    if (t) { t.priority = !t.priority; save(); renderTasks(); }
}

let lastDeletedTask = null;

function deleteTask(id) {
    if (state.reminderTimers[id]) clearTimeout(state.reminderTimers[id]);
    const found = state.tasks.find(x => x.id === id);
    lastDeletedTask = found ? JSON.parse(JSON.stringify(found)) : null;
    state.tasks = state.tasks.filter(x => x.id !== id);
    save();
    renderTasks();
    renderWeekStrip();
    if (lastDeletedTask) showUndoAlert();
}

function undoDelete() {
    if (!lastDeletedTask) return;
    state.tasks.push(lastDeletedTask);
    lastDeletedTask = null;
    save();
    renderTasks();
    renderWeekStrip();
}

function showUndoAlert() {
    const old = document.getElementById('undo-alert');
    if (old) old.remove();

    const el = document.createElement('div');
    el.id = 'undo-alert';
    el.className = 'inapp-alert undo-alert';
    el.innerHTML = `Úkol smazán &nbsp;<button class="undo-btn">Vrátit</button>`;
    el.querySelector('.undo-btn').addEventListener('click', () => {
        undoDelete();
        el.remove();
    });
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
    }, 5000);
}

function moveToNextDay(id) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    t.date = addDays(t.date, 1);
    t.reminderFired = false;
    t.postponeCount = (t.postponeCount || 0) + 1;
    save();
    renderTasks();
    renderWeekStrip();
    showInAppAlert('Úkol přesunut na ' + formatDate(t.date));
}

function openEditTask(id) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    document.getElementById('edit-task-id').value         = id;
    document.getElementById('edit-task-text').value       = t.text;
    document.getElementById('edit-task-time').value       = t.reminder || '';
    document.getElementById('edit-task-date').value       = t.date || todayStr();
    document.getElementById('edit-task-priority').checked = !!t.priority;
    document.getElementById('edit-task-modal').classList.remove('hidden');
    document.getElementById('edit-task-text').focus();
}

function saveEditTask() {
    const id       = document.getElementById('edit-task-id').value;
    const text     = document.getElementById('edit-task-text').value.trim();
    const reminder = document.getElementById('edit-task-time').value || null;
    const date     = document.getElementById('edit-task-date').value || todayStr();
    const priority = document.getElementById('edit-task-priority').checked;
    if (!text) return;

    const t = state.tasks.find(x => x.id === id);
    if (!t) return;

    // Reschedule if reminder changed
    if (state.reminderTimers[id]) clearTimeout(state.reminderTimers[id]);
    t.text          = text;
    t.reminder      = reminder;
    t.date          = date;
    t.reminderFired = reminder ? (t.reminderFired && t.reminder === reminder) : false;
    t.priority      = priority;
    save();
    if (t.date === todayStr()) scheduleReminder(t);
    renderTasks();
    renderWeekStrip();
    document.getElementById('edit-task-modal').classList.add('hidden');
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

// ── CRUD – Recurring ───────────────────────────────────────
/*
 * Recurring template structure:
 * { id, text, reminder:'HH:MM'|null, days:[0-6], active:bool,
 *   spawnedDates:['YYYY-MM-DD',...], createdAt }
 */
function addRecurring(text, reminder, days) {
    if (!text.trim() || !days.length) return;
    const rec = {
        id:           uid(),
        text:         text.trim(),
        reminder:     reminder || null,
        days,
        active:       true,
        spawnedDates: [],
        createdAt:    Date.now(),
    };
    state.recurring.push(rec);
    save();
    spawnRecurringTasks();   // spawn for today immediately if applicable
    renderRecurring();
}

function deleteRecurring(id) {
    state.recurring = state.recurring.filter(r => r.id !== id);
    save();
    renderRecurring();
}

function toggleRecurring(id) {
    const r = state.recurring.find(x => x.id === id);
    if (r) { r.active = !r.active; save(); renderRecurring(); }
}

/**
 * For each active recurring template whose day matches today,
 * create a task for today (if not already spawned).
 */
function spawnRecurringTasks() {
    const today    = todayStr();
    const todayDay = new Date(today + 'T00:00:00').getDay();
    let   spawned  = false;

    state.recurring.forEach(rec => {
        if (!rec.active) return;
        if (!rec.days.includes(todayDay)) return;
        if (rec.spawnedDates.includes(today)) return;

        addTask(rec.text, rec.reminder, today, rec.id);
        rec.spawnedDates.push(today);
        spawned = true;
    });

    if (spawned) save();
}

// Label for day array, e.g. [1,2,3,4,5] → "Po–Pá"
function daysLabel(days) {
    const sorted = [...days].sort((a,b) => a - b);
    if (sorted.length === 7) return 'Každý den';
    if (sorted.join() === '1,2,3,4,5') return 'Pracovní dny';
    if (sorted.join() === '0,6') return 'Víkend';
    return sorted.map(d => DAY_NAMES_SHORT[d]).join(', ');
}

// ── Render: Recurring list ─────────────────────────────────
function renderRecurring() {
    const list  = document.getElementById('recurring-list');
    const empty = document.getElementById('recurring-empty');
    if (!list) return;

    list.innerHTML = '';

    if (state.recurring.length === 0) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    state.recurring.forEach(rec => {
        const li = document.createElement('li');
        li.className = `recurring-item${rec.active ? '' : ' inactive'}`;

        const timeStr = rec.reminder ? ` v ${rec.reminder}` : '';

        li.innerHTML = `
            <div class="recurring-body">
                <div class="recurring-text">${escHtml(rec.text)}</div>
                <div class="recurring-meta">${daysLabel(rec.days)}${timeStr}</div>
            </div>
            <button class="recurring-toggle icon-btn" data-id="${rec.id}" title="${rec.active ? 'Pozastavit' : 'Aktivovat'}">
                ${rec.active
                    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                       </svg>`
                    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <polygon points="5 3 19 12 5 21 5 3"/>
                       </svg>`}
            </button>
            <button class="task-delete" data-id="${rec.id}" aria-label="Smazat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
            </button>
        `;
        list.appendChild(li);
    });

    list.querySelectorAll('.recurring-toggle').forEach(btn => {
        btn.addEventListener('click', () => toggleRecurring(btn.dataset.id));
    });
    list.querySelectorAll('.task-delete').forEach(btn => {
        btn.addEventListener('click', () => deleteRecurring(btn.dataset.id));
    });
}

// ── Recurring modal ────────────────────────────────────────
function openRecurringModal() {
    renderRecurring();
    // Reset form
    document.getElementById('rec-task-input').value = '';
    document.getElementById('rec-time-input').value = '';
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('recurring-modal').classList.remove('hidden');
}

function closeRecurringModal() {
    document.getElementById('recurring-modal').classList.add('hidden');
}

function getSelectedDays() {
    return [...document.querySelectorAll('.day-btn.active')]
        .map(b => parseInt(b.dataset.day));
}

// ── Rollover ───────────────────────────────────────────────
function rolloverPendingTasks() {
    const tomorrow = addDays(state.currentDate, 1);
    const pending  = state.tasks.filter(t => t.date === state.currentDate && !t.done);
    pending.forEach(orig => {
        addTask(orig.text, orig.reminder, tomorrow, orig.recurringId);
        const newTask = state.tasks[state.tasks.length - 1];
        newTask.postponeCount = (orig.postponeCount || 0) + 1;
        orig.carried = true;
    });
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

// ── Render: Week strip (6 past + today + 7 future = 14 days) ──
function renderWeekStrip() {
    const strip = document.getElementById('week-strip');
    if (!strip) return;
    strip.innerHTML = '';

    let todayBtn = null;

    for (let i = -6; i <= 7; i++) {
        const date       = addDays(todayStr(), i);
        const d          = new Date(date + 'T00:00:00');
        const isToday    = date === todayStr();
        const isSelected = date === state.currentDate;
        const isFuture   = i > 0;

        const dayTasks = state.tasks.filter(t => t.date === date);
        const total    = dayTasks.length;
        const done     = dayTasks.filter(t => t.done).length;

        let dotHtml = '';
        if (total > 0) {
            const allDone = done === total;
            dotHtml = `<span class="wday-dot${allDone ? ' all-done' : ''}${isFuture ? ' future' : ''}">${done}/${total}</span>`;
        }

        const btn = document.createElement('button');
        btn.className = `wday${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}${isFuture ? ' future' : ''}`;
        btn.dataset.date = date;
        btn.innerHTML = `
            <span class="wday-name">${DAY_NAMES_SHORT[d.getDay()]}</span>
            <span class="wday-num">${d.getDate()}</span>
            ${dotHtml}
        `;
        btn.addEventListener('click', () => {
            state.currentDate = date;
            renderDateNav();
            renderTasks();
            renderNotes();
            renderWeekStrip();
            document.getElementById('go-today-btn').classList.toggle('hidden', isToday);
        });
        strip.appendChild(btn);
        if (isToday) todayBtn = btn;
    }

    // Scroll today into view (centered)
    if (todayBtn) {
        setTimeout(() => todayBtn.scrollIntoView({ inline: 'center', behavior: 'instant' }), 0);
    }
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

    // Sort: priority undone → undone → done
    const sorted = [...tasks].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (!a.done && a.priority !== b.priority) return a.priority ? -1 : 1;
        return a.createdAt - b.createdAt;
    });

    sorted.forEach(task => {
        const isRecurring   = !!task.recurringId;
        const overPostponed = (task.postponeCount || 0) >= 3;

        let cls = 'task-item';
        if (task.done)                   cls += ' done';
        if (task.priority && !task.done) cls += ' is-priority';
        if (isRecurring)                 cls += ' is-recurring';
        if (overPostponed && !task.done) cls += ' over-postponed';

        const li = document.createElement('li');
        li.className = cls;
        li.dataset.id = task.id;

        const recurringBadge = task.recurringId
            ? `<span class="recurring-badge" title="Opakující se">↺</span>`
            : '';

        const reminderHtml = task.reminder
            ? `<div class="task-reminder${task.reminderFired ? ' fired' : ''}">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                   <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                   <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                 </svg>
                 ${task.reminderFired ? 'Připomenuto' : 'Připomínka'} v ${task.reminder}
               </div>`
            : '';

        const starFilled = task.priority
            ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="#f5a623" stroke="#f5a623" stroke-width="1.5">
                 <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
               </svg>`
            : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5">
                 <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
               </svg>`;

        li.innerHTML = `
            <button class="task-check" data-id="${task.id}" aria-label="Splněno">
                <svg class="check-svg" viewBox="0 0 12 12"><polyline points="1.5 6 4.5 9 10.5 3"/></svg>
            </button>
            <div class="task-body">
                <div class="task-text">${recurringBadge}${escHtml(task.text)}${overPostponed && !task.done ? `<span class="postpone-badge">odloženo ${task.postponeCount}×</span>` : ''}</div>
                ${reminderHtml}
            </div>
            <button class="star-btn${task.priority ? ' active' : ''}" data-id="${task.id}" aria-label="Priorita">${starFilled}</button>
            <button class="task-tomorrow" data-id="${task.id}" aria-label="Přesunout na zítra" title="Přesunout na zítra">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <polyline points="9 18 15 12 9 6"/>
                </svg>
            </button>
            <button class="task-edit" data-id="${task.id}" aria-label="Upravit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
            </button>
        `;
        list.appendChild(li);
    });

    // Delegate events — star, tomorrow, edit, check
    list.querySelectorAll('.star-btn').forEach(btn => {
        btn.addEventListener('click', () => togglePriority(btn.dataset.id));
    });
    list.querySelectorAll('.task-tomorrow').forEach(btn => {
        btn.addEventListener('click', () => moveToNextDay(btn.dataset.id));
    });
    list.querySelectorAll('.task-edit').forEach(btn => {
        btn.addEventListener('click', () => openEditTask(btn.dataset.id));
    });
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

    taskEl.textContent = (parsed.priority ? '⭐ ' : '') + parsed.text;
    if (parsed.reminder) {
        remEl.textContent = `Připomínka v ${parsed.reminder}`;
        remEl.classList.remove('hidden');
    } else {
        remEl.textContent = '';
        remEl.classList.add('hidden');
    }

    if (parsed.type === 'note') {
        taskEl.textContent = `Nápad: ${parsed.text}`;
    } else if (parsed.type === 'recurring') {
        taskEl.textContent = `↺ ${parsed.text}`;
        if (parsed.days) {
            remEl.textContent = daysLabel(parsed.days) + (parsed.reminder ? ` v ${parsed.reminder}` : '');
            remEl.classList.remove('hidden');
        }
    }

    preview.classList.remove('hidden');
    box.classList.remove('hidden');

    const statusMap = { note: 'Uložit jako nápad?', recurring: 'Přidat jako opakující se připomínku?', task: 'Přidat jako úkol?' };
    document.getElementById('voice-status').textContent = statusMap[parsed.type] || statusMap.task;
}

function confirmVoice() {
    if (!state.parsedVoice) return;
    const { type, text, reminder, days, priority } = state.parsedVoice;

    if (type === 'note') {
        addNote(text);
        switchTab('notes');
    } else if (type === 'recurring') {
        addRecurring(text, reminder, days || []);
        openRecurringModal();
    } else {
        addTask(text, reminder, null, null, !!priority);
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

// ── Search ─────────────────────────────────────────────────
function openSearchModal() {
    document.getElementById('search-modal').classList.remove('hidden');
    const inp = document.getElementById('search-input');
    inp.value = '';
    inp.focus();
    renderSearchResults('');
}

function closeSearchModal() {
    document.getElementById('search-modal').classList.add('hidden');
}

function renderSearchResults(query) {
    const list  = document.getElementById('search-results');
    const empty = document.getElementById('search-empty');
    list.innerHTML = '';

    if (!query.trim()) { empty.classList.add('hidden'); return; }

    const q = query.toLowerCase();

    const taskHits = state.tasks.filter(t =>
        t.text.toLowerCase().includes(q)
    );
    const noteHits = state.notes.filter(n =>
        n.text.toLowerCase().includes(q)
    );

    if (taskHits.length === 0 && noteHits.length === 0) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    const allHits = [
        ...taskHits.map(t => ({ ...t, _kind: 'task' })),
        ...noteHits.map(n => ({ ...n, _kind: 'note' })),
    ].sort((a, b) => (a.date > b.date ? 1 : -1));

    allHits.forEach(item => {
        const li = document.createElement('li');
        li.className = 'search-result-item';
        const isToday = item.date === todayStr();
        const dateLabel = isToday ? 'Dnes' : formatDate(item.date);
        const icon = item._kind === 'note' ? '✏️' : (item.done ? '✓' : '○');
        const textHighlighted = escHtml(item.text).replace(
            new RegExp(escHtml(query), 'gi'),
            m => `<mark>${m}</mark>`
        );
        li.innerHTML = `
            <span class="sr-icon">${icon}</span>
            <span class="sr-body">
                <span class="sr-text">${textHighlighted}</span>
                <span class="sr-date">${dateLabel}</span>
            </span>
        `;
        li.addEventListener('click', () => {
            state.currentDate = item.date;
            renderDateNav();
            renderWeekStrip();
            renderTasks();
            renderNotes();
            document.getElementById('go-today-btn').classList.toggle('hidden', item.date === todayStr());
            closeSearchModal();
        });
        list.appendChild(li);
    });
}

// ── Settings modal ─────────────────────────────────────────
function openSettingsModal() {
    document.getElementById('summary-time-input').value    = state.settings.summaryTime || '21:00';
    document.getElementById('auto-rollover-input').checked = state.settings.autoRollover !== false;
    document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
}

function saveSettings() {
    state.settings.summaryTime     = document.getElementById('summary-time-input').value || '21:00';
    state.settings.autoRollover    = document.getElementById('auto-rollover-input').checked;
    state.settings.lastSummaryDate = null;
    save();
    closeSettingsModal();
    startSummaryCheck();
    showInAppAlert('Nastavení uloženo.');
}

// ── Export / Import ────────────────────────────────────────
function exportData() {
    const backup = {
        version:   2,
        exportedAt: new Date().toISOString(),
        tasks:     state.tasks,
        notes:     state.notes,
        recurring: state.recurring,
        settings:  state.settings,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = todayStr();
    a.href     = url;
    a.download = `itinerar-zaloha-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showInAppAlert('Záloha stažena.');
}

function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const backup = JSON.parse(e.target.result);
            if (!backup.tasks && !backup.notes) throw new Error('Neplatný soubor');

            // Merge: add imported items that don't already exist (by id)
            const existingTaskIds = new Set(state.tasks.map(t => t.id));
            const newTasks = (backup.tasks || []).filter(t => !existingTaskIds.has(t.id));
            state.tasks.push(...newTasks);

            const existingNoteIds = new Set(state.notes.map(n => n.id));
            const newNotes = (backup.notes || []).filter(n => !existingNoteIds.has(n.id));
            state.notes.push(...newNotes);

            const existingRecIds = new Set(state.recurring.map(r => r.id));
            const newRec = (backup.recurring || []).filter(r => !existingRecIds.has(r.id));
            state.recurring.push(...newRec);

            save();
            renderTasks();
            renderNotes();
            closeSettingsModal();
            showInAppAlert(`Importováno: ${newTasks.length} úkolů, ${newNotes.length} nápadů.`);
        } catch (err) {
            showInAppAlert('Chyba při importu — zkontroluj soubor.');
        }
    };
    reader.readAsText(file);
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
    renderWeekStrip();
    renderTasks();
    renderNotes();
    document.getElementById('go-today-btn').classList.toggle('hidden', state.currentDate === todayStr());
}

// ── Init ───────────────────────────────────────────────────
function init() {
    spawnRecurringTasks();
    renderDateNav();
    renderWeekStrip();
    renderTasks();
    renderNotes();
    scheduleAllReminders();
    startSummaryCheck();
    checkAutoRollover();
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

    // Edit task modal
    document.getElementById('save-edit-task').addEventListener('click', saveEditTask);
    document.getElementById('delete-edit-task').addEventListener('click', () => {
        const id = document.getElementById('edit-task-id').value;
        document.getElementById('edit-task-modal').classList.add('hidden');
        deleteTask(id);
    });
    ['cancel-edit-task', 'cancel-edit-task-2'].forEach(id => {
        document.getElementById(id).addEventListener('click', () => {
            document.getElementById('edit-task-modal').classList.add('hidden');
        });
    });
    document.getElementById('edit-task-text').addEventListener('keydown', e => {
        if (e.key === 'Enter') saveEditTask();
        if (e.key === 'Escape') document.getElementById('edit-task-modal').classList.add('hidden');
    });
    document.getElementById('edit-task-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) document.getElementById('edit-task-modal').classList.add('hidden');
    });

    // Summary button
    document.getElementById('summary-btn').addEventListener('click', openSummaryModal);
    document.getElementById('close-summary').addEventListener('click', closeSummaryModal);
    document.getElementById('rollover-btn').addEventListener('click', rolloverPendingTasks);
    document.getElementById('dismiss-btn').addEventListener('click',  closeSummaryModal);

    // Search
    document.getElementById('search-btn').addEventListener('click', openSearchModal);
    document.getElementById('close-search').addEventListener('click', closeSearchModal);
    document.getElementById('search-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeSearchModal();
    });
    document.getElementById('search-input').addEventListener('input', e => {
        renderSearchResults(e.target.value);
    });

    // Settings
    document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
    document.getElementById('close-settings').addEventListener('click', closeSettingsModal);
    document.getElementById('save-settings').addEventListener('click',  saveSettings);
    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('import-file').addEventListener('change', e => {
        importData(e.target.files[0]);
        e.target.value = ''; // reset so same file can be imported again if needed
    });

    // Notification banner
    document.getElementById('allow-notif').addEventListener('click', () => {
        Notification.requestPermission().then(() => {
            document.getElementById('notif-banner').classList.add('hidden');
        });
    });
    document.getElementById('deny-notif').addEventListener('click', () => {
        document.getElementById('notif-banner').classList.add('hidden');
    });

    // Recurring modal
    document.getElementById('recurring-btn').addEventListener('click', openRecurringModal);
    document.getElementById('close-recurring').addEventListener('click', closeRecurringModal);
    document.getElementById('recurring-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeRecurringModal();
    });

    // Day picker buttons
    document.querySelectorAll('.day-btn').forEach(btn => {
        btn.addEventListener('click', () => btn.classList.toggle('active'));
    });

    // Day preset buttons (Pracovní dny / Víkend / Každý den)
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const days = btn.dataset.days.split(',').map(Number);
            document.querySelectorAll('.day-btn').forEach(b => {
                b.classList.toggle('active', days.includes(parseInt(b.dataset.day)));
            });
        });
    });

    // Add recurring manually
    document.getElementById('confirm-recurring').addEventListener('click', () => {
        const text    = document.getElementById('rec-task-input').value.trim();
        const time    = document.getElementById('rec-time-input').value || null;
        const selDays = getSelectedDays();
        if (!text || selDays.length === 0) {
            showInAppAlert('Vyber alespoň jeden den a napiš název připomínky.');
            return;
        }
        addRecurring(text, time, selDays);
        document.getElementById('rec-task-input').value = '';
        document.getElementById('rec-time-input').value = '';
        document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
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

// ── Service Worker registration + message handling ─────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.warn('SW registration failed:', err);
        });
    });

    // Handle action messages posted back from notification clicks
    navigator.serviceWorker.addEventListener('message', e => {
        const { type, taskId, hours } = e.data || {};
        if (type === 'sw_task_done') toggleTask(taskId);
        if (type === 'sw_snooze')    snoozeTask(taskId, hours);
    });
}
