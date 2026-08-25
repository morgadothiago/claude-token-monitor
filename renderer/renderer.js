'use strict';

/* global Chart, CTMLogic */

// Wrapped in an IIFE so every top-level `const`/`function` here lives in its
// own scope instead of the page's shared global scope - classic <script>
// tags (no bundler/modules) all share one global lexical environment, so
// without this a name here could collide with one declared in logic.js
// (which does need to expose its globals, via window.CTMLogic).
(function () {

const {
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
} = CTMLogic;

const TOP_N_PROJECTS = 8;
const TABLE_PAGE_SIZE = 50;

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
  tableVisibleCount: TABLE_PAGE_SIZE,
};

let sessionsChart = null;
let categoriesChart = null;

// Sessions matching the currently selected period. This is what "current
// projects" means in the UI: filtering by this scopes every card, chart and
// table row to only the work happening in that window.
function getVisibleSessions() {
  return filterByPeriod(state.sessions, state.period, Date.now());
}

// ---------- Data loading ----------

async function loadData() {
  setLoading(true);
  try {
    const result = await window.tokenMonitorAPI.scanSessions();
    state.sessions = result.sessions;
    state.tableVisibleCount = TABLE_PAGE_SIZE;
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
//
// Rendered incrementally (page size TABLE_PAGE_SIZE) instead of all at once.
// With a couple dozen sessions this would never matter, but someone who
// runs Claude Code daily for a couple of years can accumulate thousands of
// session files - creating one <tr> per row up front would start to make
// sorting/filtering visibly janky well before that.

function getFilteredSortedSessions() {
  const withPeriod = getVisibleSessions();
  const withText = textFilterSessions(withPeriod, state.filterText);
  return sortSessions(withText, state.sortKey, state.sortDir);
}

function renderTable() {
  const tbody = document.getElementById('sessions-tbody');
  const emptyState = document.getElementById('empty-state');
  const loadMoreWrap = document.getElementById('table-load-more-wrap');
  const list = getFilteredSortedSessions();

  tbody.innerHTML = '';

  if (!list.length) {
    emptyState.textContent = state.sessions.length
      ? 'Nenhuma sessão no período/filtro selecionado.'
      : 'Nenhuma sessão encontrada em ~/.claude/projects.';
    emptyState.hidden = false;
    loadMoreWrap.hidden = true;
    updateSortHeaders();
    return;
  }
  emptyState.hidden = true;

  const visible = list.slice(0, state.tableVisibleCount);

  const fragment = document.createDocumentFragment();
  for (const s of visible) {
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

  const remaining = list.length - visible.length;
  const loadMoreBtn = document.getElementById('table-load-more');
  if (remaining > 0) {
    loadMoreWrap.hidden = false;
    loadMoreBtn.textContent = `Carregar mais (${formatNumber(remaining)} restantes)`;
  } else {
    loadMoreWrap.hidden = true;
  }

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

// ---------- Event wiring ----------

function wireEvents() {
  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadData();
  });

  document.getElementById('table-filter').addEventListener('input', (e) => {
    state.filterText = e.target.value;
    state.tableVisibleCount = TABLE_PAGE_SIZE;
    renderTable();
  });

  document.getElementById('table-load-more').addEventListener('click', () => {
    state.tableVisibleCount += TABLE_PAGE_SIZE;
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
      state.tableVisibleCount = TABLE_PAGE_SIZE;
      renderTable();
    });
  });

  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.period = btn.dataset.period;
      state.tableVisibleCount = TABLE_PAGE_SIZE;
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

})();
