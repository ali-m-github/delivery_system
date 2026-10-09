#!/usr/bin/env node
/**
 * Generate square PWA icons from the uploaded Jet logo.
 *
 * The source logo is rectangular with a white background, so it is
 * contained (never stretched/cropped) and centered on a solid white
 * square canvas. A safe-zone padding keeps the text/arrow clear of
 * circular Android launcher masks.
 *
 * Usage: node scripts/generate-pwa-icons.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SOURCE_CANDIDATES = [
  '/root/Downloads/JetLogo.png',
  '/root/downloads/jetlogo.png',
  '/root/downlods/jetlogo.png',
];

// padding = fraction of the canvas kept empty on each side.
// Maskable icons get a 20% safe zone so circular/circular-masked
// launchers never crop the logo.
const TARGETS = [
  { file: 'public/icon-192x192.png', size: 192, padding: 0.1 },
  { file: 'public/icon-512x512.png', size: 512, padding: 0.1 },
  { file: 'public/icon-maskable-512x512.png', size: 512, padding: 0.2 },
  { file: 'public/apple-touch-icon.png', size: 180, padding: 0.1 },
];

const WHITE = '#ffffff';

function findSource() {
  for (const candidate of SOURCE_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Source logo not found. Checked:\n${SOURCE_CANDIDATES.map((c) => `  - ${c}`).join('\n')}`
  );
}

async function main() {
  const src = findSource();
  const srcMeta = await sharp(src).metadata();
  console.log(`Source: ${src} (${srcMeta.width}x${srcMeta.height})`);

  for (const { file, size, padding } of TARGETS) {
    const inner = Math.round(size * (1 - 2 * padding));

    // Flatten onto white (source has alpha), then contain-fit into the
    // inner safe area with white letterboxing.
    const logo = await sharp(src)
      .flatten({ background: WHITE })
      .resize(inner, inner, { fit: 'contain', background: WHITE })
      .toBuffer();

    const outPath = path.resolve(__dirname, '..', file);
    await sharp({
      create: { width: size, height: size, channels: 3, background: WHITE },
    })
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toFile(outPath);

    console.log(`Wrote ${file} (${size}x${size}, ${Math.round(padding * 100)}% padding)`);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
