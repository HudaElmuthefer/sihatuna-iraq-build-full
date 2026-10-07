// backend/routes/inventoryPredictionRoutes.js
//
// توقّع استهلاك المخزون — صفحة مستقلة بالفرونت إند (InventoryPredictionPage
// .js). التحليل نفسه (POST /inventory-prediction/analyze) إحصائي حتمي بحت
// عبر agents/inventoryPredictionAgent.js — بلا أي استدعاء AI وبلا حقل mode
// إطلاقاً؛ الملاحظة الاختيارية بلغة بسيطة عن اتجاه صنف واحد (POST
// /inventory-prediction/explain) منفصلة تماماً وتحترم aiProviderRouter.js
// (bot/online/offline) كبقية ميزات AI بالنظام. نفس نمط
// billingAnomalyRoutes.js بالضبط.
const express = require('express');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const rateLimit = require('express-rate-limit');
const RedisRateLimitStore = require('../config/redisRateLimitStore');
const { skipInTest } = require('../config/rateLimiters');
const { logAudit } = require('../utils/auditLog');
const { getFeatureStatus } = require('../utils/aiProviderRouter');
const { predictInventory, explainTrend } = require('../agents/inventoryPredictionAgent');

const router = express.Router();

const analyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: skipInTest,
  message: { message: 'عدد كبير جداً من طلبات تحليل المخزون، حاول مرة أخرى بعد قليل' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('inventory-prediction'),
});
const explainLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: skipInTest,
  message: { message: 'عدد كبير جداً من طلبات الشرح، حاول مرة أخرى بعد قليل' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('inventory-prediction-explain'),
});

// حالة ميزة الملاحظة الاختيارية بالذكاء الاصطناعي فقط (bot/online/offline)
// — لا علاقة لها بتوفر التحليل الإحصائي نفسه، المتاح دائماً بغض النظر عنها.
router.get('/inventory-prediction/status', auth, requirePermission('inventory-prediction'), async (req, res, next) => {
  try {
    res.json(await getFeatureStatus('inventoryPrediction'));
  } catch (err) { next(err); }
});

router.post('/inventory-prediction/analyze', auth, requirePermission('inventory-prediction'), analyzeLimiter, async (req, res, next) => {
  try {
    const { bufferDays } = req.body || {};
    const result = await predictInventory(req.user?.hospitalId || null, bufferDays);
    logAudit({
      module: 'inventory-prediction',
      action: 'analyze',
      userId: req.user.id,
      userRole: req.user.role,
      after: { totalItemsAnalyzed: result.totalItemsAnalyzed, itemsWithData: result.itemsWithData, reorderBufferDays: result.reorderBufferDays },
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/inventory-prediction/explain', auth, requirePermission('inventory-prediction'), explainLimiter, async (req, res, next) => {
  try {
    const { item, lang, mode } = req.body;
    if (!item || typeof item !== 'object' || !item.itemId) {
      return res.status(400).json({ message: 'بيانات الصنف المطلوب شرحه مفقودة' });
    }
    const result = await explainTrend(item, lang, mode);
    if (!result.available) return res.json({ available: false });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
