// ── State ──────────────────────────────────────────────────
let age = 5;
let gender = 'dívka';
let theme = '';
let speech = null;
let recognition = null;
let audioEl = null;
let voiceId = localStorage.getItem('elVoiceId') || null;

// ── Profily & Historie ───────────────────────────────────────
function getProfiles() { return JSON.parse(localStorage.getItem('profiles') || '[]'); }
function getStories()  { return JSON.parse(localStorage.getItem('stories')  || '[]'); }
function setProfiles(p) { localStorage.setItem('profiles', JSON.stringify(p)); }
function setStories(s)  { localStorage.setItem('stories',  JSON.stringify(s.slice(-30))); }

function upsertProfile(name, a, g) {
    const profiles = getProfiles();
    const idx = profiles.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
    if (idx !== -1) {
        profiles[idx] = { ...profiles[idx], age: a, gender: g };
        // move to front (most recently used)
        profiles.unshift(profiles.splice(idx, 1)[0]);
    } else {
        profiles.unshift({ id: Date.now().toString(), name, age: a, gender: g });
    }
    setProfiles(profiles);
    renderProfileChips();
}

function addStoryToHistory(title, story, profileName) {
    const stories = getStories();
    stories.push({ id: Date.now().toString(), title, story, profileName, date: new Date().toISOString() });
    setStories(stories);
}

function loadProfileIntoForm(p) {
    document.getElementById('child-name').value = p.name;
    age = p.age;
    document.getElementById('age-display').textContent = age;
    gender = p.gender;
    document.getElementById('gender-girl').classList.toggle('active', gender === 'dívka');
    document.getElementById('gender-boy').classList.toggle('active', gender === 'chlapec');
    renderProfileChips();
}

function renderProfileChips() {
    const profiles = getProfiles();
    const section = document.getElementById('profile-section');
    const row     = document.getElementById('profile-row');

    if (profiles.length === 0) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');

    const currentName = document.getElementById('child-name').value.trim().toLowerCase();
    row.innerHTML = '';

    profiles.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'profile-chip' + (p.name.toLowerCase() === currentName ? ' active' : '');
        btn.textContent = p.name;
        btn.addEventListener('click', () => loadProfileIntoForm(p));
        row.appendChild(btn);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'profile-chip profile-chip-new';
    addBtn.textContent = '+ Nový';
    addBtn.addEventListener('click', () => {
        document.getElementById('child-name').value = '';
        document.getElementById('child-name').focus();
        renderProfileChips();
    });
    row.appendChild(addBtn);
}

function renderHistory() {
    const stories = getStories();
    const list = document.getElementById('history-list');

    if (stories.length === 0) {
        list.innerHTML = '<p class="history-empty">Zatím žádné pohádky.<br>Vykouzlete první!</p>';
        return;
    }

    list.innerHTML = '';
    [...stories].reverse().forEach(s => {
        const d = new Date(s.date).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' });
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
            <div class="history-item-info">
                <div class="history-item-title">${s.title}</div>
                <div class="history-item-meta">${s.profileName} · ${d}</div>
            </div>
            <svg class="history-arrow" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        `;
        item.addEventListener('click', () => {
            document.getElementById('story-title').textContent = s.title;
            document.getElementById('story-text').textContent  = s.story;
            document.getElementById('demo-banner').classList.add('hidden');
            document.getElementById('play-hint').textContent = 'Přehrát pohádku hlasem';
            resetPlayButton();
            showScreen('screen-story');
        });
        list.appendChild(item);
    });
}

// Init — load most recent profile
(function init() {
    const profiles = getProfiles();
    if (profiles.length > 0) loadProfileIntoForm(profiles[0]);
    else renderProfileChips();
})();

// ── Screen navigation ───────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo(0, 0);
}

// ── Age picker ──────────────────────────────────────────────
document.getElementById('age-down').addEventListener('click', () => {
    if (age > 1) { age--; document.getElementById('age-display').textContent = age; }
});
document.getElementById('age-up').addEventListener('click', () => {
    if (age < 12) { age++; document.getElementById('age-display').textContent = age; }
});

// ── Gender picker ────────────────────────────────────────────
document.getElementById('gender-girl').addEventListener('click', () => {
    gender = 'dívka';
    document.getElementById('gender-girl').classList.add('active');
    document.getElementById('gender-boy').classList.remove('active');
});
document.getElementById('gender-boy').addEventListener('click', () => {
    gender = 'chlapec';
    document.getElementById('gender-boy').classList.add('active');
    document.getElementById('gender-girl').classList.remove('active');
});

// ── Theme picker ─────────────────────────────────────────────
document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        theme = btn.dataset.theme;
    });
});

// ── Char counter ─────────────────────────────────────────────
document.getElementById('events-input').addEventListener('input', function () {
    document.getElementById('char-num').textContent = this.value.length;
});

// ── Voice input ──────────────────────────────────────────────
const voiceBtn = document.getElementById('btn-voice-input');
const voiceStatusText = document.getElementById('voice-status-text');
const eventsInput = document.getElementById('events-input');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
    voiceBtn.title = 'Váš prohlížeč nepodporuje hlasový vstup';
    voiceBtn.style.opacity = '0.4';
    voiceBtn.disabled = true;
} else {
    recognition = new SpeechRecognition();
    recognition.lang = 'cs-CZ';
    recognition.continuous = false; // mobile-safe: stops after silence, no ambient noise loop
    recognition.interimResults = true;

    let baseText = '';
    let isRecording = false;
    let restartTimer = null;

    recognition.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const transcript = e.results[i][0].transcript;
            if (e.results[i].isFinal) baseText += transcript;
            else interim += transcript;
        }
        eventsInput.value = (baseText + interim).slice(0, 1200);
        document.getElementById('char-num').textContent = eventsInput.value.length;
    };

    recognition.onerror = (e) => {
        if (e.error === 'aborted' || e.error === 'no-speech') return;
        voiceStatusText.textContent = 'Chyba mikrofonu';
        voiceStatusText.classList.remove('hidden');
        setTimeout(() => voiceStatusText.classList.add('hidden'), 2000);
        stopRecording();
    };

    recognition.onend = () => {
        if (!isRecording) return;
        // Restart after brief pause so user can continue speaking in multiple sentences
        restartTimer = setTimeout(() => {
            if (isRecording) {
                try { recognition.start(); } catch (_) {}
            }
        }, 250);
    };

    function stopRecording() {
        isRecording = false;
        clearTimeout(restartTimer);
        voiceBtn.classList.remove('recording');
        voiceStatusText.classList.add('hidden');
        try { recognition.stop(); } catch (_) {}
    }

    voiceBtn.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            baseText = eventsInput.value;
            isRecording = true;
            voiceBtn.classList.add('recording');
            voiceStatusText.classList.remove('hidden');
            voiceStatusText.textContent = 'Poslouchám…';
            recognition.start();
        }
    });
}

// ── Navigation ───────────────────────────────────────────────
function goToForm() {
    document.getElementById('form-error').classList.add('hidden');
    showScreen('screen-form');
}
document.getElementById('btn-start').addEventListener('click', goToForm);
document.getElementById('btn-back').addEventListener('click', () => showScreen('screen-home'));
document.getElementById('btn-new-story').addEventListener('click', () => {
    stopSpeech();
    goToForm();
});
document.getElementById('btn-history').addEventListener('click', () => {
    renderHistory();
    showScreen('screen-history');
});
document.getElementById('btn-back-history').addEventListener('click', () => showScreen('screen-home'));

// ── Voice setup navigation ───────────────────────────────────
document.getElementById('btn-voice-setup').addEventListener('click', () => {
    renderVoiceScreen();
    showScreen('screen-voice');
});
document.getElementById('btn-back-voice').addEventListener('click', () => showScreen('screen-home'));
document.getElementById('btn-rerecord').addEventListener('click', () => {
    document.getElementById('voice-done-section').classList.add('hidden');
    document.getElementById('voice-record-section').classList.remove('hidden');
});

function renderVoiceScreen() {
    if (voiceId) {
        document.getElementById('voice-done-section').classList.remove('hidden');
        document.getElementById('voice-record-section').classList.add('hidden');
        document.getElementById('voice-setup-label').textContent = '🎙 Váš hlas je aktivní';
    } else {
        document.getElementById('voice-done-section').classList.add('hidden');
        document.getElementById('voice-record-section').classList.remove('hidden');
        document.getElementById('voice-setup-label').textContent = '🎙 Nastavit svůj hlas';
    }
}

// ── MediaRecorder voice recording ───────────────────────────
(function initVoiceRecorder() {
    const btnRecord   = document.getElementById('btn-record');
    const timerEl     = document.getElementById('voice-timer');
    const statusEl    = document.getElementById('voice-status');

    let mediaRecorder = null;
    let chunks        = [];
    let timerInterval = null;
    let seconds       = 0;
    let isRecording   = false;

    function formatTime(s) {
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function startTimer() {
        seconds = 0;
        timerEl.textContent = formatTime(seconds);
        timerInterval = setInterval(() => {
            seconds++;
            timerEl.textContent = formatTime(seconds);
            if (seconds >= 120) stopRecording(); // auto-stop at 2 min
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timerInterval);
    }

    async function stopRecording() {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
        isRecording = false;
        btnRecord.classList.remove('recording');
        document.getElementById('btn-record-icon').textContent = '🎙';
        document.getElementById('btn-record-text').textContent = 'Začít nahrávat';
        stopTimer();
        mediaRecorder.stop();
    }

    btnRecord.addEventListener('click', async () => {
        if (isRecording) {
            await stopRecording();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
            mediaRecorder = new MediaRecorder(stream, { mimeType });
            chunks = [];

            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());

                if (seconds < 10) {
                    statusEl.textContent = 'Nahrajte alespoň 10 sekund hlasu.';
                    statusEl.className = 'voice-status error';
                    statusEl.classList.remove('hidden');
                    return;
                }

                statusEl.textContent = 'Nahrávám hlas…';
                statusEl.className = 'voice-status';
                statusEl.classList.remove('hidden');
                btnRecord.disabled = true;

                try {
                    const blob = new Blob(chunks, { type: mimeType });
                    const base64 = await blobToBase64(blob);

                    const res = await fetch('/api/create-voice', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ audio: base64, mimeType }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Chyba nahrávání hlasu.');

                    voiceId = data.voiceId;
                    localStorage.setItem('elVoiceId', voiceId);

                    statusEl.textContent = 'Hlas byl úspěšně nahrán!';
                    statusEl.className = 'voice-status success';

                    setTimeout(() => {
                        renderVoiceScreen();
                    }, 1500);

                } catch (err) {
                    statusEl.textContent = err.message || 'Nepodařilo se nahrát hlas.';
                    statusEl.className = 'voice-status error';
                } finally {
                    btnRecord.disabled = false;
                }
            };

            isRecording = true;
            btnRecord.classList.add('recording');
            document.getElementById('btn-record-icon').textContent = '⏹';
            document.getElementById('btn-record-text').textContent = 'Zastavit nahrávání';
            startTimer();
            mediaRecorder.start();

        } catch (err) {
            statusEl.textContent = 'Nepodařilo se získat přístup k mikrofonu.';
            statusEl.className = 'voice-status error';
            statusEl.classList.remove('hidden');
        }
    });
})();

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ── Story generation (streaming) ──────────────────────────────
document.getElementById('story-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const childName   = document.getElementById('child-name').value.trim();
    const events      = document.getElementById('events-input').value.trim();
    const generateBtn = document.getElementById('btn-generate');
    const btnText     = document.getElementById('btn-generate-text');
    const spinner     = document.getElementById('btn-generate-spinner');
    const errorEl     = document.getElementById('form-error');

    if (!childName || !events) return;

    generateBtn.disabled = true;
    btnText.textContent = 'Kouzlíme…';
    spinner.classList.remove('hidden');
    errorEl.classList.add('hidden');

    try {
        const res = await fetch('/api/generate-story', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ childName, childAge: age, childGender: gender, theme, events }),
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Něco se pokazilo.');
        }

        // Prepare story screen before streaming starts
        document.getElementById('story-text').textContent = '';
        document.getElementById('story-title').textContent = `Pohádka pro ${childName}`;
        document.getElementById('demo-banner').classList.add('hidden');
        document.getElementById('play-hint').textContent = 'Přehrát pohádku hlasem';
        resetPlayButton();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuf = '';
        let screenShown = false;
        let storyTitle = `Pohádka pro ${childName}`;
        let completed = false;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                sseBuf += decoder.decode(value, { stream: true });
                const parts = sseBuf.split('\n\n');
                sseBuf = parts.pop();

                for (const part of parts) {
                    const evMatch   = part.match(/^event: (\w+)/m);
                    const dataMatch = part.match(/^data: (.+)/ms);
                    if (!evMatch || !dataMatch) continue;

                    const ev   = evMatch[1];
                    const data = JSON.parse(dataMatch[1]);

                    if (ev === 'title') {
                        storyTitle = data || storyTitle;
                        upsertProfile(childName, age, gender);
                        document.getElementById('story-title').textContent = storyTitle;
                        if (!screenShown) { showScreen('screen-story'); screenShown = true; }
                    } else if (ev === 'text') {
                        if (!screenShown) { showScreen('screen-story'); screenShown = true; }
                        document.getElementById('story-text').textContent += data;
                    } else if (ev === 'done') {
                        completed = true;
                        try {
                            addStoryToHistory(storyTitle, document.getElementById('story-text').textContent, childName);
                        } catch (_) {}
                    } else if (ev === 'error') {
                        throw new Error(data.message || 'Něco se pokazilo.');
                    }
                }
            }
        } catch (streamErr) {
            // Ignore connection-close errors after successful completion
            if (!completed) throw streamErr;
        }

    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    } finally {
        generateBtn.disabled = false;
        btnText.textContent = 'Vykouzlit pohádku';
        spinner.classList.add('hidden');
    }
});

// ── Web Speech API ────────────────────────────────────────────
function resetPlayButton() {
    document.getElementById('icon-play').classList.remove('hidden');
    document.getElementById('icon-pause').classList.add('hidden');
}

function stopSpeech() {
    if (audioEl) {
        audioEl.pause();
        audioEl.src = '';
        audioEl = null;
    }
    if (speech) {
        window.speechSynthesis.cancel();
        speech = null;
    }
    resetPlayButton();
    document.getElementById('play-hint').textContent = 'Přehrát pohádku hlasem';
}

document.getElementById('btn-play').addEventListener('click', async () => {
    // ── Pause/resume HTML audio (ElevenLabs) ──
    if (audioEl) {
        if (audioEl.paused) {
            audioEl.play();
            document.getElementById('icon-play').classList.add('hidden');
            document.getElementById('icon-pause').classList.remove('hidden');
            document.getElementById('play-hint').textContent = 'Pohádka se přehrává…';
        } else {
            audioEl.pause();
            document.getElementById('icon-play').classList.remove('hidden');
            document.getElementById('icon-pause').classList.add('hidden');
            document.getElementById('play-hint').textContent = 'Pozastaveno';
        }
        return;
    }

    // ── Pause/resume Web Speech API ──
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
            document.getElementById('icon-play').classList.add('hidden');
            document.getElementById('icon-pause').classList.remove('hidden');
            document.getElementById('play-hint').textContent = 'Pohádka se přehrává…';
        } else {
            window.speechSynthesis.pause();
            document.getElementById('icon-play').classList.remove('hidden');
            document.getElementById('icon-pause').classList.add('hidden');
            document.getElementById('play-hint').textContent = 'Pozastaveno';
        }
        return;
    }

    const storyText = document.getElementById('story-text').textContent;

    // ── ElevenLabs TTS ──
    if (voiceId) {
        const playBtn = document.getElementById('btn-play');
        playBtn.disabled = true;
        document.getElementById('play-hint').textContent = 'Připravuji váš hlas…';

        try {
            const res = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: storyText, voiceId }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Chyba TTS.');
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            audioEl = new Audio(url);

            audioEl.onplay = () => {
                document.getElementById('icon-play').classList.add('hidden');
                document.getElementById('icon-pause').classList.remove('hidden');
                document.getElementById('play-hint').textContent = 'Pohádka se přehrává…';
            };
            audioEl.onended = audioEl.onerror = () => {
                URL.revokeObjectURL(url);
                audioEl = null;
                resetPlayButton();
                document.getElementById('play-hint').textContent = 'Dobrou noc!';
            };

            audioEl.play();
        } catch (err) {
            audioEl = null;
            resetPlayButton();
            document.getElementById('play-hint').textContent = err.message || 'Chyba přehrávání.';
        } finally {
            playBtn.disabled = false;
        }
        return;
    }

    // ── Fallback: Web Speech API ──
    if (!('speechSynthesis' in window)) {
        document.getElementById('play-hint').textContent = 'Váš prohlížeč nepodporuje hlasové čtení.';
        return;
    }

    speech = new SpeechSynthesisUtterance(storyText);
    speech.lang = 'cs-CZ';
    speech.rate = 0.88;
    speech.pitch = 1.05;

    const voices = window.speechSynthesis.getVoices();
    const czVoice = voices.find(v => v.lang.startsWith('cs'));
    if (czVoice) speech.voice = czVoice;

    speech.onstart = () => {
        document.getElementById('icon-play').classList.add('hidden');
        document.getElementById('icon-pause').classList.remove('hidden');
        document.getElementById('play-hint').textContent = 'Pohádka se přehrává…';
    };
    speech.onend = speech.onerror = () => {
        resetPlayButton();
        document.getElementById('play-hint').textContent = 'Dobrou noc!';
        speech = null;
    };

    window.speechSynthesis.speak(speech);
});

window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

// ── Sdílení ───────────────────────────────────────────────────
document.getElementById('btn-share').addEventListener('click', async () => {
    const title = document.getElementById('story-title').textContent;
    const text  = document.getElementById('story-text').textContent;
    const shareBtn  = document.getElementById('btn-share');
    const shareTxt  = document.getElementById('btn-share-text');

    if (navigator.share) {
        try {
            await navigator.share({ title, text });
        } catch (e) {
            // user cancelled — ignore
        }
        return;
    }

    // Fallback: copy to clipboard
    try {
        await navigator.clipboard.writeText(`${title}\n\n${text}`);
        shareTxt.textContent = 'Zkopírováno!';
        shareBtn.classList.add('copied');
        setTimeout(() => {
            shareTxt.textContent = 'Sdílet pohádku';
            shareBtn.classList.remove('copied');
        }, 2500);
    } catch (e) {
        shareTxt.textContent = 'Kopírování selhalo';
        setTimeout(() => { shareTxt.textContent = 'Sdílet pohádku'; }, 2000);
    }
});
