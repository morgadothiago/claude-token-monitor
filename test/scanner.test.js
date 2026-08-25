'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  sumUsage,
  parseLine,
  projectNameFromCwd,
  projectNameFromSlug,
  finalizeSessions,
  scanSessions,
} = require('../lib/scanner');

test('sumUsage adds the four token categories and treats missing fields as 0', () => {
  const result = sumUsage({
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_input_tokens: 100,
    // cache_read_input_tokens intentionally omitted
  });
  assert.deepEqual(result, { input: 10, output: 5, cacheCreation: 100, cacheRead: 0, total: 115 });
});

test('sumUsage never invents tokens for garbage input', () => {
  const result = sumUsage({ input_tokens: 'not-a-number', output_tokens: null });
  assert.equal(result.total, 0);
});

test('parseLine returns null for malformed JSON instead of throwing', () => {
  assert.equal(parseLine('{not valid json', 'fallback-id'), null);
});

test('parseLine returns null for a blank line', () => {
  assert.equal(parseLine('   ', 'fallback-id'), null);
});

test('parseLine falls back to the filename-derived sessionId when missing', () => {
  const line = JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z' });
  const parsed = parseLine(line, 'fallback-id');
  assert.equal(parsed.sessionId, 'fallback-id');
});

test('parseLine extracts usage only from assistant messages that carry it', () => {
  const withUsage = JSON.stringify({
    sessionId: 'abc',
    message: { usage: { input_tokens: 1, output_tokens: 2 } },
  });
  const withoutUsage = JSON.stringify({ sessionId: 'abc', type: 'user' });

  assert.equal(parseLine(withUsage, 'fallback').usage.total, 3);
  assert.equal(parseLine(withoutUsage, 'fallback').usage, null);
});

test('projectNameFromCwd takes the last path segment', () => {
  assert.equal(projectNameFromCwd('/Users/thiago/Desktop/my-app'), 'my-app');
  assert.equal(projectNameFromCwd('/Users/thiago/Desktop/my-app/'), 'my-app');
  assert.equal(projectNameFromCwd(null), null);
});

test('projectNameFromSlug falls back to the last dash-separated segment', () => {
  assert.equal(projectNameFromSlug('-Users-thiago-Desktop-my-app'), 'app');
  assert.equal(projectNameFromSlug(''), '');
});

test('finalizeSessions drops sessions with zero tokens and sorts by total desc', () => {
  const map = new Map([
    ['a', { sessionId: 'a', cwd: '/x/proj-a', projectSlug: 'proj-a', lastActivity: 1, input: 10, output: 0, cacheCreation: 0, cacheRead: 0, total: 10 }],
    ['b', { sessionId: 'b', cwd: '/x/proj-b', projectSlug: 'proj-b', lastActivity: 2, input: 100, output: 0, cacheCreation: 0, cacheRead: 0, total: 100 }],
    ['c', { sessionId: 'c', cwd: null, projectSlug: 'proj-c', lastActivity: null, input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }],
  ]);

  const { sessions, totals } = finalizeSessions(map);

  assert.equal(sessions.length, 2, 'the zero-token session must be dropped');
  assert.equal(sessions[0].sessionId, 'b', 'highest total must come first');
  assert.equal(totals.total, 110);
});

// ---------- Integration: real filesystem, real NDJSON files ----------

test('scanSessions reads real .jsonl fixtures end to end', async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ctm-test-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));

  const projectDir = path.join(tmpRoot, '-Users-someone-Desktop-demo-app');
  await fs.mkdir(projectDir, { recursive: true });

  const lines = [
    JSON.stringify({
      sessionId: 'session-1',
      cwd: '/Users/someone/Desktop/demo-app',
      timestamp: '2026-01-01T10:00:00.000Z',
      message: { usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    }),
    'this line is not json and must be skipped without crashing the scan',
    JSON.stringify({
      sessionId: 'session-1',
      cwd: '/Users/someone/Desktop/demo-app',
      timestamp: '2026-01-01T10:05:00.000Z',
      message: { usage: { input_tokens: 20, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1000 } },
    }),
  ];
  await fs.writeFile(path.join(projectDir, 'session-1.jsonl'), lines.join('\n') + '\n');

  const result = await scanSessions(tmpRoot);

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].projectName, 'demo-app');
  assert.equal(result.sessions[0].total, 100 + 50 + 20 + 10 + 5 + 1000);
  assert.equal(result.totals.total, result.sessions[0].total);
  assert.ok(typeof result.scannedAt === 'number');
});

test('scanSessions returns an empty result instead of throwing when the projects dir does not exist', async () => {
  const result = await scanSessions('/tmp/this-path-should-never-exist-ctm-test');
  assert.deepEqual(result.sessions, []);
  assert.equal(result.totals.total, 0);
});
