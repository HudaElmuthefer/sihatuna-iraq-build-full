// backend/routes/gitUpdateRoutes.js
//
// Stage 4: git-based differential update system. Same access restriction as
// the code backup routes (requireGlobalAdmin) — an update affects the whole
// codebase for every hospital, not something a local hospital admin should
// be able to trigger.
//
// system_settings only stores what git itself doesn't track: when updates
// were last checked, and the commit recorded immediately before the last
// install (so "Rollback" still works after the restart the install itself
// triggers). The update source path/URL is NOT duplicated here — see
// utils/gitUpdate.js's module comment for why the git remote config is kept
// as the single source of truth for that.
const express = require('express');
const { execFile } = require('child_process');
const asyncHandler = require('../middleware/asyncHandler');
const auth = require('../middleware/auth');
const requireGlobalAdmin = require('../middleware/requireGlobalAdmin');
const { pool } = require('../config/database');
const { logAudit } = require('../utils/auditLog');
const {
  DEFAULT_PROJECT_ROOT,
  configureUpdateSource,
  getUpdateSource,
  getCurrentCommit,
  getCurrentBranch,
  checkForUpdates,
  installUpdate,
  rollbackToCommit,
} = require('../utils/gitUpdate');

const router = express.Router();

const LAST_CHECK_KEY = 'git_update_last_check';
const LAST_INSTALL_KEY = 'git_update_last_install';

async function getSetting(key) {
  const result = await pool.query('SELECT value FROM system_settings WHERE key=$1', [key]);
  return result.rows[0]?.value || null;
}
async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

// Restarting the very process that answered this request has to happen
// AFTER the HTTP response is flushed, or the client never sees it — the
// route handlers below call this once res.json() has already been sent,
// with a short delay to be safe. `pm2 restart ecosystem.config.js` talks to
// the separate PM2 daemon over IPC, so it doesn't depend on this process
// staying alive to complete.
function scheduleRestart() {
  setTimeout(() => {
    execFile('pm2', ['restart', 'ecosystem.config.js'], { cwd: DEFAULT_PROJECT_ROOT }, (err) => {
      if (err) console.error('⚠️  PM2 restart after update failed — restart manually:', err.message);
      else console.log('🔄 PM2 restart triggered after update.');
    });
  }, 1000);
}

router.get('/git-update/status', auth, requireGlobalAdmin, asyncHandler(async (req, res) => {
  const [source, currentCommit, currentBranch, lastCheck, lastInstall] = await Promise.all([
    getUpdateSource(),
    getCurrentCommit(),
    getCurrentBranch(),
    getSetting(LAST_CHECK_KEY),
    getSetting(LAST_INSTALL_KEY),
  ]);
  res.json({ source, currentCommit, currentBranch, lastCheck, lastInstall });
}));

router.put('/git-update/source', auth, requireGlobalAdmin, asyncHandler(async (req, res) => {
  const { sourcePath } = req.body;
  try {
    const result = await configureUpdateSource(sourcePath);
    logAudit({ module: 'system_settings', action: 'update', recordId: 'git_update_source', userId: req.user.id, userRole: req.user.role, after: { sourcePath: result.sourcePath } });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}));

router.post('/git-update/check', auth, requireGlobalAdmin, asyncHandler(async (req, res) => {
  try {
    const result = await checkForUpdates();
    await setSetting(LAST_CHECK_KEY, { checkedAt: new Date().toISOString(), ...result });
    res.json(result);
  } catch (err) {
    const status = err.code === 'NO_SOURCE' ? 400 : err.code === 'UNREACHABLE' ? 502 : 500;
    res.status(status).json({ message: err.message, code: err.code });
  }
}));

router.post('/git-update/install', auth, requireGlobalAdmin, asyncHandler(async (req, res) => {
  try {
    const result = await installUpdate();
    if (!result.alreadyUpToDate) {
      await setSetting(LAST_INSTALL_KEY, { installedAt: new Date().toISOString(), ...result });
      logAudit({ module: 'system', action: 'git_update_install', userId: req.user.id, userRole: req.user.role, after: { beforeCommit: result.beforeCommit, afterCommit: result.afterCommit, filesChanged: result.filesChanged.length } });
    }
    res.json(result);
    if (!result.alreadyUpToDate) scheduleRestart();
  } catch (err) {
    const status = err.code === 'NO_SOURCE' ? 400 : err.code === 'UNREACHABLE' ? 502 : err.code === 'DIRTY_TREE' ? 409 : 500;
    res.status(status).json({ message: err.message, code: err.code, files: err.files });
  }
}));

router.post('/git-update/rollback', auth, requireGlobalAdmin, asyncHandler(async (req, res) => {
  const lastInstall = await getSetting(LAST_INSTALL_KEY);
  if (!lastInstall?.beforeCommit) {
    return res.status(400).json({ message: 'No recorded install to roll back to.' });
  }
  try {
    const result = await rollbackToCommit(lastInstall.beforeCommit);
    logAudit({ module: 'system', action: 'git_update_rollback', userId: req.user.id, userRole: req.user.role, after: { rolledBackTo: result.rolledBackTo } });
    await setSetting(LAST_INSTALL_KEY, null);
    res.json(result);
    scheduleRestart();
  } catch (err) {
    res.status(400).json({ message: err.message, code: err.code });
  }
}));

module.exports = router;
