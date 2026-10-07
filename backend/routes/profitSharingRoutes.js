// backend/routes/profitSharingRoutes.js
//
// تقسيم الحصص: قائمة مستفيدين غير محدودة العدد (مستثمر/طبيب/صيدلي/أي أحد —
// اسم ونوع وصفي حر بلا قيد، راجع migrations-sql/015) لكل منشأة، كل واحد
// بنسبته المئوية من إجمالي الإيرادات. مجموع النسب لا يتجاوز 100% (فحص خادم
// صارم)؛ التنبيه لو المجموع أقل من 100% مسؤولية الواجهة (raw totalPercentage
// يُعاد بكل استدعاء). حساب المستحقات (summary) يُعاد حسابه بالكامل من
// السجلات الحالية بكل طلب — لا تخزين/كاش — فأي إيراد جديد أو تعديل/إضافة/
// حذف مستفيد ينعكس فوراً بأول تحميل تالٍ بلا أي كود إبطال إضافي.
const express = require('express');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const requirePermission = require('../middleware/requirePermission');
const { query } = require('../config/database');
const { getRevenue } = require('../utils/revenueAggregation');
const { logAudit } = require('../utils/auditLog');

const router = express.Router();

// يحسم المنشأة الفعلية المطلوب العمل عليها: إدمن/موظف مرتبط بمنشأة معيّنة
// يُقيَّد بها دائماً بغض النظر عمّا يُرسِله بالطلب؛ إدمن عام يحدِّدها صراحة.
const resolveHospitalId = (req, bodyOrQuery) => req.user.hospitalId || bodyOrQuery.hospitalId || null;

router.get('/profit-sharing/beneficiaries', auth, requirePermission('accounts'), async (req, res, next) => {
  try {
    const hospitalId = resolveHospitalId(req, req.query);
    if (!hospitalId) return res.json([]); // إدمن عام بلا تحديد منشأة — لا معنى لقائمة مستفيدين "لكل المنشآت"
    const result = await query(
      `SELECT id, hospital_id, name, type, percentage, created_at, updated_at
       FROM profit_sharing_beneficiaries WHERE hospital_id = $1 ORDER BY created_at ASC`,
      [hospitalId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/profit-sharing/beneficiaries', auth, requireAdmin, async (req, res, next) => {
  try {
    const hospitalId = resolveHospitalId(req, req.body);
    const { name, type, percentage } = req.body;
    if (!hospitalId) return res.status(400).json({ message: 'المنشأة مطلوبة' });
    if (!name || !percentage || Number(percentage) <= 0) return res.status(400).json({ message: 'الاسم والنسبة المئوية مطلوبان' });

    const sumRes = await query(
      `SELECT COALESCE(SUM(percentage), 0) AS total FROM profit_sharing_beneficiaries WHERE hospital_id = $1`,
      [hospitalId]
    );
    const existingTotal = Number(sumRes.rows[0].total);
    if (existingTotal + Number(percentage) > 100) {
      return res.status(400).json({ message: `مجموع النسب سيتجاوز 100% (الحالي ${existingTotal}% + ${percentage}%)` });
    }

    const inserted = await query(
      `INSERT INTO profit_sharing_beneficiaries (hospital_id, name, type, percentage)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [hospitalId, name, type || null, percentage]
    );
    logAudit({ module: 'profit-sharing', action: 'create', recordId: inserted.rows[0].id, userId: req.user.id, userRole: req.user.role, after: inserted.rows[0] });
    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/profit-sharing/beneficiaries/:id', auth, requireAdmin, async (req, res, next) => {
  try {
    const existing = await query(`SELECT * FROM profit_sharing_beneficiaries WHERE id = $1`, [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ message: 'غير موجود' });
    const row = existing.rows[0];
    // إدمن محلي لا يستطيع لمس مستفيد بمنشأة ثانية (نفس نمط belongsToUserHospital بـpgCrud.js)
    if (req.user.hospitalId && row.hospital_id !== req.user.hospitalId) return res.status(404).json({ message: 'غير موجود' });

    const { name, type, percentage } = req.body;
    if (percentage !== undefined) {
      const sumRes = await query(
        `SELECT COALESCE(SUM(percentage), 0) AS total FROM profit_sharing_beneficiaries WHERE hospital_id = $1 AND id != $2`,
        [row.hospital_id, req.params.id]
      );
      const existingTotal = Number(sumRes.rows[0].total);
      if (existingTotal + Number(percentage) > 100) {
        return res.status(400).json({ message: `مجموع النسب سيتجاوز 100% (باقي المستفيدين ${existingTotal}% + ${percentage}%)` });
      }
    }

    const updated = await query(
      `UPDATE profit_sharing_beneficiaries
       SET name = COALESCE($1, name), type = COALESCE($2, type), percentage = COALESCE($3, percentage), updated_at = now()
       WHERE id = $4 RETURNING *`,
      [name, type, percentage, req.params.id]
    );
    logAudit({ module: 'profit-sharing', action: 'update', recordId: req.params.id, userId: req.user.id, userRole: req.user.role, after: updated.rows[0] });
    res.json(updated.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/profit-sharing/beneficiaries/:id', auth, requireAdmin, async (req, res, next) => {
  try {
    const existing = await query(`SELECT * FROM profit_sharing_beneficiaries WHERE id = $1`, [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ message: 'غير موجود' });
    if (req.user.hospitalId && existing.rows[0].hospital_id !== req.user.hospitalId) return res.status(404).json({ message: 'غير موجود' });

    await query(`DELETE FROM profit_sharing_beneficiaries WHERE id = $1`, [req.params.id]);
    logAudit({ module: 'profit-sharing', action: 'delete', recordId: req.params.id, userId: req.user.id, userRole: req.user.role });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// المستحقات المحسوبة لكل مستفيد لفترة مُعطاة — حيّة بالكامل، بلا أي تخزين
// وسيط: يُعاد استدعاء getRevenue() (نفس دالة تبويب الإيرادات) في كل طلب.
router.get('/profit-sharing/summary', auth, requirePermission('accounts'), async (req, res, next) => {
  try {
    const hospitalId = resolveHospitalId(req, req.query);
    if (!hospitalId) return res.json({ totalRevenue: 0, totalPercentage: 0, beneficiaries: [] });

    const { from, to } = req.query;
    const [revenue, beneficiariesRes] = await Promise.all([
      getRevenue({ hospitalId, from: from || null, to: to || null }),
      query(`SELECT id, hospital_id, name, type, percentage FROM profit_sharing_beneficiaries WHERE hospital_id = $1 ORDER BY created_at ASC`, [hospitalId]),
    ]);

    const totalPercentage = beneficiariesRes.rows.reduce((s, b) => s + Number(b.percentage), 0);
    const beneficiaries = beneficiariesRes.rows.map(b => ({
      ...b,
      due: revenue.totalRevenue * (Number(b.percentage) / 100),
    }));

    res.json({ totalRevenue: revenue.totalRevenue, totalPercentage, beneficiaries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
