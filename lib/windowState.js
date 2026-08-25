'use strict';

// Tiny, dependency-free window bounds persistence (position + size only -
// no need to pull in electron-store for one JSON file). Kept free of any
// `electron` import so the read/merge logic is unit-testable like the rest
// of lib/.

const fs = require('fs');
const path = require('path');

const DEFAULT_BOUNDS = { width: 1200, height: 820, x: undefined, y: undefined };

function stateFilePath(userDataDir) {
  return path.join(userDataDir, 'window-state.json');
}

/**
 * Reads previously saved bounds from disk. Returns DEFAULT_BOUNDS if the
 * file is missing, unreadable, or contains garbage - a corrupt state file
 * must never prevent the window from opening.
 */
function loadWindowBounds(userDataDir) {
  try {
    const raw = fs.readFileSync(stateFilePath(userDataDir), 'utf8');
    const parsed = JSON.parse(raw);
    const bounds = { ...DEFAULT_BOUNDS };
    for (const key of ['width', 'height', 'x', 'y']) {
      if (typeof parsed[key] === 'number' && Number.isFinite(parsed[key])) {
        bounds[key] = parsed[key];
      }
    }
    if (bounds.width < 400) bounds.width = DEFAULT_BOUNDS.width;
    if (bounds.height < 300) bounds.height = DEFAULT_BOUNDS.height;
    return bounds;
  } catch {
    return { ...DEFAULT_BOUNDS };
  }
}

/**
 * Persists the given bounds to disk. Best-effort - a failed write (e.g. a
 * read-only filesystem) must never crash the app on close.
 */
function saveWindowBounds(userDataDir, bounds) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(stateFilePath(userDataDir), JSON.stringify(bounds));
  } catch {
    // Non-fatal - the app just falls back to default bounds next launch.
  }
}

module.exports = { loadWindowBounds, saveWindowBounds, DEFAULT_BOUNDS };
