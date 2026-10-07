// backend/services/queue/ocrQueue.js
//
// طابور معالجة قراءة الفواتير والوصفات الطبية بالذكاء الاصطناعي (OCR + AI
// vision) — انتقلت من مسار HTTP المباشر (routes/invoiceReaderRoutes.js
// وroutes/prescriptionReaderRoutes.js) لمهمة خلفية عبر BullMQ، لأن استدعاء
// AI فعلياً (Gemini/Claude) قد يأخذ عدة ثوانٍ لكل صورة (وOCR قبله ثوانٍ
// إضافية — راجع agents/ocrAgent.js)، وإبقاء طلب HTTP معلّقاً كل هذه المدة
// يحجز worker كامل من Express بلا فائدة حقيقية. الآن: الطلب يُرجع فوراً
// برقم مهمة (jobId)، والفرونت إند يستعلم عن حالتها دورياً.
//
// طابور واحد لكلا النوعين (اسم المهمة يميّز بينهما: 'read-invoice' مقابل
// 'read-prescription' — راجع ocrWorker.js لمنطق التوزيع) بدل طابورين
// منفصلين: نفس نمط المعالجة بالضبط (OCR + AI vision)، ولا فائدة حقيقية من
// عزلهما بعملية Worker إضافية كاملة (PM2 app جديد، إعداد Docker إضافي)
// لمجرد اختلاف الميزة النهائية — يكفي تمييز بسيط باسم المهمة.
//
// يُستهلَك هذا الطابور بعملية منفصلة تماماً عن الخادم الرئيسي — راجع
// ocrWorker.js وecosystem.config.js لسبب فصله عن عمليات worker الخاصة
// بـExpress.
const { Queue } = require('bullmq');
const { createQueueConnection } = require('./queueConnection');

const QUEUE_NAME = 'ocr-jobs';

let queue = null;
function getQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: createQueueConnection(),
      defaultJobOptions: {
        attempts: 2, // محاولة إعادة واحدة إضافية لو فشل استدعاء AI لسبب مؤقت (انقطاع شبكة قصير)
        backoff: { type: 'fixed', delay: 3000 },
        removeOnComplete: { age: 60 * 60 }, // نحتفظ بنتيجة المهمة ساعة كاملة (يكفي لاستعلام الفرونت إند)، ثم تُحذف تلقائياً بدل تراكمها بلا حدود بـRedis
        removeOnFail: { age: 24 * 60 * 60 }, // نُبقي المهام الفاشلة يوماً كاملاً — مفيدة للتشخيص لو تكرر فشل استدعاء AI
      },
    });
  }
  return queue;
}

// يُضيف مهمة قراءة فاتورة جديدة للطابور — يرمي استثناءً لو تعذّر الوصول
// لـRedis. المستدعي بـinvoiceReaderRoutes.js يلتقط هذا صراحة ويرجع
// available:false للفرونت إند، بنفس نمط "الذكاء الاصطناعي غير مُفعَّل"
// الموجود أصلاً بكل ميزات الذكاء الاصطناعي بهذا النظام.
async function enqueueInvoiceReadJob(data) {
  const job = await getQueue().add('read-invoice', data);
  return job.id;
}

async function enqueuePrescriptionReadJob(data) {
  const job = await getQueue().add('read-prescription', data);
  return job.id;
}

// حالة مهمة محدَّدة — تُستخدم بمسار الاستعلام (polling) من الفرونت إند.
// ترجع null لو المهمة غير موجودة (رقم خاطئ، أو حُذفت بعد انتهاء removeOnComplete/removeOnFail).
async function getJobStatus(jobId) {
  const job = await getQueue().getJob(jobId);
  if (!job) return null;
  const state = await job.getState(); // 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | ...
  return {
    id: job.id,
    state,
    result: state === 'completed' ? job.returnvalue : null,
    error: state === 'failed' ? (job.failedReason || 'فشلت المعالجة') : null,
  };
}

module.exports = { getQueue, enqueueInvoiceReadJob, enqueuePrescriptionReadJob, getJobStatus, QUEUE_NAME };
