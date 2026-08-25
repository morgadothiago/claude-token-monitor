'use strict';

// Pure, DOM-free UI logic (formatting, filtering, sorting, aggregation).
// Loaded as a plain <script> in the renderer (no bundler, per this
// project's "vanilla JS" choice) *and* required directly from
// test/logic.test.js via Node's CommonJS - hence the dual export at the
// bottom instead of `export`/`import`. Keeping this DOM-free is what makes
// it testable with plain `node --test`, no jsdom needed.

const PERIOD_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

// ---------- Formatting ----------

function trimZero(n) {
  return n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return trimZero(n / 1_000_000_000) + 'B';
  if (abs >= 1_000_000) return trimZero(n / 1_000_000) + 'M';
  if (abs >= 1_000) return trimZero(n / 1_000) + 'K';
  return String(n);
}

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortId(uuid) {
  if (!uuid) return '-';
  return uuid.slice(0, 8);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

// ---------- Aggregation ----------

function computeTotals(sessions) {
  return sessions.reduce(
    (acc, s) => {
      acc.input += s.input;
      acc.output += s.output;
      acc.cacheCreation += s.cacheCreation;
      acc.cacheRead += s.cacheRead;
      acc.total += s.total;
      return acc;
    },
    { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }
  );
}

// Groups sessions by project (cwd wins as the dedup key when present, since
// two different paths can share a folder basename) so every current project
// always shows up as its own slice/row instead of fragmenting into one
// sliver per session or getting buried inside "Outros".
function aggregateByProject(sessions) {
  const map = new Map();

  for (const s of sessions) {
    const key = s.cwd || `name:${s.projectName}`;
    let proj = map.get(key);
    if (!proj) {
      proj = {
        projectName: s.projectName,
        cwd: s.cwd,
        sessionCount: 0,
        lastActivity: null,
        input: 0,
        output: 0,
        cacheCreation: 0,
        cacheRead: 0,
        total: 0,
      };
      map.set(key, proj);
    }
    proj.sessionCount += 1;
    proj.input += s.input;
    proj.output += s.output;
    proj.cacheCreation += s.cacheCreation;
    proj.cacheRead += s.cacheRead;
    proj.total += s.total;
    if (s.lastActivity && (proj.lastActivity === null || s.lastActivity > proj.lastActivity)) {
      proj.lastActivity = s.lastActivity;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

// ---------- Filtering / sorting ----------

// Sessions whose last activity falls inside `period`, relative to `now`
// (injected instead of read internally via Date.now(), so this is
// deterministic and testable).
function filterByPeriod(sessions, period, now) {
  if (period === 'all') return sessions;

  if (period === 'today') {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const cutoff = startOfToday.getTime();
    return sessions.filter((s) => s.lastActivity && s.lastActivity >= cutoff);
  }

  const windowMs = PERIOD_MS[period];
  if (!windowMs) return sessions;
  const cutoff = now - windowMs;
  return sessions.filter((s) => s.lastActivity && s.lastActivity >= cutoff);
}

function textFilterSessions(sessions, filterText) {
  const filter = (filterText || '').trim().toLowerCase();
  if (!filter) return sessions;
  return sessions.filter((s) => {
    const haystack = `${s.projectName} ${s.sessionId} ${s.cwd || ''}`.toLowerCase();
    return haystack.includes(filter);
  });
}

function sortSessions(sessions, sortKey, sortDir) {
  const dirMultiplier = sortDir === 'asc' ? 1 : -1;

  return [...sessions].sort((a, b) => {
    let va = a[sortKey];
    let vb = b[sortKey];
    if (typeof va === 'string' || typeof vb === 'string') {
      va = (va || '').toString().toLowerCase();
      vb = (vb || '').toString().toLowerCase();
      if (va < vb) return -1 * dirMultiplier;
      if (va > vb) return 1 * dirMultiplier;
      return 0;
    }
    va = va || 0;
    vb = vb || 0;
    return (va - vb) * dirMultiplier;
  });
}

function percentage(part, total) {
  if (!total) return '0';
  return ((part / total) * 100).toFixed(1);
}

const CTMLogic = {
  formatNumber,
  formatDate,
  shortId,
  escapeHtml,
  computeTotals,
  aggregateByProject,
  filterByPeriod,
  textFilterSessions,
  sortSessions,
  percentage,
};

// Browser: plain <script> tag, no module system - expose as a global.
// Node (tests): CommonJS require().
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CTMLogic;
}
if (typeof window !== 'undefined') {
  window.CTMLogic = CTMLogic;
}
