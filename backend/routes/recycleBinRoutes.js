// backend/routes/recycleBinRoutes.js
//
// سلة المحذوفات: أي حذف بأي موديول (عبر pgCrud.js) ينقل السجل هنا بدل حذفه
// نهائياً — هذا الملف يوفّر ثلاث عمليات فقط، كلها بصلاحية إدمن حصراً:
//   GET    /api/recycle-bin           قائمة كل العناصر المحذوفة (بحدود منشأة
//                                      المستخدم لو كان مرتبطاً بمنشأة معيّنة)
//   POST   /api/recycle-bin/:id/restore   إرجاع العنصر لجدوله الأصلي
//   DELETE /api/recycle-bin/:id            حذف نهائي من سلة المحذوفات (لا رجعة)
//
// يعتمد على moduleRegistry المُصدَّر من pgCrud.js لمعرفة الجدول الفعلي وبنية
// الأعمدة المفهرسة لكل موديول دون تكرار تلك التفاصيل هنا.
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { moduleRegistry } = require('./pgCrud');
const { logAudit } = require('../utils/auditLog');
const { deleteUploadedFile } = require('../config/uploadConfig');

// كل عمليات سلة المحذوفات بصلاحية إدمن فقط (استرجاع أو حذف نهائي قرار حسّاس)
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'صلاحية إدمن مطلوبة' });
  next();
};

// GET /api/recycle-bin
router.get('/', auth, adminOnly, async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];
    // إدمن مرتبط بمنشأة معيّنة يرى عناصر منشأته فقط؛ إدمن بلا منشأة (وزاري) يرى الكل
    if (req.user?.hospitalId) {
      params.push(req.user.hospitalId);
      conditions.push(`hospital_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT * FROM recycle_bin ${where} ORDER BY deleted_at DESC LIMIT 500`,
      params
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      moduleKey: r.module_key,
      originalId: r.original_id,
      data: r.data,
      hospitalId: r.hospital_id,
      deletedBy: r.deleted_by,
      deletedByName: r.deleted_by_name,
      deletedAt: r.deleted_at,
    })));
  } catch (err) { next(err); }
});

// POST /api/recycle-bin/:id/restore
router.post('/:id/restore', auth, adminOnly, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const binRes = await client.query('SELECT * FROM recycle_bin WHERE id = $1', [req.params.id]);
    if (binRes.rows.length === 0) return res.status(404).json({ message: 'غير موجود بسلة المحذوفات' });
    const binRow = binRes.rows[0];

    if (req.user?.hospitalId && binRow.hospital_id && binRow.hospital_id !== req.user.hospitalId) {
      return res.status(404).json({ message: 'غير موجود' });
    }

    const moduleInfo = moduleRegistry[binRow.module_key];
    if (!moduleInfo) {
      return res.status(409).json({ message: `تعذّر الاسترجاع: الموديول "${binRow.module_key}" لم يعد مسجَّلاً بالنظام.` });
    }
    const { tableName, indexedColumns } = moduleInfo;

    const rest = { ...binRow.data };
    delete rest.id;
    const indexedValues = indexedColumns.map(({ field }) => rest[field] ?? null);
    indexedColumns.forEach(({ field }) => delete rest[field]);

    // نحاول نحافظ على نفس المعرّف الأصلي (يهم لو سجلات ثانية تشير له، مثل
    // dossiers.retiredId) طالما ما صار تعارض مع سجل جديد ياخذ نفس الرقم بالفترة
    // التي كانت فيها بسلة المحذوفات؛ لو وُجد تعارض، نرجعه بمعرّف جديد بدل الفشل.
    const collision = await client.query(`SELECT id FROM ${tableName} WHERE id = $1`, [binRow.original_id]);
    const preserveId = collision.rows.length === 0;

    let sql, values;
    const dataCol = indexedColumns.length === 0 ? 'data' : `${indexedColumns.map(c => c.column).join(', ')}, data`;
    if (preserveId) {
      if (indexedColumns.length === 0) {
        sql = `INSERT INTO ${tableName} (id, data) VALUES ($1, $2) RETURNING *`;
        values = [binRow.original_id, JSON.stringify(rest)];
      } else {
        const placeholders = indexedColumns.map((_, i) => `$${i + 2}`).join(', ');
        sql = `INSERT INTO ${tableName} (id, ${indexedColumns.map(c => c.column).join(', ')}, data) VALUES ($1, ${placeholders}, $${indexedColumns.length + 2}) RETURNING *`;
        values = [binRow.original_id, ...indexedValues, JSON.stringify(rest)];
      }
    } else {
      if (indexedColumns.length === 0) {
        sql = `INSERT INTO ${tableName} (data) VALUES ($1) RETURNING *`;
        values = [JSON.stringify(rest)];
      } else {
        const placeholders = indexedColumns.map((_, i) => `$${i + 1}`).join(', ');
        sql = `INSERT INTO ${tableName} (${indexedColumns.map(c => c.column).join(', ')}, data) VALUES (${placeholders}, $${indexedColumns.length + 1}) RETURNING *`;
        values = [...indexedValues, JSON.stringify(rest)];
      }
    }

    await client.query('BEGIN');
    const inserted = await client.query(sql, values);
    await client.query('DELETE FROM recycle_bin WHERE id = $1', [binRow.id]);
    await client.query('COMMIT');

    const record = { ...inserted.rows[0].data, id: inserted.rows[0].id };
    indexedColumns.forEach(({ field, column }) => { record[field] = inserted.rows[0][column]; });
    logAudit({ action: 'RESTORE', table: tableName, recordId: record.id, note: preserveId ? '' : `معرّف جديد بدل ${binRow.original_id} — تعارض`, userId: req.user?.id, username: req.user?.username });
    res.json({ success: true, record, idChanged: !preserveId });
  } catch (err) {
    // إصلاح حرج: نفس مشكلة مسار الحذف بـ pgCrud.js — ROLLBACK غير محمي يقدر
    // يُسقط السيرفر كامل لو فشل هو نفسه.
    try { await client.query('ROLLBACK'); } catch (rollbackErr) {
      console.error('⚠️ فشل ROLLBACK بعد خطأ استرجاع من سلة المحذوفات:', rollbackErr.message);
    }
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/recycle-bin/:id — حذف نهائي، لا يمكن التراجع عنه أبداً
router.delete('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const binRes = await pool.query('SELECT * FROM recycle_bin WHERE id = $1', [req.params.id]);
    if (binRes.rows.length === 0) return res.status(404).json({ message: 'غير موجود' });
    if (req.user?.hospitalId && binRes.rows[0].hospital_id && binRes.rows[0].hospital_id !== req.user.hospitalId) {
      return res.status(404).json({ message: 'غير موجود' });
    }
    await pool.query('DELETE FROM recycle_bin WHERE id = $1', [req.params.id]);
    // إصلاح: حذف نهائي من سلة المحذوفات لوثيقة إضبارة (موظف/متقاعد) كان يحذف
    // سطر recycle_bin فقط، ويترك الملف المرفق الفعلي يتيماً بمجلد uploads للأبد
    // — هذا هو المسار الذي تستخدمه الواجهة فعلياً (DossiersTab.js يستدعي
    // DELETE /api/dossiers/:id العام، الذي ينقل لسلة المحذوفات أولاً، ثم
    // الحذف الفعلي يصير هنا لاحقاً من صفحة الإعدادات).
    if (binRes.rows[0].module_key === 'dossiers') {
      await deleteUploadedFile(binRes.rows[0].data?.filePath);
    }
    logAudit({ action: 'PURGE', table: 'recycle_bin', recordId: req.params.id, note: 'حذف نهائي — لا رجعة', userId: req.user?.id, username: req.user?.username });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
