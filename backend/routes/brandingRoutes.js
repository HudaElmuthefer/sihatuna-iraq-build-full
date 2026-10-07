// backend/routes/brandingRoutes.js
//
// Organization logo — uploaded once by an admin, applied system-wide (header,
// login page, print header, page banners). Stored as a single global setting
// in the existing system_settings key/value table (same pattern already used
// for multi_hospital_enabled) rather than a per-hospital column: multi-hospital
// mode is opt-in and off by default in this deployment, and nothing in the
// current architecture implies hospitals need distinct branding yet — this
// stays trivially upgradable to a per-hospital `hospitals.logo_path` column
// later without touching this global fallback.
//
// The two GET routes below are deliberately public (no `auth`) — the logo
// must render on the login page and the print header, both reachable before
// or without an authenticated session. Every other uploaded file in the
// system stays behind the auth-gated `/uploads` static mount in server.js;
// this is the one narrow, intentional exception, scoped only to the logo.
//
// ── Security fix ─────────────────────────────────────────────────────────
// Every write route below used to require just `requireAdmin` (any admin
// tier, including a single hospital's own local admin) — but this setting is
// one global row with zero hospital scoping. A single hospital's admin could
// silently overwrite the branding seen by every other hospital on this
// deployment. Now requireGlobalAdmin (ministry-level admin) only — matches
// the same restriction already used for anything affecting every hospital
// (see hospitalsRoutes.js's system-settings route, gitUpdateRoutes.js).
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('../middleware/asyncHandler');
const auth = require('../middleware/auth');
const requireGlobalAdmin = require('../middleware/requireGlobalAdmin');
const { pool } = require('../config/database');
const { logAudit } = require('../utils/auditLog');
const { UPLOADS_DIR } = require('../config/uploadConfig');

const router = express.Router();
const LOGO_SETTING_KEY = 'app_logo_path';

// Separate, stricter multer instance for the logo specifically (images only,
// 2MB cap) — the shared `upload` in uploadConfig.js allows PDFs/docs up to
// 20MB for general document uploads, which isn't right for a header logo.
const LOGO_ALLOWED_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `logo-${uuidv4()}${path.extname(file.originalname)}`),
});
const logoFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const expectedMime = LOGO_ALLOWED_TYPES[ext];
  if (!expectedMime) {
    const err = new Error('Logo must be a PNG or JPG image');
    err.statusCode = 400;
    return cb(err);
  }
  if (file.mimetype !== expectedMime && file.mimetype !== 'application/octet-stream') {
    const err = new Error('File content does not match its extension');
    err.statusCode = 400;
    return cb(err);
  }
  cb(null, true);
};
const uploadLogo = multer({ storage: logoStorage, fileFilter: logoFileFilter, limits: { fileSize: 2 * 1024 * 1024 } });

async function getLogoRow() {
  const result = await pool.query('SELECT value, updated_at FROM system_settings WHERE key=$1', [LOGO_SETTING_KEY]);
  return result.rows[0] || null;
}
async function getLogoPath() {
  const row = await getLogoRow();
  return row?.value || null;
}

// Lightweight metadata check — frontend uses this to decide whether to render
// <img> (custom logo) or fall back to the built-in icon, so it never has to
// handle a broken-image state. `updatedAt` lets the frontend cache-bust the
// logo image URL (which is otherwise always the same constant path) whenever
// the logo is replaced.
router.get('/branding/logo-info', asyncHandler(async (req, res) => {
  const row = await getLogoRow();
  res.json({ hasLogo: !!row?.value, updatedAt: row?.updated_at || null });
}));

// Serves the actual current logo file bytes. Always the same URL regardless
// of which physical file is currently set — the frontend never needs to know
// the underlying filename.
router.get('/branding/logo', asyncHandler(async (req, res) => {
  const logoPath = await getLogoPath();
  if (!logoPath) return res.status(404).json({ message: 'No logo uploaded' });
  const fullPath = path.join(UPLOADS_DIR, path.basename(logoPath)); // basename strips any directory traversal
  if (!fs.existsSync(fullPath)) return res.status(404).json({ message: 'Logo file missing on disk' });
  res.sendFile(fullPath);
}));

router.post('/branding/logo', auth, requireGlobalAdmin, uploadLogo.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

  const previousLogoPath = await getLogoPath();
  const newLogoPath = `/uploads/${req.file.filename}`;

  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [LOGO_SETTING_KEY, JSON.stringify(newLogoPath)]
  );

  // Clean up the previous logo file so replacing it repeatedly doesn't leave
  // orphaned images accumulating in /uploads forever.
  if (previousLogoPath) {
    const oldFullPath = path.join(UPLOADS_DIR, path.basename(previousLogoPath));
    fs.unlink(oldFullPath, () => {}); // best-effort — fine if it's already gone
  }

  logAudit({ module: 'system_settings', action: 'update', recordId: LOGO_SETTING_KEY, userId: req.user.id, userRole: req.user.role, after: { logoPath: newLogoPath } });
  res.json({ success: true, hasLogo: true });
}));

router.delete('/branding/logo', auth, requireGlobalAdmin, asyncHandler(async (req, res) => {
  const previousLogoPath = await getLogoPath();
  await pool.query('DELETE FROM system_settings WHERE key=$1', [LOGO_SETTING_KEY]);
  if (previousLogoPath) {
    const oldFullPath = path.join(UPLOADS_DIR, path.basename(previousLogoPath));
    fs.unlink(oldFullPath, () => {});
  }
  logAudit({ module: 'system_settings', action: 'delete', recordId: LOGO_SETTING_KEY, userId: req.user.id, userRole: req.user.role });
  res.json({ success: true, hasLogo: false });
}));

// ── Editable app name (bilingual) ───────────────────────────────────────────
// Same system_settings key/value pattern as the logo above — one row holding
// both language variants as a JSON object. Public GET for the same reason as
// the logo: the name must render on the login page and print header before/
// without an authenticated session. null values mean "no override" — the
// frontend falls back to its own hardcoded default ("صحتنا عراق" / "SIHATUNA
// IRAQ") in that case, so clearing the setting fully restores today's behavior.
const APP_NAME_SETTING_KEY = 'app_name_override';

router.get('/branding/app-name', asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT value FROM system_settings WHERE key=$1', [APP_NAME_SETTING_KEY]);
  const val = result.rows[0]?.value || {};
  res.json({ nameAr: val.ar || null, nameEn: val.en || null });
}));

router.put('/branding/app-name', auth, requireGlobalAdmin, asyncHandler(async (req, res) => {
  const nameAr = (req.body.nameAr || '').trim();
  const nameEn = (req.body.nameEn || '').trim();
  if (!nameAr && !nameEn) {
    // Both blank — treat as a reset rather than storing an empty override.
    await pool.query('DELETE FROM system_settings WHERE key=$1', [APP_NAME_SETTING_KEY]);
    logAudit({ module: 'system_settings', action: 'delete', recordId: APP_NAME_SETTING_KEY, userId: req.user.id, userRole: req.user.role });
    return res.json({ success: true, nameAr: null, nameEn: null });
  }
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [APP_NAME_SETTING_KEY, JSON.stringify({ ar: nameAr, en: nameEn })]
  );
  logAudit({ module: 'system_settings', action: 'update', recordId: APP_NAME_SETTING_KEY, userId: req.user.id, userRole: req.user.role, after: { nameAr, nameEn } });
  res.json({ success: true, nameAr: nameAr || null, nameEn: nameEn || null });
}));

router.delete('/branding/app-name', auth, requireGlobalAdmin, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM system_settings WHERE key=$1', [APP_NAME_SETTING_KEY]);
  logAudit({ module: 'system_settings', action: 'delete', recordId: APP_NAME_SETTING_KEY, userId: req.user.id, userRole: req.user.role });
  res.json({ success: true, nameAr: null, nameEn: null });
}));

module.exports = router;
