import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const DEMO_MODE = !process.env.ANTHROPIC_API_KEY;
const client = DEMO_MODE ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Jsi milý vypravěč pohádek pro malé děti. Tvoříš krátké, teplé pohádky na dobrou noc v češtině.

Pravidla:
- Pohádka trvá při čtení nahlas 2–3 minuty (cca 300–400 slov)
- Hlavní hrdina je dítě ze zadaného profilu — používej jeho jméno a správný rod (dívka = ona/její, chlapec = on/jeho)
- Skloňuj a přechyluj správně dle pohlaví dítěte v celém textu
- Příběh vychází z toho, co dítě ten den zažilo, ale magicky to proměňuje
- Konec je vždy klidný a uklidňující — dítě usíná spokojené
- Jazyk je jednoduchý, teplý, pohádkový
- Nepoužívej záporné postavy ani strašidelné scény
- Každá pohádka má jasný začátek, střed a konec

Vracej POUZE text pohádky, bez nadpisů, bez uvozovek, bez komentářů.`;

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

app.post('/api/generate-story', async (req, res) => {
    const { childName, childAge, childGender, theme, events } = req.body;

    if (!childName || !events) {
        return res.status(400).json({ error: 'Chybí jméno dítěte nebo dnešní zážitky.' });
    }

    if (DEMO_MODE) {
        await new Promise(r => setTimeout(r, 1800)); // simulace načítání
        return res.json({ story: demoStory(childName), demo: true });
    }

    try {
        const themeNote = theme ? `\nProstředí pohádky: ${theme}.` : '';
        const userPrompt = `Dítě: ${childName}, ${childAge} let, pohlaví: ${childGender || 'dívka'}.${themeNote}
Dnešní zážitky: ${events}

Vytvoř pohádku na dobrou noc.`;

        const message = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
        });

        const story = message.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('');

        res.json({ story });
    } catch (err) {
        console.error('Claude API error:', err);
        res.status(500).json({ error: err.message || 'Nepodařilo se vytvořit pohádku. Zkus to znovu.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Pohádky server běží na http://localhost:${PORT}`);
});
