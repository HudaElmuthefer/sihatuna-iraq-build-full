// backend/utils/logger.js
//
// أداة تسجيل خفيفة لرسائل تشخيصية/معلوماتية (إقلاع السيرفر، migrations
// يدوية، النسخ الاحتياطي...) — تُطبَع فقط لو NODE_ENV غير "production"
// (أي أثناء التطوير المحلي، أو تشغيل سكربت migration يدوياً بدون ضبط
// NODE_ENV). بمرحلة الإنتاج (PM2 مع NODE_ENV=production)، تُكتَم تلقائياً
// — يشمل هذا إخفاء قائمة كلمات المرور الافتراضية عن سجلات الإنتاج، وهذا
// تحسين أمني إضافي بجانب تقليل الضجيج.
//
// لا تستخدم هذا لرسائل الأخطاء الحقيقية (استخدم console.error مباشرة،
// أو نظام sendAlert بملف utils/alerts.js للأخطاء الحرجة) — هذا فقط
// لرسائل "معلومة، وليست مشكلة".
const isProd = process.env.NODE_ENV === 'production';

const devLog = (...args) => {
  if (!isProd) console.log(...args);
};

module.exports = { devLog };
