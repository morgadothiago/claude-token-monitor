'use strict';

/* global Chart */

const TOP_N_SESSIONS = 8;

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
  totals: null,
  sortKey: 'total',
  sortDir: 'desc',
  filterText: '',
};

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
    state.totals = result.totals;
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
  const { sessions, totals } = state;
  document.getElementById('summary-total').textContent = totals ? formatNumber(totals.total) : '-';
  document.getElementById('summary-sessions').textContent = String(sessions.length);
  const uniqueProjects = new Set(sessions.map((s) => s.projectName || s.cwd || 'desconhecido'));
  document.getElementById('summary-projects').textContent = String(uniqueProjects.size);
  document.getElementById('summary-cache-read').textContent = totals ? formatNumber(totals.cacheRead) : '-';
}

function renderSessionsChart() {
  const canvas = document.getElementById('chart-sessions');
  const legendEl = document.getElementById('legend-sessions');
  const sessions = state.sessions;

  if (!sessions.length) {
    destroyChart('sessions');
    legendEl.innerHTML = '';
    return;
  }

  const top = sessions.slice(0, TOP_N_SESSIONS);
  const rest = sessions.slice(TOP_N_SESSIONS);
  const otherTotal = rest.reduce((sum, s) => sum + s.total, 0);

  const labels = top.map((s) => `${s.projectName} (${shortId(s.sessionId)})`);
  const values = top.map((s) => s.total);
  const colors = top.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]);

  if (otherTotal > 0) {
    labels.push(`Outras (${rest.length} sessões)`);
    values.push(otherTotal);
    colors.push(OTHER_COLOR);
  }

  sessionsChart = upsertPieChart(canvas, sessionsChart, labels, values, colors);

  const legendItems = top.map((s, i) => ({
    color: colors[i],
    main: `${s.projectName}`,
    sub: `${shortId(s.sessionId)} · ${formatNumber(s.total)} tokens`,
  }));
  if (otherTotal > 0) {
    legendItems.push({
      color: OTHER_COLOR,
      main: `Outras (${rest.length} sessões)`,
      sub: `${formatNumber(otherTotal)} tokens`,
    });
  }
  renderLegend(legendEl, legendItems);
}

function renderCategoriesChart() {
  const canvas = document.getElementById('chart-categories');
  const legendEl = document.getElementById('legend-categories');
  const totals = state.totals;

  if (!totals || totals.total === 0) {
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
  let list = state.sessions;

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
}

wireEvents();
loadData();
