// backend/routes/codeBackupRoutes.js
//
// Source code backup — separate feature from routes/backupsRoutes.js (which
// handles the data backup: db.json/audit-log.json/postgres_backup.sql). This
// zips the frontend/ and backend/ source folders instead (see utils/codeBackup.js).
//
// Same access restriction as the data backup routes: global admin only
// (requireGlobalAdmin) — a code backup zip reflects the whole codebase, not
// something scoped to a single hospital, so a local hospital admin has no
// legitimate reason to trigger or download one.
const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const auth = require('../middleware/auth');
const requireGlobalAdmin = require('../middleware/requireGlobalAdmin');
const { createCodeBackup, listCodeBackups, getCodeBackupPath } = require('../utils/codeBackup');
const { logAudit } = require('../utils/auditLog');

const router = express.Router();

router.get('/code-backups', auth, requireGlobalAdmin, (req, res) => {
  res.json(listCodeBackups());
});

router.post('/code-backups/run', auth, requireGlobalAdmin, asyncHandler(async (req, res) => {
  const filename = await createCodeBackup();
  logAudit({ module: 'system', action: 'manual_code_backup', userId: req.user.id, userRole: req.user.role, after: { filename } });
  res.json({ success: true, filename, backups: listCodeBackups() });
}));

router.get('/code-backups/:name/download', auth, requireGlobalAdmin, (req, res) => {
  try {
    const filePath = getCodeBackupPath(req.params.name);
    res.download(filePath, req.params.name);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
