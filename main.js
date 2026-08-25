'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const { scanSessions } = require('./lib/scanner');
const { loadWindowBounds, saveWindowBounds } = require('./lib/windowState');

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// electron-log writes to a local file per OS (~/Library/Logs on macOS,
// %USERPROFILE%\AppData\Roaming on Windows, ~/.config on Linux) - purely
// local, nothing is ever sent anywhere. Useful for debugging a report from
// a user without asking them to run the app from a terminal.
Object.assign(console, log.functions);
log.errorHandler.startCatching();
autoUpdater.logger = log;

// Only one window/scan at a time. Without this, double-clicking the app
// icon twice (or launching it again from a second terminal) spins up two
// independent windows each re-scanning ~/.claude/projects in parallel -
// harmless but wasteful, and the second instance should just focus the
// first window instead of pretending to be a separate app.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;

function createWindow() {
  const savedBounds = loadWindowBounds(app.getPath('userData'));

  mainWindow = new BrowserWindow({
    ...savedBounds,
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

  // Persist size/position on every resize/move, debounced, and once more
  // on close so the last state is never lost even without a move/resize
  // event firing right before quit.
  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        saveWindowBounds(app.getPath('userData'), mainWindow.getBounds());
      }
    }, 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => {
    clearTimeout(saveTimer);
    if (!mainWindow.isDestroyed()) {
      saveWindowBounds(app.getPath('userData'), mainWindow.getBounds());
    }
  });

  // Any attempt to open an external link opens it in the OS browser instead
  // of a new Electron window / navigating away from the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

if (gotSingleInstanceLock) {
  // A second launch attempt lands here instead of opening its own window -
  // just bring the existing one to the front.
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

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
    // Known limitation: on macOS, Squirrel.Mac (which electron-updater
    // relies on) requires the app to be codesigned with a Developer ID
    // certificate - without one, the check succeeds but the actual update
    // install step will fail. Windows/Linux auto-update work fine unsigned,
    // just with the usual "unknown publisher" warning on first run.
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        log.warn('[auto-update] check failed (non-fatal):', err.message);
      });
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Defense in depth: block any renderer navigation to origins other than
  // our own app files, and block arbitrary new-window creation.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (navEvent, navigationUrl) => {
      const allowed = navigationUrl.startsWith('file://');
      if (!allowed) navEvent.preventDefault();
    });
  });
}
