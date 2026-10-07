// backend/routes/billingAnomalyRoutes.js
//
// كشف القيم المتطرفة بالمشتريات/الفوترة — صفحة مستقلة بالفرونت إند
// (BillingAnomalyPage.js). التحليل نفسه (POST /billing-anomaly/analyze)
// إحصائي حتمي بحت عبر agents/billingAnomalyAgent.js — بلا أي استدعاء AI
// وبلا حقل mode إطلاقاً؛ الشرح الاختياري بلغة بسيطة لعنصر واحد مُعلَّم
// (POST /billing-anomaly/explain) منفصل تماماً ويحترم aiProviderRouter.js
// (bot/online/offline) كبقية ميزات AI بالنظام.
const express = require('express');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const rateLimit = require('express-rate-limit');
const RedisRateLimitStore = require('../config/redisRateLimitStore');
const { skipInTest } = require('../config/rateLimiters');
const { logAudit } = require('../utils/auditLog');
const { getFeatureStatus } = require('../utils/aiProviderRouter');
const { detectAnomalies, explainAnomaly } = require('../agents/billingAnomalyAgent');

const router = express.Router();

// التحليل يمسح كامل جدول procurement بكل استدعاء — حد أعلى معقول يكفي
// للاستخدام الفعلي (تحديث الصفحة، إعادة تحليل بعد استيراد Excel) دون فتح
// الباب لإغراق الخادم باستعلامات متكررة بلا داعٍ.
const analyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: skipInTest,
  message: { message: 'عدد كبير جداً من طلبات تحليل الفوترة، حاول مرة أخرى بعد قليل' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('billing-anomaly'),
});
const explainLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: skipInTest,
  message: { message: 'عدد كبير جداً من طلبات الشرح، حاول مرة أخرى بعد قليل' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('billing-anomaly-explain'),
});

// حالة ميزة الشرح الاختياري بالذكاء الاصطناعي فقط (bot/online/offline) —
// لا علاقة لها بتوفر التحليل الإحصائي نفسه، المتاح دائماً بغض النظر عنها.
router.get('/billing-anomaly/status', auth, requirePermission('billing-anomaly'), async (req, res, next) => {
  try {
    res.json(await getFeatureStatus('billingAnomaly'));
  } catch (err) { next(err); }
});

router.post('/billing-anomaly/analyze', auth, requirePermission('billing-anomaly'), analyzeLimiter, async (req, res, next) => {
  try {
    const result = await detectAnomalies(req.user?.hospitalId || null);
    logAudit({
      module: 'billing-anomaly',
      action: 'analyze',
      userId: req.user.id,
      userRole: req.user.role,
      after: { totalRecordsAnalyzed: result.totalRecordsAnalyzed, totalFlagged: result.totalFlagged },
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/billing-anomaly/explain', auth, requirePermission('billing-anomaly'), explainLimiter, async (req, res, next) => {
  try {
    const { item, lang, mode } = req.body;
    if (!item || typeof item !== 'object' || !item.recordId) {
      return res.status(400).json({ message: 'بيانات العنصر المطلوب شرحه مفقودة' });
    }
    const result = await explainAnomaly(item, lang, mode);
    if (!result.available) return res.json({ available: false });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
