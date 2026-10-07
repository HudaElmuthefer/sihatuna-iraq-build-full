// backend/utils/auditLog.js
//
// يسجل تلقائياً كل عملية إضافة/تعديل/حذف على أي موديول حساس: من قام بها، وماذا
// تغيّر، ومتى. استُخرجت من server.js لتصغيره وتسهيل استخدامها من أي ملف
// مسارات (routes/*) بدون تكرار.
//
// ── إصلاح: مسار قابل للتخصيص (نفس نمط DB_PATH وREVOKED_TOKENS_PATH) ──────────
// قبل هذا، المسار كان ثابتاً دائماً (backend/data/audit-log.json)، بعكس
// DB_PATH وREVOKED_TOKENS_PATH اللذين صارا قابلين للتخصيص عبر متغير بيئة لعزل
// بيانات الاختبارات الآلية عن البيانات الحقيقية. النتيجة: أي تشغيل تجريبي
// للسيرفر (حتى اختبار يدوي بسيط عبر curl) كان يكتب مباشرة فوق سجل التدقيق
// *الحقيقي* بالمشروع دون قصد.
const fs = require('fs');
const path = require('path');

const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH || path.join(__dirname, '..', 'data', 'audit-log.json');
const MAX_AUDIT_ENTRIES = 5000; // نحافظ على حجم الملف معقول

const logAudit = (entry) => {
  try {
    let log = [];
    if (fs.existsSync(AUDIT_LOG_PATH)) {
      log = JSON.parse(fs.readFileSync(AUDIT_LOG_PATH, 'utf8'));
    }
    log.push({
      id: log.length > 0 ? log[log.length - 1].id + 1 : 1,
      timestamp: new Date().toISOString(),
      ...entry,
    });
    if (log.length > MAX_AUDIT_ENTRIES) log = log.slice(log.length - MAX_AUDIT_ENTRIES);
    fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
  } catch (err) {
    console.error('⚠️  Failed to write audit log:', err.message);
  }
};

module.exports = { logAudit, AUDIT_LOG_PATH };
