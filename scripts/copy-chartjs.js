'use strict';

// Copies the locally installed Chart.js UMD bundle into renderer/ so the
// renderer process can load it via a plain <script src="chart.umd.js">
// under a strict `script-src 'self'` CSP, with no CDN dependency and full
// offline support.

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
const dest = path.join(__dirname, '..', 'renderer', 'chart.umd.js');

try {
  fs.copyFileSync(src, dest);
  console.log('[copy-chartjs] chart.umd.js copiado para renderer/');
} catch (err) {
  console.error('[copy-chartjs] falha ao copiar Chart.js:', err.message);
  process.exit(1);
}
