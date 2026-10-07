// backend/routes/aiProviderSettingsRoutes.js
//
// إدارة اختيار مزوّد الذكاء الاصطناعي لكل ميزة (بوت/إنترنت/محلي) — راجع
// utils/aiProviderRouter.js لمنطق التوزيع الفعلي. GET متاح لأي مستخدم
// مسجّل دخول (صفحات قراءة الفواتير/التضارب الدوائي/الوصفات تحتاج معرفة
// الاختيار الحالي لعرض تسمية صادقة، بغض النظر عن دور المستخدم).
//
// ── إصلاح أمني ────────────────────────────────────────────────────────────
// PUT كان يتطلب requireAdmin العام (أي مستوى إدمن، بما فيه إدمن مستشفى واحد
// محلي) — لكن هذا الإعداد صف واحد عالمي بـsystem_settings بلا أي تصفية
// hospitalId إطلاقاً (راجع getSettings/setSettings بـutils/
// aiProviderRouter.js). يعني إدمن مستشفى واحد محلي كان يستطيع تغيير مزوّد
// الذكاء الاصطناعي (حتى تعطيله بالكامل) لكل المستشفيات الأخرى بنفس النظام
// دون علمها أو موافقتها. الآن requireGlobalAdmin (إدمن عام مستوى الوزارة)
// حصراً — نفس المستوى المطلوب لأي إعداد يؤثر على كل المستشفيات، تماماً
// مثل PUT /system-settings/:key بـhospitalsRoutes.js وgitUpdateRoutes.js.
const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const auth = require('../middleware/auth');
const requireGlobalAdmin = require('../middleware/requireGlobalAdmin');
const { getSettings, setSettings } = require('../utils/aiProviderRouter');
const { logAudit } = require('../utils/auditLog');

const router = express.Router();

router.get('/ai-provider-settings', auth, asyncHandler(async (req, res) => {
  const settings = await getSettings();
  res.json(settings);
}));

router.put('/ai-provider-settings', auth, requireGlobalAdmin, asyncHandler(async (req, res) => {
  const updated = await setSettings(req.body || {});
  logAudit({ module: 'ai-provider-settings', action: 'update', userId: req.user.id, userRole: req.user.role, after: updated });
  res.json(updated);
}));

module.exports = router;
