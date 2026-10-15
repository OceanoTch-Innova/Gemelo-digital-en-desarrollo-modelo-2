'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aquatwins-auth-'));
process.env.DB_PATH = path.join(testDirectory, 'auth.sqlite');
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = crypto.randomBytes(32).toString('hex');
process.env.CORS_ORIGIN = 'http://frontend.test';
process.env.NODE_ENV = 'test';

const app = require('../src/server');
const db = require('../src/db');

let server;
let baseUrl;
let testEmail;
let testPassword;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  testEmail = `auth-test-${crypto.randomUUID()}@example.test`;
  testPassword = `Test-${crypto.randomBytes(16).toString('hex')}!`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  db.close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('health endpoint responds with an explicit healthy status', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json().then(({ status }) => ({ status })), { status: 'ok' });
});

test('CORS allows the configured frontend and rejects an unconfigured origin', async () => {
  const allowed = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: process.env.CORS_ORIGIN,
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), process.env.CORS_ORIGIN);
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');

  const localFileOrigin = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'null' },
  });
  assert.equal(localFileOrigin.status, 200);

  process.env.NODE_ENV = 'production';
  const productionFileOrigin = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'null' },
  });
  assert.equal(productionFileOrigin.status, 403);
  process.env.NODE_ENV = 'test';

  const rejected = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://unconfigured.example' },
  });
  assert.equal(rejected.status, 403);
});

test('register validates credentials and login returns a session only for a valid account', async () => {
  const invalidRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: 'invalid' }),
  });
  assert.equal(invalidRegistration.status, 400);

  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  assert.equal(registration.status, 201);
  assert.equal((await registration.json()).user.email, testEmail);

  const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'incorrect' }),
  });
  assert.equal(invalidLogin.status, 401);
  assert.deepEqual(await invalidLogin.json(), { error: 'Correo o contraseña incorrectos.' });

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(typeof session.accessToken, 'string');
  assert.equal(session.user.email, testEmail);
  const refreshCookie = login.headers.get('set-cookie');
  assert.match(refreshCookie, /HttpOnly/i);
  assert.match(refreshCookie, /SameSite=Strict/i);
});

test('public registration is disabled by default in production', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRegistrationFlag = process.env.PUBLIC_REGISTRATION_ENABLED;
  process.env.NODE_ENV = 'production';
  delete process.env.PUBLIC_REGISTRATION_ENABLED;

  try {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `production-registration-${crypto.randomUUID()}@example.test`,
        password: `Test-${crypto.randomBytes(16).toString('hex')}!`,
      }),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'El registro público no está habilitado.' });
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalRegistrationFlag === undefined) {
      delete process.env.PUBLIC_REGISTRATION_ENABLED;
    } else {
      process.env.PUBLIC_REGISTRATION_ENABLED = originalRegistrationFlag;
    }
  }
});

test('refresh, logout, and protected profile routes report missing authentication', async () => {
  const refresh = await fetch(`${baseUrl}/api/auth/refresh`, { method: 'POST' });
  assert.equal(refresh.status, 401);

  const profile = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(profile.status, 401);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true });
});
