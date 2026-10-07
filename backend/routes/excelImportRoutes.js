// backend/routes/excelImportRoutes.js
//
// مصنع مسار استيراد جماعي من ملف Excel، بنفس فكرة pgCrud.js (مصنع قابل لإعادة
// الاستخدام لأكثر من موديول) — يضيف مسار POST /api/<apiName>/import-excel.
//
// نتيجة الاستيراد ليست "الكل أو لا شيء": كل صف يُعالَج ويُحفَظ بشكل مستقل عن
// باقي الصفوف عمداً (بدون معاملة/transaction واحدة تلف الجميع) — لأن الهدف
// هو "استورد كل الصفوف الصحيحة، وأخبرني بالضبط عن الصفوف الخاطئة وسببها"،
// وليس رفض الملف كاملاً بسبب خطأ بصف واحد وسط مئات الصفوف السليمة.
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { validateFields } = require('../middleware/validate');
const { parseExcelBuffer } = require('../utils/excelImport');
const { moduleRegistry } = require('./pgCrud');

// تخزين بالذاكرة فقط (memoryStorage) — الملف يُقرأ ويُحلَّل مباشرة ولا يُكتب
// على القرص إطلاقاً، فلا حاجة لأي تنظيف لاحق ولا خطر تراكم ملفات مؤقتة.
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 ميجا كافية جداً حتى لآلاف الصفوف كنص خام
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

// apiName: اسم المسار (يظهر بالرابط: /api/<apiName>/import-excel)
// tableName: اسم الجدول الفعلي بقاعدة البيانات إن اختلف عن apiName (مثل
//            ambulanceVehicles -> ambulance_vehicles)، بنفس فكرة sqlTableName
//            بملف pgCrud.js — يجب أن يطابق تماماً الاسم المستخدم هناك لنفس
//            الموديول، وإلا يفشل الإدراج بخطأ "الجدول غير موجود"
// schema: نفس مخطط التحقق المستخدم بـ middleware/schemas.js لهذا الموديول
// columnMap: قاموس "عنوان العمود بملف Excel" -> "اسم الحقل الداخلي"
// options.indexedColumns: مطلوب صراحة الآن (بلا قيمة افتراضية) — يجب أن يطابق
//            تماماً نفس المصفوفة المُمرَّرة لـ pgCrud() لنفس الموديول
//            بـ modules.js (حتى لو فاضية [])، وإلا يفشل الإدراج.
//            ── إصلاح fail-fast: كان الافتراض الضمني name/phone/status، وهو
//            خاطئ لأغلب الجداول (تخزين JSONB بحت) — بالضبط نفس خطأ pgCrud.js
//            الذي كسر 4 موديولات فعلياً بالاستيراد (المشاريع، الأقسام،
//            المخزون، الأصول) قبل هذا الإصلاح. نسيان تمريره الآن يوقف تسجيل
//            المسار فوراً برسالة واضحة بدل فشل استيراد غامض لاحقاً.
const registerExcelImport = (router, apiName, schema, columnMap, options = {}) => {
  if (options.indexedColumns === undefined) {
    throw new Error(
      `❌ registerExcelImport('${apiName}'): options.indexedColumns مطلوب صراحة ولا قيمة افتراضية له.\n` +
      `   مرر نفس المصفوفة بالضبط المُستخدَمة بتسجيل pgCrud() لنفس الموديول (حتى لو []).`
    );
  }
  const {
    indexedColumns,
    hospitalScoped = false,
    permission = null,
    tableName = apiName,
    limiter = (req, res, next) => next(), // بدون تحديد معدل إضافي إن لم يُمرَّر
    duplicateCheck = null, // مثال: ['name', 'phone'] — راجع isDuplicate أدناه
    // ── إصلاح: تعبئة افتراضية اختيارية بعد تحليل كل صف ────────────────────────
    // بعض الحقول الرقمية (مثل spent/progress/milestones بموديول المشاريع)
    // ما تكون بأعمدة Excel أصلاً، فتبقى undefined وتكسر حسابات الواجهة
    // (تظهر "NaN%" أو "undefined/undefined"). afterParse(data) دالة اختيارية
    // تُستدعى على كل صف بعد تحليله وقبل التحقق منه — تستطيع إرجاع نسخة معدَّلة
    // بقيم افتراضية معقولة للحقول الناقصة.
    afterParse = null,
  } = options;

  // ── ميزة التصدير إلى Excel: عناوين أعمدة جميلة ─────────────────────────────
  // columnMap يربط عدة عناوين محتملة بنفس الحقل (مثلاً 'الاسم' و'اسم المريض'
  // و'Name' كلها -> 'name'، لمرونة الاستيراد). للتصدير نريد عنوان واحد لطيف
  // لكل حقل — نأخذ أول عنوان نصادفه بترتيب المفاتيح (وهو غالباً التسمية
  // العربية الأساسية بكل تعريفات الموديولات الحالية). يُخزَّن بـ moduleRegistry
  // (نفس السجل المشترك المستخدم لسلة المحذوفات) ليقرأه export-excel بـ
  // pgCrud.js — يعمل حتى لو استُدعيت registerExcelImport قبل pgCrud() لنفس
  // الموديول (ترتيب الاستدعاء الفعلي بـ modules.js)، لأن pgCrud.js يدمج بدل
  // ما يستبدل عند تسجيله لاحقاً.
  const exportHeaders = {};
  Object.entries(columnMap).forEach(([header, field]) => {
    if (!(field in exportHeaders)) exportHeaders[field] = header;
  });
  moduleRegistry[apiName] = { ...moduleRegistry[apiName], exportHeaders };

  // ── إصلاح: كشف التكرار قبل الإدراج ────────────────────────────────────────
  // قبل هذا، رفع نفس الملف مرتين (بالخطأ، أو بعد إضافة صفوف جديدة لملف قديم)
  // كان يُنشئ نسخاً مكررة كاملة لكل سجل، بدون أي تحذير. الآن نتحقق قبل كل
  // إدراج: لو فيه سجل موجود مسبقاً يطابق كل حقول duplicateCheck بالضبط (مثلاً
  // نفس الاسم ونفس الهاتف لمريض)، نتجاوزه ونبلّغ عنه كـ"مكرر" بدل إدراجه مرة
  // ثانية. الحقل المفهرس (indexedColumns) يُستعلَم مباشرة (أسرع)، وأي حقل غير
  // مفهرس يُستعلَم من عمود JSONB (data->>'field') — أبطأ قليلاً لكنه دقيق.
  const isDuplicate = async (data, userHospitalId) => {
    if (!duplicateCheck || duplicateCheck.length === 0) return false;
    const conditions = [];
    const values = [];
    duplicateCheck.forEach((field) => {
      const indexed = indexedColumns.find(c => c.field === field);
      const expr = indexed ? indexed.column : `data->>'${field}'`;
      values.push(data[field] ?? '');
      conditions.push(`${expr} = $${values.length}`);
    });
    // نطاق التحقق يبقى ضمن نفس المنشأة فقط بالأنظمة متعددة المنشآت — نفس
    // الاسم والهاتف بمستشفيين مختلفين حالة مشروعة (مريضين مختلفين)، وليست تكراراً
    if (hospitalScoped && userHospitalId) {
      values.push(userHospitalId);
      conditions.push(`data->>'hospitalId' = $${values.length}`);
    }
    const sql = `SELECT id FROM ${tableName} WHERE ${conditions.join(' AND ')} LIMIT 1`;
    const result = await pool.query(sql, values);
    return result.rows.length > 0;
  };

  // ── تحميل قالب فارغ ──────────────────────────────────────────────────────
  // يبني ملف Excel بصف عناوين + صف مثال واحد، بنفس الأعمدة المتوقعة بالضبط —
  // يريح المستخدم من تخمين أسماء الأعمدة الصحيحة أو ترتيبها.
  if (options.template) {
    router.get(`/${apiName}/import-template`, auth, requirePermission(permission), (req, res, next) => {
      try {
        const headers = options.template.map(t => t.header);
        const example = options.template.map(t => t.example || '');
        const ws = XLSX.utils.aoa_to_sheet([headers, example]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, apiName);
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${apiName}-template.xlsx"`);
        res.send(buffer);
      } catch (err) { next(err); }
    });
  }

  router.post(`/${apiName}/import-excel`, auth, requirePermission(permission), limiter, importUpload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'لم يُرفَع أي ملف' });

      const { rows, error } = parseExcelBuffer(req.file.buffer, columnMap);
      if (error) return res.status(400).json({ message: error });

      const results = { imported: 0, failed: 0, duplicates: 0, errors: [], duplicateRows: [] };

      for (const { rowNumber, data: rawData } of rows) {
        // صف فاضي بالكامل (مثلاً صف أخير زايد بالملف بالخطأ) — تجاهله بصمت
        if (Object.values(rawData).every(v => v === '' || v === undefined)) continue;

        // ── إصلاح: afterParse الآن يُنتظَر (await) ويستقبل hospitalId كمعامل
        // ثانٍ — يسمح لدوال afterParse بعمل استعلام قاعدة بيانات حقيقي أثناء
        // معالجة الصف (مثلاً تحويل اسم ردهة نصي بملف Excel إلى wardId رقمي
        // فعلي بالبحث بجدول wards)، وليس فقط تحويلات محلية على نفس الصف كما
        // كان الحال سابقاً. الدوال المتزامنة (non-async) تبقى تعمل بلا أي
        // تغيير — await على قيمة عادية غير Promise يرجعها كما هي فوراً.
        const data = afterParse ? await afterParse(rawData, hospitalScoped ? req.user?.hospitalId : null) : rawData;

        const rowErrors = validateFields(schema, data);
        if (rowErrors.length > 0) {
          results.failed++;
          results.errors.push({ row: rowNumber, messages: rowErrors });
          continue;
        }

        // فرض منشأة المستخدم تلقائياً — نفس منطق pgCrud.js بالضبط
        if (hospitalScoped && req.user?.hospitalId) {
          data.hospitalId = req.user.hospitalId;
        }
        if (!data.status) data.status = 'active'; // قيمة افتراضية معقولة لو العمود غير موجود بالملف

        try {
          if (await isDuplicate(data, req.user?.hospitalId)) {
            results.duplicates++;
            results.duplicateRows.push({ row: rowNumber, name: data.name || data.title || '' });
            continue;
          }
        } catch (dupErr) {
          // فشل فحص التكرار نفسه (مثلاً عمود JSONB بحاجة صياغة مختلفة) — لا
          // نوقف الاستيراد كله بسببه، نكمل للإدراج مباشرة كما لو لا يوجد تكرار
          console.warn(`⚠️ [${apiName}] فشل فحص التكرار للصف ${rowNumber}:`, dupErr.message);
        }

        const indexedValues = indexedColumns.map(({ field }) => data[field] ?? null);
        const rest = { ...data };
        indexedColumns.forEach(({ field }) => delete rest[field]);

        // نفس فرع الحالتين المستخدم بـ pgCrud.js بالضبط: تخزين JSONB بحت لو
        // لا توجد أعمدة فهرسة إضافية (مثل ambulanceVehicles)، أو أعمدة + JSONB
        let insertSql, insertValues;
        if (indexedColumns.length === 0) {
          insertSql = `INSERT INTO ${tableName} (data) VALUES ($1)`;
          insertValues = [JSON.stringify(rest)];
        } else {
          const columnsSql = indexedColumns.map(c => c.column).join(', ');
          const placeholders = indexedColumns.map((_, i) => `$${i + 1}`).join(', ');
          const dataPlaceholder = `$${indexedColumns.length + 1}`;
          insertSql = `INSERT INTO ${tableName} (${columnsSql}, data) VALUES (${placeholders}, ${dataPlaceholder})`;
          insertValues = [...indexedValues, JSON.stringify(rest)];
        }

        try {
          await pool.query(insertSql, insertValues);
          results.imported++;
        } catch (dbErr) {
          results.failed++;
          results.errors.push({ row: rowNumber, messages: ['خطأ حفظ بقاعدة البيانات: ' + dbErr.message] });
        }
      }

      console.log(`📥 [${apiName}] استيراد Excel: ${results.imported} نجح، ${results.duplicates} مكرر، ${results.failed} فشل — بواسطة user #${req.user?.id}`);
      res.json(results);
    } catch (err) { next(err); }
  });
};

module.exports = registerExcelImport;
