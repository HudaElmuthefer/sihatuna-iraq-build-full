// backend/routes/medicalCodesRoutes.js
//
// Search, add, and get statistics for ICD-10 / SNOMED CT reference codes.
// Backed by the medical_codes database table (see
// migrations-sql/007_medical_codes.sql) — not a static file anymore, so
// staff can add missing codes themselves from the UI without needing a
// code change.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { pool } = require('../config/database');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      const err = new Error('الملف يجب أن يكون بصيغة Excel (.xlsx أو .xls)');
      err.statusCode = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

// GET /api/medical-codes-icd/import-template ، /api/medical-codes-snomed/import-template
function registerTemplateRoute(system) {
  router.get(`/medical-codes-${system}/import-template`, auth, (req, res) => {
    const headers = system === 'snomed'
      ? [['code', 'nameAr', 'nameEn', 'icdLink'], ['195967001', 'الربو', 'Asthma', 'J45']]
      : [['code', 'nameAr', 'nameEn'], ['J45', 'الربو', 'Asthma']];
    const ws = XLSX.utils.aoa_to_sheet(headers);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'codes');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="medical-codes-${system}-template.xlsx"`);
    res.send(buffer);
  });
}
registerTemplateRoute('icd');
registerTemplateRoute('snomed');

// GET /api/medical-codes-icd/export-excel ، /api/medical-codes-snomed/export-excel
// كانت غائبة تماماً — الاستيراد فقط كان موجوداً بلا أي طريقة لتصدير الرموز
// الحالية. مسجَّلة بنفس نمط مسار الاستيراد بالضبط (نفس apiName) حتى يعمل
// مكوّن ExcelExportButton الجاهز مباشرة بدون أي تعديل إضافي بالواجهة.
function registerExportRoute(system) {
  router.get(`/medical-codes-${system}/export-excel`, auth, async (req, res, next) => {
    try {
      const result = await pool.query(
        'SELECT code, name_ar AS "nameAr", name_en AS "nameEn", icd_link AS "icdLink" FROM medical_codes WHERE system = $1 ORDER BY code',
        [system]
      );
      const headers = system === 'snomed' ? ['code', 'nameAr', 'nameEn', 'icdLink'] : ['code', 'nameAr', 'nameEn'];
      const rows = result.rows.map(r => headers.map(h => r[h] ?? ''));
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'codes');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="medical-codes-${system}-${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } catch (err) { next(err); }
  });
}
registerExportRoute('icd');
registerExportRoute('snomed');

// ── ربط تشخيصات ICD-10/SNOMED CT بمرضى حقيقيين دفعة واحدة ────────────────────
// مختلف عن كل استيرادات Excel الثانية بالنظام: هذا لا يُنشئ سجلات جديدة، بل
// يُحدِّث سجلات patients الموجودة فعلاً (يضيف عنصراً لمصفوفة diagnoses[]
// المخزَّنة بسجل كل مريض) — لهذا السبب لا يستطيع استخدام مصنع registerExcelImport
// العام (مصمَّم للإدراج فقط INSERT). يطابق نفس شكل عنصر diagnoses[] المستخدَم
// فعلياً بـ PatientsPage.js بالضبط: {id, icdCode, icdNameAr, icdNameEn,
// snomedCode, snomedNameAr, snomedNameEn, isPrimary, dateAdded}.
router.get('/patient-diagnoses/import-template', auth, (req, res) => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['اسم المريض', 'رمز ICD-10', 'الاسم بالعربي', 'الاسم بالإنجليزي', 'رمز SNOMED CT', 'تاريخ الإضافة'],
    ['Test Patient CBC 1', 'I21.9', 'احتشاء عضلة قلبية حاد، غير محدد', 'Acute myocardial infarction, unspecified', '', '2026-07-01'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'diagnoses');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="patient-diagnoses-template.xlsx"');
  res.send(buffer);
});

router.post('/patient-diagnoses/import-excel', auth, importUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'لم يُرفَع أي ملف' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const results = { imported: 0, duplicates: 0, failed: 0, errors: [], duplicateRows: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const patientName = String(row['اسم المريض'] || row['Patient Name'] || '').trim();
      const icdCode = String(row['رمز ICD-10'] || row['ICD-10 Code'] || '').trim();
      if (!patientName || !icdCode) {
        results.failed++;
        results.errors.push({ row: i + 2, messages: ['اسم المريض ورمز ICD-10 مطلوبان'] });
        continue;
      }

      try {
        const patientResult = await pool.query('SELECT id, data FROM patients WHERE name = $1 LIMIT 1', [patientName]);
        if (patientResult.rows.length === 0) {
          results.failed++;
          results.errors.push({ row: i + 2, messages: [`لم يُعثر على مريض باسم "${patientName}"`] });
          continue;
        }
        const patient = patientResult.rows[0];
        const existingDiagnoses = Array.isArray(patient.data?.diagnoses) ? patient.data.diagnoses : [];

        if (existingDiagnoses.some(d => d.icdCode === icdCode)) {
          results.duplicates++;
          results.duplicateRows.push({ row: i + 2, name: `${patientName} — ${icdCode}` });
          continue;
        }

        const newDiagnosis = {
          id: Date.now() + Math.floor(Math.random() * 100000),
          icdCode,
          icdNameAr: String(row['الاسم بالعربي'] || '').trim(),
          icdNameEn: String(row['الاسم بالإنجليزي'] || '').trim(),
          snomedCode: String(row['رمز SNOMED CT'] || '').trim(),
          snomedNameAr: '',
          snomedNameEn: '',
          isPrimary: existingDiagnoses.length === 0,
          dateAdded: String(row['تاريخ الإضافة'] || new Date().toISOString().split('T')[0]).trim(),
        };
        const updatedDiagnoses = [...existingDiagnoses, newDiagnosis];
        await pool.query(
          `UPDATE patients SET data = jsonb_set(data, '{diagnoses}', $1::jsonb) WHERE id = $2`,
          [JSON.stringify(updatedDiagnoses), patient.id]
        );
        results.imported++;
      } catch (err) {
        results.failed++;
        results.errors.push({ row: i + 2, messages: ['خطأ حفظ بقاعدة البيانات: ' + err.message] });
      }
    }

    console.log(`📥 [patient-diagnoses] استيراد: ${results.imported} تمّ، ${results.duplicates} مكرر، ${results.failed} فشل`);
    res.json(results);
  } catch (err) { next(err); }
});

// POST /api/medical-codes-icd/import-excel ، /api/medical-codes-snomed/import-excel
// Bulk import — each row is processed independently (one bad row doesn't
// block the rest), matching the pattern used elsewhere in this app.
function registerImportRoute(system) {
  router.post(`/medical-codes-${system}/import-excel`, auth, importUpload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'لم يُرفَع أي ملف' });

      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      let imported = 0;
      const errors = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const code = String(row.code || '').trim();
        const nameAr = String(row.nameAr || '').trim();
        const nameEn = String(row.nameEn || '').trim();
        const icdLink = row.icdLink ? String(row.icdLink).trim() : null;

        if (!code || !nameAr || !nameEn) {
          errors.push({ row: i + 2, messages: ['الرمز والاسم بالعربي والإنكليزي مطلوبة'] });
          continue;
        }
        try {
          await pool.query(
            `INSERT INTO medical_codes (system, code, name_ar, name_en, icd_link)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (system, code) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en, icd_link = EXCLUDED.icd_link`,
            [system, code, nameAr, nameEn, icdLink]
          );
          imported++;
        } catch (err) {
          errors.push({ row: i + 2, messages: [err.message] });
        }
      }

      res.json({ imported, failed: errors.length, errors });
    } catch (err) { next(err); }
  });
}
registerImportRoute('icd');
registerImportRoute('snomed');

// GET /api/medical-codes/search?system=icd|snomed&q=...
router.get('/medical-codes/search', auth, async (req, res, next) => {
  try {
    const system = req.query.system === 'snomed' ? 'snomed' : 'icd';
    const q = (req.query.q || '').trim();

    let result;
    if (!q) {
      result = await pool.query(
        'SELECT code, name_ar AS "nameAr", name_en AS "nameEn" FROM medical_codes WHERE system = $1 ORDER BY code LIMIT 20',
        [system]
      );
    } else {
      result = await pool.query(
        `SELECT code, name_ar AS "nameAr", name_en AS "nameEn" FROM medical_codes
         WHERE system = $1 AND (code ILIKE $2 OR name_ar ILIKE $2 OR name_en ILIKE $2)
         ORDER BY code LIMIT 20`,
        [system, `%${q}%`]
      );
    }
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/medical-codes/browse?system=icd|snomed&q=...&page=1
// Paginated listing for the admin management page — lets staff browse
// and search the whole table, not just get top-20 autocomplete results.
router.get('/medical-codes/browse', auth, async (req, res, next) => {
  try {
    const system = req.query.system === 'snomed' ? 'snomed' : 'icd';
    const q = (req.query.q || '').trim();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const where = q ? 'WHERE system = $1 AND (code ILIKE $2 OR name_ar ILIKE $2 OR name_en ILIKE $2)' : 'WHERE system = $1';
    const params = q ? [system, `%${q}%`] : [system];

    const countResult = await pool.query(`SELECT COUNT(*) FROM medical_codes ${where}`, params);
    const dataResult = await pool.query(
      `SELECT id, code, name_ar AS "nameAr", name_en AS "nameEn", icd_link AS "icdLink" FROM medical_codes ${where} ORDER BY code LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count, 10), page, totalPages: Math.max(Math.ceil(countResult.rows[0].count / limit), 1) });
  } catch (err) { next(err); }
});

// POST /api/medical-codes — add a new code. Any logged-in staff member can
// add one (not restricted to admin) since this is exactly the "I need a
// code that isn't in the list" scenario raised directly by the user.
router.post('/medical-codes', auth, async (req, res, next) => {
  try {
    const { system, code, nameAr, nameEn, icdLink } = req.body;
    if (!system || !['icd', 'snomed'].includes(system)) return res.status(400).json({ message: 'صيغة system غير صحيحة' });
    if (!code || !nameAr || !nameEn) return res.status(400).json({ message: 'الرمز والاسم بالعربي والإنكليزي مطلوبة' });

    const result = await pool.query(
      `INSERT INTO medical_codes (system, code, name_ar, name_en, icd_link)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (system, code) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en, icd_link = EXCLUDED.icd_link
       RETURNING id, system, code, name_ar AS "nameAr", name_en AS "nameEn", icd_link AS "icdLink"`,
      [system, code.trim(), nameAr.trim(), nameEn.trim(), icdLink?.trim() || null]
    );
    res.json({ success: true, code: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/medical-codes/:id
router.delete('/medical-codes/:id', auth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM medical_codes WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/medical-codes/stats
// Counts how often each ICD *and* SNOMED code appears across all
// patients' diagnosis entries — both systems, not just ICD. This is the
// actual practical payoff of coding diagnoses at all: real statistics on
// the most common conditions seen, instead of unstructured free-text
// that can't be aggregated or compared.
router.get('/medical-codes/stats', auth, async (req, res, next) => {
  try {
    const icdResult = await pool.query(`
      SELECT diag->>'icdCode' AS code, COUNT(*) AS occurrences
      FROM patients, jsonb_array_elements(
        CASE WHEN jsonb_typeof(data->'diagnoses') = 'array' THEN data->'diagnoses' ELSE '[]'::jsonb END
      ) AS diag
      WHERE diag->>'icdCode' IS NOT NULL AND diag->>'icdCode' != ''
      GROUP BY diag->>'icdCode' ORDER BY occurrences DESC LIMIT 20
    `);
    const snomedResult = await pool.query(`
      SELECT diag->>'snomedCode' AS code, COUNT(*) AS occurrences
      FROM patients, jsonb_array_elements(
        CASE WHEN jsonb_typeof(data->'diagnoses') = 'array' THEN data->'diagnoses' ELSE '[]'::jsonb END
      ) AS diag
      WHERE diag->>'snomedCode' IS NOT NULL AND diag->>'snomedCode' != ''
      GROUP BY diag->>'snomedCode' ORDER BY occurrences DESC LIMIT 20
    `);

    const attachNames = async (rows, system) => {
      if (rows.length === 0) return [];
      const codes = rows.map((row) => row.code);
      const meta = await pool.query(
        'SELECT code, name_ar AS "nameAr", name_en AS "nameEn" FROM medical_codes WHERE system = $1 AND code = ANY($2::text[])',
        [system, codes]
      );
      const metaByCode = new Map(meta.rows.map((m) => [m.code, m]));
      return rows.map((row) => {
        const m = metaByCode.get(row.code);
        return { code: row.code, occurrences: parseInt(row.occurrences, 10), nameAr: m?.nameAr || row.code, nameEn: m?.nameEn || row.code };
      });
    };

    res.json({
      icd: await attachNames(icdResult.rows, 'icd'),
      snomed: await attachNames(snomedResult.rows, 'snomed'),
    });
  } catch (err) { next(err); }
});

module.exports = router;
