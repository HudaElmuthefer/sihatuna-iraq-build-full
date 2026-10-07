// backend/routes/invoiceReaderRoutes.js
//
// AI Invoice Reader — matches a feature seen in a competing Iraqi hospital
// system (المنصة الطبية العراقية). Lets staff photograph or upload a
// paper invoice (from a supplier, pharmacy delivery, etc.) instead of
// typing every line item manually — the AI reads the image and returns
// structured data (vendor, invoice number, date, line items, total) to
// pre-fill the request form.
//
// Uses the same Gemini-first/Claude-fallback provider already configured
// for AI diagnosis (see utils/aiProvider.js) — no new API key needed if
// GEMINI_API_KEY is already set in .env.
//
// ── المرحلة الثانية: معالجة خلفية عبر BullMQ ─────────────────────────────────
// استدعاء AI فعلياً (Gemini/Claude) لقراءة صورة قد يأخذ عدة ثوانٍ — POST
// /invoice-reader/read كان يُبقي طلب HTTP معلَّقاً طوال هذه المدة (يحجز
// worker من Express بلا فائدة حقيقية). الآن يُضيف مهمة لطابور
// services/queue/ocrQueue.js ويرجع فوراً برقم مهمة (jobId، 202 Accepted)؛
// الفرونت إند يستعلم دورياً عن حالتها عبر GET /invoice-reader/jobs/:id
// (راجع frontend/src/pages/ProcurementPage.js). المعالجة الفعلية تتم
// بعملية Worker منفصلة تماماً — راجع services/queue/ocrWorker.js.
const express = require('express');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const rateLimit = require('express-rate-limit');
const RedisRateLimitStore = require('../config/redisRateLimitStore');
const { skipInTest } = require('../config/rateLimiters');
const { getFeatureStatus } = require('../utils/aiProviderRouter');
const { enqueueInvoiceReadJob, getJobStatus } = require('../services/queue/ocrQueue');

const router = express.Router();

const invoiceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: skipInTest,
  message: { message: 'عدد كبير جداً من طلبات قراءة الفواتير، حاول مرة أخرى بعد قليل' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('invoice-reader'),
});

// راجع utils/aiProviderRouter.js — يعكس الوضع المُختار فعلياً (bot/online/
// offline) بدل افتراض Gemini/Claude دائماً كما كان سابقاً.
router.get('/invoice-reader/status', auth, async (req, res, next) => {
  try {
    res.json(await getFeatureStatus('invoiceReader'));
  } catch (err) { next(err); }
});

// ملاحظة: بنية استخراج البيانات (system/user prompt، مخطط JSON المتوقَّع)
// انتقلت لـservices/queue/invoiceReadProcessor.js — الآن تشمل خطوة OCR
// (PaddleOCR) تمهيدية قبل استدعاء AI، تعمل داخل مهمة الطابور نفسها (راجع
// شرح كامل هناك)، فلم يعد ممكناً بناء الـprompt النهائي هنا وقت استلام
// الطلب (يحتاج نص OCR غير متوفر إلا بعد تشغيل تلك الخطوة داخل الـWorker).

router.post('/invoice-reader/read', auth, requirePermission('procurement'), invoiceLimiter, async (req, res, next) => {
  try {
    const { image, mimeType, mode } = req.body;
    if (!image) return res.status(400).json({ message: 'الصورة مطلوبة' });

    // The frontend sends a data URL (data:image/jpeg;base64,....) — strip
    // the prefix, since the AI providers only want the raw base64 payload.
    const base64 = image.includes(',') ? image.split(',')[1] : image;
    const detectedMimeType = mimeType || (image.match(/^data:(.+?);base64,/) || [])[1] || 'image/jpeg';

    let jobId;
    try {
      jobId = await enqueueInvoiceReadJob({
        imageBase64: base64,
        mimeType: detectedMimeType,
        userId: req.user.id,
        userRole: req.user.role,
        mode,
      });
    } catch (err) {
      // تعذّر الوصول لطابور المعالجة (Redis غير متاح) — نفس التسمية الصادقة
      // "غير مُفعَّل" المستخدمة أصلاً لو مزوّد الذكاء الاصطناعي نفسه غير
      // مُعدّ، بدل خطأ 500 مربك لموظف يحاول قراءة فاتورة.
      console.error('⚠️  [invoice-reader] تعذّر إضافة مهمة لطابور المعالجة (Redis):', err.message);
      return res.json({ available: false });
    }

    res.status(202).json({ jobId });
  } catch (err) { next(err); }
});

// GET /api/invoice-reader/jobs/:id — يستعلم الفرونت إند دورياً عن حالة مهمة
// قراءة فاتورة أُنشئت بـPOST /invoice-reader/read أعلاه، لحد اكتمالها.
router.get('/invoice-reader/jobs/:id', auth, requirePermission('procurement'), async (req, res, next) => {
  try {
    const status = await getJobStatus(req.params.id);
    if (!status) return res.status(404).json({ message: 'المهمة غير موجودة (ربما انتهت صلاحيتها أو رقمها خاطئ)' });

    if (status.state === 'completed') {
      const result = status.result;
      if (!result?.available) return res.json({ state: 'completed', available: false });
      return res.json({ state: 'completed', available: true, provider: result.provider, ...result.parsed });
    }
    if (status.state === 'failed') {
      return res.json({ state: 'failed', available: false, error: status.error });
    }
    // waiting / active / delayed — الفرونت إند يستمر بالاستعلام
    res.json({ state: status.state });
  } catch (err) { next(err); }
});

module.exports = router;
