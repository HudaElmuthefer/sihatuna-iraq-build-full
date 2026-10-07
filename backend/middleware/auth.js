// backend/middleware/auth.js
//
// middleware مصادقة JWT موحّد. كان معرَّفاً سابقاً داخل server.js فقط، واستُخرج
// إلى هنا حتى يتسنى لمسارات PostgreSQL الجديدة (pgCrud.js) استخدامه أيضاً دون
// تكرار نفس الكود في مكانين، مع بقاء سلوكه مطابقاً تماماً للسابق.
//
// إصلاح: كان هذا الملف يعرّف JWT_SECRET بنفسه بقيمة افتراضية منفصلة (نص
// حرفي مكرر عن config/jwtConfig.js) — لو تغيّرت قيمة أحدهما يوماً بدون
// الثاني، تصبح كل التوكنات الصادرة بمفتاح غير صالحة عند التحقق منها بالمفتاح
// الآخر بصمت تام. الآن مصدر واحد موثوق فقط (jwtConfig.js) — لا حلقة استيراد
// دائرية هنا لأن jwtConfig.js لا يستورد شيئاً إطلاقاً.
const jwt = require('jsonwebtoken');
const { isRevoked } = require('../utils/tokenRevocation');
const { JWT_SECRET } = require('../config/jwtConfig');

// ── إصلاح أمني ────────────────────────────────────────────────────────────────
// قبل هذا التعديل، كان الفرونت إند يخزّن التوكن بـ localStorage ويرسله بـ
// Authorization header بكل طلب — أي ثغرة XSS بأي مكان بالتطبيق (حتى مستقبلية)
// كانت كافية لسرقة التوكن كاملاً وانتحال هوية المستخدم بالكامل، لأن أي كود
// جافاسكربت يعمل في الصفحة يمكنه قراءة localStorage بسهولة.
// الآن: الفرونت إند يعتمد على httpOnly cookie (المتصفح يرسلها تلقائياً، وكود
// الجافاسكربت لا يمكنه قراءتها إطلاقاً حتى لو وقع XSS). نتحقق من الكوكي أولاً،
// ونبقي دعم Authorization header كخيار احتياطي فقط (لأدوات API مباشرة مثل
// Postman، أو ملفات الاختبار الآلي بمجلد tests/) — الفرونت إند نفسه لم يعد
// يستخدم هذا المسار الثاني إطلاقاً.
const auth = async (req, res, next) => {
  const cookieToken = req.cookies?.auth_token;
  const header = req.headers.authorization;
  const headerToken = header ? header.split(' ')[1] : null;
  const token = cookieToken || headerToken;

  if (!token) return res.status(401).json({ message: 'غير مصرح' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // ── إصلاح أمني: إبطال فعلي عند تسجيل الخروج ──────────────────────────────
    // بدون هذا الفحص، تسجيل الخروج كان يمسح الكوكي في المتصفح فقط — التوكن نفسه
    // يبقى صالحاً بجانب الخادم حتى تنتهي مدته الطبيعية. الآن نتحقق من قائمة
    // الإبطال (انظر utils/tokenRevocation.js — Redis منذ المرحلة الثانية،
    // مشترك فعلياً بين كل عمليات cluster mode) — أي توكن سُجِّل خروج منه
    // صراحة يُرفَض فوراً حتى لو توقيعه صحيحاً وتاريخه لم ينته بعد.
    if (await isRevoked(decoded.jti)) {
      return res.status(401).json({ message: 'انتهت الجلسة، الرجاء تسجيل الدخول من جديد' });
    }
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: 'رمز منتهي الصلاحية' });
  }
};

module.exports = auth;
