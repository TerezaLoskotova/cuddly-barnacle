// ── State ──────────────────────────────────────────────────
let age = 5;
let gender = 'dívka';
let speech = null;
let recognition = null;

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
    recognition.continuous = true;
    recognition.interimResults = true;

    let baseText = '';
    let isRecording = false;

    recognition.onresult = (e) => {
        let interim = '';
        let final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const transcript = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += transcript;
            else interim += transcript;
        }
        if (final) baseText += final;
        const combined = (baseText + interim).slice(0, 1200);
        eventsInput.value = combined;
        document.getElementById('char-num').textContent = eventsInput.value.length;
    };

    recognition.onerror = (e) => {
        if (e.error !== 'aborted') {
            voiceStatusText.textContent = 'Chyba mikrofonu';
            voiceStatusText.classList.remove('hidden');
            setTimeout(() => voiceStatusText.classList.add('hidden'), 2000);
        }
        stopRecording();
    };

    recognition.onend = () => {
        if (isRecording) {
            // Mobile browsers stop recognition after silence even with continuous:true — restart
            try { recognition.start(); } catch (_) {}
        }
    };

    function stopRecording() {
        isRecording = false;
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

// ── Story generation ─────────────────────────────────────────
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
    btnText.textContent = 'Kouzelníme…';
    spinner.classList.remove('hidden');
    errorEl.classList.add('hidden');

    try {
        const res = await fetch('/api/generate-story', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ childName, childAge: age, childGender: gender, events }),
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Něco se pokazilo.');
        }

        document.getElementById('story-title').textContent = `Pohádka pro ${childName}`;
        document.getElementById('story-text').textContent = data.story;

        const demoBanner = document.getElementById('demo-banner');
        if (data.demo) demoBanner.classList.remove('hidden');
        else demoBanner.classList.add('hidden');
        document.getElementById('play-hint').textContent = 'Přehrát pohádku hlasem';
        resetPlayButton();
        showScreen('screen-story');

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
