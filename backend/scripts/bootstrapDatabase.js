// backend/scripts/bootstrapDatabase.js
//
// Prepares the database for first use. Runs once per deployment and is
// safe to run again on every later start — every step here only acts when
// something is actually missing, so it never duplicates or overwrites
// existing data.
//
// Steps, in order:
//   1. Apply database/postgres_schema.sql (creates the base tables —
//      CREATE TABLE IF NOT EXISTS and its two seed INSERTs are both
//      idempotent, so re-running this is always safe).
//   2. Apply every file in migrations-sql/, in order, skipping any already
//      recorded in the schema_migrations tracking table.
//   3. Create the first admin account, but only if the users table is
//      still empty. Skips entirely once any user exists.
//
// Run manually:
//   node scripts/bootstrapDatabase.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

const SCHEMA_FILE = path.join(__dirname, '..', '..', 'database', 'postgres_schema.sql');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations-sql');

async function applyBaseSchema() {
  console.log('Step 1/3: applying base schema...');
  if (!fs.existsSync(SCHEMA_FILE)) {
    throw new Error(`Schema file not found: ${SCHEMA_FILE}`);
  }
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  await pool.query(sql);
  console.log('  Base schema is up to date.');
}

async function applyMigrations() {
  console.log('Step 2/3: applying pending migrations...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ DEFAULT now()
    )
  `);
  const appliedResult = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map((r) => r.filename));

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('  No migrations-sql/ folder found — nothing to do.');
    return;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    if (applied.has(file)) { skippedCount++; continue; }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`  Applying ${file} ...`);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    appliedCount++;
  }

  console.log(`  ${appliedCount} migration(s) applied, ${skippedCount} already up to date.`);
}

function generateRandomPassword() {
  // 18 random bytes, base64url-encoded — no padding characters, URL-safe,
  // long enough to be a strong one-time password.
  return crypto.randomBytes(18).toString('base64url');
}

async function createFirstAdminIfNeeded() {
  console.log('Step 3/3: checking for an existing admin account...');
  const countResult = await pool.query('SELECT COUNT(*) FROM users');
  if (parseInt(countResult.rows[0].count, 10) > 0) {
    console.log('  A user account already exists — skipping.');
    return;
  }

  const username = process.env.ADMIN_USERNAME || 'admin';
  const providedPassword = process.env.ADMIN_PASSWORD;
  const password = providedPassword || generateRandomPassword();
  const hashed = bcrypt.hashSync(password, 10);

  await pool.query(
    `INSERT INTO users (full_name, username, password, role, permissions, must_change_password, is_primary_admin, is_active)
     VALUES ($1, $2, $3, 'admin', '[]'::jsonb, TRUE, TRUE, TRUE)`,
    ['System Administrator', username, hashed]
  );

  console.log('');
  console.log('========================================================');
  console.log('  First admin account created.');
  console.log(`  Username: ${username}`);
  if (providedPassword) {
    console.log('  Password: (the one set in ADMIN_PASSWORD in your .env)');
  } else {
    console.log(`  Password: ${password}`);
    console.log('  This password will not be shown again — save it now.');
  }
  console.log('  A password change will be required on first login.');
  console.log('========================================================');
  console.log('');
}

async function run() {
  await applyBaseSchema();
  await applyMigrations();
  await createFirstAdminIfNeeded();
  console.log('Database is ready.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Database bootstrap failed:', err.message);
    process.exit(1);
  });
