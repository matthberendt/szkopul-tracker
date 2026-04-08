const NAMES = [
  'Jan','Piotr','Paweł','Andrzej','Michał','Krzysztof',
  'Tomasz','Marcin','Mateusz','Łukasz','Kamil','Jakub',
  'Wilk','Lis','Niedźwiedź','Chrobry','Śmiały',
  'Stanisław','Wojciech','Zbigniew','Tadeusz','Kazimierz',
  'Władysław','Zygmunt','Henryk','Stefan','Bolesław',
  'Grzegorz','Rafał','Marek','Adam','Bartosz',
  'Orzeł','Żubr','Ryś','Bóbr','Sokół',
];

let lastCrashDate = new Date();
let isCrashed = false;
let crashCount = 0;
let uptimePercent = 0;
let lang = 'PL';

// --- DOM refs ---
const $status   = document.getElementById('status');
const $dot      = document.getElementById('status-dot');
const $days     = document.getElementById('days-since');
const $daysText = document.getElementById('days-since-text');
const $hours    = document.getElementById('hours');
const $minutes  = document.getElementById('minutes');
const $seconds  = document.getElementById('seconds');
const $counter  = document.getElementById('counter');
const $color    = document.getElementById('color');
const $lang     = document.getElementById('lang');
const $langLabel = document.getElementById('lang-label');
const $iconSun  = document.getElementById('icon-sun');
const $iconMoon = document.getElementById('icon-moon');
const $pct      = document.getElementById('uptime-pct');

// --- Fetch ---
async function fetchStatus() {
  try {
    const data = await (await fetch('/api/status')).json();
    isCrashed = !data.isUp;
    lastCrashDate = new Date(data.lastCrashTime);
    crashCount = data.downtimeCount;
    uptimePercent = data.uptimePercent;
    updateRing();
    updateCounter();
  } catch {
    $status.textContent = 'Lost connection! 📡';
  }
}

// --- Uptime ---
function updateRing() {
  const pct = Math.min(100, Math.max(0, uptimePercent));
  $pct.textContent = pct.toFixed(4) + '%';

  // Color based on nines: green >=99.99, yellow >=99.9, red <99.9
  if (pct >= 99.99) {
    $pct.className = 'uptime-green';
  } else if (pct >= 99.9) {
    $pct.className = 'uptime-yellow';
  } else {
    $pct.className = 'uptime-red';
  }
}

// --- Render ---
function updateCounter() {
  const diff = Math.abs(Date.now() - lastCrashDate);
  const d = Math.floor(diff / 864e5);
  const h = Math.floor(diff / 36e5) % 24;
  const m = Math.floor(diff / 6e4) % 60;
  const s = Math.floor(diff / 1e3) % 60;

  $days.textContent = d;

  const pad = n => String(n).padStart(2, '0');
  const labels = lang === 'PL'
      ? ['Godzin', 'Minut', 'Sekund']
      : ['Hours', 'Minutes', 'Seconds'];

  $hours.textContent   = `${pad(h)} ${labels[0]}`;
  $minutes.textContent = `${pad(m)} ${labels[1]}`;
  $seconds.textContent = `${pad(s)} ${labels[2]}`;

  const name = NAMES[crashCount % NAMES.length];

  if (isCrashed) {
    $dot.classList.add('down');
    $status.textContent = lang === 'PL'
        ? `Chomik nr.${crashCount}, pseudonim ${name}, umarł.`
        : `Hamster nr.${crashCount}, codename ${name}, has died.`;
    $counter.hidden = true;
  } else {
    $dot.classList.remove('down');
    $status.textContent = lang === 'PL'
        ? `Chomik nr.${crashCount}, pracuje ile może`
        : `Hamster nr.${crashCount}, is working hard`;
    $counter.hidden = false;
  }
}

// --- Controls ---
function toggleLang() {
  lang = lang === 'PL' ? 'EN' : 'PL';
  $langLabel.textContent = lang === 'PL' ? 'PL' : 'EN';
  $daysText.textContent = lang === 'PL'
      ? 'Dni od ostatniego incydentu'
      : 'Days since last incident';
  localStorage.setItem('lang', lang);
  updateCounter();
  updateChartTheme();
  updateRankingLang();
  fetchRankings();
}

function toggleMode() {
  const dark = document.body.classList.toggle('dark');
  $iconSun.classList.toggle('hidden', dark);
  $iconMoon.classList.toggle('hidden', !dark);
  localStorage.setItem('mode', dark ? 'dark' : 'light');
  updateChartTheme();
}

$color.onclick = toggleMode;
$lang.onclick  = toggleLang;

// --- Chart ---
const $chartTitle = document.getElementById('chart-title');
let uptimeChart = null;
const CHART_START = '2026-03-31';

// --- Ranking ---
const $rankingTitle = document.getElementById('ranking-title');
const $rankingBody = document.getElementById('ranking-body');
const $rankCol = document.getElementById('rank-col');
const $daysCol = document.getElementById('days-col');
const $periodCol = document.getElementById('period-col');
const $statusCol = document.getElementById('status-col');

async function fetchRankings() {
  try {
    const data = await (await fetch('/api/uptime-rankings')).json();
    renderRankings(data);
  } catch { /* ignore */ }
}

function renderRankings(data) {
  $rankingBody.innerHTML = '';
  const top = data.slice(0, 10);

  top.forEach((entry, i) => {
    const days = (entry.durationMs / 864e5).toFixed(1);
    const startDate = new Date(entry.start).toLocaleDateString(
      lang === 'PL' ? 'pl-PL' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }
    );
    const endDate = entry.ongoing
      ? (lang === 'PL' ? 'teraz' : 'now')
      : new Date(entry.end).toLocaleDateString(
          lang === 'PL' ? 'pl-PL' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }
        );

    const tr = document.createElement('tr');
    if (i === 0) tr.classList.add('rank-gold');
    else if (i === 1) tr.classList.add('rank-silver');
    else if (i === 2) tr.classList.add('rank-bronze');

    const statusText = entry.ongoing
      ? (lang === 'PL' ? 'Trwa' : 'Ongoing')
      : (lang === 'PL' ? 'Zakończony' : 'Ended');
    const statusClass = entry.ongoing ? 'status-ongoing' : 'status-ended';

    tr.innerHTML = `
      <td class="rank-num">${i + 1}</td>
      <td class="rank-days">${days}</td>
      <td class="rank-period">${startDate} — ${endDate}</td>
      <td><span class="rank-status ${statusClass}">${statusText}</span></td>
    `;
    $rankingBody.appendChild(tr);
  });
}

function updateRankingLang() {
  $rankingTitle.textContent = lang === 'PL'
    ? 'Najdłuższe okresy bez incydentu'
    : 'Longest periods without incident';
  $rankCol.textContent = '#';
  $daysCol.textContent = lang === 'PL' ? 'Dni' : 'Days';
  $periodCol.textContent = lang === 'PL' ? 'Okres' : 'Period';
  $statusCol.textContent = 'Status';
}

// --- Visitor counter ---
const $visitorCount = document.getElementById('visitor-count');

async function trackVisit() {
  try {
    const data = await (await fetch('/api/visit', { method: 'POST' })).json();
    $visitorCount.textContent = data.visitors.toLocaleString();
  } catch {
    try {
      const data = await (await fetch('/api/visitors')).json();
      $visitorCount.textContent = data.visitors.toLocaleString();
    } catch { /* ignore */ }
  }
}

// --- Cloudflare incidents ---
let cfIncidents = [];

async function fetchCfIncidents() {
  try {
    cfIncidents = await (await fetch('/api/cloudflare-incidents')).json();
  } catch { /* ignore */ }
}

// --- Init ---
if (localStorage.getItem('lang') === 'EN') toggleLang();
if (localStorage.getItem('mode') === 'dark') toggleMode();
trackVisit();

function getChartColors() {
  const dark = document.body.classList.contains('dark');
  return {
    line: dark ? '#22c55e' : '#16a34a',
    fill: dark ? 'rgba(34,197,94,0.12)' : 'rgba(22,163,74,0.10)',
    grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    text: dark ? '#a1a1aa' : '#71717a',
    tooltip: dark ? '#27272a' : '#ffffff',
    tooltipText: dark ? '#fafafa' : '#1a1a1a',
    point: dark ? '#4ade80' : '#16a34a',
    downLine: '#ef4444',
  };
}

async function fetchHistory() {
  try {
    await fetchCfIncidents();
    const data = await (await fetch('/api/history')).json();
    renderChart(data);
  } catch { /* ignore */ }
}

function renderChart(rawData) {
  const c = getChartColors();
  const ctx = document.getElementById('uptime-chart').getContext('2d');

  const data = rawData.filter(d => d.date >= CHART_START);
  const labels = data.map(d => d.date);
  const values = data.map(d => d.uptimePercent);

  // Color segments: green for 100%, red-ish for <100%
  const segmentColor = (ctx) => {
    const idx = ctx.p1DataIndex;
    return values[idx] < 100 ? c.downLine : c.line;
  };

  // Build Cloudflare incident annotations (use daily date strings to match x-axis)
  const cfAnnotations = {};
  const chartStartMs = new Date(CHART_START + 'T00:00:00Z').getTime();
  const chartEndMs = Date.now();
  let hasCfAnnotations = false;

  cfIncidents.forEach((inc, i) => {
    const incStart = new Date(inc.startedAt).getTime();
    const incEnd = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : chartEndMs;

    if (incEnd < chartStartMs || incStart > chartEndMs) return;

    // Convert to daily date strings matching the chart's x-axis labels
    const startDate = new Date(inc.startedAt).toISOString().slice(0, 10);
    const endDate = inc.resolvedAt
      ? new Date(inc.resolvedAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    hasCfAnnotations = true;

    const impactColors = {
      critical: 'rgba(239, 68, 68, 0.20)',
      major: 'rgba(249, 115, 22, 0.18)',
      minor: 'rgba(234, 179, 8, 0.15)',
      none: 'rgba(161, 161, 170, 0.10)',
    };
    const borderColors = {
      critical: 'rgba(239, 68, 68, 0.6)',
      major: 'rgba(249, 115, 22, 0.5)',
      minor: 'rgba(234, 179, 8, 0.4)',
      none: 'rgba(161, 161, 170, 0.3)',
    };

    cfAnnotations['cf' + i] = {
      type: 'box',
      xMin: startDate,
      xMax: endDate,
      backgroundColor: impactColors[inc.impact] || impactColors.minor,
      borderColor: borderColors[inc.impact] || borderColors.minor,
      borderWidth: 1,
    };
  });

  // Update legend text to show count
  const $legendText = document.getElementById('legend-cf-text');
  if (hasCfAnnotations) {
    const count = Object.keys(cfAnnotations).length;
    $legendText.textContent = lang === 'PL'
      ? `Awaria Cloudflare (wpływ na Szkopuł) — ${count}`
      : `Cloudflare outage (affected Szkopuł) — ${count}`;
  } else {
    $legendText.textContent = lang === 'PL'
      ? 'Awaria Cloudflare — brak w tym okresie'
      : 'Cloudflare outage — none in this period';
  }

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: lang === 'PL' ? 'Czas działania (%)' : 'Uptime (%)',
        data: values,
        borderColor: c.line,
        backgroundColor: c.fill,
        fill: true,
        tension: 0.3,
        pointRadius: data.length > 60 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: c.point,
        borderWidth: 2,
        segment: {
          borderColor: segmentColor,
        },
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: cfAnnotations,
        },
        tooltip: {
          backgroundColor: c.tooltip,
          titleColor: c.tooltipText,
          bodyColor: c.tooltipText,
          borderColor: c.grid,
          borderWidth: 1,
          callbacks: {
            title: (items) => {
              const d = new Date(items[0].label + 'T00:00:00');
              return d.toLocaleDateString(lang === 'PL' ? 'pl-PL' : 'en-US', {
                year: 'numeric', month: 'long', day: 'numeric'
              });
            },
            label: (item) => `${item.parsed.y.toFixed(2)}%`,
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'week', tooltipFormat: 'yyyy-MM-dd' },
          ticks: { color: c.text, maxTicksLimit: 12 },
          grid: { color: c.grid },
        },
        y: {
          min: Math.max(0, Math.min(...values) - 2),
          max: 100,
          ticks: {
            color: c.text,
            callback: v => v.toFixed(1) + '%',
          },
          grid: { color: c.grid },
        }
      }
    }
  };

  if (uptimeChart) {
    uptimeChart.destroy();
  }
  uptimeChart = new Chart(ctx, config);
}

function updateChartTheme() {
  if (uptimeChart) {
    fetchHistory();
  }
  $chartTitle.textContent = lang === 'PL' ? 'Dzienny czas działania' : 'Daily Uptime';
  // Legend text updates on next chart render via fetchHistory
}

setInterval(updateCounter, 1000);
setInterval(fetchStatus, 10_000);
fetchStatus();
fetchHistory();
fetchRankings();
setInterval(fetchHistory, 60_000);
setInterval(fetchRankings, 60_000);
