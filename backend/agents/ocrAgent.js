// backend/agents/ocrAgent.js
//
// PaddleOCR text extraction — one plain async function, called directly by
// Node code (services/queue/ocrWorker.js today, services/prescriptionAgent.js
// in a later phase). No HTTP, no persistent service: PaddleOCR only has a
// Python API, so this shells out to backend/services/ocr/paddle_ocr_runner.py
// as a one-off child process per call, the same execFile pattern already
// used for pg_dump in utils/backup.js — not a network call between agents.
//
// ── لماذا عملية Python جديدة بكل استدعاء، لا خادم Python دائم؟ ──────────────
// أبسط بكثير (بلا بروتوكول IPC/HTTP داخلي، بلا إدارة دورة حياة عملية طويلة
// الأمد، بلا حالة مشتركة بين مهام متزامنة) — الكلفة: PaddleOCR يعيد تحميل
// نماذجه (~ثانية إلى ثلاث) بكل استدعاء بدل إبقائها بالذاكرة. مقبول تماماً
// هنا لأن قراءة الفواتير أصلاً تعمل بمهمة خلفية BullMQ (راجع ocrWorker.js)
// لا بخيط طلب HTTP — بضع ثوانٍ إضافية لا يشعر بها المستخدم، وCONCURRENCY
// بـocrWorker.js (افتراضياً 3) يعني حد أقصى 3 عمليات Python متزامنة، لا
// انفجار غير محدود بالعمليات.
//
// ── fail-open ──────────────────────────────────────────────────────────────
// نفس فلسفة كل مزوّد ذكاء اصطناعي/اختياري بهذا المشروع (راجع
// utils/aiProvider.js وutils/redisService.js): لو PaddleOCR غير مثبَّت أصلاً،
// أو فشل التشغيل لأي سبب، نرجع available:false بدل رمي استثناء يُسقط مهمة
// قراءة الفاتورة كاملة — المستدعي (ocrWorker.js) يقرر ماذا يفعل (حالياً:
// يستمر بالاعتماد على الصورة الأصلية وحدها عبر رؤية Gemini، راجع شرح كامل
// هناك).
const { spawn } = require('child_process');
const path = require('path');

const RUNNER_SCRIPT_PATH = path.join(__dirname, '..', 'services', 'ocr', 'paddle_ocr_runner.py');
const PYTHON_BIN = process.env.OCR_PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
// أول استدعاء فعلي (بعد إقلاع الحاوية/الجهاز) يحمّل نماذج PaddleOCR من القرص
// (أو يُنزّلها لو أول مرة إطلاقاً) — قد يأخذ عشرات الثواني. المهلة هنا سخية
// عمداً لتغطية هذا، مع بقائها محدودة (لا تعليق أبدي لو تعطّلت العملية فعلاً).
const TIMEOUT_MS = parseInt(process.env.OCR_TIMEOUT_MS, 10) || 60_000;

// imageBase64: raw base64 (no "data:image/...;base64," prefix) — نفس شرط
// callAIWithImage بـutils/aiProvider.js، يتوقّعه المستدعي مُزالاً مسبقاً.
async function extractText(imageBase64) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(PYTHON_BIN, [RUNNER_SCRIPT_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ available: false, error: `انتهت مهلة PaddleOCR (${TIMEOUT_MS}ms)` });
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      // غالباً يعني: python/python3 غير موجود بـPATH إطلاقاً (بيئة بدون Python)
      finish({ available: false, error: `تعذّر تشغيل عملية Python: ${err.message}` });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        finish({ available: false, error: stderr.trim() || `عملية PaddleOCR فشلت (رمز خروج ${code})` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        finish({ available: true, text: parsed.text || '', avgConfidence: parsed.avgConfidence ?? null, lines: parsed.lines || [] });
      } catch (err) {
        finish({ available: false, error: `رد غير صالح من PaddleOCR: ${err.message}` });
      }
    });

    child.stdin.write(imageBase64);
    child.stdin.end();
  });
}

module.exports = { extractText };
