// backend/routes/documentLookupRoutes.js
//
// Looks up an official letter (outgoing or incoming) by its reference
// number — used by the barcode page: scan a barcode, get the letter's
// details immediately, no manual search needed.
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const multer = require('multer');
const XLSX = require('xlsx');
const { parseExcelBuffer } = require('../utils/excelImport');

const barcodeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ── نفس جدول Code 39 المستخدَم بالضبط بـ hr/BarcodeTab.js — منقول هنا حرفياً
// لتوليد الباركود على الخادم أثناء الاستيراد الجماعي (بدون الحاجة لفتح
// الصفحة لكل كتاب على حدة). QR غير مدعوم هنا عمداً — يحتاج مكتبة خارجية
// بالمتصفح (qrcode-generator) غير متوفرة بالخادم؛ كتب الأرقام العربية
// (التي تحتاج QR حصراً) تبقى بحاجة فتح الصفحة يدوياً مرة واحدة لكل كتاب،
// نفس ما هو موثّق بالتعليق أعلى الحفظ التلقائي بـBarcodeTab.js.
const CODE39 = {
  '0':'NNNWWNWNN','1':'WNNWNNNNW','2':'NNWWNNNNW','3':'WNWWNNNNN',
  '4':'NNNWWNNNW','5':'WNNWWNNNN','6':'NNWWWNNNN','7':'NNNWNNWNW',
  '8':'WNNWNNWNN','9':'NNWWNNWNN','A':'WNNNNWNNW','B':'NNWNNWNNW',
  'C':'WNWNNWNNN','D':'NNNNWWNNW','E':'WNNNWWNNN','F':'NNWNWWNNN',
  'G':'NNNNNWWNW','H':'WNNNNWWNN','I':'NNWNNWWNN','J':'NNNNWWWNN',
  'K':'WNNNNNNWW','L':'NNWNNNNWW','M':'WNWNNNNWN','N':'NNNNWNNWW',
  'O':'WNNNWNNWN','P':'NNWNWNNWN','Q':'NNNNNNWWW','R':'WNNNNNWWN',
  'S':'NNWNNNWWN','T':'NNNNWNWWN','U':'WWNNNNNNW','V':'NWWNNNNNW',
  'W':'WWWNNNNNN','X':'NWNNWNNNW','Y':'WWNNWNNNN','Z':'NWWNWNNNN',
  '-':'NWNNNNWNW','.':'WWNNNNWNN',' ':'NWWNNNWNN','*':'NWNNWNWNN',
  '$':'NWNWNWNNN','/':'NWNWNNNWN','+':'NWNNNWNWN','%':'NNNWNWNWN',
};
function code39ToSvg(rawText, height = 60) {
  const text = ('*' + rawText.toUpperCase() + '*');
  let x = 0;
  const narrow = 3, wide = 9, gap = 3;
  const bars = [];
  for (const ch of text) {
    const pattern = CODE39[ch];
    if (!pattern) continue;
    for (let i = 0; i < pattern.length; i++) {
      const isBar = i % 2 === 0;
      const w = pattern[i] === 'W' ? wide : narrow;
      if (isBar) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`);
      x += w;
    }
    x += gap;
  }
  const totalWidth = x + 10;
  return `<svg viewBox="0 0 ${totalWidth} ${height}" xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}">${bars.join('')}</svg>`;
}
const hasArabic = (text) => /[\u0600-\u06FF]/.test(text || '');

router.get('/document-lookup/search', auth, async (req, res, next) => {
  try {
    const q = `%${req.query.q || ''}%`;
    const cols = `id, data->>'ref' AS ref, data->>'title' AS title, data->>'to' AS "to", data->>'from' AS "from", data->>'subject' AS subject, data->>'date' AS date, data->>'barcodeSvg' AS "barcodeSvg", data->>'barcodeType' AS "barcodeType"`;
    const where = `WHERE data->>'ref' ILIKE $1 OR data->>'title' ILIKE $1 OR data->>'to' ILIKE $1 OR data->>'from' ILIKE $1`;

    const outgoing = await pool.query(`SELECT ${cols}, 'outgoing' AS type FROM outgoing ${where} LIMIT 20`, [q]);
    const incoming = await pool.query(`SELECT ${cols}, 'incoming' AS type FROM incoming ${where} LIMIT 20`, [q]);

    res.json([...outgoing.rows, ...incoming.rows]);
  } catch (err) { next(err); }
});

// ── حفظ صورة الباركود المولَّدة على سجل الكتاب نفسه ──────────────────────────
// إصلاح: كانت صورة الباركود تُولَّد لحظياً بالمتصفح كل مرة (توليد نصي بحت،
// بدون حفظ)، فأي قراءة لاحقة بالمسح تعتمد على نفس خوارزمية التوليد وقت
// القراءة — لو تغيّرت الخوارزمية مستقبلاً، الباركود المطبوع على الورق فعلياً
// ما يعود يطابق الصورة المُعاد توليدها. الآن تُحفَظ الصورة (SVG كنص) مباشرة
// بحقل إضافي `barcodeSvg` ضمن نفس سجل الكتاب (outgoing/incoming) — بدون جدول
// منفصل، لأنها بيانات تخص الكتاب نفسه بالضبط (نفس علاقة 1-إلى-1).
router.post('/document-lookup/save-barcode', auth, async (req, res, next) => {
  try {
    const { type, id, barcodeSvg, barcodeType } = req.body || {};
    if (!type || !id || !barcodeSvg) {
      return res.status(400).json({ message: 'type و id و barcodeSvg كلها مطلوبة' });
    }
    const table = type === 'outgoing' ? 'outgoing' : type === 'incoming' ? 'incoming' : null;
    if (!table) return res.status(400).json({ message: 'type يجب أن يكون outgoing أو incoming' });

    const result = await pool.query(
      `UPDATE ${table}
       SET data = jsonb_set(jsonb_set(data, '{barcodeSvg}', to_jsonb($1::text)), '{barcodeType}', to_jsonb($2::text))
       WHERE id = $3
       RETURNING id, data`,
      [barcodeSvg, barcodeType || null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'الكتاب غير موجود' });
    res.json({ id: result.rows[0].id, ...result.rows[0].data });
  } catch (err) { next(err); }
});

router.get('/document-lookup-ref', auth, async (req, res, next) => {
  try {
    const ref = (req.query.ref || '').trim();
    if (!ref) return res.status(400).json({ message: 'ref required' });

    const outgoing = await pool.query(
      `SELECT id, data FROM outgoing WHERE TRIM(data->>'ref') = $1 LIMIT 1`,
      [ref]
    );
    if (outgoing.rows.length > 0) {
      return res.json({ found: true, type: 'outgoing', id: outgoing.rows[0].id, ...outgoing.rows[0].data });
    }

    const incoming = await pool.query(
      `SELECT id, data FROM incoming WHERE TRIM(data->>'ref') = $1 LIMIT 1`,
      [ref]
    );
    if (incoming.rows.length > 0) {
      return res.json({ found: true, type: 'incoming', id: incoming.rows[0].id, ...incoming.rows[0].data });
    }

    res.json({ found: false });
  } catch (err) { next(err); }
});

router.get('/barcode/import-template', auth, requirePermission('hr'), (req, res, next) => {
  try {
    const ws = XLSX.utils.aoa_to_sheet([['رقم الكتاب'], ['ص-2026-001']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'barcode');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="barcode-template.xlsx"');
    res.send(buffer);
  } catch (err) { next(err); }
});

// ── تصدير: قائمة كل الكتب (صادرة ووارد) مع حالة الباركود لكل واحد ────────────
router.get('/barcode/export-excel', auth, requirePermission('hr'), async (req, res, next) => {
  try {
    const cols = `data->>'ref' AS ref, data->>'title' AS title, data->>'barcodeSvg' IS NOT NULL AS "hasBarcode", data->>'barcodeType' AS "barcodeType"`;
    const outgoing = await pool.query(`SELECT ${cols}, 'outgoing' AS type FROM outgoing ORDER BY id DESC`);
    const incoming = await pool.query(`SELECT ${cols}, 'incoming' AS type FROM incoming ORDER BY id DESC`);
    const all = [...outgoing.rows, ...incoming.rows];

    const rows = all.map(r => ([
      r.type === 'outgoing' ? 'صادر' : 'وارد',
      r.ref || '',
      r.title || '',
      r.hasBarcode ? 'نعم' : 'لا',
      r.hasBarcode ? (r.barcodeType === 'qr' ? 'QR' : 'Code 39') : '',
    ]));
    const ws = XLSX.utils.aoa_to_sheet([
      ['النوع', 'رقم الكتاب', 'العنوان', 'له باركود محفوظ', 'نوع الباركود المحفوظ'],
      ...rows,
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'barcodes');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="barcodes.xlsx"');
    res.send(buffer);
  } catch (err) { next(err); }
});

// ── استيراد: توليد وحفظ باركود Code 39 دفعة واحدة لقائمة أرقام كتب ───────────
// كل صف = رقم كتاب واحد (عمود "رقم الكتاب" أو "Ref"). يبحث عن الرقم بجدولي
// outgoing وincoming، ولو وجده ومحتوٍ أرقام/حروف إنجليزية فقط (Code 39 يدعمها)،
// يولّد الباركود ويحفظه مباشرة. أرقام الكتب التي فيها حرف عربي تحتاج QR حصراً
// (غير مدعوم هنا)، فتُرجَع بقائمة "تحتاج فتح الصفحة يدوياً" بدل تجاهلها بصمت.
router.post('/barcode/import-excel', auth, requirePermission('hr'), barcodeUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'لم يُرفَع أي ملف' });

    const { rows, error } = parseExcelBuffer(req.file.buffer, {
      'رقم الكتاب': 'ref', 'Ref': 'ref', 'Reference': 'ref',
    });
    if (error) return res.status(400).json({ message: error });

    const results = { imported: 0, duplicates: 0, failed: 0, errors: [], duplicateRows: [] };

    for (const { rowNumber, data } of rows) {
      const ref = (data.ref || '').toString().trim();
      if (!ref) continue;

      let found = await pool.query(`SELECT id, data FROM outgoing WHERE TRIM(data->>'ref') = $1 LIMIT 1`, [ref]);
      let table = 'outgoing';
      if (found.rows.length === 0) {
        found = await pool.query(`SELECT id, data FROM incoming WHERE TRIM(data->>'ref') = $1 LIMIT 1`, [ref]);
        table = 'incoming';
      }
      if (found.rows.length === 0) {
        results.failed++;
        results.errors.push({ row: rowNumber, messages: [`لم يُعثر على كتاب برقم "${ref}"`] });
        continue;
      }

      const rec = found.rows[0];
      if (rec.data.barcodeSvg) {
        results.duplicates++;
        results.duplicateRows.push({ row: rowNumber, name: `${ref} (له باركود محفوظ مسبقاً)` });
        continue;
      }
      if (hasArabic(ref)) {
        results.failed++;
        results.errors.push({ row: rowNumber, messages: [`"${ref}" يحتوي حرفاً عربياً — يحتاج QR، افتح الكتاب من تبويب "توليد" يدوياً مرة وحدة`] });
        continue;
      }

      try {
        const svg = code39ToSvg(ref);
        await pool.query(
          `UPDATE ${table} SET data = jsonb_set(jsonb_set(data, '{barcodeSvg}', to_jsonb($1::text)), '{barcodeType}', to_jsonb('code39'::text)) WHERE id = $2`,
          [svg, rec.id]
        );
        results.imported++;
      } catch (dbErr) {
        results.failed++;
        results.errors.push({ row: rowNumber, messages: ['خطأ حفظ بقاعدة البيانات: ' + dbErr.message] });
      }
    }

    console.log(`📥 [barcode] استيراد دفعة: ${results.imported} تولّد، ${results.duplicates} موجود مسبقاً، ${results.failed} فشل`);
    res.json(results);
  } catch (err) { next(err); }
});

module.exports = router;
