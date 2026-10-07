// backend/routes/backupsRoutes.js
//
// مسارات النسخ الاحتياطي وسجل التدقيق (Audit Log).
//
// ── إصلاح أمني ────────────────────────────────────────────────────────────
// كل هذه المسارات تتطلب **إدمن عام (مستوى الوزارة)** حصراً، وليس أي إدمن —
// ملف نسخة احتياطية واحد يحوي بيانات *كل* المنشآت مع بعض (نسخة PostgreSQL
// الكاملة عبر pg_dump)، فلا معنى لتفويض الوصول له أو لاستعادته لإدمن محلي
// مرتبط بمنشأة واحدة (كان يستطيع نظرياً استعادة نسخة قديمة تمسح تعديلات
// حديثة بمنشآت ثانية غيره بالكامل). نفس المنطق ينطبق على سجل التدقيق الشامل
// — راجع middleware/requireGlobalAdmin.js.
//
// ── إضافة: POST /backups/run يقبل الآن destination اختياري بجسم الطلب ──────
// { destination: 'pgadmin' | 'computer' | 'cloud', cloudUrl?: string }
// بدون destination (أو الاستدعاء القديم بلا جسم)، يعمل تماماً كما كان —
// نسخة محلية عادية، بدون أي تغيير بالسلوك الحالي.
const express = require('express');
const fs = require('fs');
const asyncHandler = require('../middleware/asyncHandler');
const auth = require('../middleware/auth');
const requireGlobalAdmin = require('../middleware/requireGlobalAdmin');
const { listBackups, restoreFromBackup, runBackup, runBackupWithDestination } = require('../utils/backup');
const { logAudit, AUDIT_LOG_PATH } = require('../utils/auditLog');

const router = express.Router();

// ── BACKUPS ──────────────────────────────────────────────────────────────────
router.get('/backups', auth, requireGlobalAdmin, (req, res) => {
  res.json(listBackups());
});

router.post('/backups/run', auth, requireGlobalAdmin, asyncHandler(async (req, res) => {
  const { destination, cloudUrl } = req.body || {};

  // بدون وجهة محددة: نفس السلوك القديم تماماً (نسخة محلية عادية)
  if (!destination) {
    await runBackup();
    logAudit({ module: 'system', action: 'manual_backup', userId: req.user.id, userRole: req.user.role });
    return res.json({ success: true, backups: listBackups() });
  }

  const result = await runBackupWithDestination(destination, cloudUrl);
  logAudit({
    module: 'system',
    action: 'manual_backup',
    userId: req.user.id,
    userRole: req.user.role,
    after: { destination },
  });

  if (result.type === 'computer') {
    return res.download(result.sqlFilePath, 'sihatuna_backup.sql');
  }

  const messages = {
    pgadmin: 'تم إنشاء النسخة الاحتياطية بنجاح، جاهزة للفتح من pgAdmin',
    cloud: 'تم إنشاء النسخة الاحتياطية ورفعها على الكلاود بنجاح',
  };

  res.json({ success: true, message: messages[result.type], backups: listBackups() });
}));

router.post('/backups/:name/restore', auth, requireGlobalAdmin, (req, res) => {
  try {
    restoreFromBackup(req.params.name);
    logAudit({ module: 'system', action: 'restore_backup', userId: req.user.id, userRole: req.user.role, after: { backupName: req.params.name } });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
// GET /api/audit-log?module=patients&limit=100  (للإدمن العام فقط)
router.get('/audit-log', auth, requireGlobalAdmin, (req, res) => {
  if (!fs.existsSync(AUDIT_LOG_PATH)) return res.json([]);
  let log = JSON.parse(fs.readFileSync(AUDIT_LOG_PATH, 'utf8'));
  const { module, action, userId, limit } = req.query;
  if (module) log = log.filter(e => e.module === module);
  if (action) log = log.filter(e => e.action === action);
  if (userId) log = log.filter(e => String(e.userId) === String(userId));
  log = log.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(log.slice(0, Number(limit) || 200));
});

module.exports = router;
