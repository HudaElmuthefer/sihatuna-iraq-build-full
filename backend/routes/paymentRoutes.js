// server/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const paymentSettingsController = require('../controllers/paymentSettingsController');
const asyncHandler = require('../middleware/asyncHandler');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');

// ── إصلاح أمني حرج ───────────────────────────────────────────────────────────
// كانت كل هذه المسارات بلا أي مصادقة إطلاقاً (auth/requireAdmin معلَّقين
// بالكومنت أدناه سابقاً) — أي شخص بدون تسجيل دخول، حتى من خارج الشبكة
// المحلية، كان يستطيع إضافة أو حذف بيانات اعتماد بوابات دفع (مفاتيح API حساسة)
// أو يرسل عمليات دفع وهمية عبر /api/payments مباشرة. الآن:
//   - مسارات إعدادات بوابات الدفع (admin/*) تحتاج تسجيل دخول + دور "admin" حصراً
//   - مسارات الدفع الفعلية تحتاج تسجيل دخول فقط (أي مستخدم بالنظام، مثل
//     المحاسب من شاشة الفوترة)، بدون اشتراط دور admin

// -- إعدادات الإدمن --
// ملاحظة: لا حاجة لمعرّف مستشفى بالمسار (hospitalId) — النظام يعمل حالياً بمنشأة
// واحدة تُحدَّد تلقائياً بالخادم (انظر config/defaultHospital.js). لو احتجت دعم
// أكثر من منشأة مستقبلاً، هذا أول مكان تُعيد فيه إضافة المعرّف بالمسار.
router.get('/admin/payment-providers', auth, requireAdmin, asyncHandler(paymentSettingsController.listAllProviders));
router.get('/admin/payment-gateways', auth, requireAdmin, asyncHandler(paymentSettingsController.listHospitalGateways));
router.post('/admin/payment-gateways', auth, requireAdmin, asyncHandler(paymentSettingsController.upsertHospitalGateway));
router.delete('/admin/payment-gateways/:providerCode', auth, requireAdmin, asyncHandler(paymentSettingsController.deactivateGateway));

// -- عمليات الدفع الفعلية --
router.get('/payment-methods', auth, asyncHandler(paymentController.getAvailableMethods));
router.post('/payments', auth, asyncHandler(paymentController.createPayment));
router.post('/payments/:paymentId/verify', auth, asyncHandler(paymentController.verifyPayment));
router.post('/payments/:paymentId/manual-confirm', auth, asyncHandler(paymentController.manualConfirm));

module.exports = router;
