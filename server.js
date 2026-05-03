import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Jsi milý vypravěč pohádek pro malé děti. Tvoříš krátké, teplé pohádky na dobrou noc v češtině.

Pravidla:
- Pohádka trvá při čtení nahlas 2–3 minuty (cca 300–400 slov)
- Hlavní hrdina je dítě ze zadaného profilu — používej jeho jméno
- Příběh vychází z toho, co dítě ten den zažilo, ale magicky to proměňuje
- Konec je vždy klidný a uklidňující — dítě usíná spokojené
- Jazyk je jednoduchý, teplý, pohádkový
- Nepoužívej záporné postavy ani strašidelné scény
- Každá pohádka má jasný začátek, střed a konec

Vracej POUZE text pohádky, bez nadpisů, bez uvozovek, bez komentářů.`;

app.post('/api/generate-story', async (req, res) => {
    const { childName, childAge, events } = req.body;

    if (!childName || !events) {
        return res.status(400).json({ error: 'Chybí jméno dítěte nebo dnešní zážitky.' });
    }

    try {
        const userPrompt = `Dítě: ${childName}, ${childAge} let.
Dnešní zážitky: ${events}

Vytvoř pohádku na dobrou noc.`;

        const message = await client.messages.create({
            model: 'claude-opus-4-7',
            max_tokens: 1024,
            thinking: { type: 'adaptive' },
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
            cache_control: { type: 'ephemeral' },
        });

        const story = message.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('');

        res.json({ story });
    } catch (err) {
        console.error('Claude API error:', err);
        res.status(500).json({ error: 'Nepodařilo se vytvořit pohádku. Zkus to znovu.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Pohádky server běží na http://localhost:${PORT}`);
});
