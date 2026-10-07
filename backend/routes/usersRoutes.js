// backend/routes/usersRoutes.js
//
// ── إصلاح أمني حرج (محفوظ من قبل) ────────────────────────────────────────────
// هذه المسارات كانت بلا أي فحص دور إطلاقاً — auth فقط كان يتحقق إن التوكن
// صالح، بغض النظر عن صاحبه. يعني أي مستخدم عادي (ممرضة، محاسب...) كان يستطيع
// عبر استدعاء مباشر للـ API (خارج الواجهة) إنشاء حساب إدمن جديد لنفسه، أو
// يغيّر دور/كلمة مرور أي حساب آخر بالنظام — استيلاء كامل على الصلاحيات.
// الآن: كل عمليات القراءة والتعديل على المستخدمين للإدمن فقط.
//
// ── إصلاح أمني ثانٍ (تاريخي — الآن مُشدَّد أكثر، راجع الفقرة التالية) ─────────
// requireAdmin وحدها تتحقق فقط من role === 'admin' — بدون أي اعتبار لأي منشأة
// ينتمي لها هذا الإدمن. كان إدمن محلي مرتبط بمستشفى معيّن (hospitalId محدَّد
// بحسابه) يستطيع أن يرى ويعدّل ويحذف بل حتى **يعيد ضبط كلمة مرور** مستخدمين
// بمستشفيات ثانية غيره تماماً. أول إصلاح كان: إدمن له hospitalId يرى فقط
// مستخدمي نفس منشأته (inScope أدناه، بنفس نمط belongsToUserHospital المستخدم
// بـpgCrud.js لباقي الموديولات).
//
// ── إصلاح أمني ثالث: إدارة المستخدمين تصير حصراً للإدمن العام ─────────────────
// "مسؤول مستشفى" (إدمن له hospitalId) يحصل تلقائياً على صلاحيات كاملة على
// بيانات منشأته عبر تجاوز requirePermission.js العام لأي role==='admin' —
// هذا مقصود ولا يحتاج تعديلاً. لكن إدارة الحسابات نفسها (إنشاء/تعديل/حذف
// مستخدمين، إعادة ضبط كلمات المرور) يجب أن تبقى حصراً بيد الإدمن العام
// (مستوى الوزارة) — حتى إدمن محلي لا يُنشئ حسابات لمنشأته هو حتى، فقط
// الإدمن العام يفعل ذلك نيابة عنه. لذا كل مسارات هذا الملف (عدا self-service
// أدناه) تستخدم الآن requireGlobalAdmin بدل requireAdmin. inScope تبقى هنا
// (غير فعّالة عملياً الآن بما أن actingAdmin.hospitalId دائماً فارغ لأي طالب
// يجتاز requireGlobalAdmin) توثيقاً للمنطق ولمرونة أي تفويض جزئي مستقبلي.
//
// ── ترحيل db.json → PostgreSQL ───────────────────────────────────────────────
// هذا الملف كان يقرأ/يكتب مستخدمي النظام من ملف مسطّح (backend/data/db.json
// عبر utils/db.js) — بلا أي قيود فعلية بجانب قاعدة البيانات (لا تفرّد، لا
// مفاتيح خارجية، عرضة لتلف الملف وتضارب الكتابة المتزامنة). كل الاستعلامات
// أدناه الآن تُنفَّذ مباشرة على جدول users الحقيقي بـPostgreSQL (راجع
// database/postgres_schema.sql وmigrations-sql/016_users_real_columns.sql).
// معرّف المستخدم أصبح UUID (بدل رقم تسلسلي) — الحماية القديمة "لا يمكن حذف
// المستخدم id==1" استُبدلت بعمود is_primary_admin.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const requireGlobalAdmin = require('../middleware/requireGlobalAdmin');
const { pool } = require('../config/database');
const { mapUserRow } = require('../utils/userMapper');
const { logAudit } = require('../utils/auditLog');

const router = express.Router();

// يتحقق هل مستخدم مستهدَف (target) يقع ضمن نطاق صلاحية الإدمن الحالي —
// إدمن عام (بدون hospitalId) يرى الجميع؛ إدمن محلي يرى فقط نفس منشأته.
// غير فعّالة عملياً الآن (actingAdmin.hospitalId دائماً فارغ لأي طالب يجتاز
// requireGlobalAdmin) — محفوظة توثيقاً للمنطق ولمرونة أي تفويض جزئي مستقبلي.
const inScope = (actingAdmin, targetUser) => {
  if (!actingAdmin.hospitalId) return true; // إدمن عام
  return targetUser?.hospital_id === actingAdmin.hospitalId;
};

router.get('/users', auth, requireGlobalAdmin, async (req, res, next) => {
  try {
    const result = req.user.hospitalId
      ? await pool.query('SELECT * FROM users WHERE hospital_id = $1 ORDER BY created_at ASC', [req.user.hospitalId])
      : await pool.query('SELECT * FROM users ORDER BY created_at ASC');
    res.json(result.rows.map(mapUserRow));
  } catch (err) { next(err); }
});

router.post('/users', auth, requireGlobalAdmin, async (req, res, next) => {
  try {
    const { password, name, email, role, jobTitle, avatar, color, permissions } = req.body;
    const hashed = bcrypt.hashSync(password || 'changeme', 10);
    // إدمن محلي يفرض منشأته تلقائياً على أي حساب ينشئه، متجاهلاً أي hospitalId
    // ثاني يُرسَل بالطلب — يمنع إنشاء مستخدم بمنشأة ثانية عبر تعديل الطلب يدوياً.
    // إدمن عام يستطيع تحديد أي منشأة (أو يتركها فارغة لحساب مستوى وزارة).
    const hospitalId = req.user.hospitalId ? req.user.hospitalId : (req.body.hospitalId || null);

    let inserted;
    try {
      inserted = await pool.query(
        `INSERT INTO users (hospital_id, full_name, username, password, email, role, job_title, avatar, color, permissions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [hospitalId, name || req.body.username, req.body.username, hashed, email || null, role || 'staff',
          jobTitle || null, avatar || null, color || null, JSON.stringify(permissions || [])]
      );
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ message: 'اسم المستخدم مستخدَم مسبقاً' });
      throw err;
    }

    const safe = mapUserRow(inserted.rows[0]);
    logAudit({ module: 'users', action: 'create', recordId: safe.id, userId: req.user.id, userRole: req.user.role, after: safe });
    res.status(201).json(safe);
  } catch (err) { next(err); }
});

router.put('/users/:id', auth, requireGlobalAdmin, async (req, res, next) => {
  try {
    const existingRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (existingRes.rows.length === 0 || !inScope(req.user, existingRes.rows[0])) {
      return res.status(404).json({ message: 'غير موجود' });
    }
    const existing = existingRes.rows[0];
    const { password, hospitalId, name, email, role, jobTitle, avatar, color, permissions, isActive } = req.body;

    // إدمن محلي لا يستطيع نقل مستخدم لمنشأة ثانية (يبقى hospitalId ثابتاً على
    // منشأته هو)؛ إدمن عام يستطيع تغييره بحرية.
    const nextHospitalId = req.user.hospitalId ? existing.hospital_id : (hospitalId !== undefined ? hospitalId : existing.hospital_id);

    const updated = await pool.query(
      `UPDATE users SET
         full_name = COALESCE($1, full_name),
         email = COALESCE($2, email),
         role = COALESCE($3, role),
         job_title = COALESCE($4, job_title),
         avatar = COALESCE($5, avatar),
         color = COALESCE($6, color),
         permissions = COALESCE($7, permissions),
         is_active = COALESCE($8, is_active),
         password = COALESCE($9, password),
         hospital_id = $10,
         updated_at = now()
       WHERE id = $11 RETURNING *`,
      [
        name || null, email || null, role || null, jobTitle || null, avatar || null, color || null,
        permissions !== undefined ? JSON.stringify(permissions) : null,
        isActive !== undefined ? isActive : null,
        password ? bcrypt.hashSync(password, 10) : null,
        nextHospitalId,
        req.params.id,
      ]
    );
    const safe = mapUserRow(updated.rows[0]);
    logAudit({ module: 'users', action: 'update', recordId: safe.id, userId: req.user.id, userRole: req.user.role, after: safe });
    res.json(safe);
  } catch (err) { next(err); }
});

router.delete('/users/:id', auth, requireGlobalAdmin, async (req, res, next) => {
  try {
    const targetRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    const target = targetRes.rows[0];
    if (!target || !inScope(req.user, target)) return res.status(404).json({ message: 'غير موجود' });
    if (target.is_primary_admin) return res.status(403).json({ message: 'لا يمكن حذف المدير الرئيسي' });

    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    logAudit({ module: 'users', action: 'delete', recordId: req.params.id, userId: req.user.id, userRole: req.user.role });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── تعطيل/حذف جماعي لكل مستخدمي منشأة واحدة دفعة واحدة ───────────────────────
// يُستخدَم عند انتهاء اشتراك مستشفى: بدل تعطيل/حذف مستخدم بواحد (بما فيهم
// مسؤول المستشفى نفسه)، الإدمن العام يضغط زراً واحداً يطبَّق على الجميع معاً.
// حصراً للإدمن العام (requireGlobalAdmin) — لا معنى لتفويض هذا لمسؤول
// المستشفى نفسه (لن يستطيع أصلاً تعطيل حسابه هو من داخل جلسته الحالية).
// المدير الرئيسي (is_primary_admin) مستثنى دائماً من التعطيل/الحذف الجماعي.
router.post('/users/bulk-deactivate', auth, requireGlobalAdmin, async (req, res, next) => {
  try {
    const { hospitalId } = req.body;
    if (!hospitalId) return res.status(400).json({ message: 'hospitalId مطلوب' });
    const result = await pool.query(
      'UPDATE users SET is_active = FALSE, updated_at = now() WHERE hospital_id = $1 AND is_primary_admin = FALSE RETURNING id',
      [hospitalId]
    );
    logAudit({ module: 'users', action: 'bulk_deactivate', userId: req.user.id, userRole: req.user.role, after: { hospitalId, count: result.rowCount, userIds: result.rows.map(r => r.id) } });
    res.json({ success: true, count: result.rowCount });
  } catch (err) { next(err); }
});

router.post('/users/bulk-delete', auth, requireGlobalAdmin, async (req, res, next) => {
  try {
    const { hospitalId } = req.body;
    if (!hospitalId) return res.status(400).json({ message: 'hospitalId مطلوب' });
    const result = await pool.query(
      'DELETE FROM users WHERE hospital_id = $1 AND is_primary_admin = FALSE RETURNING id',
      [hospitalId]
    );
    logAudit({ module: 'users', action: 'bulk_delete', userId: req.user.id, userRole: req.user.role, after: { hospitalId, count: result.rowCount, userIds: result.rows.map(r => r.id) } });
    res.json({ success: true, count: result.rowCount });
  } catch (err) { next(err); }
});

// ── استعادة كلمة المرور (بدون بريد إلكتروني — النظام لا يملك خدمة SMTP) ──────
// الحل العملي المتاح: الإدمن يولّد كلمة مرور مؤقتة عشوائية للمستخدم (تُعرض
// له مرة واحدة فقط بواجهة الإدمن، يوصّلها للمستخدم يدوياً بالهاتف أو حضورياً)،
// ويُجبَر ذاك المستخدم على تغييرها بأول تسجيل دخول له (mustChangePassword).
// الكلمة المؤقتة نفسها لا تُخزَّن أبداً كنص صريح — فقط نسختها المشفّرة (bcrypt)،
// ولا تُسجَّل بسجل التدقيق (audit log) لأي سبب.
router.post('/users/:id/reset-password', auth, requireGlobalAdmin, async (req, res, next) => {
  try {
    const targetRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (targetRes.rows.length === 0 || !inScope(req.user, targetRes.rows[0])) {
      return res.status(404).json({ message: 'غير موجود' });
    }

    // كلمة مرور مؤقتة عشوائية آمنة (12 حرف hex = 6 بايت عشوائي، سهلة القراءة
    // والنطق هاتفياً مقارنة بترميز base64 مثلاً)
    const tempPassword = crypto.randomBytes(6).toString('hex');
    await pool.query(
      'UPDATE users SET password = $1, must_change_password = TRUE, updated_at = now() WHERE id = $2',
      [bcrypt.hashSync(tempPassword, 10), req.params.id]
    );

    // نسجّل بسجل التدقيق أن إعادة ضبط صارت — بدون كلمة المرور نفسها إطلاقاً
    logAudit({ module: 'users', action: 'password_reset', recordId: req.params.id, userId: req.user.id, userRole: req.user.role });

    // الكلمة المؤقتة تُعاد بجسم الاستجابة مرة واحدة فقط هنا — لن تظهر ثانية
    // بأي مكان (لا بسجل التدقيق، لا بأي استعلام لاحق). على الإدمن نسخها فوراً.
    res.json({ success: true, tempPassword });
  } catch (err) { next(err); }
});

// تغيير كلمة المرور الذاتي — أي مستخدم مسجّل دخول يستطيع تغيير كلمة مروره هو
// نفسه (يحتاج معرفة كلمة المرور الحالية أولاً، بما فيها الكلمة المؤقتة
// المُصدَرة من الإدمن أعلاه). (بدون فحص منشأة هنا عمداً — كل مستخدم يغيّر
// كلمة مروره الخاصة فقط، بغض النظر عن منشأته، فلا يوجد احتمال وصول عبر
// منشأة ثانية أصلاً)
router.put('/users/me/password', auth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'كلمة المرور الحالية والجديدة مطلوبتان' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف' });
    }
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'غير موجود' });

    const valid = bcrypt.compareSync(currentPassword, result.rows[0].password);
    if (!valid) return res.status(401).json({ message: 'كلمة المرور الحالية غير صحيحة' });

    await pool.query(
      'UPDATE users SET password = $1, must_change_password = FALSE, updated_at = now() WHERE id = $2',
      [bcrypt.hashSync(newPassword, 10), req.user.id]
    );
    logAudit({ module: 'users', action: 'password_self_change', recordId: req.user.id, userId: req.user.id, userRole: req.user.role });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── لوحة تحكم قابلة للتخصيص لكل مستخدم (Stage 5) ────────────────────────────
// dashboardLayout = مصفوفة من مفاتيح الودجت الظاهرة، بترتيب عرضها فعلياً —
// حذف مفتاح من المصفوفة يعني إخفاء الودجت، وترتيب المصفوفة نفسه هو ترتيب
// العرض (يغني عن حقل "ترتيب" منفصل). null/غير موجود = لم يخصِّص المستخدم
// شيئاً بعد، فتُستخدَم القائمة الافتراضية الكاملة بالفرونت إند.
const VALID_DASHBOARD_WIDGETS = ['erp', 'stats', 'departments', 'appointments', 'doctors'];

router.put('/users/me/dashboard-layout', auth, async (req, res, next) => {
  try {
    const { widgets } = req.body;
    if (!Array.isArray(widgets) || !widgets.every(w => VALID_DASHBOARD_WIDGETS.includes(w))) {
      return res.status(400).json({ message: 'قائمة ودجت غير صالحة' });
    }
    // منع التكرار داخل نفس الطلب — احتياط بسيط ضد بيانات مشوَّهة من الواجهة
    const deduped = [...new Set(widgets)];
    const result = await pool.query(
      'UPDATE users SET dashboard_layout = $1, updated_at = now() WHERE id = $2 RETURNING id',
      [JSON.stringify(deduped), req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'غير موجود' });
    res.json({ success: true, dashboardLayout: deduped });
  } catch (err) { next(err); }
});

router.delete('/users/me/dashboard-layout', auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'UPDATE users SET dashboard_layout = NULL, updated_at = now() WHERE id = $1 RETURNING id',
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'غير موجود' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
