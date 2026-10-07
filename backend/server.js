/**
 * SIHATUNA IRAQ - Backend Server
 * م. هدى عبد العظيم عبد الكريم
 * halmuthefer@gmail.com
 *
 * ── ملاحظة بعد إعادة الهيكلة (تقسيم الملف) ──────────────────────────────────
 * كان هذا الملف يحتوي كل شيء بمكان واحد (~1000 سطر): كل المسارات، كل الإعدادات،
 * كل الدوال المساعدة. الآن هو فقط ملف "تنسيق" (orchestration) يجمع القطع من
 * أماكنها المتخصصة:
 *   - config/*         → إعدادات ثابتة (JWT، رفع الملفات، تحديد المعدل)
 *   - utils/*           → دوال مساعدة عامة (db.json، سجل التدقيق، إبطال التوكن)
 *   - middleware/*      → middleware قابل لإعادة الاستخدام (auth، صلاحيات، تحقق)
 *   - routes/*          → كل مجموعة مسارات بملفها الخاص حسب المجال
 * أي منطق فعلي (كيف يعمل تسجيل الدخول، كيف تُبنى استعلامات SQL...) موجود
 * بمكانه المتخصص، وليس هنا. هذا الملف فقط يربطهم مع بعض بالترتيب الصحيح.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { JWT_SECRET } = require('./config/jwtConfig'); // يطبع تحذير أمان تلقائياً لو المفتاح افتراضي
const { generalLimiter } = require('./config/rateLimiters');
const { testConnection, pool } = require('./config/database');
const { UPLOADS_DIR } = require('./config/uploadConfig');
const auth = require('./middleware/auth');
const { startAutoBackup } = require('./utils/backup');
const { devLog } = require('./utils/logger');
const { sendAlert } = require('./utils/alerts');

const app = express();
const PORT = process.env.PORT || 8000;

// ── شبكة أمان أخيرة (Defense in Depth) ──────────────────────────────────────
// إصلاح حرج: لقينا خطأ فعلي (مسار حذف بـ pgCrud.js) حيث استثناء غير مُعالَج
// داخل async route handler واحد كان يُسقط **السيرفر بالكامل** — بنسخ Node.js
// الحديثة (v15+)، أي unhandledRejection غير مُلتقَط يُنهي العملية تلقائياً
// افتراضياً. صحّحنا الحالة المحدَّدة (ROLLBACK غير محمي)، لكن هذا يبقى كخط
// دفاع أخير: أي خطأ مشابه بالمستقبل يُسجَّل بوضوح بدل ما يُطفي كل الخادم
// بصمت (يعطّل جلسات كل المستخدمين لأجل طلب واحد فاشل). الحل الحقيقي دائماً
// معالجة كل Promise بمكانها (try/catch)، هذا فقط شبكة أمان لو نسينا مكاناً.
process.on('unhandledRejection', (reason) => {
  console.error('🔥 خطأ غير مُعالَج (unhandledRejection) — كاد يُسقط السيرفر:', reason);
});

// ── Middleware ─────────────────────────────────────────────────────────────────
// ── Helmet (رؤوس أمان HTTP قياسية) ──────────────────────────────────────────────
// يضيف رؤوساً وقائية جاهزة يوصي بها OWASP بدون أي إعداد يدوي (يمنع تخمين نوع
// المحتوى بالمتصفح، يمنع تضمين الموقع بإطار iframe خارجي لحماية من Clickjacking،
// يخفي رأس X-Powered-By الذي يكشف أنه Express، وغيرها). نُعطّل تحديداً سياستين
// افتراضيتين قد تكسران عمل النظام الحالي دون أي فائدة أمنية حقيقية بحالتنا:
//   - crossOriginResourcePolicy: الفرونت إند (منفذ 3000) يعرض صوراً مرفوعة من
//     الباك إند (منفذ 8000) عبر <img src>؛ الإعداد الافتراضي same-origin كان
//     سيمنع تحميلها لاختلاف المنفذ. عدّلناه لـ cross-origin بدل تعطيله بالكامل.
//   - contentSecurityPolicy: مصمَّم أساساً لصفحات HTML، ولا فائدة حقيقية منه
//     على خادم API خالص لا يُقدّم صفحات ويب مباشرة؛ تعطيله يتجنّب تعقيداً غير
//     ضروري دون فقدان أي حماية فعلية بحالتنا.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

// ── CORS ───────────────────────────────────────────────────────────────────────
// كان مفتوحاً للجميع (origin: '*') سابقاً — أي موقع بالعالم يستطيع استدعاء الـ API
// لو حصل على توكن دخول (مثلاً عبر XSS بموقع آخر). الآن مقيّد بنطاق الفرونت إند
// الفعلي فقط. القيمة الافتراضية تناسب التطوير المحلي (localhost:3000)؛ عند
// النشر على خادم حقيقي، أضف FRONTEND_URL بملف .env بعنوان موقعك الفعلي
// (مثلاً https://sihatuna-iraq.example.com) بدل الاعتماد على القيمة الافتراضية.
//
// إصلاح: FRONTEND_URL كانت قيمة نصية واحدة فقط — تكفي لعنوان إنتاج حقيقي
// واحد، لكنها تفشل بصمت (CORS يرفض الرد) لأي عنوان محلي إضافي مشروع (مثل
// معاينة نسخة الإنتاج المبنية محلياً على منفذ مختلف عن خادم التطوير 3000،
// كما حصل فعلياً هنا). ندعم الآن قائمة عناوين مفصولة بفاصلة اختيارياً —
// القيمة الافتراضية (بلا فاصلة) تبقى تماماً كما كانت لأي نشر حقيقي موجود.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const ALLOWED_ORIGINS = FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean);
// credentials: true مطلوب حتى يستطيع المتصفح إرسال واستقبال httpOnly cookie —
// بدونه، المتصفح يرفض إرفاق الكوكي بطلبات fetch حتى لو الكود يمرر
// credentials:'include' من جهة الفرونت إند. يجب أن يكون origin عنواناً محدَّداً
// صراحة (وليس '*') حتى يسمح المتصفح بهذا أصلاً — وهو مضبوط هكذا أصلاً بالأعلى.
app.use(cors({ origin: ALLOWED_ORIGINS.length > 1 ? ALLOWED_ORIGINS : ALLOWED_ORIGINS[0], credentials: true, methods: ['GET','POST','PUT','DELETE','PATCH'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// ── إصلاح أمني ────────────────────────────────────────────────────────────────
// كانت الملفات المرفوعة (وثائق طبية، ملفات موظفين متقاعدين...) تُعرض عبر
// express.static بدون أي تحقق تسجيل دخول — أي رابط ملف (لو انسرب أو انخمّن
// اسمه) كان يفتح مباشرة بالمتصفح من أي شخص، حتى بدون حساب بالنظام. الآن
// يحتاج طلب عرض أي ملف توكن دخول صالح، تماماً مثل باقي مسارات الـ API.
app.use('/uploads', auth, express.static(UPLOADS_DIR));

// ── Routes ─────────────────────────────────────────────────────────────────────
const router = express.Router();
router.use(generalLimiter);

// ── إصلاح: فحص صحي حقيقي بدل رد شكلي فقط ────────────────────────────────────
// قبل هذا، /health كان يرجع "ok" دائماً بمجرد إن Express نفسه يشتغل، حتى لو
// قاعدة البيانات متوقفة تماماً — يعطي انطباعاً خاطئاً إن النظام "سليم" بينما
// كل الوظائف الفعلية معطّلة. الآن يفحص فعلياً اتصال PostgreSQL.
//
// ── إصلاح أمني ────────────────────────────────────────────────────────────
// هذا المسار *يجب* يبقى بدون تسجيل دخول (auth) عمداً — أدوات مراقبة خارجية
// (monitor.js، أو أي uptime monitor سحابي مستقبلاً) تحتاج تفحصه بدون بيانات
// اعتماد. لكن هذا يعني إن أي زائر (حتى بدون حساب) يستطيع استدعاءه — فلا يصح
// نرجّع له تفاصيل خطأ قاعدة البيانات الداخلية (dbCheck.error.message قد
// يكشف اسم مستخدم قاعدة البيانات، اسم الخادم الداخلي، أو تفاصيل بنيوية
// أخرى). التفاصيل الكاملة تُسجَّل بسجل الخادم (console) للتشخيص، والعميل
// يستلم فقط "connected"/"disconnected" — كافٍ تماماً لأي أداة مراقبة لاتخاذ
// قرار التنبيه، بدون كشف أي تفصيل داخلي حساس.
router.get('/health', async (req, res) => {
  const dbCheck = await testConnection();
  if (!dbCheck.ok) console.error('⚠️  [health] فشل اتصال قاعدة البيانات:', dbCheck.error.message);
  res.status(dbCheck.ok ? 200 : 503).json({
    status: dbCheck.ok ? 'ok' : 'degraded',
    system: 'SIHATUNA IRAQ',
    time: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: dbCheck.ok ? 'connected' : 'disconnected',
    memoryUsedMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

router.use(require('./routes/hospitalsRoutes'));
router.use(require('./routes/brandingRoutes'));
router.use(require('./routes/dicomWebhookRoutes'));
router.use(require('./routes/invoiceReaderRoutes'));
router.use(require('./routes/prescriptionReaderRoutes'));
router.use(require('./routes/aiProviderSettingsRoutes'));
router.use(require('./routes/documentLookupRoutes'));
router.use(require('./routes/bookingRoutes'));
router.use(require('./routes/medicalCodesRoutes'));
router.use(require('./routes/backupsRoutes'));
router.use(require('./routes/codeBackupRoutes'));
router.use(require('./routes/gitUpdateRoutes'));
router.use(require('./routes/authRoutes'));

// -- Public queue display endpoint (no login required) ----------------------
// Meant for a TV/monitor screen in a waiting area, not for staff use — so it
// intentionally has NO auth requirement (a screen mounted on a wall can't log
// in) and deliberately returns ONLY ticket numbers, departments and status —
// never patient names, since anyone walking past a public screen can read it.
// Optional ?hospitalId=X query param to scope to one hospital in a
// multi-hospital deployment; omit it to show all (fine for a single-hospital
// setup, which is the current deployment).
router.get('/queue-display', async (req, res, next) => {
  try {
    const { hospitalId } = req.query;
    // ── إصلاح: كان الاستعلام يجيب "آخر 200 تذكرة برقم id" بدون أي فلترة
    // بالتاريخ — يعني أي تذكرة قديمة (id أصغر) تُنادى الآن (تحديث status
    // فقط، id ما يتغيّر) تختفي من الشاشة إذا صار عندها 200+ تذكرة أحدث id
    // بعدها (بالضبط ما صار بعد استيراد دفعة كبيرة من التذاكر التجريبية) —
    // رغم إن التحديث نجح فعلياً بقاعدة البيانات. الآن نفلتر بتاريخ اليوم
    // فقط (بنفس منطق "اليوم المحلي" المُصلَح بـ QueuePage.js، لا UTC)، فلا
    // توجد تذكرة نشطة تختفي بسبب الترتيب.
    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const params = [todayLocal];
    let where = `WHERE data->>'createdAt' LIKE $1 || '%'`;
    if (hospitalId) {
      params.push(hospitalId);
      where += ` AND data->>'hospitalId' = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT id, department, status, data->>'ticketNo' AS "ticketNo", data->>'calledBy' AS "calledBy"
       FROM queue_tickets
       ${where}
       ORDER BY id DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});
router.use(require('./routes/usersRoutes'));
router.use(require('./routes/revenueRoutes'));
router.use(require('./routes/profitSharingRoutes'));
// إصلاح: مسار "الإضابير الشخصية" (رفع/عرض/حذف وثيقة موظف بملف مرفق حقيقي)
// كان غير مسجَّل بالسيرفر إطلاقاً — راجع التعليق أعلى employeeDossierRoutes.js.
router.use(require('./routes/employeeDossierRoutes'));
router.use(require('./routes/aiDiagnosisRoutes'));
router.use(require('./routes/drugInteractionRoutes'));
router.use(require('./routes/dosageRoutes'));
router.use(require('./routes/allergyRoutes'));
router.use(require('./routes/billingAnomalyRoutes'));
router.use(require('./routes/inventoryPredictionRoutes'));
require('./routes/modules')(router); // يسجّل كل موديولات pgCrud + استيراد Excel (41 موديول)
router.use('/recycle-bin', require('./routes/recycleBinRoutes'));
router.use(require('./routes/miscRoutes'));

// ── Health check (يستخدمه الفرونت إند للتأكد إن السيرفر يعمل) ──────────────
app.get('/', (req, res) => res.json({ status: 'ok', service: 'SIHATUNA IRAQ Backend' }));

// ── Mount router ───────────────────────────────────────────────────────────────
app.use('/api', router);

// ── Payment Gateway (PostgreSQL) — احتياطي متقدم، تعمل فقط بعد إعداد .env ──
// ملاحظة: نظام CRM القديم متعدد المستشفيات (routes/crmRoutes.js) أُزيل نهائياً
// من هنا — كان يستعلم عن أعمدة (channel, follow_up_type, ...) لم تعد موجودة
// بعد إعادة بناء جداول CRM بالنمط الجديد (JSONB مرن، انظر pgCrud بملف
// routes/modules.js)، وكان سيتسبب بانهيار أي طلب يصل له صدفة. CRM الفعلي
// يعمل الآن عبر pgCrud مباشرة.
try {
  const paymentRoutes = require('./routes/paymentRoutes');
  app.use('/api', generalLimiter, paymentRoutes);
  devLog('✅ Payment module loaded (/api/payments, /api/admin/payment-gateways)');
} catch (err) {
  console.warn('⚠️  Payment module not loaded — check that "pg" is installed and .env is configured:', err.message);
}

// 404
app.use((req, res) => res.status(404).json({ message: 'المسار غير موجود' }));

// ── معالج الأخطاء المركزي ────────────────────────────────────────────────────
// نقطة واحدة لكل أخطاء الخادم (المتزامنة وغير المتزامنة عبر asyncHandler)،
// بدل تكرار try/catch وصياغة الاستجابة في كل controller على حدة.
// يُصنَّف الخطأ حسب نوعه لإعطاء رمز حالة (status code) ورسالة مناسبة،
// ولا تُرسَل تفاصيل الخطأ الداخلية (err.stack) للمستخدم في بيئة الإنتاج.
// ── تبريد التنبيهات (Cooldown) ────────────────────────────────────────────
// لو نفس الخطأ تكرر مرات كثيرة بفترة قصيرة (مثلاً استعلام معطوب يتكرر مع كل
// طلب لصفحة معينة)، ما نبعث تنبيه بريد إلكتروني منفصل لكل مرة — نكتفي بتنبيه
// واحد كل 15 دقيقة لكل نوع خطأ (مسار + رسالة)، والباقي يبقى مسجَّلاً بالسجل
// العادي فقط بدون إغراقك برسائل متكررة لنفس المشكلة.
const alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
function shouldAlert(key) {
  const last = alertCooldowns.get(key);
  const now = Date.now();
  if (last && now - last < ALERT_COOLDOWN_MS) return false;
  alertCooldowns.set(key, now);
  return true;
}

app.use((err, req, res, next) => {
  console.error(`❌ [${req.method} ${req.originalUrl}]`, err.message);

  // خطأ اتصال بقاعدة PostgreSQL (السيرفر غير متاح أو غير مُعدّ)
  if (err.code === 'ECONNREFUSED' || err.code === '3D000') {
    return res.status(503).json({ message: 'تعذّر الاتصال بقاعدة البيانات، حاول لاحقاً' });
  }
  // خطأ توكن JWT غير صالح أو منتهي (في حال مرّره middleware المصادقة عبر next(err))
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'رمز الدخول غير صالح أو منتهي الصلاحية' });
  }
  // خطأ تحقق من صحة البيانات (يمكن لأي controller رمي Error برمز statusCode = 400)
  if (err.statusCode) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  // ── خطأ غير متوقع (500) — ينبَّه فوراً بدل أن يبقى مدفوناً بسجل الملف فقط ──────
  // مخصص للأخطاء الحقيقية غير المصنَّفة فقط (وليس 400/401/404 التي هي أخطاء
  // "طلب خاطئ" عادية، حتى لا نغرق بتنبيهات لكل شخص كتب كلمة مرور خاطئة مثلاً).
  // sendAlert تُستدعى بدون await قصداً (fire-and-forget) — ما نأخّر رد المستخدم
  // بانتظار إرسال بريد إلكتروني قد يستغرق ثوانٍ.
  const alertKey = `${req.method} ${req.originalUrl} :: ${err.message}`;
  if (shouldAlert(alertKey)) {
    sendAlert(
      `خطأ غير متوقع بالخادم — ${req.method} ${req.originalUrl}`,
      `الرسالة: ${err.message}\nالمستخدم: ${req.user?.username || 'غير مسجّل دخول'}\nالوقت: ${new Date().toLocaleString('ar-IQ')}`
    ).catch(() => {}); // لو فشل التنبيه نفسه، ما نكسر الاستجابة الأصلية بسببه
  }

  res.status(500).json({
    message: 'خطأ في الخادم',
    error: process.env.NODE_ENV === 'production' ? undefined : err.message,
  });
});

// ── بدء التشغيل الفعلي ────────────────────────────────────────────────────────
// نُشغّل الاستماع الفعلي على المنفذ فقط عند تشغيل هذا الملف مباشرة (node server.js)،
// وليس عند استيراده كموديول (مثلاً بواسطة ملفات الاختبار عبر require('../server')).
// بدون هذا الشرط، أي محاولة اختبار آلي للتطبيق كانت ستُشغّل سيرفراً حقيقياً على
// المنفذ 8000 وتكتب فوق قاعدة البيانات الحقيقية بمجرد استيراد الملف — وهذا بالضبط
// ما يمنع كتابة اختبارات آمنة لهذا المشروع حتى الآن.
if (require.main === module) {
  const server = app.listen(PORT, async () => {
    devLog(`\n╔════════════════════════════════════════╗`);
    devLog(`║     SIHATUNA IRAQ — Backend Server     ║`);
    devLog(`║  Developer: Huda Abduladheem           ║`);
    devLog(`╠════════════════════════════════════════╣`);
    devLog(`║  🟢 Server: http://localhost:${PORT}     ║`);
    devLog(`║  📁 DB:     PostgreSQL (${process.env.PG_DATABASE || 'sihatuna_iraq'})  ║`);
    devLog(`║  📎 Uploads: /uploads                  ║`);
    devLog(`╚════════════════════════════════════════╝\n`);

    // ── حارس التفرّد تحت PM2 cluster mode ──────────────────────────────────
    // بعد التحويل لـ cluster mode (عدة عمليات worker لنفس السيرفر)، أي كود هنا
    // يشتغل داخل هذا الـ callback يتكرّر تلقائياً بعدد العمليات (مثلاً 8 مرات
    // على جهاز بـ8أنوية) — مقبول لإعداد Express نفسه (بلا حالة مشتركة)، لكن
    // مدمّر لأي مهمة يُفترض أنها تشتغل مرة وحدة بس: النسخ الاحتياطي التلقائي
    // (نسخ متعددة متزامنة تتصارع على نفس الملفات) وخادم HL7 (كل عملية تحاول
    // تفتح نفس منفذ TCP). PM2 يعطي كل عملية متغيّر NODE_APP_INSTANCE فريد
    // ('0', '1', '2'...) — نشغّل هذه المهام بعملية '0' فقط. بالتشغيل المباشر
    // بدون PM2 (node server.js أثناء التطوير)، هذا المتغيّر غير موجود أصلاً
    // فتشتغل طبيعياً كالسابق.
    const isPrimaryWorker = process.env.NODE_APP_INSTANCE === undefined || process.env.NODE_APP_INSTANCE === '0';

    if (isPrimaryWorker) {
      startAutoBackup();

      // ── خادم HL7 (نتائج المختبر) — يشتغل بمنفذ منفصل، بجانب الباك إند الرئيسي
      // نغلّفه بـ try/catch: لو صار تعارض منفذ أو أي خطأ، يبقى النظام الأساسي
      // يعمل بشكل طبيعي (تكامل المختبر ميزة إضافية، وليس أساس تشغيل النظام)
      try {
        const { startHL7Listener } = require('./services/hl7/hl7Listener');
        startHL7Listener();
      } catch (err) {
        console.error('⚠️  فشل تشغيل خادم HL7 (تكامل المختبر):', err.message);
      }
    }

    // ── فحص اتصال PostgreSQL فوراً بعد الإقلاع ────────────────────────────────
    // الخادم يبقى يعمل حتى لو فشل هذا الفحص (بعض الاستخدامات لا تحتاج قاعدة
    // بيانات فوراً)، لكن نطبع تحذيراً واضحاً بالعربية بدل ترك المستخدم يكتشف
    // المشكلة لاحقاً كخطأ 503 غامض بمنتصف استخدامه للنظام.
    const dbCheck = await testConnection();
    if (dbCheck.ok) {
      devLog('✅ الاتصال بقاعدة بيانات PostgreSQL يعمل بنجاح.\n');
    } else {
      console.error('\n╔════════════════════════════════════════════════════════════╗');
      console.error('║  ⚠️  تعذّر الاتصال بقاعدة بيانات PostgreSQL!                  ║');
      console.error('╚════════════════════════════════════════════════════════════╝');
      console.error(`  الخطأ: ${dbCheck.error.message}`);
      console.error('  الخادم يعمل، لكن كل طلب يحتاج قاعدة البيانات (المرضى، الأطباء...)');
      console.error('  سيفشل برمز 503 حتى تُحل هذه المشكلة. تأكد من:');
      console.error('  1) خدمة PostgreSQL تعمل فعلياً بجهازك');
      console.error('  2) بيانات الاتصال بملف backend/.env صحيحة (PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE)');
      console.error('  3) قاعدة البيانات "sihatuna_iraq" (أو الاسم المحدَّد بـ.env) منشأة فعلاً\n');
    }
  });

  // معالجة صريحة لخطأ انشغال المنفذ (EADDRINUSE): بدون هذا المعالج، محاولة تشغيل
  // نسخة ثانية من السيرفر بينما نسخة سابقة لا تزال عالقة بالخلفية (مثلاً بعد إغلاق
  // نافذة CMD دون إنهاء العملية فعلياً) تنتهي بخطأ غامض يصعب تشخيصه من طرف المستخدم.
  // هنا نطبع رسالة واضحة بالعربية وحل عملي، بدل ترك Node يطبع Stack Trace غير مفهوم.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ المنفذ ${PORT} مستخدم مسبقاً من عملية أخرى.`);
      console.error('   هذا يعني على الأغلب أن نسخة سابقة من الخادم لا تزال تعمل بالخلفية');
      console.error('   (حتى لو أُغلقت نافذتها) وهي التي ترد فعلياً على localhost:8000 —');
      console.error('   ما يفسّر ظهور استجابات قديمة أو غير متوقعة رغم تشغيل السيرفر من جديد.\n');
      console.error('   الحل: أغلق العملية العالقة أولاً، من داخل PowerShell:');
      console.error(`     netstat -ano | findstr :${PORT}`);
      console.error('     (لاحظ رقم PID بآخر السطر، ثم:)');
      console.error('     taskkill /PID <رقم_العملية> /F\n');
      console.error('   أو ببساطة: افتح "إدارة المهام" (Task Manager) وأنهِ كل عمليات "Node.js" يدوياً،');
      console.error('   ثم أعد تشغيل start-backend.bat من جديد.\n');
      process.exit(1);
    } else {
      console.error('❌ خطأ غير متوقع عند بدء تشغيل الخادم:', err.message);
      process.exit(1);
    }
  });
}

module.exports = app;
