'use strict';

// Pure-ish scanning/aggregation logic, deliberately kept free of any
// `electron` import so it can be unit tested with plain Node (no app
// bootstrap, no BrowserWindow) via `node --test`. main.js only wires this
// up to IPC.

const path = require('path');
const fs = require('fs');
const readline = require('readline');

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
 * Sums the four token usage categories Claude Code reports per assistant
 * message into a single "total" figure used throughout the UI.
 */
function sumUsage(usage) {
  const input = Number(usage.input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  const cacheCreation = Number(usage.cache_creation_input_tokens) || 0;
  const cacheRead = Number(usage.cache_read_input_tokens) || 0;
  return {
    input,
    output,
    cacheCreation,
    cacheRead,
    total: input + output + cacheCreation + cacheRead,
  };
}

function emptyTotals() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
}

/**
 * Parses one NDJSON line into a usage delta, or null if the line has no
 * usable usage/timestamp/session data (malformed JSON, non-assistant event,
 * etc). Pure function - no I/O - so it's the easiest unit to test directly.
 */
function parseLine(rawLine, fallbackSessionId) {
  const line = rawLine.trim();
  if (!line) return null;

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  const sessionId = event.sessionId || fallbackSessionId;
  const usage = event.message && event.message.usage;

  let timestamp = null;
  if (event.timestamp) {
    const ts = Date.parse(event.timestamp);
    if (!Number.isNaN(ts)) timestamp = ts;
  }

  return {
    sessionId,
    cwd: event.cwd || null,
    timestamp,
    usage: usage ? sumUsage(usage) : null,
  };
}

/**
 * Streams a single .jsonl file line by line (NDJSON), accumulating token
 * usage into the sessions map. Malformed lines are skipped silently since
 * Claude Code session files can contain partial/truncated trailing lines.
 */
async function processJsonlFile(filePath, projectSlug, sessionsMap) {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  // Fallback sessionId derived from the file name (session-uuid.jsonl) in
  // case a line is missing the sessionId field.
  const fallbackSessionId = path.basename(filePath, '.jsonl');

  for await (const rawLine of rl) {
    const parsed = parseLine(rawLine, fallbackSessionId);
    if (!parsed) continue;

    let session = sessionsMap.get(parsed.sessionId);
    if (!session) {
      session = {
        sessionId: parsed.sessionId,
        cwd: null,
        projectSlug,
        lastActivity: null,
        input: 0,
        output: 0,
        cacheCreation: 0,
        cacheRead: 0,
        total: 0,
      };
      sessionsMap.set(parsed.sessionId, session);
    }

    if (parsed.cwd && !session.cwd) {
      session.cwd = parsed.cwd;
    }

    if (parsed.timestamp !== null && (session.lastActivity === null || parsed.timestamp > session.lastActivity)) {
      session.lastActivity = parsed.timestamp;
    }

    if (parsed.usage) {
      session.input += parsed.usage.input;
      session.output += parsed.usage.output;
      session.cacheCreation += parsed.usage.cacheCreation;
      session.cacheRead += parsed.usage.cacheRead;
      session.total += parsed.usage.total;
    }
  }
}

/**
 * Turns the internal sessions map into the sorted, UI-ready session list
 * plus grand totals. Pure/sync - split out so it's testable without any
 * filesystem access.
 */
function finalizeSessions(sessionsMap) {
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

  return { sessions, totals };
}

/**
 * Scans `projectsDir` (defaults to `~/.claude/projects`) for all session
 * JSONL files and aggregates token usage per session.
 */
async function scanSessions(projectsDir) {
  const sessionsMap = new Map();

  let projectDirs = [];
  try {
    projectDirs = await fs.promises.readdir(projectsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { sessions: [], totals: emptyTotals(), scannedAt: Date.now() };
    }
    throw err;
  }

  for (const dirEntry of projectDirs) {
    if (!dirEntry.isDirectory()) continue;
    const projectSlug = dirEntry.name;
    const projectDirPath = path.join(projectsDir, projectSlug);
    const jsonlFiles = await findJsonlFiles(projectDirPath);

    for (const filePath of jsonlFiles) {
      try {
        await processJsonlFile(filePath, projectSlug, sessionsMap);
      } catch (err) {
        // Don't let one corrupt file abort the whole scan.
        console.error(`[claude-token-monitor] failed to read ${filePath}:`, err.message);
      }
    }
  }

  const { sessions, totals } = finalizeSessions(sessionsMap);
  return { sessions, totals, scannedAt: Date.now() };
}

module.exports = {
  scanSessions,
  findJsonlFiles,
  projectNameFromSlug,
  projectNameFromCwd,
  sumUsage,
  parseLine,
  finalizeSessions,
  emptyTotals,
};
