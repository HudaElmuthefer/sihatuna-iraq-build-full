// backend/config/rateLimiters.js
//
// كل محددات المعدل (Rate Limiters) المستخدمة بالنظام، بمكان واحد.
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./jwtConfig');
// ── المرحلة الثانية: عدّاد مشترك عبر Redis بدل ذاكرة كل عملية ──────────────
// راجع تعليق config/redisRateLimitStore.js للسبب الكامل (PM2 cluster mode
// كان يُضاعف الحد الفعلي تلقائياً بعدد أنوية المعالج). كل limiter يحتاج
// نسخة Store منفصلة (prefix مختلف)، حتى لو تشابهت إعداداتهم.
const RedisRateLimitStore = require('./redisRateLimitStore');

// ── تعطيل تحديد المعدل أثناء الاختبارات (skipInTest) ────────────────────────
// كل limiter بهذا الملف وبملفات routes/*.js (dosageRoutes وغيرها — كل من يبني
// RedisRateLimitStore خاصة به) يشارك عدّاداً واحداً بـRedis مفتاحه IP أو معرّف
// المستخدم الوهمي الثابت (1) الذي تزرعه tests/testUtils.js — بعكس db.json/
// PostgreSQL/سجل التدقيق، هذا العدّاد غير معزول فعلياً بين ملفات الاختبار
// (يتراكم عبر كل الملفات بنفس نافذة الدقائق الـ15)، فتشغيل مجموعة الاختبارات
// الكاملة (٢٨+ ملفاً يسجّلون الدخول، وملفات أخرى بعشرات الطلبات لنفس المسار)
// يتجاوز الحد الحقيقي بسرعة ويُفشِل اختبارات لا علاقة لها بصحة الكود
// المُختبَر فعلياً بـ429 عشوائية. لذا: `skip` (خاصية express-rate-limit
// الرسمية) تُعطِّل تحديد المعدل بالكامل تحت NODE_ENV=test، بدل تعديل قيم
// الحد أو لمس RedisRateLimitStore نفسها (المُختبَرة مباشرة ومُتعمَّداً
// بـtests/redisRateLimitStore.test.js — تعطيلها هناك سيُبطل ذلك الاختبار).
const skipInTest = () => process.env.NODE_ENV === 'test';

// ── دالة مشتركة: تستخرج هوية المستخدم من التوكن لو موجود وصالح، وإلا IP ────
// نقرأ التوكن يدويًا هنا (نفس طريقة middleware/auth.js بالضبط: كوكي أولاً ثم
// Authorization header) لأن generalLimiter يشتغل *قبل* middleware auth بترتيب
// server.js الحالي — فـ req.user غير موجود بعد بهذه المرحلة. لو فك تشفير
// التوكن فشل (منتهي، غير صالح، أو غير موجود أصلاً — مثل صفحة تسجيل الدخول
// نفسها)، نرجع لعنوان IP كخط احتياط، بدل ما يفشل الطلب بالكامل بخطأ غير متوقع.
const keyByUserOrIP = (req) => {
  const cookieToken = req.cookies?.auth_token;
  const header = req.headers.authorization;
  const headerToken = header ? header.split(' ')[1] : null;
  const token = cookieToken || headerToken;
  if (!token) return req.ip;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return `user:${decoded.id}`;
  } catch (e) {
    return req.ip; // توكن غير صالح/منتهي — نعامله كزائر مجهول بالـ IP
  }
};

// ── تقييد محاولات تسجيل الدخول ────────────────────────────────────────────
// يبقى بالـ IP دائمًا (بلا تغيير) — هذا مقصود: تسجيل الدخول نفسه لا يوجد له
// مستخدم مصادَق بعد أصلاً، فمفهوم "لكل مستخدم" غير منطقي هنا. هذا هو الخط
// الدفاعي ضد تخمين كلمات المرور (Brute Force)، ويجب أن يبقى صارمًا بالـ IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: skipInTest,
  message: { message: 'محاولات دخول كثيرة جداً، حاول مرة أخرى بعد 15 دقيقة' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('login'),
});

// ── تحديد معدل عام لكل مسارات API ──────────────────────────────────────────
// الآن لكل مستخدم مسجّل دخوله حصته الخاصة 300 طلب/5 دقائق، بغض النظر عن كم
// موظف ثاني يشتغل بنفس الوقت أو بنفس الشبكة (حتى لو خلف NAT مشترك). الزوار
// غير المسجّلين (توكن غير صالح أو معدوم) يبقون محدودين بالـ IP كخط احتياط.
const generalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  keyGenerator: keyByUserOrIP,
  skip: skipInTest,
  message: { message: 'طلبات كثيرة جداً، حاول مرة أخرى بعد قليل' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('general'),
});

const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: keyByUserOrIP,
  skip: skipInTest,
  message: { message: 'عمليات استيراد كثيرة جداً، حاول مرة أخرى بعد قليل' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('import'),
});

module.exports = { loginLimiter, generalLimiter, importLimiter, skipInTest };
