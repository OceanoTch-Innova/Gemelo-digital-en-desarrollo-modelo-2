/**
 * seed.js — Crea un usuario demo para desarrollo/demo.
 * Uso: node src/seed.js
 * 
 * Usuario demo:
 *   Email:    demo@oceanotech.com
 *   Password: AquaTwins2025!
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./db');

const DEMO_EMAIL = 'demo@oceanotech.com';
const DEMO_PASSWORD = 'AquaTwins2025!';
const DEMO_NAME = 'Demo User';

const SALT_ROUNDS = 12;

function seed() {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL);
  if (existing) {
    console.log(`[seed] El usuario ${DEMO_EMAIL} ya existe (id=${existing.id}).`);
    return;
  }

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, SALT_ROUNDS);
  const now = Date.now();

  const info = db.prepare(
    `INSERT INTO users (email, password_hash, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(DEMO_EMAIL, passwordHash, DEMO_NAME, now, now);

  console.log(`[seed] Usuario demo creado:`);
  console.log(`  ID:       ${info.lastInsertRowid}`);
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log(`  Nombre:   ${DEMO_NAME}`);
}

seed();
