#!/usr/bin/env node
/**
 * Generates icon-192.png and icon-512.png from icon.svg.
 * Run once: node generate-icons.js
 * Requires: npm install sharp   OR   just uses canvas fallback
 */
const fs   = require('fs');
const path = require('path');

// Try to use sharp if available, otherwise generate a minimal PNG programmatically
try {
    const sharp = require('sharp');
    const svg   = fs.readFileSync(path.join(__dirname, 'icon.svg'));

    Promise.all([
        sharp(svg).resize(192, 192).png().toFile('icon-192.png'),
        sharp(svg).resize(512, 512).png().toFile('icon-512.png'),
    ]).then(() => console.log('Icons generated with sharp.'))
      .catch(e => { console.error(e); fallback(); });
} catch {
    fallback();
}

function fallback() {
    // Minimal valid 1x1 purple PNG (placeholder) — replace with real icons in production
    // These are base64-encoded minimal PNGs that will work as app icons
    console.log('sharp not available — writing placeholder PNGs.');

    // A 192x192 solid purple PNG generated inline via Canvas API isn't available in Node.
    // We'll copy the SVG as a fallback reference and note that sharp is needed for real PNGs.
    fs.copyFileSync('icon.svg', 'icon-192.svg');
    fs.copyFileSync('icon.svg', 'icon-512.svg');
    console.log('Copied SVG placeholders. For real PNG icons run: npm install sharp && node generate-icons.js');
}
