// backend/middleware/asyncHandler.js
//
// غلاف موحّد لأي دالة مسار (route handler) غير متزامنة (async).
// بدون هذا الغلاف، أي استثناء يُرمى داخل دالة async (مثل خطأ اتصال بقاعدة PostgreSQL)
// لا يُلتقط تلقائياً بواسطة Express 4، ويتحول إلى Unhandled Promise Rejection
// بدل أن يصل إلى معالج الأخطاء المركزي — وهذا قد يُسقط الطلب دون رد واضح للمستخدم،
// أو في أسوأ الحالات يُسقط عملية الخادم بالكامل.
//
// الاستخدام:
//   router.post('/payments', asyncHandler(paymentController.createPayment));
//
// بهذا يُصبح أي خطأ داخل createPayment مُمرَّراً تلقائياً إلى next(err)،
// فيلتقطه معالج الأخطاء المركزي في server.js ويُعيد استجابة موحّدة للمستخدم.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
