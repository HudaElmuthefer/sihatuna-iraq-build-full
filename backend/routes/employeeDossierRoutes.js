// backend/routes/employeeDossierRoutes.js
//
// إصلاح حرج: تبويب "الإضابير الشخصية" بالموظفين النشطين كان بدون أي اتصال
// بالباك إند إطلاقاً — أي وثيقة (شهادة، عقد) تُفقَد بمجرد تحديث الصفحة، وحتى
// الملف المرفق نفسه كان معاينة محلية فقط (blob URL) لا يُرفَع لأي مكان.
// هذا الملف يبني المسار الحقيقي الناقص (GET/POST/DELETE /api/employees/:id/dossier)
// مربوطاً بجدول dossiers الموجود أصلاً بقاعدة البيانات (JSONB بحت — id/data/
// created_at/updated_at فقط)، ويستخدم نفس إعداد multer المشترك (config/
// uploadConfig.js) المستخدم ببقية مسارات الرفع بالمشروع، حتى يبقى نوع/حجم
// الملف المسموح به موحّداً بكل النظام.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { pool } = require('../config/database');
const { upload, deleteUploadedFile } = require('../config/uploadConfig');

router.use(auth);

// ── جلب كل وثائق موظف معيّن ──────────────────────────────────────────────────
router.get('/employees/:id/dossier', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, data FROM dossiers WHERE data->>'employeeId' = $1 ORDER BY id DESC`,
      [String(id)]
    );
    res.json(result.rows.map(r => ({ id: r.id, ...r.data })));
  } catch (err) {
    console.error('❌ [GET /api/employees/:id/dossier]', err.message);
    res.status(500).json({ message: 'تعذّر جلب الإضبارة' });
  }
});

// ── رفع وثيقة جديدة (بملف مرفق حقيقي) ────────────────────────────────────────
router.post('/employees/:id/dossier', upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { type, title, date, notes } = req.body;
    // إصلاح: بدون هذا الفحص، طلب بلا ملف مرفق كان يمر بصمت ويُنشئ سجلاً بلا
    // filePath — يكسر شرط الاختبار /^\/uploads\// لاحقاً بدل رفض واضح فوراً.
    if (!req.file) {
      return res.status(400).json({ message: 'الملف المرفق مطلوب' });
    }
    const data = {
      employeeId: String(id),
      type: type || '',
      title: title || '',
      date: date || '',
      notes: notes || '',
      filePath: `/uploads/${req.file.filename}`,
      fileType: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
    };
    const result = await pool.query(
      `INSERT INTO dossiers (data) VALUES ($1) RETURNING id, data`,
      [JSON.stringify(data)]
    );
    res.status(201).json({ id: result.rows[0].id, ...result.rows[0].data });
  } catch (err) {
    // إصلاح: خطأ multer (نوع/حجم ملف مرفوض من uploadConfig.js) يحمل statusCode
    // خاصاً به (400) — نعرضه كما هو بدل تعميمه كـ 500 مربك.
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error('❌ [POST /api/employees/:id/dossier]', err.message);
    res.status(500).json({ message: 'تعذّر رفع الوثيقة' });
  }
});

// ── حذف وثيقة ────────────────────────────────────────────────────────────────
router.delete('/employees/:id/dossier/:docId', async (req, res) => {
  try {
    const { id, docId } = req.params;
    // نتأكد إن الوثيقة فعلاً تخص هذا الموظف قبل الحذف — يمنع حذف وثيقة موظف
    // آخر بمجرد تخمين رقم docId.
    const result = await pool.query(
      `DELETE FROM dossiers WHERE id = $1 AND data->>'employeeId' = $2 RETURNING id, data`,
      [docId, String(id)]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'الوثيقة غير موجودة' });
    }
    // حذف نهائي هنا (لا سلة محذوفات، بعكس DELETE /api/dossiers/:id العام) —
    // الملف المرفق يجب أن يُحذف من القرص أيضاً، وإلا يبقى يتيماً للأبد.
    await deleteUploadedFile(result.rows[0].data?.filePath);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ [DELETE /api/employees/:id/dossier/:docId]', err.message);
    res.status(500).json({ message: 'تعذّر حذف الوثيقة' });
  }
});

module.exports = router;
