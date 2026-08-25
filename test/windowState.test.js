'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { loadWindowBounds, saveWindowBounds, DEFAULT_BOUNDS } = require('../lib/windowState');

test('loadWindowBounds returns defaults when no state file exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctm-winstate-'));
  const bounds = loadWindowBounds(dir);
  assert.equal(bounds.width, DEFAULT_BOUNDS.width);
  assert.equal(bounds.height, DEFAULT_BOUNDS.height);
});

test('saveWindowBounds then loadWindowBounds round-trips', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctm-winstate-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  saveWindowBounds(dir, { width: 1400, height: 900, x: 50, y: 60 });
  const bounds = loadWindowBounds(dir);

  assert.equal(bounds.width, 1400);
  assert.equal(bounds.height, 900);
  assert.equal(bounds.x, 50);
  assert.equal(bounds.y, 60);
});

test('loadWindowBounds ignores a corrupt state file instead of throwing', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctm-winstate-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await fs.writeFile(path.join(dir, 'window-state.json'), '{ not valid json');

  assert.doesNotThrow(() => loadWindowBounds(dir));
  const bounds = loadWindowBounds(dir);
  assert.equal(bounds.width, DEFAULT_BOUNDS.width);
});

test('loadWindowBounds rejects absurdly small persisted sizes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctm-winstate-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  saveWindowBounds(dir, { width: 10, height: 10, x: 0, y: 0 });
  const bounds = loadWindowBounds(dir);

  assert.equal(bounds.width, DEFAULT_BOUNDS.width);
  assert.equal(bounds.height, DEFAULT_BOUNDS.height);
});
