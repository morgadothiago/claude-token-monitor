'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const readline = require('readline');

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Only kept for the "usage window" progress bar (rolling-window estimate the
// renderer builds from a user-configured limit/duration — see README). We
// never fetch or guess any official Anthropic quota; this is just recent
// history bucketed finely enough to compute a rolling sum locally.
const TIMELINE_WINDOW_MS = 72 * 60 * 60 * 1000; // keep last 72h of buckets
const TIMELINE_BUCKET_MS = 5 * 60 * 1000; // 5-minute resolution

/**
 * Recursively lists all .jsonl files under a directory.
 * Uses async fs to avoid blocking the main process on large trees.
 */
async function findJsonlFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return results;
    throw err;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findJsonlFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Derives a human-readable project name from a project slug directory name.
 * Claude Code stores project dirs as "-Users-name-Desktop-my-project" which
 * roughly mirrors the original absolute path with slashes swapped for dashes.
 * This is a best-effort fallback used only when `cwd` was never seen in the
 * session's JSONL lines.
 */
function projectNameFromSlug(slug) {
  const parts = slug.split('-').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : slug;
}

/**
 * Derives a human-readable project name from an absolute cwd path.
 */
function projectNameFromCwd(cwd) {
  if (!cwd) return null;
  const normalized = cwd.replace(/[\\/]+$/, '');
  const base = path.basename(normalized);
  return base || normalized;
}

/**
 * Streams a single .jsonl file line by line (NDJSON), accumulating token
 * usage into the sessions map. Malformed lines are skipped silently since
 * Claude Code session files can contain partial/truncated trailing lines.
 */
async function processJsonlFile(filePath, projectSlug, sessionsMap, bucketsMap, cutoffMs) {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  // Fallback sessionId derived from the file name (session-uuid.jsonl) in
  // case a line is missing the sessionId field.
  const fallbackSessionId = path.basename(filePath, '.jsonl');

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // skip malformed / truncated lines
    }

    const sessionId = event.sessionId || fallbackSessionId;
    const usage = event.message && event.message.usage;

    let session = sessionsMap.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        cwd: null,
        projectSlug,
        lastActivity: null,
        input: 0,
        output: 0,
        cacheCreation: 0,
        cacheRead: 0,
        total: 0,
      };
      sessionsMap.set(sessionId, session);
    }

    if (event.cwd && !session.cwd) {
      session.cwd = event.cwd;
    }

    let ts = null;
    if (event.timestamp) {
      const parsed = Date.parse(event.timestamp);
      if (!Number.isNaN(parsed)) {
        ts = parsed;
        if (session.lastActivity === null || ts > session.lastActivity) {
          session.lastActivity = ts;
        }
      }
    }

    if (usage) {
      const input = Number(usage.input_tokens) || 0;
      const output = Number(usage.output_tokens) || 0;
      const cacheCreation = Number(usage.cache_creation_input_tokens) || 0;
      const cacheRead = Number(usage.cache_read_input_tokens) || 0;
      const lineTotal = input + output + cacheCreation + cacheRead;

      session.input += input;
      session.output += output;
      session.cacheCreation += cacheCreation;
      session.cacheRead += cacheRead;
      session.total += lineTotal;

      // Recent-history timeline, used only to compute a locally-derived
      // rolling-window usage estimate in the renderer (never an official
      // Anthropic quota, which has no public API).
      if (ts !== null && ts >= cutoffMs) {
        const bucketKey = Math.floor(ts / TIMELINE_BUCKET_MS) * TIMELINE_BUCKET_MS;
        let bucket = bucketsMap.get(bucketKey);
        if (!bucket) {
          bucket = { t: bucketKey, input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
          bucketsMap.set(bucketKey, bucket);
        }
        bucket.input += input;
        bucket.output += output;
        bucket.cacheCreation += cacheCreation;
        bucket.cacheRead += cacheRead;
        bucket.total += lineTotal;
      }
    }
  }
}

/**
 * Scans ~/.claude/projects for all session JSONL files and aggregates
 * token usage per session.
 */
async function scanSessions() {
  const sessionsMap = new Map();
  const bucketsMap = new Map();
  const cutoffMs = Date.now() - TIMELINE_WINDOW_MS;

  let projectDirs = [];
  try {
    projectDirs = await fs.promises.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { sessions: [], totals: emptyTotals(), timeline: [], scannedAt: Date.now() };
    }
    throw err;
  }

  for (const dirEntry of projectDirs) {
    if (!dirEntry.isDirectory()) continue;
    const projectSlug = dirEntry.name;
    const projectDirPath = path.join(CLAUDE_PROJECTS_DIR, projectSlug);
    const jsonlFiles = await findJsonlFiles(projectDirPath);

    for (const filePath of jsonlFiles) {
      try {
        await processJsonlFile(filePath, projectSlug, sessionsMap, bucketsMap, cutoffMs);
      } catch (err) {
        // Don't let one corrupt file abort the whole scan.
        console.error(`[claude-token-monitor] failed to read ${filePath}:`, err.message);
      }
    }
  }

  const sessions = Array.from(sessionsMap.values())
    .filter((s) => s.total > 0)
    .map((s) => ({
      sessionId: s.sessionId,
      cwd: s.cwd,
      projectName: projectNameFromCwd(s.cwd) || projectNameFromSlug(s.projectSlug),
      lastActivity: s.lastActivity,
      input: s.input,
      output: s.output,
      cacheCreation: s.cacheCreation,
      cacheRead: s.cacheRead,
      total: s.total,
    }))
    .sort((a, b) => b.total - a.total);

  const totals = sessions.reduce(
    (acc, s) => {
      acc.input += s.input;
      acc.output += s.output;
      acc.cacheCreation += s.cacheCreation;
      acc.cacheRead += s.cacheRead;
      acc.total += s.total;
      return acc;
    },
    emptyTotals()
  );

  const timeline = Array.from(bucketsMap.values()).sort((a, b) => a.t - b.t);

  return { sessions, totals, timeline, scannedAt: Date.now() };
}

function emptyTotals() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
}

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
    return scanSessions();
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
