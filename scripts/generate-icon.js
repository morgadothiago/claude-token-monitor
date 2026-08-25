'use strict';

// One-off tool: renders scripts/icon-design.html (a 1024x1024 inline SVG)
// through a hidden Electron window and saves it as build/icon-1024.png.
// This replaces the default Electron icon with the app's own icon before
// packaging. Run with: npx electron scripts/generate-icon.js

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_PATH = path.join(__dirname, '..', 'build', 'icon-1024.png');
const HTML_PATH = path.join(__dirname, 'icon-design.html');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false },
  });

  await win.loadFile(HTML_PATH);
  // Give the SVG a tick to paint before capturing.
  await new Promise((resolve) => setTimeout(resolve, 200));

  const image = await win.webContents.capturePage();
  fs.writeFileSync(OUT_PATH, image.toPNG());
  console.log(`[generate-icon] saved ${OUT_PATH} (${image.getSize().width}x${image.getSize().height})`);

  app.quit();
});
