// backend/routes/dosageRoutes.js
//
// فحص الجرعة الآمنة — صفحة مستقلة تماماً بالفرونت إند (DosageCheckPage.js،
// لا علاقة بصفحة الصيدلية أو قارئ الوصفات إطلاقاً — قرار صريح بمحادثة
// التخطيط). نفس نمط drugInteractionRoutes.js بالضبط: قاعدة بيانات (bot)
// أولاً عبر agents/dosageAgent.js، AI احتياطياً فقط لو الدواء/النطاق غير
// موجود بجدول dosage_limits — راجع migrations-sql/009_dosage_limits.sql.
const express = require('express');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const rateLimit = require('express-rate-limit');
const RedisRateLimitStore = require('../config/redisRateLimitStore');
const { skipInTest } = require('../config/rateLimiters');
const { logAudit } = require('../utils/auditLog');
const { getFeatureStatus } = require('../utils/aiProviderRouter');
const { checkDosage } = require('../agents/dosageAgent');

const router = express.Router();

const dosageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: skipInTest,
  message: { message: 'عدد كبير جداً من طلبات فحص الجرعات، حاول مرة أخرى بعد قليل' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('dosage-check'),
});

// نفس نمط /drug-interactions/status — يخبر الفرونت إند فوراً هل الذكاء
// الاصطناعي الحقيقي متاح، لعرض تسمية صادقة من أول لحظة (وضع 'bot' يبقى
// "متاح" دائماً — طبقة قاعدة البيانات تعمل بمعزل تام عن توفّر AI).
router.get('/dosage-check/status', auth, requirePermission('dosage-check'), async (req, res, next) => {
  try {
    res.json(await getFeatureStatus('dosageValidation'));
  } catch (err) { next(err); }
});

router.post('/dosage-check/check', auth, requirePermission('dosage-check'), dosageLimiter, async (req, res, next) => {
  try {
    const { drugName, dose, unit, ageYears, weightKg, lang, mode } = req.body;

    if (!drugName || typeof drugName !== 'string' || !drugName.trim()) {
      return res.status(400).json({ message: 'اسم الدواء مطلوب' });
    }
    const doseNum = Number(dose);
    if (!Number.isFinite(doseNum) || doseNum <= 0) {
      return res.status(400).json({ message: 'الجرعة مطلوبة ويجب أن تكون رقماً موجباً' });
    }
    const ageNum = ageYears != null && ageYears !== '' ? Number(ageYears) : null;
    const weightNum = weightKg != null && weightKg !== '' ? Number(weightKg) : null;
    if (ageNum != null && !Number.isFinite(ageNum)) {
      return res.status(400).json({ message: 'العمر يجب أن يكون رقماً صالحاً' });
    }
    if (weightNum != null && !Number.isFinite(weightNum)) {
      return res.status(400).json({ message: 'الوزن يجب أن يكون رقماً صالحاً' });
    }
    // ── يجب توفر عمر أو وزن واحد على الأقل ────────────────────────────────────
    // بدون أي منهما، لا معنى لمطابقة أي نطاق بجدول dosage_limits (كل صف
    // كان سيبدو "متطابقاً" بالخطأ — راجع شرح findDbMatch بـdosageAgent.js)،
    // وحتى فحص AI الاحتياطي يحتاج معلومة مريض أساسية ليعطي رأياً ذا معنى.
    if (ageNum == null && weightNum == null) {
      return res.status(400).json({ message: 'العمر أو الوزن مطلوب (واحد منهما على الأقل) لفحص الجرعة' });
    }

    const result = await checkDosage(drugName.trim(), doseNum, unit || 'mg', ageNum, weightNum, lang, mode);

    if (!result.available) {
      return res.json({ available: false });
    }

    logAudit({
      module: 'dosage-check',
      action: 'check',
      userId: req.user.id,
      userRole: req.user.role,
      after: { drugName: drugName.trim(), dose: doseNum, unit: unit || 'mg', source: result.source, status: result.status },
    });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
