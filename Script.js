/* ════════════════════════════════════════════════════════════════
   OceanoTech Innova · script.js
   Same routing architecture + dashboard live simulation
════════════════════════════════════════════════════════════════ */

/* ─── State ──────────────────────────────────────────────────── */
const state = {
  currentRoute: 'inicio',
  dashInterval: null,
  chartData: { temp: [], oxy: [] },
};

/* ─── DOM References ─────────────────────────────────────────── */
const appShell    = document.getElementById('appShell');
const routeViews  = Array.from(document.querySelectorAll('.route-view'));
const routeLinks  = Array.from(document.querySelectorAll('[data-route-link]'));
const menuToggle  = document.getElementById('menuToggle');
const mobilePanel = document.getElementById('mobilePanel');

/* ═══════════════════════════════════════════════════════════════
   ROUTING — identical logic, preserved
═══════════════════════════════════════════════════════════════ */

function normalizeRoute(rawHash) {
  const cleaned = String(rawHash || '')
    .replace('#', '')
    .replace('/', '')
    .trim()
    .toLowerCase();

  if (!cleaned) return 'inicio';

  const exists = routeViews.some((v) => v.dataset.route === cleaned);
  return exists ? cleaned : 'inicio';
}

function updateActiveLinks(route) {
  routeLinks.forEach((link) => {
    const isActive = link.dataset.routeLink === route;
    link.classList.toggle('is-active', isActive);
    link.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

function updateViews(route) {
  routeViews.forEach((view) => {
    const isActive = view.dataset.route === route;
    view.classList.toggle('is-active', isActive);
    view.hidden = !isActive;
  });
}

function navigateTo(route, options = { replaceHash: true }) {
  state.currentRoute = route;
  updateViews(route);
  updateActiveLinks(route);

  if (options.replaceHash) {
    window.location.hash = `/${route}`;
  }

  if (appShell) {
    appShell.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Lifecycle hooks
  if (route === 'dashboard') initDashboard();
  else stopDashboard();

  if (route === 'inicio') startCounters();
}

function handleHashRoute() {
  const route = normalizeRoute(window.location.hash);
  navigateTo(route, { replaceHash: false });
}

function bindLinks() {
  routeLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const targetRoute = link.dataset.routeLink;
      navigateTo(targetRoute, { replaceHash: true });

      if (mobilePanel && !mobilePanel.hidden) {
        mobilePanel.hidden = true;
        if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
      }
    });
  });
}

function bindMobileToggle() {
  if (!menuToggle || !mobilePanel) return;

  menuToggle.addEventListener('click', () => {
    const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
    mobilePanel.hidden = isExpanded;
  });
}

/* ═══════════════════════════════════════════════════════════════
   STATUS CLOCK
═══════════════════════════════════════════════════════════════ */

function startClock() {
  const el = document.getElementById('statusClock');
  if (!el) return;
  const tick = () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    el.textContent = `UTC ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}

/* ═══════════════════════════════════════════════════════════════
   COUNT-UP ANIMATION (Inicio metrics)
═══════════════════════════════════════════════════════════════ */

function animateCount(el, target, duration = 1600) {
  const start = performance.now();
  const update = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(eased * target).toLocaleString('es-CL');
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

function startCounters() {
  // Slight delay so animation triggers after route transition
  setTimeout(() => {
    document.querySelectorAll('[data-count-up]').forEach((el) => {
      const target = parseInt(el.dataset.countUp, 10);
      animateCount(el, target);
    });
  }, 120);
}

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD — Live Ocean Data Simulation
═══════════════════════════════════════════════════════════════ */

const SENSOR_NAMES = [
  'SENSOR-AQ01', 'SENSOR-AQ02', 'SENSOR-TM03',
  'SENSOR-OX04', 'SENSOR-SL05', 'SENSOR-PH06',
  'SENSOR-SAL07', 'SENSOR-DPT08',
];

// Realistic ocean data ranges
const OCEAN_PARAMS = {
  temp: { base: 14.2, range: 1.8, label: 'kpiTemp' },
  oxy:  { base: 7.4,  range: 0.6, label: 'kpiOxy'  },
  sal:  { base: 34.1, range: 0.4, label: 'kpiSal'  },
  ph:   { base: 7.92, range: 0.06,label: 'kpiPh'   },
};

const ALERT_MSGS = [
  { level: 'ok',   msg: 'SENSOR-AQ01 — Lectura nominal'           },
  { level: 'ok',   msg: 'Sync completado — 2847 nodos'             },
  { level: 'warn', msg: 'SENSOR-TM03 — Temp. límite superior'      },
  { level: 'ok',   msg: 'Backup automático completado'             },
  { level: 'warn', msg: 'SENSOR-OX04 — O₂ bajo umbral mínimo'     },
  { level: 'ok',   msg: 'Predicción generada — Zona Norte'         },
  { level: 'err',  msg: 'SENSOR-DPT08 — Sin señal (5 min)'         },
  { level: 'ok',   msg: 'Modelo ML actualizado correctamente'      },
];

let liveValues = { temp: 14.2, oxy: 7.4, sal: 34.1, ph: 7.92 };
let alertIndex = 0;

function randomDelta(range) {
  return (Math.random() - 0.5) * 2 * range * 0.18;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function updateLiveValues() {
  liveValues.temp = clamp(liveValues.temp + randomDelta(OCEAN_PARAMS.temp.range), 12.0, 16.5);
  liveValues.oxy  = clamp(liveValues.oxy  + randomDelta(OCEAN_PARAMS.oxy.range),  6.2,  8.8);
  liveValues.sal  = clamp(liveValues.sal  + randomDelta(OCEAN_PARAMS.sal.range),  33.2, 35.0);
  liveValues.ph   = clamp(liveValues.ph   + randomDelta(OCEAN_PARAMS.ph.range),   7.75, 8.10);
}

function renderKPIs() {
  const set = (id, val, dec) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val.toFixed(dec);
  };
  set('kpiTemp', liveValues.temp, 1);
  set('kpiOxy',  liveValues.oxy,  1);
  set('kpiSal',  liveValues.sal,  1);
  set('kpiPh',   liveValues.ph,   2);
}

/* ─── Spark Lines ────────────────────────────────────────────── */
const sparkHistory = { temp: [], oxy: [], sal: [], ph: [] };

function pushSpark(key, value) {
  sparkHistory[key].push(value);
  if (sparkHistory[key].length > 40) sparkHistory[key].shift();
}

function drawSpark(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || data.length < 2) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.height;
  canvas.width = W;
  ctx.clearRect(0, 0, W, H);

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 0.001;
  const scaleY = (v) => H - ((v - min) / range) * (H - 4) - 2;
  const scaleX = (i) => (i / (data.length - 1)) * W;

  ctx.beginPath();
  ctx.moveTo(scaleX(0), scaleY(data[0]));
  for (let i = 1; i < data.length; i++) {
    ctx.lineTo(scaleX(i), scaleY(data[i]));
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Fill area
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = color + '22';
  ctx.fill();
}

function renderSparks() {
  drawSpark('sparkTemp', sparkHistory.temp, '#00e5ff');
  drawSpark('sparkOxy',  sparkHistory.oxy,  '#0080ff');
  drawSpark('sparkSal',  sparkHistory.sal,  '#00d97e');
  drawSpark('sparkPh',   sparkHistory.ph,   '#f0a500');
}

/* ─── Main Chart ─────────────────────────────────────────────── */
const mainChartData = { temp: [], oxy: [], maxLen: 60 };

function pushMain() {
  mainChartData.temp.push(liveValues.temp);
  mainChartData.oxy.push(liveValues.oxy);
  if (mainChartData.temp.length > mainChartData.maxLen) {
    mainChartData.temp.shift();
    mainChartData.oxy.shift();
  }
}

function drawMainChart() {
  const canvas = document.getElementById('mainChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth;
  const H = canvas.height;
  canvas.width = W;
  ctx.clearRect(0, 0, W, H);

  const data1 = mainChartData.temp;
  const data2 = mainChartData.oxy;
  if (data1.length < 2) return;

  // Grid
  ctx.strokeStyle = 'rgba(0,200,220,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (i / 4) * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  function drawLine(data, color, rangeMin, rangeMax) {
    const scaleY = (v) => H - ((v - rangeMin) / (rangeMax - rangeMin)) * (H - 8) - 4;
    const scaleX = (i) => (i / (data.length - 1)) * W;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + '55');
    grad.addColorStop(1, 'transparent');

    ctx.beginPath();
    ctx.moveTo(scaleX(0), scaleY(data[0]));
    for (let i = 1; i < data.length; i++) {
      const cx = (scaleX(i - 1) + scaleX(i)) / 2;
      ctx.bezierCurveTo(cx, scaleY(data[i - 1]), cx, scaleY(data[i]), scaleX(i), scaleY(data[i]));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // area
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  drawLine(data1, '#00e5ff', 11, 17);
  drawLine(data2, '#0080ff', 6, 9);
}

/* ─── Alerts ─────────────────────────────────────────────────── */
function renderAlert() {
  const list = document.getElementById('alertList');
  if (!list) return;

  const alert = ALERT_MSGS[alertIndex % ALERT_MSGS.length];
  alertIndex++;

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;

  const item = document.createElement('div');
  item.className = 'alert-item';
  item.innerHTML = `
    <span class="alert-dot alert-dot--${alert.level}"></span>
    <span>${alert.msg}</span>
    <span class="alert-item__time">${time}</span>
  `;

  list.insertBefore(item, list.firstChild);
  while (list.children.length > 6) list.removeChild(list.lastChild);
}

/* ─── Sensors ────────────────────────────────────────────────── */
function renderSensors() {
  const list = document.getElementById('sensorList');
  if (!list || list.children.length > 0) return; // Only render once

  SENSOR_NAMES.forEach((name) => {
    const statuses = ['ok', 'ok', 'ok', 'ok', 'ok', 'warn'];
    const s = statuses[Math.floor(Math.random() * statuses.length)];
    const labels = { ok: 'ONLINE', warn: 'ALERTA', err: 'FALLO' };
    const item = document.createElement('div');
    item.className = 'sensor-item';
    item.innerHTML = `
      <span class="sensor-item__name">${name}</span>
      <span class="sensor-item__status status--${s}">${labels[s]}</span>
    `;
    list.appendChild(item);
  });
}

/* ─── Dashboard Tick ─────────────────────────────────────────── */
function dashTick() {
  updateLiveValues();
  renderKPIs();

  pushSpark('temp', liveValues.temp);
  pushSpark('oxy',  liveValues.oxy);
  pushSpark('sal',  liveValues.sal);
  pushSpark('ph',   liveValues.ph);
  renderSparks();

  pushMain();
  drawMainChart();
}

let alertTick = 0;
function initDashboard() {
  if (state.dashInterval) return; // Already running

  renderSensors();
  // Seed data
  for (let i = 0; i < 30; i++) {
    updateLiveValues();
    pushSpark('temp', liveValues.temp);
    pushSpark('oxy',  liveValues.oxy);
    pushSpark('sal',  liveValues.sal);
    pushSpark('ph',   liveValues.ph);
    pushMain();
  }
  renderKPIs();
  renderSparks();
  drawMainChart();
  renderAlert();

  state.dashInterval = setInterval(() => {
    dashTick();
    alertTick++;
    if (alertTick % 8 === 0) renderAlert();
  }, 1000);
}

function stopDashboard() {
  if (state.dashInterval) {
    clearInterval(state.dashInterval);
    state.dashInterval = null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════ */

function initRouting() {
  bindLinks();
  bindMobileToggle();
  handleHashRoute();
  window.addEventListener('hashchange', handleHashRoute);
}

function init() {
  startClock();
  initRouting();

  // Count-up on Inicio if that's the landing route
  if (state.currentRoute === 'inicio') startCounters();

  // Redraw chart on window resize
  window.addEventListener('resize', () => {
    if (state.currentRoute === 'dashboard') drawMainChart();
  });
}

init();