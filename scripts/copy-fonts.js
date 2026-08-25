'use strict';

// Copies a curated subset of the locally installed @fontsource packages
// into renderer/fonts/, so the renderer can @font-face them under a strict
// `script-src/style-src 'self'` CSP with zero network requests (no Google
// Fonts, no CDN) — fully offline, same approach as copy-chartjs.js.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'renderer', 'fonts');

const WANTED = [
  { pkg: '@fontsource/fraunces', file: 'fraunces-latin-600-normal.woff2' },
  { pkg: '@fontsource/fraunces', file: 'fraunces-latin-700-normal.woff2' },
  { pkg: '@fontsource/fraunces', file: 'fraunces-latin-600-italic.woff2' },
  { pkg: '@fontsource/inter', file: 'inter-latin-400-normal.woff2' },
  { pkg: '@fontsource/inter', file: 'inter-latin-500-normal.woff2' },
  { pkg: '@fontsource/inter', file: 'inter-latin-600-normal.woff2' },
  { pkg: '@fontsource/inter', file: 'inter-latin-700-normal.woff2' },
  { pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-400-normal.woff2' },
  { pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-500-normal.woff2' },
];

fs.mkdirSync(DEST, { recursive: true });

for (const { pkg, file } of WANTED) {
  const src = path.join(ROOT, 'node_modules', pkg, 'files', file);
  const dest = path.join(DEST, file);
  fs.copyFileSync(src, dest);
}

console.log(`[copy-fonts] copied ${WANTED.length} font files to renderer/fonts/`);
