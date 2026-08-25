'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  formatNumber,
  shortId,
  escapeHtml,
  computeTotals,
  aggregateByProject,
  filterByPeriod,
  textFilterSessions,
  sortSessions,
  percentage,
} = require('../renderer/logic');

function makeSession(overrides) {
  return {
    sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    cwd: '/Users/x/Desktop/demo',
    projectName: 'demo',
    lastActivity: Date.now(),
    input: 0,
    output: 0,
    cacheCreation: 0,
    cacheRead: 0,
    total: 0,
    ...overrides,
  };
}

// ---------- formatNumber ----------

test('formatNumber formats thousands/millions/billions with K/M/B suffixes', () => {
  assert.equal(formatNumber(999), '999');
  assert.equal(formatNumber(1500), '1.5K');
  assert.equal(formatNumber(1_234_567), '1.23M');
  assert.equal(formatNumber(2_000_000_000), '2B');
});

test('formatNumber returns a placeholder for null/NaN', () => {
  assert.equal(formatNumber(null), '-');
  assert.equal(formatNumber(NaN), '-');
});

// ---------- shortId / escapeHtml ----------

test('shortId truncates a uuid to its first 8 chars', () => {
  assert.equal(shortId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), 'aaaaaaaa');
  assert.equal(shortId(null), '-');
});

test('escapeHtml neutralizes every HTML-significant character', () => {
  assert.equal(escapeHtml(`<script>alert('x')</script>`), '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

// ---------- computeTotals ----------

test('computeTotals sums every category across sessions', () => {
  const sessions = [
    makeSession({ input: 10, output: 1, cacheCreation: 2, cacheRead: 3, total: 16 }),
    makeSession({ input: 5, output: 0, cacheCreation: 0, cacheRead: 0, total: 5 }),
  ];
  assert.deepEqual(computeTotals(sessions), { input: 15, output: 1, cacheCreation: 2, cacheRead: 3, total: 21 });
});

test('computeTotals on an empty list returns all zeros, not NaN/undefined', () => {
  assert.deepEqual(computeTotals([]), { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 });
});

// ---------- aggregateByProject ----------

test('aggregateByProject sums multiple sessions of the same project into one entry', () => {
  const sessions = [
    makeSession({ sessionId: 's1', cwd: '/x/proj-a', projectName: 'proj-a', total: 100 }),
    makeSession({ sessionId: 's2', cwd: '/x/proj-a', projectName: 'proj-a', total: 50 }),
    makeSession({ sessionId: 's3', cwd: '/x/proj-b', projectName: 'proj-b', total: 10 }),
  ];

  const projects = aggregateByProject(sessions);

  assert.equal(projects.length, 2, 'proj-a sessions must collapse into a single entry');
  const projA = projects.find((p) => p.projectName === 'proj-a');
  assert.equal(projA.sessionCount, 2);
  assert.equal(projA.total, 150);
  assert.equal(projects[0].projectName, 'proj-a', 'must be sorted by total desc');
});

test('aggregateByProject falls back to projectName as the grouping key when cwd is missing', () => {
  const sessions = [
    makeSession({ sessionId: 's1', cwd: null, projectName: 'orphan', total: 10 }),
    makeSession({ sessionId: 's2', cwd: null, projectName: 'orphan', total: 20 }),
  ];
  const projects = aggregateByProject(sessions);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].total, 30);
});

// ---------- filterByPeriod ----------

test('filterByPeriod "all" returns every session untouched', () => {
  const sessions = [makeSession({ lastActivity: 1 })];
  assert.equal(filterByPeriod(sessions, 'all', Date.now()), sessions);
});

test('filterByPeriod "24h" excludes sessions older than 24h', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z');
  const sessions = [
    makeSession({ sessionId: 'recent', lastActivity: now - 60 * 60 * 1000 }), // 1h ago
    makeSession({ sessionId: 'old', lastActivity: now - 48 * 60 * 60 * 1000 }), // 48h ago
  ];
  const result = filterByPeriod(sessions, '24h', now);
  assert.equal(result.length, 1);
  assert.equal(result[0].sessionId, 'recent');
});

test('filterByPeriod "today" uses the calendar day, not a rolling 24h window', () => {
  // Built with the local Date constructor (not a UTC ISO string) so this
  // test is timezone-independent - filterByPeriod itself uses local midnight
  // via `setHours(0,0,0,0)`, so the fixture must match that same frame.
  const now = new Date(2026, 0, 10, 1, 0, 0).getTime(); // 01:00 local, Jan 10th
  const sessions = [
    makeSession({ sessionId: 'earlier-today', lastActivity: new Date(2026, 0, 10, 0, 30, 0).getTime() }),
    makeSession({ sessionId: 'yesterday', lastActivity: new Date(2026, 0, 9, 23, 0, 0).getTime() }),
  ];
  const result = filterByPeriod(sessions, 'today', now);
  assert.equal(result.length, 1);
  assert.equal(result[0].sessionId, 'earlier-today');
});

test('filterByPeriod excludes sessions with no lastActivity at all', () => {
  const sessions = [makeSession({ lastActivity: null })];
  assert.equal(filterByPeriod(sessions, '7d', Date.now()).length, 0);
});

// ---------- textFilterSessions ----------

test('textFilterSessions matches project name, session id or cwd, case-insensitively', () => {
  const sessions = [
    makeSession({ sessionId: 's1', projectName: 'LojaVirtual', cwd: '/x/loja' }),
    makeSession({ sessionId: 's2', projectName: 'Helpdesk', cwd: '/x/help' }),
  ];
  assert.equal(textFilterSessions(sessions, 'loja').length, 1);
  assert.equal(textFilterSessions(sessions, 'HELPDESK').length, 1);
  assert.equal(textFilterSessions(sessions, '').length, 2);
});

// ---------- sortSessions ----------

test('sortSessions sorts numerically desc/asc', () => {
  const sessions = [makeSession({ sessionId: 'a', total: 5 }), makeSession({ sessionId: 'b', total: 50 })];
  assert.equal(sortSessions(sessions, 'total', 'desc')[0].sessionId, 'b');
  assert.equal(sortSessions(sessions, 'total', 'asc')[0].sessionId, 'a');
});

test('sortSessions sorts strings case-insensitively', () => {
  const sessions = [makeSession({ sessionId: 'a', projectName: 'zebra' }), makeSession({ sessionId: 'b', projectName: 'Apple' })];
  assert.equal(sortSessions(sessions, 'projectName', 'asc')[0].projectName, 'Apple');
});

test('sortSessions does not mutate the input array', () => {
  const sessions = [makeSession({ sessionId: 'a', total: 1 }), makeSession({ sessionId: 'b', total: 2 })];
  const original = [...sessions];
  sortSessions(sessions, 'total', 'desc');
  assert.deepEqual(sessions, original);
});

// ---------- percentage ----------

test('percentage computes a one-decimal share, and returns "0" for a zero total', () => {
  assert.equal(percentage(25, 100), '25.0');
  assert.equal(percentage(5, 0), '0');
});
