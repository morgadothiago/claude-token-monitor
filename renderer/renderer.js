'use strict';

/* global Chart */

const TOP_N_PROJECTS = 8;

const PIE_COLORS = [
  '#7c9cff', '#4fd1c5', '#f6ad55', '#b794f4',
  '#f56565', '#68d391', '#fbd38d', '#90cdf4',
];
const OTHER_COLOR = '#4a5160';

const CATEGORY_COLORS = {
  input: '#7c9cff',
  output: '#4fd1c5',
  cacheCreation: '#f6ad55',
  cacheRead: '#b794f4',
};

const CATEGORY_LABELS = {
  input: 'Input',
  output: 'Output',
  cacheCreation: 'Cache creation',
  cacheRead: 'Cache read',
};

let state = {
  sessions: [],
  sortKey: 'total',
  sortDir: 'desc',
  filterText: '',
  period: 'all',
};

const PERIOD_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

// Sessions whose last activity falls inside the currently selected period.
// This is what "current projects" means in the UI: filtering by this scopes
// every card, chart and table row to only the work happening in that window.
function getVisibleSessions() {
  const { period, sessions } = state;
  if (period === 'all') return sessions;

  const now = Date.now();

  if (period === 'today') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const cutoff = startOfToday.getTime();
    return sessions.filter((s) => s.lastActivity && s.lastActivity >= cutoff);
  }

  const windowMs = PERIOD_MS[period];
  if (!windowMs) return sessions;
  const cutoff = now - windowMs;
  return sessions.filter((s) => s.lastActivity && s.lastActivity >= cutoff);
}

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

let sessionsChart = null;
let categoriesChart = null;

// ---------- Formatting helpers ----------

function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return trimZero(n / 1_000_000_000) + 'B';
  if (abs >= 1_000_000) return trimZero(n / 1_000_000) + 'M';
  if (abs >= 1_000) return trimZero(n / 1_000) + 'K';
  return String(n);
}

function trimZero(n) {
  return n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
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

// ---------- Data loading ----------

async function loadData() {
  setLoading(true);
  try {
    const result = await window.tokenMonitorAPI.scanSessions();
    state.sessions = result.sessions;
    renderAll(result.scannedAt);
  } catch (err) {
    console.error('Failed to scan sessions:', err);
    alert('Falha ao ler as sessões do Claude Code: ' + err.message);
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  document.getElementById('loading-overlay').classList.toggle('is-active', isLoading);
  document.getElementById('refresh-btn').classList.toggle('is-loading', isLoading);
}

// ---------- Rendering ----------

function renderAll(scannedAt) {
  renderScannedAt(scannedAt);
  renderSummaryCards();
  renderSessionsChart();
  renderCategoriesChart();
  renderTable();
}

function renderScannedAt(scannedAt) {
  const el = document.getElementById('scanned-at');
  el.textContent = scannedAt ? `Última leitura: ${formatDate(scannedAt)}` : '';
}

function renderSummaryCards() {
  const sessions = getVisibleSessions();
  const totals = computeTotals(sessions);
  document.getElementById('summary-total').textContent = formatNumber(totals.total);
  document.getElementById('summary-sessions').textContent = String(sessions.length);
  const uniqueProjects = new Set(sessions.map((s) => s.projectName || s.cwd || 'desconhecido'));
  document.getElementById('summary-projects').textContent = String(uniqueProjects.size);
  document.getElementById('summary-cache-read').textContent = formatNumber(totals.cacheRead);
}

// Groups sessions by project (cwd wins as the dedup key when present, since
// two different paths can share a folder basename) so every current project
// always shows up as its own slice/row instead of fragmenting into one
// sliver per session or getting buried inside "Outras".
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

function renderSessionsChart() {
  const canvas = document.getElementById('chart-sessions');
  const legendEl = document.getElementById('legend-sessions');
  const projects = aggregateByProject(getVisibleSessions());

  if (!projects.length) {
    destroyChart('sessions');
    legendEl.innerHTML = '';
    return;
  }

  const top = projects.slice(0, TOP_N_PROJECTS);
  const rest = projects.slice(TOP_N_PROJECTS);
  const otherTotal = rest.reduce((sum, p) => sum + p.total, 0);

  const labels = top.map((p) => p.projectName);
  const values = top.map((p) => p.total);
  const colors = top.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]);

  if (otherTotal > 0) {
    labels.push(`Outros (${rest.length} projetos)`);
    values.push(otherTotal);
    colors.push(OTHER_COLOR);
  }

  sessionsChart = upsertPieChart(canvas, sessionsChart, labels, values, colors);

  const legendItems = top.map((p, i) => ({
    color: colors[i],
    main: p.projectName,
    sub: `${p.sessionCount} sessão${p.sessionCount === 1 ? '' : 'ões'} · ${formatNumber(p.total)} tokens`,
  }));
  if (otherTotal > 0) {
    legendItems.push({
      color: OTHER_COLOR,
      main: `Outros (${rest.length} projetos)`,
      sub: `${formatNumber(otherTotal)} tokens`,
    });
  }
  renderLegend(legendEl, legendItems);
}

function renderCategoriesChart() {
  const canvas = document.getElementById('chart-categories');
  const legendEl = document.getElementById('legend-categories');
  const totals = computeTotals(getVisibleSessions());

  if (totals.total === 0) {
    destroyChart('categories');
    legendEl.innerHTML = '';
    return;
  }

  const keys = ['input', 'output', 'cacheCreation', 'cacheRead'];
  const labels = keys.map((k) => CATEGORY_LABELS[k]);
  const values = keys.map((k) => totals[k]);
  const colors = keys.map((k) => CATEGORY_COLORS[k]);

  categoriesChart = upsertPieChart(canvas, categoriesChart, labels, values, colors);

  const legendItems = keys.map((k) => ({
    color: CATEGORY_COLORS[k],
    main: CATEGORY_LABELS[k],
    sub: `${formatNumber(totals[k])} tokens (${percentage(totals[k], totals.total)}%)`,
  }));
  renderLegend(legendEl, legendItems);
}

function percentage(part, total) {
  if (!total) return '0';
  return ((part / total) * 100).toFixed(1);
}

function upsertPieChart(canvas, existingChart, labels, values, colors) {
  if (existingChart) {
    existingChart.data.labels = labels;
    existingChart.data.datasets[0].data = values;
    existingChart.data.datasets[0].backgroundColor = colors;
    existingChart.update();
    return existingChart;
  }

  return new Chart(canvas, {
    type: 'pie',
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderColor: '#171a21',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const value = ctx.raw;
              return `${ctx.label}: ${formatNumber(value)} tokens`;
            },
          },
        },
      },
    },
  });
}

function destroyChart(which) {
  if (which === 'sessions' && sessionsChart) {
    sessionsChart.destroy();
    sessionsChart = null;
  }
  if (which === 'categories' && categoriesChart) {
    categoriesChart.destroy();
    categoriesChart = null;
  }
}

function renderLegend(container, items) {
  container.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = item.color;

    const textWrap = document.createElement('div');
    textWrap.className = 'legend-text';

    const main = document.createElement('span');
    main.className = 'legend-text__main';
    main.textContent = item.main;

    const sub = document.createElement('span');
    sub.className = 'legend-text__sub';
    sub.textContent = item.sub;

    textWrap.appendChild(main);
    textWrap.appendChild(sub);
    li.appendChild(swatch);
    li.appendChild(textWrap);
    container.appendChild(li);
  }
}

// ---------- Table ----------

function getFilteredSortedSessions() {
  const filter = state.filterText.trim().toLowerCase();
  let list = getVisibleSessions();

  if (filter) {
    list = list.filter((s) => {
      const haystack = `${s.projectName} ${s.sessionId} ${s.cwd || ''}`.toLowerCase();
      return haystack.includes(filter);
    });
  }

  const { sortKey, sortDir } = state;
  const dirMultiplier = sortDir === 'asc' ? 1 : -1;

  list = [...list].sort((a, b) => {
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

  return list;
}

function renderTable() {
  const tbody = document.getElementById('sessions-tbody');
  const emptyState = document.getElementById('empty-state');
  const list = getFilteredSortedSessions();

  tbody.innerHTML = '';

  if (!list.length) {
    emptyState.textContent = state.sessions.length
      ? 'Nenhuma sessão no período/filtro selecionado.'
      : 'Nenhuma sessão encontrada em ~/.claude/projects.';
    emptyState.hidden = false;
    updateSortHeaders();
    return;
  }
  emptyState.hidden = true;

  const fragment = document.createDocumentFragment();
  for (const s of list) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="project-cell">
          <span class="project-cell__name">${escapeHtml(s.projectName)}</span>
          <span class="project-cell__path">${escapeHtml(s.cwd || '')}</span>
        </div>
      </td>
      <td class="mono">${escapeHtml(shortId(s.sessionId))}</td>
      <td>${formatDate(s.lastActivity)}</td>
      <td>${formatNumber(s.input)}</td>
      <td>${formatNumber(s.output)}</td>
      <td>${formatNumber(s.cacheCreation)}</td>
      <td>${formatNumber(s.cacheRead)}</td>
      <td><strong>${formatNumber(s.total)}</strong></td>
    `;
    fragment.appendChild(tr);
  }
  tbody.appendChild(fragment);

  updateSortHeaders();
}

function updateSortHeaders() {
  const headers = document.querySelectorAll('#sessions-table thead th[data-sort]');
  headers.forEach((th) => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.sort === state.sortKey) {
      th.classList.add(state.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Event wiring ----------

function wireEvents() {
  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadData();
  });

  document.getElementById('table-filter').addEventListener('input', (e) => {
    state.filterText = e.target.value;
    renderTable();
  });

  document.querySelectorAll('#sessions-table thead th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = 'desc';
      }
      renderTable();
    });
  });

  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.period = btn.dataset.period;
      document.querySelectorAll('.period-btn').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
      });
      renderSummaryCards();
      renderSessionsChart();
      renderCategoriesChart();
      renderTable();
    });
  });
}

wireEvents();
loadData();
