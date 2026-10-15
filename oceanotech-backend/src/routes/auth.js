const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { isValidEmail, isValidPassword, normalizeEmail } = require('../utils/validators');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { verifyRecaptcha } = require('../utils/recaptcha');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const SALT_ROUNDS = 12;
const MAX_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_MS = parseInt(process.env.LOCKOUT_MINUTES || '15', 10) * 60 * 1000;

const REFRESH_COOKIE_NAME = 'oceanotech_refresh';
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function logAttempt(email, ip, success) {
  db.prepare(
    'INSERT INTO login_events (email, ip, success, created_at) VALUES (?, ?, ?, ?)'
  ).run(email, ip || null, success ? 1 : 0, Date.now());
}

// ---------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------
router.post(
  '/register',
  registerLimiter,
  [
    body('email').isString(),
    body('password').isString(),
    body('name').optional().isString().trim().isLength({ max: 120 }),
  ],
  (req, res) => {
    // El acceso es restringido por defecto en producción. La habilitación es
    // explícita para evitar exponer un alta pública por accidente.
    if (
      process.env.NODE_ENV === 'production'
      && process.env.PUBLIC_REGISTRATION_ENABLED !== 'true'
    ) {
      return res.status(403).json({ error: 'El registro público no está habilitado.' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    const email = normalizeEmail(req.body.email || '');
    const { password, name } = req.body;

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Correo electrónico inválido.' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({
        error:
          'La contraseña debe tener al menos 10 caracteres, con mayúscula, minúscula, número y símbolo.',
      });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      // Mensaje genérico: no confirmamos si el correo ya existe
      return res.status(409).json({ error: 'No se pudo crear la cuenta con esos datos.' });
    }

    const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
    const now = Date.now();

    const info = db
      .prepare(
        `INSERT INTO users (email, password_hash, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(email, passwordHash, name || null, now, now);

    return res.status(201).json({
      user: { id: info.lastInsertRowid, email, name: name || null },
    });
  }
);

// ---------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------
router.post(
  '/login',
  loginLimiter,
  [body('email').isString(), body('password').isString()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    const email = normalizeEmail(req.body.email || '');
    const { password, recaptchaToken } = req.body;
    const ip = req.ip;

    // Punto de enganche para reCAPTCHA (no hace nada mientras RECAPTCHA_ENABLED=false)
    const captcha = await verifyRecaptcha(recaptchaToken, ip);
    if (!captcha.success) {
      logAttempt(email, ip, false);
      return res.status(400).json({ error: 'Verificación anti-bot fallida.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const genericError = { error: 'Correo o contraseña incorrectos.' };

    if (!user) {
      // No revelamos si el correo existe o no
      logAttempt(email, ip, false);
      return res.status(401).json(genericError);
    }

    // ¿Cuenta bloqueada por intentos fallidos?
    if (user.locked_until && user.locked_until > Date.now()) {
      const minutesLeft = Math.ceil((user.locked_until - Date.now()) / 60000);
      logAttempt(email, ip, false);
      return res.status(423).json({
        error: `Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intenta de nuevo en ${minutesLeft} min.`,
      });
    }

    const passwordOk = bcrypt.compareSync(password, user.password_hash);

    if (!passwordOk) {
      const attempts = user.failed_attempts + 1;
      const lockedUntil = attempts >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : null;

      db.prepare(
        'UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?'
      ).run(attempts, lockedUntil, Date.now(), user.id);

      logAttempt(email, ip, false);

      if (lockedUntil) {
        return res.status(423).json({
          error: `Demasiados intentos fallidos. Cuenta bloqueada por ${LOCKOUT_MS / 60000} min.`,
        });
      }
      return res.status(401).json(genericError);
    }

    // Login correcto: resetea contador de intentos
    db.prepare(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?'
    ).run(Date.now(), user.id);

    logAttempt(email, ip, true);

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(user.id, hashToken(refreshToken), Date.now() + REFRESH_COOKIE_OPTS.maxAge, Date.now());

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTS);

    return res.json({
      accessToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  }
);

// ---------------------------------------------------------------------
// POST /api/auth/refresh — renueva el access token usando la cookie httpOnly
// ---------------------------------------------------------------------
router.post('/refresh', (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'No hay sesión activa.' });
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
    return res.status(401).json({ error: 'Sesión expirada, inicia sesión de nuevo.' });
  }

  const stored = db
    .prepare(
      'SELECT * FROM refresh_tokens WHERE user_id = ? AND token_hash = ? AND revoked = 0'
    )
    .get(payload.sub, hashToken(token));

  if (!stored || stored.expires_at < Date.now()) {
    return res.status(401).json({ error: 'Sesión expirada, inicia sesión de nuevo.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user) {
    return res.status(401).json({ error: 'Usuario no encontrado.' });
  }

  const accessToken = signAccessToken(user);
  return res.json({ accessToken });
});

// ---------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------
router.post('/logout', (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (token) {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(hashToken(token));
  }
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------
// GET /api/auth/me — ejemplo de ruta protegida
// ---------------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT id, email, name, created_at FROM users WHERE id = ?')
    .get(req.user.id);

  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  return res.json({ user });
});

module.exports = router;
