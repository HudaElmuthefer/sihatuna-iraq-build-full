// backend/routes/drugInteractionRoutes.js
//
// ── إصلاح: فحص تضارب دوائي حقيقي بدل جدول ثابت لـ5 تضاربات فقط ──────────────
// قبل هذا الملف، صفحة "التضارب الدوائي" كانت تطابق الأدوية المختارة مقابل
// مصفوفة ثابتة بـ5 أزواج تضارب معروفة مسبقاً بالكود — أي دواءين غير موجودين
// حرفياً بهذه القائمة الخمسة كانا يُعتبَران "آمنين" تلقائياً، بغض النظر عن
// وجود تضارب حقيقي بينهم أو لا.
//
// ── الجولة الثانية من الإصلاح: قاعدة بيانات (bot) أولاً، AI احتياطياً ───────
// نفس الخمسة تضاربات انتقلت لجدول drug_interactions الحقيقي بـPostgreSQL
// (راجع migrations-sql/008_drug_interactions.sql)، وصار الفحص الفعلي عبر
// agents/interactionAgent.js: يفحص الجدول أولاً لكل زوج أدوية (فوري، مجاني،
// يعمل حتى بدون أي مفتاح API)، ولا يستدعي AI إلا للأزواج غير الموجودة
// بالجدول. راجع شرح كامل بذاك الملف.
const express = require('express');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const rateLimit = require('express-rate-limit');
const RedisRateLimitStore = require('../config/redisRateLimitStore');
const { skipInTest } = require('../config/rateLimiters');
const { logAudit } = require('../utils/auditLog');
const { getFeatureStatus } = require('../utils/aiProviderRouter');
const { checkInteractions } = require('../agents/interactionAgent');

const router = express.Router();

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: skipInTest,
  message: { message: 'عدد كبير جداً من طلبات الفحص، حاول مرة أخرى بعد قليل' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('drug-interactions'),
});

// نفس نمط /ai-diagnosis/status — يخبر الفرونت إند فوراً هل الذكاء الاصطناعي
// الحقيقي متاح، لعرض تسمية صادقة بالواجهة من أول لحظة. ملاحظة: الفحص نفسه
// (POST /check أدناه) يبقى مفيداً جزئياً حتى لو available هنا false — طبقة
// قاعدة البيانات (bot) تعمل بمعزل تام عن توفّر AI.
router.get('/drug-interactions/status', auth, requirePermission('drug-interactions'), async (req, res, next) => {
  try {
    res.json(await getFeatureStatus('drugInteractions'));
  } catch (err) { next(err); }
});

router.post('/drug-interactions/check', auth, requirePermission('drug-interactions'), aiLimiter, async (req, res, next) => {
  try {
    const { drugs, lang, mode } = req.body;
    if (!Array.isArray(drugs) || drugs.length < 2) {
      return res.status(400).json({ message: 'يجب اختيار دوائين على الأقل' });
    }

    const result = await checkInteractions(drugs, lang, mode);

    if (!result.available) {
      return res.json({ available: false });
    }

    logAudit({ module: 'drug-interactions', action: 'check', userId: req.user.id, userRole: req.user.role, after: { drugsCount: drugs.length, source: result.source, provider: result.provider } });
    res.json({ available: true, source: result.source, provider: result.provider, incomplete: result.incomplete, interactions: result.interactions });
  } catch (err) { next(err); }
});

module.exports = router;
