'use strict';

const SENSOR_SCHEMA = Object.freeze({
  temperature: { min: 0, max: 30, fallback: 12.4 },
  do: { min: 0, max: 15, fallback: 8.4 },
  salinity: { min: 25, max: 40, fallback: 33.1 },
  pH: { min: 6, max: 10, fallback: 7.84 },
  ammonia: { min: 0, max: 0.1, fallback: 0.008 },
  turbidity: { min: 0, max: 100, fallback: 2.2 },
  flow: { min: 0, max: 3000, fallback: 1185 },
});

const API_CONFIG = Object.freeze({
  cleanSensorEndpoint: window.AQUATWIN_SENSOR_API || 'http://127.0.0.1:8000/api/sensores/limpios',
  pollMs: 5000,
});

const GlobalState = (() => {
  const listeners = new Set();
  const state = {
    route: 'gemelo',
    sensors: {
      source: 'bootstrap',
      quality: 'empty',
      lastUpdated: null,
      data: normalizeSensorData({}),
      history: [],
    },
    twin: {
      day: 0,
      biomass: 0,
      individualWeight: 0,
      population: 0,
      lastResult: null,
    },
  };

  function clone(value) {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function notify(topic, payload) {
    const event = { topic, payload: clone(payload), state: getSnapshot() };
    listeners.forEach((listener) => {
      try { listener(event); } catch (error) { console.error('[GlobalState]', error); }
    });
  }

  function getSnapshot() {
    return clone(state);
  }

  function setRoute(route) {
    state.route = route;
    notify('route:changed', { route });
  }

  function setCleanSensorData(payload, source = 'api') {
    const data = normalizeSensorData(payload);
    const sample = {
      source,
      quality: 'ok',
      lastUpdated: new Date().toISOString(),
      data,
    };

    state.sensors.source = sample.source;
    state.sensors.quality = sample.quality;
    state.sensors.lastUpdated = sample.lastUpdated;
    state.sensors.data = sample.data;
    state.sensors.history.push(sample);
    if (state.sensors.history.length > 240) state.sensors.history.shift();

    notify('sensors:updated', state.sensors);
    return clone(state.sensors);
  }

  function getLatestSensorData() {
    return clone(state.sensors);
  }

  function setTwinSnapshot(snapshot) {
    state.twin = { ...state.twin, ...clone(snapshot) };
    notify('twin:updated', state.twin);
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    getSnapshot,
    setRoute,
    setCleanSensorData,
    getLatestSensorData,
    setTwinSnapshot,
    subscribe,
  };
})();

function normalizeSensorData(raw) {
  const aliases = {
    oxygen: 'do',
    dissolvedOxygen: 'do',
    oxigeno: 'do',
    o2: 'do',
    temperatura: 'temperature',
    salinidad: 'salinity',
    amonio: 'ammonia',
    nh3: 'ammonia',
    turbidez: 'turbidity',
    caudal: 'flow',
    ph: 'pH',
  };

  const canonical = {};
  Object.entries(raw || {}).forEach(([key, value]) => {
    canonical[aliases[key] || key] = value;
  });

  return Object.fromEntries(Object.entries(SENSOR_SCHEMA).map(([key, rule]) => {
    const value = Number(canonical[key]);
    const safe = Number.isFinite(value) ? value : rule.fallback;
    return [key, Math.max(rule.min, Math.min(rule.max, safe))];
  }));
}

const AppRouter = (() => {
  const routes = new Set(['captacion', 'gemelo']);

  function currentRoute() {
    const candidate = window.location.hash.replace('#', '').replace('/', '') || 'gemelo';
    return routes.has(candidate) ? candidate : 'gemelo';
  }

  function navigate() {
    const route = currentRoute();
    document.querySelectorAll('[data-route-view]').forEach((view) => {
      view.classList.toggle('active', view.dataset.routeView === route);
      view.setAttribute('aria-hidden', String(view.dataset.routeView !== route));
    });
    document.querySelectorAll('[data-route-link]').forEach((link) => {
      link.classList.toggle('active', link.dataset.routeLink === route);
      link.setAttribute('aria-current', link.dataset.routeLink === route ? 'page' : 'false');
    });
    document.body.dataset.route = route;
    GlobalState.setRoute(route);
  }

  function isRouteActive(route) {
    return currentRoute() === route;
  }

  window.addEventListener('hashchange', navigate);
  document.addEventListener('DOMContentLoaded', navigate);

  return { navigate, isRouteActive };
})();

const CaptacionDashboard = (() => {
  const interop = [
    'FastAPI filtra lecturas y publica solo datos utiles para entrenamiento.',
    'GlobalState actua como bus local entre captacion, IA y simulador TGC.',
    'El gemelo digital consume la ultima lectura limpia sin reiniciar canvas ni boids.',
    'La capa de API puede reemplazarse por SSE/WebSocket para telemetria continua.',
  ];

  const alerts = [
    { state: 'green', cage: 'Jaula-02', event: 'Consumo en rango optimo', impact: 'Positivo', action: 'Mantener estrategia actual' },
    { state: 'yellow', cage: 'Jaula-07', event: 'Turbidez elevandose', impact: 'Moderado', action: 'Ajustar aireacion y monitorear 30 min' },
    { state: 'red', cage: 'Jaula-11', event: 'Baja de oxigeno puntual', impact: 'Critico', action: 'Activar protocolo O2 y reducir alimentacion' },
  ];

  function init() {
    bindEvents();
    renderStatic();
    renderFromState(GlobalState.getSnapshot());
    GlobalState.subscribe(({ topic, state }) => {
      if (topic === 'sensors:updated' || topic === 'twin:updated') renderFromState(state);
    });
    pollCleanSensorApi();
    window.setInterval(pollCleanSensorApi, API_CONFIG.pollMs);
  }

  function bindEvents() {
    document.getElementById('capRefresh')?.addEventListener('click', pollCleanSensorApi);
    document.getElementById('capHorizon')?.addEventListener('change', () => {
      renderFromState(GlobalState.getSnapshot());
    });
    window.addEventListener('resize', drawPredictiveChart);
  }

  async function pollCleanSensorApi() {
    try {
      const response = await fetch(API_CONFIG.cleanSensorEndpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const payload = await response.json();
      GlobalState.setCleanSensorData(payload.data || payload, 'fastapi');
    } catch (error) {
      GlobalState.setCleanSensorData(generateDemoSensorSample(), 'demo-fallback');
    }
  }

  function generateDemoSensorSample() {
    const t = Date.now() / 1000;
    return {
      temperature: 12.8 + Math.sin(t / 40) * 0.6,
      do: 8.1 + Math.cos(t / 33) * 0.35,
      pH: 7.72 + Math.sin(t / 55) * 0.08,
      ammonia: 0.008 + Math.max(0, Math.sin(t / 70)) * 0.004,
      salinity: 33.0 + Math.cos(t / 90) * 0.25,
      turbidity: 3.2 + Math.max(0, Math.sin(t / 45)) * 2.1,
      flow: 1180 + Math.sin(t / 35) * 90,
    };
  }

  function renderStatic() {
    const list = document.getElementById('capInteropList');
    if (list) list.innerHTML = interop.map((item) => `<li>${item}</li>`).join('');

    const body = document.getElementById('capAlertsBody');
    if (body) {
      body.innerHTML = alerts.map((alert) => `
        <tr>
          <td><span class="state ${alert.state}">${alert.state.toUpperCase()}</span></td>
          <td>${alert.cage}</td>
          <td>${alert.event}</td>
          <td>${alert.impact}</td>
          <td>${alert.action}</td>
        </tr>
      `).join('');
    }
  }

  function renderFromState(state) {
    const sensors = state.sensors.data;
    const twin = state.twin;
    const biomass = twin.biomass || 186.4;
    const fcr = twin.lastResult?.FCR || 1.21;
    const oxygen = sensors.do;
    const risk = calculateRisk(sensors);

    const kpis = [
      { title: 'Biomasa estimada total', value: `${biomass.toFixed(1)} t`, trend: `Dia ${twin.day || 0}` },
      { title: 'Conversion alimenticia (FCR)', value: fcr.toFixed(2), trend: fcr <= 1.25 ? 'Eficiente' : 'Revisar racion' },
      { title: 'Oxigeno disuelto promedio', value: `${oxygen.toFixed(1)} mg/L`, trend: oxygen >= 7 ? 'En rango' : 'Atencion operacional' },
      { title: 'Riesgo operativo', value: risk.label, trend: `Indice ${risk.score.toFixed(2)}` },
    ];

    const grid = document.getElementById('capKpiGrid');
    if (grid) {
      grid.innerHTML = kpis.map((kpi) => `
        <article class="kpi"><h4>${kpi.title}</h4><div class="value">${kpi.value}</div><div class="trend">${kpi.trend}</div></article>
      `).join('');
    }

    renderWater(sensors);
    renderSimulation(biomass, risk.score);
    drawPredictiveChart();
    renderGlobalStateStatus(state.sensors);
  }

  function renderWater(sensors) {
    const rows = [
      { name: 'Temperatura', value: `${sensors.temperature.toFixed(1)} C`, status: inRange(sensors.temperature, 10, 16) },
      { name: 'Oxigeno disuelto', value: `${sensors.do.toFixed(1)} mg/L`, status: inRange(sensors.do, 7, 12) },
      { name: 'pH', value: sensors.pH.toFixed(2), status: inRange(sensors.pH, 7, 8) },
      { name: 'Amonio NH3', value: `${(sensors.ammonia * 1000).toFixed(1)} ug/L`, status: sensors.ammonia < 0.012 ? 'ok' : sensors.ammonia < 0.03 ? 'warn' : 'critical' },
      { name: 'Turbidez', value: `${sensors.turbidity.toFixed(1)} NTU`, status: sensors.turbidity < 5 ? 'ok' : sensors.turbidity < 15 ? 'warn' : 'critical' },
      { name: 'Salinidad', value: `${sensors.salinity.toFixed(1)} PSU`, status: inRange(sensors.salinity, 30, 35) },
      { name: 'Caudal', value: `${sensors.flow.toFixed(0)} L/min`, status: sensors.flow >= 800 ? 'ok' : sensors.flow >= 400 ? 'warn' : 'critical' },
    ];

    const container = document.getElementById('capWaterMetrics');
    if (container) {
      container.innerHTML = rows.map((row) => `
        <div class="metric-item"><span>${row.name}</span><strong>${row.value}</strong></div>
      `).join('');
    }

    const hasCritical = rows.some((row) => row.status === 'critical');
    const hasWarn = rows.some((row) => row.status === 'warn');
    const badge = document.getElementById('capWaterBadge');
    if (badge) {
      badge.className = `badge ${hasCritical ? 'critical' : hasWarn ? 'warn' : 'ok'}`;
      badge.textContent = hasCritical ? 'Critico' : hasWarn ? 'Atencion' : 'Estable';
    }
  }

  function renderSimulation(biomass, riskScore) {
    const hours = Number(document.getElementById('capHorizon')?.value || 6);
    const projectedGrowth = Math.max(0.03, 0.12 * (1 - riskScore));
    const cards = [
      { label: 'Biomasa proyectada', value: `${(biomass + hours * projectedGrowth).toFixed(1)} t`, eff: Math.max(80, 97 - riskScore * 18 - hours * 0.06) },
      { label: 'Riesgo sanitario', value: `${Math.min(100, riskScore * 100 + hours * 0.2).toFixed(0)}%`, eff: Math.max(80, 96 - riskScore * 20) },
      { label: 'Ventana predictiva', value: `${hours} h`, eff: Math.max(80, 98 - hours * 0.18) },
    ];

    const container = document.getElementById('capSimulationCards');
    if (container) {
      container.innerHTML = cards.map((card) => `
        <div class="sim-card"><div>${card.label}</div><strong>${card.value}</strong><div>Efectividad: ${card.eff.toFixed(1)}%</div></div>
      `).join('');
    }

    const accuracy = document.getElementById('capAccuracy');
    if (accuracy) accuracy.textContent = `${(cards.reduce((sum, card) => sum + card.eff, 0) / cards.length).toFixed(1)}%`;
  }

  function drawPredictiveChart() {
    const canvas = document.getElementById('capPredictiveChart');
    if (!canvas || canvas.offsetWidth === 0) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height;
    const points = GlobalState.getSnapshot().sensors.history.slice(-12);
    const values = points.length ? points.map((point) => point.data.do) : [7.7, 7.9, 8.1, 8.0, 8.2, 8.4];
    const min = Math.min(...values, 5);
    const max = Math.max(...values, 10);

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(0,175,210,.13)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.beginPath();
    values.forEach((value, index) => {
      const x = values.length === 1 ? 0 : (width / (values.length - 1)) * index;
      const y = height - ((value - min) / Math.max(0.1, max - min)) * (height - 16) - 8;
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#00c8d8';
    ctx.stroke();
  }

  function renderGlobalStateStatus(sensors) {
    const status = document.getElementById('globalStateStatus');
    const timestamp = document.getElementById('globalStateTimestamp');
    if (status) status.textContent = sensors.source === 'fastapi' ? 'API sincronizada' : 'Modo demo local';
    if (timestamp) timestamp.textContent = sensors.lastUpdated ? new Date(sensors.lastUpdated).toLocaleString('es-CL') : 'Sin lectura sincronizada';
  }

  function inRange(value, min, max) {
    if (value >= min && value <= max) return 'ok';
    if (value >= min * 0.85 && value <= max * 1.15) return 'warn';
    return 'critical';
  }

  function calculateRisk(sensors) {
    const components = [
      sensors.do < 7 ? (7 - sensors.do) / 7 : 0,
      sensors.temperature < 10 ? (10 - sensors.temperature) / 10 : sensors.temperature > 16 ? (sensors.temperature - 16) / 16 : 0,
      sensors.pH < 7 ? (7 - sensors.pH) / 7 : sensors.pH > 8 ? (sensors.pH - 8) / 8 : 0,
      sensors.ammonia > 0.012 ? Math.min(1, (sensors.ammonia - 0.012) / 0.038) : 0,
      sensors.turbidity > 5 ? Math.min(1, (sensors.turbidity - 5) / 25) : 0,
    ];
    const score = Math.max(0, Math.min(1, components.reduce((sum, value) => sum + value, 0) / components.length));
    return { score, label: score < 0.2 ? 'Bajo' : score < 0.45 ? 'Medio' : 'Alto' };
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init, pollCleanSensorApi };
})();

window.GlobalState = GlobalState;
window.AppRouter = AppRouter;
window.CaptacionDashboard = CaptacionDashboard;
