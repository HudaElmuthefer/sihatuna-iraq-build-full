// backend/routes/miscRoutes.js
//
// مسارات متفرقة: رفع مستندات الإضابير الشخصية (موظفين نشطين ومتقاعدين معاً،
// بجدول PostgreSQL واحد مشترك `dossiers`)، رفع ملف عام، وإحصائيات لوحة التحكم.
const express = require('express');
const auth = require('../middleware/auth');
const { upload } = require('../config/uploadConfig');
const { pool } = require('../config/database');

const router = express.Router();
const PORT = process.env.PORT || 8000;

// ── إضابير المتقاعدين والموظفين النشطين (جدول dossiers الحقيقي بـ PostgreSQL) ──
// إصلاح جذري: كان هذا المسار (POST/DELETE) يكتب لملف db.json المؤقت، بينما
// صفحة المتقاعدين تقرأ الوثائق أصلاً من جدول PostgreSQL الحقيقي (GET /api/
// dossiers عبر pgCrud) — يعني أي وثيقة تُرفَع فعلياً تُخزَّن بمكان مختلف
// تماماً عن المكان الذي تُعرَض منه، فتختفي بعد أول تحديث للصفحة. وإضابير
// الموظفين النشطين كانت بملف db.json بالكامل (قراءة وكتابة)، منفصلة كلياً
// عن قاعدة البيانات وسلة المحذوفات. الآن كلاهما يُخزَّن بنفس جدول
// PostgreSQL الحقيقي (`dossiers`، بحقل retiredId أو employeeId حسب النوع) —
// يحلّ تعارض القراءة/الكتابة، ويمنح الحذف حماية سلة المحذوفات تلقائياً
// (الحذف نفسه أُزيل من هنا — الفرونت إند يستخدم DELETE /api/dossiers/:id
// العام عبر pgCrud مباشرة، الذي أصلاً مسجَّل بسلة المحذوفات).
router.post('/retired/:id/dossier', auth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.body.title) return res.status(400).json({ message: 'العنوان مطلوب' });
    const data = {
      retiredId: Number(req.params.id),
      type: req.body.type || 'وثيقة',
      title: req.body.title,
      date: req.body.date || '',
      notes: req.body.notes || '',
      fileName: req.file ? req.file.originalname : null,
      filePath: req.file ? `/uploads/${req.file.filename}` : null,
      fileType: req.file ? req.file.mimetype : null,
      hospitalId: req.user?.hospitalId || null,
    };
    const result = await pool.query('INSERT INTO dossiers (data) VALUES ($1) RETURNING *', [JSON.stringify(data)]);
    res.status(201).json({ ...result.rows[0].data, id: result.rows[0].id });
  } catch (err) { next(err); }
});

router.post('/employees/:id/dossier', auth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.body.title) return res.status(400).json({ message: 'العنوان مطلوب' });
    const data = {
      employeeId: Number(req.params.id),
      type: req.body.type || 'وثيقة',
      title: req.body.title,
      date: req.body.date || '',
      notes: req.body.notes || '',
      fileName: req.file ? req.file.originalname : null,
      filePath: req.file ? `/uploads/${req.file.filename}` : null,
      fileType: req.file ? req.file.mimetype : null,
      hospitalId: req.user?.hospitalId || null,
    };
    const result = await pool.query('INSERT INTO dossiers (data) VALUES ($1) RETURNING *', [JSON.stringify(data)]);
    res.status(201).json({ ...result.rows[0].data, id: result.rows[0].id });
  } catch (err) { next(err); }
});

// ── FILE UPLOAD (general) ─────────────────────────────────────────────────────
router.post('/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'لا يوجد ملف' });
  res.json({
    url: `http://localhost:${PORT}/uploads/${req.file.filename}`,
    filename: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });
});

// ── DASHBOARD STATS ───────────────────────────────────────────────────────────
// ── إصلاح: كان هذا المسار يقرأ من db.json (readDB) — بيانات قديمة تماماً.
// المرضى والأطباء والمواعيد والأقسام والموظفين والمتقاعدين كلهم انتقلوا لجداول
// PostgreSQL فعلية من زمان (عبر pgCrud)، وما عادوا يُكتَبون بملف db.json
// إطلاقاً. يعني اللوحة كانت تعرض أرقاماً مجمَّدة منذ لحظة الانتقال، بغض النظر
// عمّا يصير فعلياً بالنظام. الآن نستعلم مباشرة من الجداول الحقيقية.
router.get('/stats', auth, async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [patients, doctors, appointments, departments, employees, retired] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM patients'),
      pool.query(`SELECT COUNT(*) FROM doctors WHERE status = 'active'`),
      pool.query('SELECT COUNT(*) FROM appointments WHERE date = $1', [today]),
      pool.query('SELECT COUNT(*) FROM departments'),
      pool.query('SELECT COUNT(*) FROM employees'),
      pool.query('SELECT COUNT(*) FROM retired'),
    ]);
    res.json({
      patients: parseInt(patients.rows[0].count, 10),
      doctors: parseInt(doctors.rows[0].count, 10),
      appointments: parseInt(appointments.rows[0].count, 10),
      departments: parseInt(departments.rows[0].count, 10),
      employees: parseInt(employees.rows[0].count, 10),
      retired: parseInt(retired.rows[0].count, 10),
    });
  } catch (err) { next(err); }
});

module.exports = router;
