import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

const DEMO_MODE = !process.env.ANTHROPIC_API_KEY;
const client = DEMO_MODE ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Jsi laskavý vypravěč pohádek pro malé děti. Píšeš v krásné, přirozené češtině.

Pravidla pro příběh:
- Pohádka trvá při čtení nahlas 5 minut (cca 700–800 slov)
- Hlavní hrdina je dítě ze zadaného profilu — používej jeho jméno a správný rod (dívka = ona/její, chlapec = on/jeho)
- Jméno dítěte správně skloňuj ve všech pádech (Evička → Evičce, Evičku, Evičky, s Evičkou; Tomáš → Tomáše, Tomášovi, s Tomášem)
- Příběh vychází z toho, co dítě ten den zažilo, ale kouzelně to proměňuje
- Konec je vždy klidný a uklidňující — dítě usíná spokojené
- Nepoužívej záporné postavy ani strašidelné scény
- Každá pohádka má jasný začátek, střed a konec

Pravidla pro jazyk:
- Piš plynnou, přirozenou češtinou — jako by pohádku vyprávěla milující babička
- Vyhýbej se neobratným a krkolomným větám
- Používej bohatou slovní zásobu, ale srozumitelnou pro děti
- Věty střídej kratší s delšími, ať text hezky plyne
- Vyhýbej se klišé a floskulím ("legendárně", "úloha" místo "úkol" apod.)

Formát odpovědi:
1. řádek: krátký poetický název pohádky (max 6 slov, bez uvozovek, bez tečky)
2. řádek: prázdný
3. řádek a dál: text pohádky

Nic jiného nepřidávej.`;

function demoStory(childName) {
    return `Byl jednou jeden kouzelný večer, kdy malé ${childName} se vrátilo domů plné zážitků a dobrodružství.

Cestou ulicí si ${childName} všimlo něčeho neobvyklého — na chodníku seděl malý světluška a svítil zlatým světlem. „Pomůžeš mi najít cestu domů?" zeptal se světluška tichým hláskem.

„Ale samozřejmě," odpovědělo ${childName} a vzalo světlušku opatrně do dlaní.

Šli spolu přes zahradu plnou rozkvetlých sedmikrásek, kolem staré lípy, kde žil moudrý sýček, až k malé loučce u potoka. Tam svítily stovky dalších světlušek a čekaly na svého kamaráda.

„Díky, ${childName}!" zavolaly světlušky radostně a začaly tančit ve vzduchu. Nakreslily zlaté hvězdičky a vláčky světla, jen pro ${childName} jako poděkování.

${childName} se usmálo, zamávalo světluškám a pomalu se vydalo domů. Nohy mělo trochu unavené od chůze, oči těžké od krásných zážitků dne.

Doma čekala teplá postel a měkký polštář. ${childName} si lehlo, přikrylo se až po bradu a z okna dopadalo na strop světlo měsíce — takové klidné, stříbrné a teplé.

Za chvíli přišly sny — plné světlušek, zlatých hvězdičiek a nových dobrodružství, která čekají zítra.

Dobrou noc.`;
}

function sseWrite(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.post('/api/generate-story', async (req, res) => {
    const { childName, childAge, childGender, theme, events } = req.body;

    if (!childName || !events) {
        return res.status(400).json({ error: 'Chybí jméno dítěte nebo dnešní zážitky.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    if (DEMO_MODE) {
        const story = demoStory(childName);
        sseWrite(res, 'title', 'Pohádka o zlaté světlušce');
        await new Promise(r => setTimeout(r, 400));
        for (let i = 0; i < story.length; i += 18) {
            sseWrite(res, 'text', story.slice(i, i + 18));
            await new Promise(r => setTimeout(r, 25));
        }
        sseWrite(res, 'done', {});
        res.end();
        return;
    }

    try {
        const themeNote = theme ? `\nProstředí pohádky: ${theme}.` : '';
        const userPrompt = `Dítě: ${childName}, ${childAge} let, pohlaví: ${childGender || 'dívka'}.${themeNote}
Dnešní zážitky: ${events}

Vytvoř pohádku na dobrou noc.`;

        const stream = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
            stream: true,
        });

        let buf = '';
        let titleSent = false;

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                const text = event.delta.text;
                if (titleSent) {
                    sseWrite(res, 'text', text);
                } else {
                    buf += text;
                    const sep = buf.indexOf('\n\n');
                    if (sep !== -1) {
                        sseWrite(res, 'title', buf.slice(0, sep).trim());
                        const rest = buf.slice(sep + 2);
                        titleSent = true;
                        if (rest) sseWrite(res, 'text', rest);
                        buf = '';
                    }
                }
            }
        }

        if (!titleSent) {
            sseWrite(res, 'title', buf.trim() || `Pohádka pro ${childName}`);
        }
        sseWrite(res, 'done', {});
        res.end();

    } catch (err) {
        console.error('Claude API error:', err);
        if (!res.writableEnded) {
            sseWrite(res, 'error', { message: err.message || String(err) || 'Chyba Claude API.' });
            res.end();
        }
    }
});

// ── ElevenLabs: nahrání hlasu ──────────────────────────────────
app.post('/api/create-voice', async (req, res) => {
    const EL_KEY = process.env.ELEVENLABS_API_KEY;
    if (!EL_KEY) return res.status(400).json({ error: 'ElevenLabs API klíč není nastaven.' });

    const { audio, mimeType } = req.body;
    if (!audio) return res.status(400).json({ error: 'Chybí audio data.' });

    try {
        const audioBuffer = Buffer.from(audio, 'base64');
        const formData = new FormData();
        formData.append('name', 'Rodičovský hlas');
        formData.append('files', new Blob([audioBuffer], { type: mimeType || 'audio/webm' }), 'voice.webm');

        const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
            method: 'POST',
            headers: { 'xi-api-key': EL_KEY },
            body: formData,
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.detail?.message || `ElevenLabs error ${response.status}`);

        res.json({ voiceId: data.voice_id });
    } catch (err) {
        console.error('ElevenLabs create voice error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── ElevenLabs: TTS ────────────────────────────────────────────
app.post('/api/tts', async (req, res) => {
    const EL_KEY = process.env.ELEVENLABS_API_KEY;
    if (!EL_KEY) return res.status(400).json({ error: 'ElevenLabs API klíč není nastaven.' });

    const { text, voiceId } = req.body;
    if (!text || !voiceId) return res.status(400).json({ error: 'Chybí text nebo voiceId.' });

    try {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                method: 'POST',
                headers: {
                    'xi-api-key': EL_KEY,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text,
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
                }),
            }
        );

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail?.message || `ElevenLabs TTS error ${response.status}`);
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
        }
        res.end();
    } catch (err) {
        console.error('TTS error:', err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Pohádky server běží na http://localhost:${PORT}`);
});
