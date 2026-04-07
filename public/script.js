const NAMES = [
  'Jan','Piotr','Paweł','Andrzej','Michał','Krzysztof',
  'Tomasz','Marcin','Mateusz','Łukasz','Kamil','Jakub',
  'Wilk','Lis','Niedźwiedź','Chrobry','Śmiały',
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
  $lang.textContent = lang === 'PL' ? '🇵🇱' : '🇬🇧';
  $daysText.textContent = lang === 'PL'
      ? 'Dni od ostatniego incydentu'
      : 'Days since last inchident';
  localStorage.setItem('lang', lang);
  updateCounter();
}

function toggleMode() {
  const dark = document.body.classList.toggle('dark');
  $color.textContent = dark ? '🌙' : '☀️';
  localStorage.setItem('mode', dark ? 'dark' : 'light');
}

$color.onclick = toggleMode;
$lang.onclick  = toggleLang;

// --- Init ---
if (localStorage.getItem('lang') === 'EN') toggleLang();
if (localStorage.getItem('mode') === 'dark') toggleMode();

setInterval(updateCounter, 1000);
setInterval(fetchStatus, 10_000);
fetchStatus();
