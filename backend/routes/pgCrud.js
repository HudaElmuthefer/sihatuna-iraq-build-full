// backend/routes/pgCrud.js
//
// مصنع مسارات CRUD موحّد يعمل على PostgreSQL، بنفس فكرة crud() الأصلية
// (المستخدمة لملف db.json) لكن بتخزين فعلي بقاعدة بيانات علائقية.
//
// استراتيجية التخزين: عمود "data" من نوع JSONB يحمل كامل بيانات السجل كما
// ترسلها الواجهة تماماً، بينما أعمدة صريحة محدَّدة (indexedColumns) للفهرسة
// والبحث السريع فقط. هذا يتجنّب مشكلة واجهناها سابقاً: أي افتراض خاطئ بأسماء
// الأعمدة (مثل ما حصل مع مخطط تحقق المواعيد) يرفض عمليات الحفظ بصمت. بهذا
// النمط، أي حقل جديد تضيفه الواجهة مستقبلاً يُخزَّن ويُسترجَع تلقائياً دون أي
// حاجة لتعديل بنية الجدول.
//
// المعامل الرابع (indexedColumns) مصفوفة عناصر بالشكل { field, column }:
//   field  = اسم الحقل كما ترسله الواجهة بالضبط (مثل "patientId")
//   column = اسم العمود الفعلي بقاعدة البيانات (مثل "patient_id")
// هذا يسمح باختلاف التسمية بين الواجهة (camelCase عادة) وقاعدة البيانات
// (snake_case حسب الاتفاقية المتّبعة ببقية الجداول)، بدل افتراض تطابق الاسمين.
//
// المعامل السادس (options.hospitalScoped) — دعم المنشآت المتعددة (مرحلة 4):
// لو true، يُطبَّق فرض تلقائي لمنشأة المستخدم على كل عملية:
//   - GET all: يُفلتر النتائج لمنشأة المستخدم فقط (data->>'hospitalId')
//   - GET one / PUT / DELETE: يرفض الوصول (404) لسجل يخص منشأة أخرى
//   - POST: يفرض hospitalId المستخدم على السجل الجديد، متجاهلاً أي قيمة
//     أرسلها العميل (حماية من انتحال منشأة أخرى عبر تعديل الطلب يدوياً)
// الفلترة تُطبَّق فقط لو المستخدم نفسه له hospitalId مُعيَّن (بحساباته —
// انظر عمود hospitalId بملف db.json لجدول users). المستخدم بلا hospitalId
// (مثل حساب إدمن على مستوى الوزارة) يرى كل شيء بلا فلترة — هذا سلوك مقصود.
//
// تحقق دائماً من الحقول الفعلية بصفحة الفرونت إند قبل التحديد — هذا بالضبط
// الدرس المستفاد من خطأ سابق بمخطط تحقق المواعيد.
//
// العقد (Contract) الخارجي مطابق تماماً لمسارات db.json الأصلية:
//   GET    /api/<table>        -> قائمة كاملة (أو مفلترة حسب المنشأة)
//   GET    /api/<table>/:id    -> سجل واحد
//   POST   /api/<table>        -> إنشاء (يُعيد السجل الكامل مع id)
//   PUT    /api/<table>/:id    -> تعديل
//   DELETE /api/<table>/:id    -> حذف
// بهذا لا يحتاج الفرونت إند أي تعديل عند التحويل من db.json إلى PostgreSQL.
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { logAudit } = require('../utils/auditLog');
const validate = require('../middleware/validate');
const requirePermission = require('../middleware/requirePermission');
const XLSX = require('xlsx');
// ── المرحلة الثانية: تخزين مؤقت اختياري (Redis) ─────────────────────────────
// راجع شرح نمط "الأجيال" (versioned cache) بأعلى utils/redisService.js.
// مفعَّل فقط للموديولات التي تمرر options.cache صراحة (حالياً: doctors،
// inventory، employees — راجع routes/modules.js) — بيانات تُقرأ كثيراً
// بصفحات متعددة (قوائم منسدلة...) وتتغيّر نادراً نسبياً. صفر تأثير على أي
// موديول آخر لم يفعّله (فحص `if (cache)` واحد فقط، بلا أي استدعاء Redis).
const { getCacheVersion, bumpCacheVersion, cacheGet, cacheSet } = require('../utils/redisService');

const DEFAULT_COLUMNS = [
  { field: 'name', column: 'name' },
  { field: 'phone', column: 'phone' },
  { field: 'status', column: 'status' },
];

// قيمة خاصة تُفهَم بمعالجة extraFilterFields أدناه كـ"الحقل غائب أو فارغ"،
// بدل تطابق تام حرفي — راجع التعليق عند استخدامها بالأسفل.
const UNSET_FILTER_VALUE = '__unset__';

// ── سجل الموديولات (Module Registry) ────────────────────────────────────────
// كل استدعاء لـ pgCrud() يسجّل نفسه هنا (apiName -> { tableName, indexedColumns,
// hospitalScoped }). سلة المحذوفات (recycleBinRoutes.js) تستخدم هذا السجل
// لمعرفة كيف تُعيد إدراج سجل مسترجَع بجدوله الأصلي الصحيح، دون أي معرفة
// مسبقة بتفاصيل كل موديول على حدة — تفادياً لتكرار نفس التفاصيل بمكانين.
const moduleRegistry = {};

// المعامل الخامس (sqlTableName) اختياري: يحدد اسم الجدول الفعلي بقاعدة البيانات
// إذا كان مختلفاً عن اسم المسار بالـ API (apiName). مطلوب فقط للموديولات التي
// اسمها camelCase بالواجهة (مثل "medicalLeaves") بينما اسم الجدول snake_case
// حسب اتفاقية PostgreSQL القياسية (medical_leaves) — مسار الـ API يبقى دائماً
// كما يتوقعه الفرونت إند، بينما الاستعلامات الداخلية تستخدم اسم الجدول الصحيح.
//
// ── إصلاح أمان-من-الانكسار (fail-fast) ──────────────────────────────────────
// المعامل الرابع (indexedColumns) لم يعد له قيمة افتراضية إطلاقاً. سابقاً كان
// الافتراض DEFAULT_COLUMNS (أعمدة name/phone/status) — فأي تسجيل موديول جديد
// نسي تمريره صراحة كان يفترض ضمنياً أن الجدول يملك هذه الأعمدة، وإذا لم يملكها
// فعلاً (وهي الغالبية العظمى من الجداول، المبنية بتخزين JSONB بحت)، تفشل كل
// عملية POST/PUT بصمت برسالة SQL غامضة ("column X does not exist") لا تظهر
// إلا لحظة أول محاولة حفظ فعلية من مستخدم حقيقي — بالضبط ما حصل بـ 15 موديول
// مختلفة قبل هذا الإصلاح. الآن: نسيان تمريره يوقف تشغيل الخادم فوراً برسالة
// واضحة، وليس خطأ SQL غامضاً لاحقاً. الموديولات التي تملك فعلاً أعمدة name/phone/
// status الحقيقية (مثل patients و doctors) تمرر DEFAULT_COLUMNS صراحة.
const pgCrud = (router, apiName, schema, indexedColumns, sqlTableName = apiName, options = {}) => {
  if (indexedColumns === undefined) {
    throw new Error(
      `❌ pgCrud('${apiName}'): المعامل الرابع (indexedColumns) مطلوب صراحة ولا قيمة افتراضية له.\n` +
      `   مرر [] لو الجدول تخزين JSONB بحت (الحالة الأكثر شيوعاً — راجع postgres_schema.sql)، ` +
      `أو مصفوفة { field, column } لو فيه أعمدة مفهرسة حقيقية، ` +
      `أو DEFAULT_COLUMNS المُصدَّرة من هذا الملف لو الجدول يطابق أعمدة name/phone/status القياسية.`
    );
  }
  const tableName = sqlTableName; // اسم الجدول الفعلي بكل استعلامات SQL أدناه
  const { hospitalScoped = false, permission = null, openRead = false, searchFields = [], extraFilterFields = [], dateRangeField = null, dateRangeColumn = null, cache = null } = options;
  moduleRegistry[apiName] = { ...moduleRegistry[apiName], tableName, indexedColumns, hospitalScoped, permission };
  // ── فحص صلاحيات (RBAC) على القراءة والكتابة ──────────────────────────────────
  // الكتابة (POST/PUT/DELETE): مقيّدة دائماً بصلاحية الموديول لو كانت محدَّدة.
  // القراءة (GET): مقيّدة بنفس الصلاحية أيضاً، إلا لو openRead=true — استثناء
  // مقصود فقط لبيانات مرجعية (مرضى/أطباء/أقسام/مواعيد) تحتاجها صفحات أخرى
  // كثيرة لعرض أسماء بقوائم منسدلة أو بجانب سجلات ثانية (مثلاً صفحة الفوترة
  // تعرض اسم المريض من موديول patients رغم إن المحاسب ما عنده صلاحية "patients"
  // نفسها). تأكدت من هذا بمراجعة كل صفحات الفرونت إند فعلياً قبل التطبيق —
  // راجع ملاحظة "لماذا القراءة المفتوحة" بالمحادثة لو احتجت تضيّق هذا لاحقاً.
  const writePermission = requirePermission(permission);
  const readPermission = openRead ? (req, res, next) => next() : requirePermission(permission);

  // يحوّل صف قاعدة البيانات (row) إلى الشكل الذي تتوقعه الواجهة: كائن واحد
  // مسطّح يدمج الأعمدة الصريحة (بأسماء حقول الواجهة) مع محتوى JSONB.
  const rowToRecord = (row) => {
    const record = { ...row.data, id: row.id };
    indexedColumns.forEach(({ field, column }) => { record[field] = row[column]; });
    return record;
  };

  // يفصل الحقول المفهرسة عن بقية بيانات السجل (التي تُخزَّن بعمود data)
  const splitBody = (body) => {
    const indexedValues = indexedColumns.map(({ field }) => body[field] ?? null);
    const rest = { ...body };
    indexedColumns.forEach(({ field }) => delete rest[field]);
    return { indexedValues, rest };
  };

  // يتحقق هل السجل (بعد قراءته) يخص منشأة المستخدم الحالي — يُستخدم بمسارات
  // GET one / PUT / DELETE لمنع الوصول لسجلات منشأة أخرى عبر تخمين المعرّف
  const belongsToUserHospital = (row, req) => {
    if (!hospitalScoped || !req.user?.hospitalId) return true; // بلا فلترة
    return row.data?.hospitalId === req.user.hospitalId;
  };

  // ── نطاق الكاش (cache scope) ──────────────────────────────────────────────
  // لموديول موزَّع بين منشآت (hospitalScoped)، القائمة الكاملة تختلف فعلياً
  // حسب هوية القارئ: موظف بمنشأة مُحدَّدة يرى سجلات منشأته فقط، بينما إدمن
  // (بلا hospitalId) يرى كل السجلات بلا فلترة — يجب مفتاح كاش منفصل لكل
  // حالة، وإلا موظف منشأة يرى كاش إدمن (كل المنشآت) أو العكس بالخطأ.
  const cacheScopeFor = (hospitalId) => hospitalId || 'ALL';
  const cacheScopeForReq = (req) => cacheScopeFor(hospitalScoped ? req.user?.hospitalId : null);

  // يُستدعى بعد أي كتابة ناجحة (POST/PUT/DELETE) — يزيد "رقم الجيل" لنطاق
  // السجل المتأثر (منشأته تحديداً) *و* نطاق 'ALL' دائماً (لأن كاش الإدمن غير
  // المفلتَر يتضمّن سجلات كل المنشآت، فأي تعديل بأي منشأة يُبطِله أيضاً).
  // fire-and-forget (بدون await من المستدعي) — لا يجب أن يبطّئ رد الكتابة
  // بانتظار Redis، تماماً مثل نمط sendAlert/logAudit الحاليين بهذا المشروع.
  const invalidateCache = async (recordHospitalId) => {
    if (!cache) return;
    const scopes = new Set([cacheScopeFor(hospitalScoped ? recordHospitalId : null), 'ALL']);
    await Promise.all([...scopes].map((s) => bumpCacheVersion(apiName, s)));
  };

  // GET all
  // دعم تصفح اختياري بالصفحات (page/limit) + بحث/فلترة، لتفادي بطء الجداول
  // الكبيرة مستقبلاً (خصوصاً المرضى والأطباء، أكثر موديولين مرشّحين للنمو
  // لآلاف السجلات). البحث والفلترة يعملان على الأعمدة المفهرسة (indexedColumns)
  // مباشرة — أسرع بكثير من فحص عمود JSONB الكامل، لكنه يعني إن البحث يشتغل
  // فقط لو كان الحقل المطلوب أصلاً من ضمن indexedColumns لهذا الموديول تحديداً.
  // ملاحظة أمان مهمة: لو طلب "page" غير مقروء كرقم صحيح، نتجاهله ونرجع لكل
  // السجلات بدل تمرير قيمة غير موثوقة مباشرة لجملة SQL (LIMIT/OFFSET).
  // الافتراضي (بدون معامل page): يرجع مصفوفة كاملة كما كان دائماً — صفر خطر
  // على أي صفحة موجودة حالياً لا ترسل هذه المعاملات.
  router.get(`/${apiName}`, auth, readPermission, async (req, res, next) => {
    try {
      // ── قراءة الكاش (لو مفعَّل لهذا الموديول) ──────────────────────────────
      // مفتاح الكاش يتضمّن كل معاملات الاستعلام (بحث/فلترة/صفحة...) — كل
      // تركيبة فلاتر مختلفة تُخزَّن بمفتاح منفصل. لو تعذّر الوصول لـRedis،
      // getCacheVersion ترجع null فنتجاوز الكاش بالكامل لهذا الطلب (fail-open).
      let cacheKey = null;
      if (cache) {
        const scope = cacheScopeForReq(req);
        const version = await getCacheVersion(apiName, scope);
        if (version !== null) {
          cacheKey = `c:${apiName}:${scope}:${version}:${JSON.stringify(req.query)}`;
          const cached = await cacheGet(cacheKey);
          if (cached) return res.json(cached);
        }
      }

      const conditions = [];
      const params = [];

      if (hospitalScoped && req.user?.hospitalId) {
        params.push(req.user.hospitalId);
        conditions.push(`data->>'hospitalId' = $${params.length}`);
      }

      // بحث نصي اختياري (?search=) — يطابق عمود "name" و"phone" لو كانا
      // مفهرسين بهذا الموديول، بالإضافة لأي حقول JSONB إضافية حُدِّدت صراحة
      // بـ options.searchFields (مثل "specialization" للأطباء — حقل غير
      // مفهرس، فالبحث فيه أبطأ قليلاً من عمود مفهرس لكنه يحافظ على نفس تجربة
      // البحث الموجودة سابقاً بالفرونت إند قبل التحويل لترقيم من السيرفر).
      const nameCol = indexedColumns.find(c => c.field === 'name')?.column;
      const phoneCol = indexedColumns.find(c => c.field === 'phone')?.column;
      if (req.query.search && (nameCol || phoneCol || searchFields.length > 0)) {
        params.push(`%${req.query.search}%`);
        const idx = params.length;
        const parts = [nameCol, phoneCol].filter(Boolean).map(c => `${c} ILIKE $${idx}`);
        // ── تحسين أداء ──────────────────────────────────────────────────────
        // لو الحقل صار عمود حقيقي مفهرس (indexedColumns) بعد ترقيته من
        // JSONB، نستخدم العمود مباشرة (سريع، مفهرس) بدل data->>'field'
        // (بطيء، فحص كامل للجدول). الحقول التي لا تزال JSONB فقط تبقى تعمل
        // بنفس الطريقة القديمة — صفر كسر لأي موديول لم يُرقَّ بعد.
        searchFields.forEach(f => {
          const promotedCol = indexedColumns.find(c => c.field === f)?.column;
          parts.push(promotedCol ? `${promotedCol} ILIKE $${idx}` : `data->>'${f}' ILIKE $${idx}`);
        });
        conditions.push(`(${parts.join(' OR ')})`);
      }

      // فلترة اختيارية بالحالة (?status=) — فقط لو "status" مفهرس بهذا الموديول
      const statusCol = indexedColumns.find(c => c.field === 'status')?.column;
      if (req.query.status && req.query.status !== 'all' && statusCol) {
        params.push(req.query.status);
        conditions.push(`${statusCol} = $${params.length}`);
      }

      // فلترة تطابق تام اختيارية على حقول JSONB إضافية (مثل ?category=medicine
      // بالمخزون) — تعمل فقط للحقول المُصرَّح بها صراحة بـ options.extraFilterFields
      // (قائمة بيضاء، حماية من فلترة عشوائية على أي اسم حقل يُرسَل بالطلب)
      // نفس تحسين الأداء أعلاه: نستخدم العمود الحقيقي لو الحقل مُرقّى.
      //
      // قيمة خاصة UNSET_FILTER_VALUE ('__unset__'): تطابق السجلات الناقصة
      // (الحقل غائب أو فارغ) بدل تطابق تام حرفي — تُستخدَم مثلاً بصفحة
      // الأصول (AssetsPage.js) لإيجاد سجلات مستوردة بحقل status/category فارغ،
      // بدل أن تبقى مخفية بصمت (كانت تُعرَض بشارة "نشط" افتراضية رغم عدم
      // تطابقها فعلياً مع فلتر "نشط" الحقيقي — تعارض عرض/فلترة). القيمة نفسها
      // لا تُعرَض أو تُخزَّن أبداً كحقل حقيقي بأي سجل — راجع frontend/src/pages/AssetsPage.js.
      extraFilterFields.forEach((field) => {
        const value = req.query[field];
        if (value === UNSET_FILTER_VALUE) {
          const promotedCol = indexedColumns.find(c => c.field === field)?.column;
          const colExpr = promotedCol || `data->>'${field}'`;
          conditions.push(`(${colExpr} IS NULL OR ${colExpr} = '')`);
        } else if (value && value !== 'all') {
          params.push(value);
          const promotedCol = indexedColumns.find(c => c.field === field)?.column;
          conditions.push(promotedCol ? `${promotedCol} = $${params.length}` : `data->>'${field}' = $${params.length}`);
        }
      });

      // Optional date-range filter (?startDate=&endDate=, format YYYY-MM-DD) —
      // powers the shared DateRangeFilter UI component. Two alternative
      // options, only one used per module depending on the field's nature:
      //   - dateRangeField: a normal field (indexed column or JSONB) already
      //     part of the record's editable data (e.g. "date" on appointments).
      //   - dateRangeColumn: a raw SQL column name, for a column the database
      //     manages automatically and that is NOT part of the editable fields
      //     (e.g. created_at on patients). Deliberately kept separate from
      //     indexedColumns: adding created_at there would make every POST/PUT
      //     explicitly insert NULL instead of relying on DEFAULT now(), since
      //     the frontend never sends this field — silently wiping out the
      //     real registration date on every new patient and every edit.
      // Validating the date format (YYYY-MM-DD) before using it in the query
      // avoids an opaque SQL error (500) on a malformed value.
      const isValidDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
      if (dateRangeField || dateRangeColumn) {
        let dateExpr = null;
        if (dateRangeColumn) {
          dateExpr = `${dateRangeColumn}::date`;
        } else {
          const promotedCol = indexedColumns.find(c => c.field === dateRangeField)?.column;
          dateExpr = promotedCol ? `${promotedCol}::date` : `(data->>'${dateRangeField}')::date`;
        }
        if (isValidDateStr(req.query.startDate)) {
          params.push(req.query.startDate);
          conditions.push(`${dateExpr} >= $${params.length}::date`);
        }
        if (isValidDateStr(req.query.endDate)) {
          params.push(req.query.endDate);
          conditions.push(`${dateExpr} <= $${params.length}::date`);
        }
      }

      let sql = `SELECT * FROM ${tableName}`;
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ' ORDER BY id ASC';

      const page = parseInt(req.query.page, 10);
      if (Number.isInteger(page) && page > 0) {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200); // حد أقصى 200 بالصفحة الواحدة
        const offset = (page - 1) * limit;

        const countSql = `SELECT COUNT(*) FROM ${tableName}` + (conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '');
        const countResult = await pool.query(countSql, params);
        const total = parseInt(countResult.rows[0].count, 10);

        params.push(limit, offset);
        sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
        const result = await pool.query(sql, params);
        const payload = {
          data: result.rows.map(rowToRecord),
          total,
          page,
          totalPages: Math.max(Math.ceil(total / limit), 1),
        };
        if (cacheKey) cacheSet(cacheKey, payload, cache.ttlSeconds || 300).catch(() => {});
        return res.json(payload);
      }

      const result = await pool.query(sql, params);
      const payload = result.rows.map(rowToRecord);
      if (cacheKey) cacheSet(cacheKey, payload, cache.ttlSeconds || 300).catch(() => {});
      res.json(payload);
    } catch (err) { next(err); }
  });

  // ── تصدير إلى Excel ──────────────────────────────────────────────────────
  // إصلاح/ميزة جديدة: كان النظام يدعم الاستيراد من Excel فقط (رفع بيانات
  // للنظام) بدون أي طريقة لتصدير البيانات الحالية لملف Excel. هذا المسار عام
  // ويعمل تلقائياً لكل موديول مسجَّل عبر pgCrud (وليس فقط الموديولات التي عندها
  // registerExcelImport مُفعَّل) — يجلب كل السجلات (بحدود منشأة المستخدم لو
  // النظام متعدد المنشآت) ويحوّلها لملف .xlsx للتنزيل المباشر.
  // العناوين: تُستخدم عناوين عربية جميلة لو كان هذا الموديول عنده أيضاً
  // registerExcelImport مُسجَّل (يملأ moduleRegistry[apiName].exportHeaders
  // تلقائياً من columnMap الخاص فيه) — وإلا تُستخدم أسماء الحقول الخام كعناوين.
  // مسجَّل قبل GET /:id عمداً، وإلا Express يطابق "export-excel" كقيمة :id.
  router.get(`/${apiName}/export-excel`, auth, readPermission, async (req, res, next) => {
    try {
      const conditions = [];
      const params = [];
      if (hospitalScoped && req.user?.hospitalId) {
        params.push(req.user.hospitalId);
        conditions.push(`data->>'hospitalId' = $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await pool.query(`SELECT * FROM ${tableName} ${where} ORDER BY id`, params);
      const records = result.rows.map(rowToRecord);

      const exportHeaders = moduleRegistry[apiName]?.exportHeaders || {};
      // نجمع كل مفاتيح موجودة فعلياً بأي سجل (وليس فقط أول سجل) — لتفادي فقدان
      // أعمدة نادرة موجودة ببعض السجلات فقط
      const allFields = new Set();
      records.forEach(r => Object.keys(r).forEach(k => allFields.add(k)));
      allFields.delete('id');
      const fields = ['id', ...[...allFields].sort()];
      const headerLabels = fields.map(f => f === 'id' ? 'ID' : (exportHeaders[f] || f));

      const rows = records.map(r => fields.map(f => {
        const v = r[f];
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return JSON.stringify(v); // مصفوفة/كائن متداخل — نص JSON بدل [object Object]
        return v;
      }));

      const ws = XLSX.utils.aoa_to_sheet([headerLabels, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, apiName.slice(0, 31)); // اسم الورقة محدود بـ31 حرف بمواصفات Excel
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      logAudit({ action: 'EXPORT', table: tableName, count: records.length, userId: req.user?.id, username: req.user?.username });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${apiName}-${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } catch (err) { next(err); }
  });

  // GET one
  router.get(`/${apiName}/:id`, auth, readPermission, async (req, res, next) => {
    try {
      const result = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ message: 'غير موجود' });
      if (!belongsToUserHospital(result.rows[0], req)) return res.status(404).json({ message: 'غير موجود' });
      res.json(rowToRecord(result.rows[0]));
    } catch (err) { next(err); }
  });

  // POST
  router.post(`/${apiName}`, auth, writePermission, validate(schema), async (req, res, next) => {
    try {
      const { indexedValues, rest } = splitBody(req.body);
      // فرض منشأة المستخدم تلقائياً (يتجاهل أي hospitalId أرسله العميل) —
      // حماية من انتحال منشأة أخرى عبر تعديل الطلب يدوياً
      if (hospitalScoped && req.user?.hospitalId) {
        rest.hospitalId = req.user.hospitalId;
      }
      let sql, values;
      if (indexedColumns.length === 0) {
        // لا توجد أعمدة فهرسة إضافية — تخزين JSONB بحت (id + data فقط)
        sql = `INSERT INTO ${tableName} (data) VALUES ($1) RETURNING *`;
        values = [JSON.stringify(rest)];
      } else {
        const columnsSql = indexedColumns.map(c => c.column).join(', ');
        const placeholders = indexedColumns.map((_, i) => `$${i + 1}`).join(', ');
        const dataPlaceholder = `$${indexedColumns.length + 1}`;
        sql = `INSERT INTO ${tableName} (${columnsSql}, data) VALUES (${placeholders}, ${dataPlaceholder}) RETURNING *`;
        values = [...indexedValues, JSON.stringify(rest)];
      }
      const result = await pool.query(sql, values);
      const record = rowToRecord(result.rows[0]);
      if (cache) invalidateCache(record.hospitalId).catch(() => {});
      logAudit({ action: 'CREATE', table: tableName, recordId: record.id, userId: req.user?.id, username: req.user?.username });
      res.status(201).json(record);
    } catch (err) { next(err); }
  });

  // PUT
  router.put(`/${apiName}/:id`, auth, writePermission, validate(schema), async (req, res, next) => {
    try {
      const existing = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [req.params.id]);
      if (existing.rows.length === 0) return res.status(404).json({ message: 'غير موجود' });
      if (!belongsToUserHospital(existing.rows[0], req)) return res.status(404).json({ message: 'غير موجود' });

      const { indexedValues, rest } = splitBody(req.body);
      if (hospitalScoped && req.user?.hospitalId) {
        rest.hospitalId = req.user.hospitalId; // يمنع تغيير منشأة السجل لمنشأة أخرى بالتعديل
      }
      const setSql = indexedColumns.map((c, i) => `${c.column} = $${i + 1}`).join(', ');
      const dataPlaceholder = `$${indexedColumns.length + 1}`;
      const idPlaceholder = `$${indexedColumns.length + 2}`;
      const setClause = setSql ? `${setSql}, data = ${dataPlaceholder}` : `data = ${dataPlaceholder}`;
      const result = await pool.query(
        `UPDATE ${tableName} SET ${setClause}, updated_at = now() WHERE id = ${idPlaceholder} RETURNING *`,
        [...indexedValues, JSON.stringify(rest), req.params.id]
      );
      const record = rowToRecord(result.rows[0]);
      if (cache) {
        // نُبطِل كاش المنشأة القديمة *و* الجديدة — عادة نفس الشيء، لكن يحمي
        // بلا كلفة تُذكَر من الحالة النادرة (تعديل إدمن يغيّر hospitalId السجل)
        invalidateCache(existing.rows[0].data?.hospitalId).catch(() => {});
        invalidateCache(record.hospitalId).catch(() => {});
      }
      logAudit({ action: 'UPDATE', table: tableName, recordId: record.id, userId: req.user?.id, username: req.user?.username });
      res.json(record);
    } catch (err) { next(err); }
  });

  // DELETE — إصلاح: كان يحذف نهائياً وفوراً بلا أي إمكانية تراجع. الآن "الحذف"
  // ينقل السجل كاملاً لسلة المحذوفات (recycle_bin) قبل حذفه من جدوله الأصلي —
  // يختفي من القوائم فوراً (نفس السلوك الظاهري بالضبط من منظور المستخدم)، لكن
  // يبقى قابلاً للاسترجاع أو الحذف النهائي من صفحة الإعدادات (إدمن فقط).
  router.delete(`/${apiName}/:id`, auth, writePermission, async (req, res, next) => {
    const client = await pool.connect();
    try {
      const existing = await client.query(`SELECT * FROM ${tableName} WHERE id = $1`, [req.params.id]);
      if (existing.rows.length === 0) return res.status(404).json({ message: 'غير موجود' });
      const row = existing.rows[0];
      if (!belongsToUserHospital(row, req)) return res.status(404).json({ message: 'غير موجود' });

      const fullRecord = rowToRecord(row);
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO recycle_bin (module_key, original_id, data, hospital_id, deleted_by, deleted_by_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [apiName, row.id, JSON.stringify(fullRecord), row.data?.hospitalId || null, req.user?.id || null, req.user?.name || null]
      );
      await client.query(`DELETE FROM ${tableName} WHERE id = $1`, [req.params.id]);
      await client.query('COMMIT');

      if (cache) invalidateCache(row.data?.hospitalId).catch(() => {});
      logAudit({ action: 'DELETE', table: tableName, recordId: req.params.id, note: 'نُقل لسلة المحذوفات', userId: req.user?.id, username: req.user?.username });
      res.json({ success: true });
    } catch (err) {
      // إصلاح حرج: ROLLBACK كان بدون حماية — لو فشل هو نفسه (مثلاً لأن الاتصال
      // انكسر أصلاً بسبب الخطأ الأول)، يصير استثناء غير مُعالَج داخل async
      // route handler لا يمسكه Express، وبـ Node.js الحديث هذا **يُسقط العملية
      // كاملة** (يطفي السيرفر بالكامل!) — تفسير مباشر لماذا ظهرت "تعذّر
      // الاتصال بالخادم" حتى بطلبات ثانية غير متعلقة، وتبقى حتى إعادة تشغيل
      // يدوية. الآن أي فشل بـ ROLLBACK يُسجَّل فقط ولا يُسقط السيرفر أبداً.
      try { await client.query('ROLLBACK'); } catch (rollbackErr) {
        console.error(`⚠️ فشل ROLLBACK بعد خطأ حذف [${tableName}]:`, rollbackErr.message);
      }
      next(err);
    } finally {
      client.release();
    }
  });
};

module.exports = pgCrud;
module.exports.DEFAULT_COLUMNS = DEFAULT_COLUMNS;
module.exports.moduleRegistry = moduleRegistry;
