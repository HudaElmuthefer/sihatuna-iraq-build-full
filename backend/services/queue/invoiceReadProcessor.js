// backend/services/queue/invoiceReadProcessor.js
//
// منطق معالجة مهمة "قراءة فاتورة" واحدة — مُستخرَج من ocrWorker.js لملف
// منفصل بلا أي اعتماد على BullMQ نفسه، حتى تستطيع tests/invoiceReadProcessor
// .test.js تختبره مباشرة (استدعاء دالة عادية) بدل الاضطرار لتشغيل BullMQ
// Worker حقيقي (يفتح اتصال Redis فوراً عند التحميل — راجع ocrWorker.js).
const { routeImageCall } = require('../../utils/aiProviderRouter');
const { extractText } = require('../../agents/ocrAgent');
const { logAudit } = require('../../utils/auditLog');
const { devLog } = require('../../utils/logger');

const SYSTEM_PROMPT_AR = 'أنت نظام استخراج بيانات فواتير دقيق لنظام مستشفى إلكتروني. اقرأ صورة الفاتورة المرفقة (ومعها نص استخراج ضوئي (OCR) أولي كمرجع مساعد فقط — قد يحتوي أخطاء، والصورة نفسها هي المصدر الأدق)، واستخرج البيانات بدقة. لو حقل غير واضح أو غير موجود، اتركه فارغاً (null) — لا تخمّن قيمة. أجب فقط بصيغة JSON صالحة مطابقة تماماً للمخطط المطلوب، بدون Markdown وبدون أي نص إضافي خارج الـ JSON.';

const RESULT_SCHEMA_AR = `{
  "vendorName": "اسم المورد/الشركة",
  "invoiceNumber": "رقم الفاتورة",
  "invoiceDate": "YYYY-MM-DD",
  "items": [
    { "name": "اسم الصنف", "quantity": 0, "unitPrice": 0, "total": 0 }
  ],
  "subtotal": 0,
  "tax": 0,
  "grandTotal": 0,
  "confidence": "high|medium|low"
}`;

// ── OCR (PaddleOCR) كخطوة تمهيدية، وليس بديلاً عن الصورة ──────────────────────
// نص PaddleOCR يُرفق كسياق إضافي مساعد فقط، والصورة الأصلية تبقى تُرسَل
// كاملة لـGemini (رؤية) كمصدر أساسي دقيق — قرار مقصود بعد نقاش صريح لأن جودة
// PaddleOCR بالعربية أضعف بكثير من قراءة Gemini المباشرة للصورة (خط يد،
// فواتير مموّهة، جودة تصوير متفاوتة...)، فالاعتماد على نص OCR وحده كان
// سيُضعف الدقة الحالية لا يحسّنها (راجع agents/ocrAgent.js للشرح الكامل).
// لو تعذّر تشغيل PaddleOCR أصلاً، نكمل بلا نص OCR إطلاقاً (fail-open) —
// الصورة وحدها تكفي تماماً، بما يطابق سلوك النظام قبل هذه الإضافة حرفياً.
function buildUserPrompt(ocrText) {
  const ocrSection = ocrText
    ? `نص استخراج ضوئي (OCR) أولي للفاتورة (مرجع مساعد فقط، قد يحتوي أخطاء — اعتمد على الصورة نفسها للدقة):\n"""\n${ocrText}\n"""\n\n`
    : '';
  return `${ocrSection}اقرأ صورة الفاتورة المرفقة واستخرج:\n${RESULT_SCHEMA_AR}`;
}

async function processInvoiceReadJob(jobData) {
  const { imageBase64, mimeType, userId, userRole, mode } = jobData;

  const ocrResult = await extractText(imageBase64);
  if (!ocrResult.available) {
    devLog(`ℹ️  [ocr-worker] PaddleOCR غير متاح (${ocrResult.error}) — نكمل بالصورة وحدها`);
  }

  const userPrompt = buildUserPrompt(ocrResult.available ? ocrResult.text : null);
  // routeImageCall تقرأ اختيار المستخدم المحفوظ (bot/online/offline) وتوزّع
  // الاستدعاء تبعاً له، أو تستخدم mode (اختيار هذا الطلب تحديداً من واجهة
  // الصفحة) لو وصل — راجع utils/aiProviderRouter.js.
  const result = await routeImageCall('invoiceReader', SYSTEM_PROMPT_AR, userPrompt, imageBase64, mimeType, mode);

  if (result.available) {
    logAudit({ module: 'invoice-reader', action: 'read', userId, userRole, after: { provider: result.provider, itemsCount: result.parsed?.items?.length || 0, ocrUsed: ocrResult.available } });
  } else if (result.error) {
    // فشل استدعاء AI نفسه (لا مزوّد مُعدّ، أو خطأ بالاستدعاء) — لا نرمي
    // استثناء يُعيد المحاولة عبثاً (سيفشل بنفس السبب مرة أخرى غالباً)، بل
    // نرجع النتيجة كما هي؛ مسار الاستعلام (GET /invoice-reader/jobs/:id)
    // يتعامل مع available:false بنفس الطريقة المعتادة أصلاً بكل ميزات
    // الذكاء الاصطناعي بهذا النظام.
    console.error(`⚠️  [ocr-worker] فشل استدعاء ${result.provider}:`, result.error);
  }
  return result;
}

module.exports = { processInvoiceReadJob, buildUserPrompt };
