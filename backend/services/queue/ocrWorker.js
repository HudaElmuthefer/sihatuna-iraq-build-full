// backend/services/queue/ocrWorker.js
//
// عملية استهلاك طابور قراءة الفواتير (OCR/AI) — تُشغَّل كعملية PM2 منفصلة
// تماماً عن الخادم الرئيسي (sihatuna-backend)، راجع ecosystem.config.js
// ("sihatuna-worker"). تُشغَّل مباشرة بـnode services/queue/ocrWorker.js.
//
// ── لماذا عملية منفصلة، لا داخل نفس عمليات Express (cluster mode)؟ ──────────
// 1) sihatuna-backend يعمل بـinstances:'max' (عملية واحدة لكل نواة معالج) —
//    لو شغّلنا Worker داخل كل عملية منها، صار عدد معالجات الطابور المتزامنة
//    يساوي عدد الأنوية تلقائياً بلا أي ضبط مقصود، ويتغيّر مع كل تغيير بعدد
//    الأنوية أو خطة الاستضافة — سلوك غير متوقَّع وصعب ضبطه أو تتبّعه.
// 2) عزل الأعطال: تعليق أو انهيار معالجة مهمة واحدة (مثلاً استجابة AI غريبة
//    الشكل، أو استدعاء شبكة عالق) لا يجب أن يؤثر على استقرار خادم HTTP
//    الرئيسي — وعكسه أيضاً: إعادة تشغيل الخادم الرئيسي بعد نشر تحديث لا يجب
//    أن يقطع مهمة معالجة جارية بمنتصفها.
// 3) دورة حياة/سياسة إعادة تشغيل مختلفة منطقياً: خادم HTTP يجب أن يبقى يعمل
//    دائماً بأقصى استقرار ممكن، بينما عملية Worker يمكن تحمّل توقف قصير أو
//    إعادة تشغيل أكثر تكراراً دون أثر ملموس على المستخدمين (المهام تبقى
//    بالطابور وتُعالَج فور عودته، بفضل ثبات BullMQ بـRedis).
// نفس فلسفة "عملية واحدة مخصَّصة لمهمة خلفية" المطبَّقة فعلياً بحارس
// NODE_APP_INSTANCE=='0' لخادم HL7 والنسخ الاحتياطي بserver.js — هنا بمستوى
// أوضح (عملية PM2 كاملة منفصلة بدل شرط داخل نفس العملية)، لأن BullMQ أصلاً
// مصمَّم ليعمل كعملية Worker مستقلة.
require('dotenv').config();
const { Worker } = require('bullmq');
const { createQueueConnection } = require('./queueConnection');
const { QUEUE_NAME } = require('./ocrQueue');
const { processInvoiceReadJob } = require('./invoiceReadProcessor');
const { processPrescriptionReadJob } = require('./prescriptionReadProcessor');
const { devLog } = require('../../utils/logger');

// يوزّع كل مهمة لمعالجها الصحيح حسب اسمها (راجع ocrQueue.js: 'read-invoice'
// مقابل 'read-prescription' — طابور واحد، معالجان مختلفان).
function processJob(job) {
  if (job.name === 'read-prescription') return processPrescriptionReadJob(job.data);
  return processInvoiceReadJob(job.data);
}

// عدد المهام المتزامنة داخل عملية Worker الوحيدة هذه: استدعاء AI عملية
// I/O-bound أساساً (تنتظر رد شبكة من Gemini/Anthropic)، وليست عملية تستهلك
// معالج (CPU-bound) — فمعالجة عدة مهام متزامنة بنفس العملية آمنة وفعّالة هنا
// (Node.js تدير انتظار عدة طلبات شبكة غير متزامنة بكفاءة بنفس الوقت)، بعكس
// لو كانت المهمة تفريغ صور كبيرة أو ضغط ملفات (CPU-bound فعلياً، تحتاج
// عمليات منفصلة حقيقية بدل تزامن داخل نفس العملية). خطوة PaddleOCR نفسها
// CPU-bound فعلاً، لكنها تعمل بعملية Python منفصلة تماماً (راجع
// agents/ocrAgent.js) — لا تحجب حلقة أحداث Node هنا إطلاقاً.
const CONCURRENCY = parseInt(process.env.OCR_WORKER_CONCURRENCY, 10) || 3;

const worker = new Worker(
  QUEUE_NAME,
  async (job) => processJob(job),
  { connection: createQueueConnection(), concurrency: CONCURRENCY }
);

worker.on('completed', (job) => devLog(`✅ [ocr-worker] مهمة ${job.id} اكتملت`));
worker.on('failed', (job, err) => console.error(`⚠️  [ocr-worker] مهمة ${job?.id} فشلت:`, err.message));
worker.on('error', (err) => console.error('⚠️  [ocr-worker] خطأ اتصال Redis:', err.message));

devLog(`🟢 [ocr-worker] جاهز، يستهلك طابور "${QUEUE_NAME}" (تزامن: ${CONCURRENCY})`);

// إغلاق نظيف عند إيقاف PM2 للعملية (إعادة نشر، إعادة تشغيل...) — يترك
// BullMQ ينهي أي مهمة جارية بأمان بدل قطعها بمنتصفها فجأة.
process.on('SIGTERM', async () => { await worker.close(); process.exit(0); });
process.on('SIGINT', async () => { await worker.close(); process.exit(0); });

module.exports = worker;
