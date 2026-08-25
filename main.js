'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const { scanSessions } = require('./lib/scanner');

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// electron-log writes to a local file per OS (~/Library/Logs on macOS,
// %USERPROFILE%\AppData\Roaming on Windows, ~/.config on Linux) - purely
// local, nothing is ever sent anywhere. Useful for debugging a report from
// a user without asking them to run the app from a terminal.
Object.assign(console, log.functions);
log.errorHandler.startCatching();
autoUpdater.logger = log;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1115',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Any attempt to open an external link opens it in the OS browser instead
  // of a new Electron window / navigating away from the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  ipcMain.handle('tokens:scan', async () => {
    return scanSessions(CLAUDE_PROJECTS_DIR);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Auto-update via GitHub Releases (see build.publish in package.json).
  // Only meaningful in a packaged build - electron-updater is a no-op (and
  // noisy in the log) when running unpackaged with `electron .`. This is
  // fire-and-forget: errors are logged locally, never surfaced as a crash.
  //
  // Known limitation: on macOS, Squirrel.Mac (which electron-updater relies
  // on) requires the app to be codesigned with a Developer ID certificate -
  // without one, the check succeeds but the actual update install step will
  // fail. Windows/Linux auto-update work fine unsigned, just with the usual
  // "unknown publisher" warning on first run.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      log.warn('[auto-update] check failed (non-fatal):', err.message);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Defense in depth: block any renderer navigation to origins other than our
// own app files, and block arbitrary new-window creation.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (navEvent, navigationUrl) => {
    const allowed = navigationUrl.startsWith('file://');
    if (!allowed) navEvent.preventDefault();
  });
});
