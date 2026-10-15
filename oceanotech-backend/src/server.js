require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const { router: twinRouter } = require('./routes/twin');
const readingsRouter = require('./routes/readings');
const { generalLimiter } = require('./middleware/rateLimiter');

const app = express();

// Necesario para que express-rate-limit y req.ip funcionen bien detrás de un proxy
app.set('trust proxy', 1);

// ---------- CORS ----------
// Acepta origenes explícitos + null (file:// en desarrollo)
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5500')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir sin origen (null = file://, o llamadas directas tipo curl)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origen no permitido: ${origin}`));
    },
    credentials: true,
  })
);

// ---------- Seguridad base ----------
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(generalLimiter);

// ---------- Rutas ----------
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

app.use('/api/auth', authRoutes);
app.use('/api/v1/twin', twinRouter);
app.use('/api/v1/readings', readingsRouter);

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

// ---------- Manejador de errores ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.message?.startsWith('CORS')) {
    return res.status(403).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 4000;

// On Windows, localhost resolves to ::1 (IPv6) first, so we listen on both
// IPv4 (127.0.0.1) and IPv6 (::1) to make fetch('http://localhost:...') work
// regardless of browser/OS DNS preference.
const http = require('http');

function startServer(host, port) {
  return new Promise((resolve) => {
    http.createServer(app).listen(port, host, () => {
      console.log(`  Listening on http://${host === '::1' ? `[${host}]` : host}:${port}`);
      resolve();
    }).on('error', (err) => {
      // Non-fatal: if IPv6 isn't available, just skip it
      console.warn(`  Could not bind ${host}:${port} — ${err.message}`);
      resolve();
    });
  });
}

(async () => {
  await startServer('127.0.0.1', PORT);
  await startServer('::1', PORT);
  console.log(`OceanoTech AquaTwins backend — http://localhost:${PORT}`);
  console.log(`  POST /api/auth/login`);
  console.log(`  POST /api/auth/register`);
  console.log(`  GET  /api/v1/twin/cages`);
  console.log(`  GET  /api/v1/twin/state/:twin_id`);
  console.log(`  POST /api/v1/twin/sync`);
  console.log(`  GET  /api/v1/twin/history/:twin_id`);
  console.log(`  POST /api/v1/readings`);
  console.log(`  GET  /api/v1/readings/latest`);
})();
