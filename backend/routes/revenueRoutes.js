// backend/routes/revenueRoutes.js
//
// موحِّد للإيرادات — يُطعِم تبويب "الإيرادات" بصفحة الحسابات (frontend/src/
// pages/accounts/RevenueTab.js) بقراءة مباشرة من السجلات الحقيقية (فواتير
// مدفوعة، صرفيات صيدلانية، ومعاملات "دخل" يدوية) بدل أي إدخال مكرَّر —
// راجع utils/revenueAggregation.js لتفاصيل كل مصدر ولماذا invoices لا
// payments هو مصدر إيراد المرضى.
const express = require('express');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { getRevenue } = require('../utils/revenueAggregation');

const router = express.Router();

// ?hospitalId= اختياري — يُستخدَم فقط لو الطالب إدمن عام (بلا hospitalId
// خاص به هو) ويريد فلترة عرضه بمنشأة واحدة تحديدًا؛ إدمن/موظف مرتبط بمنشأة
// معيّنة يُقيَّد بمنشأته دائماً بغض النظر عمّا يُرسِله هنا (نفس نمط pgCrud.js).
router.get('/revenue', auth, requirePermission('accounts'), async (req, res, next) => {
  try {
    const hospitalId = req.user.hospitalId || req.query.hospitalId || null;
    const { from, to } = req.query;
    const result = await getRevenue({ hospitalId, from: from || null, to: to || null });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
