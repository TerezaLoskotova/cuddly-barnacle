// ── State ──────────────────────────────────────────────────
let age = 5;
let gender = 'dívka';
let theme = '';
let speech = null;
let recognition = null;

// ── Profil z localStorage ────────────────────────────────────
(function loadProfile() {
    const p = JSON.parse(localStorage.getItem('childProfile') || 'null');
    if (!p) return;
    if (p.name) document.getElementById('child-name').value = p.name;
    if (p.age)  { age = p.age; document.getElementById('age-display').textContent = age; }
    if (p.gender) {
        gender = p.gender;
        document.getElementById('gender-girl').classList.toggle('active', gender === 'dívka');
        document.getElementById('gender-boy').classList.toggle('active', gender === 'chlapec');
    }
})();

function saveProfile(name) {
    localStorage.setItem('childProfile', JSON.stringify({ name, age, gender }));
}

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
document.getElementById('btn-start').addEventListener('click', () => showScreen('screen-form'));
document.getElementById('btn-back').addEventListener('click', () => showScreen('screen-home'));
document.getElementById('btn-new-story').addEventListener('click', () => {
    stopSpeech();
    showScreen('screen-form');
});

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
                    saveProfile(childName);
                    document.getElementById('story-title').textContent = data || `Pohádka pro ${childName}`;
                    if (!screenShown) { showScreen('screen-story'); screenShown = true; }
                } else if (ev === 'text') {
                    if (!screenShown) { showScreen('screen-story'); screenShown = true; }
                    document.getElementById('story-text').textContent += data;
                } else if (ev === 'error') {
                    throw new Error(data.message || 'Něco se pokazilo.');
                }
            }
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
    if (speech) {
        window.speechSynthesis.cancel();
        speech = null;
    }
    resetPlayButton();
    document.getElementById('play-hint').textContent = 'Přehrát pohádku hlasem';
}

document.getElementById('btn-play').addEventListener('click', () => {
    if (!('speechSynthesis' in window)) {
        document.getElementById('play-hint').textContent = 'Váš prohlížeč nepodporuje hlasové čtení.';
        return;
    }

    if (window.speechSynthesis.speaking) {
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
