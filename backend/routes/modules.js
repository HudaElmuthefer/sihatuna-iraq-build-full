// backend/routes/modules.js
//
// تسجيل كل موديولات pgCrud (CRUD قياسي مبني على PostgreSQL) واستيراد Excel
// الجماعي لكل موديول يدعمه — 41 موديول بمكان واحد. استُخرج هذا القسم من
// server.js (كان أكبر قسم فيه بمفرده، ~330 سطر) لتصغير الملف الرئيسي وتسهيل
// إيجاد/تعديل تسجيل أي موديول محدد دون التمرير بملف ضخم يخلط كل شيء مع بعض.
//
// دالة واحدة registerAllModules(router) تستقبل الروتر الرئيسي من server.js
// وتسجّل عليه كل المسارات — بنفس ترتيب التسجيل الأصلي بالضبط (مهم جداً: كل
// استيراد Excel مسجَّل *قبل* pgCrud لنفس الموديول، لتفادي تعارض مسار GET
// /module/:id مع GET /module/import-template — انظر شرح المشكلة والحل
// بملف routes/excelImportRoutes.js لو احتجت التفاصيل الكاملة).
const collectionSchemas = require('../middleware/schemas');
const pgCrud = require('./pgCrud');
const { DEFAULT_COLUMNS } = pgCrud;
// ── أعمدة مُرقّاة من JSONB لأعمدة حقيقية (دفعة أولى) ─────────────────────────
// راجع migration_promote_columns.sql — يجب أن يُطبَّق على قاعدة البيانات أولاً
// قبل أن يعمل هذا الكود بشكل صحيح (وإلا الأعمدة الجديدة غير موجودة أصلاً بالجدول).
const PATIENT_COLUMNS = DEFAULT_COLUMNS; // إصلاح: patient_code/blood_type/national_id ليست أعمدة حقيقية بجدول patients (JSONB بحت لهذه الحقول) — أُزيلت من هنا وأُضيفت كـ extraFilterFields بدلاً عنها بتسجيل pgCrud('patients', ...)
// إصلاح: specialization عمود حقيقي فعلاً بجدول doctors (رُقِّي بـ
// 002_promote_columns.sql، ومُعبَّأ بالكامل: 152/152 طبيب) — التعليق السابق
// هنا كان خاطئاً (يدّعي أنه JSONB بحت)، فكان rowToRecord يُسقطه بصمت من كل
// رد API رغم امتلاء العمود الحقيقي بالكامل، وبحث searchFields:['specialization']
// كان يبحث فعلياً بمسار data->>'specialization' الفارغ دائماً بدل العمود
// الحقيقي — الآن يُقرأ/يُكتب/يُبحَث فيه من العمود الحقيقي مباشرة.
const DOCTOR_COLUMNS = [...DEFAULT_COLUMNS, { field: 'specialization', column: 'specialization' }];
const registerExcelImport = require('./excelImportRoutes');
const { importLimiter } = require('../config/rateLimiters');
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');

const registerAllModules = (router) => {
  // ── STANDARD CRUD COLLECTIONS (db.json) ───────────────────────────────────────
  // لم يبقَ أي موديول قياسي على db.json — كل الموديولات انتقلت إلى PostgreSQL
  // (انظر قسم "PostgreSQL-BACKED COLLECTIONS" أسفل الملف). عنوان الـ API نفسه
  // بقي كما هو تماماً لكل موديول، فلا يحتاج الفرونت إند أي تعديل.

  // ── PostgreSQL-BACKED COLLECTIONS ─────────────────────────────────────────────
  // المرضى والأطباء أول موديولين يُنقلان إلى PostgreSQL فعلياً (باقي الموديولات
  // أعلاه لا تزال تعمل على db.json). نفس المخططات (schemas) المستخدمة سابقاً
  // للتحقق تُعاد استخدامها هنا بدون أي تغيير.
  // ── خيار permission ────────────────────────────────────────────────────────────
  // نفس مفاتيح الصفحات (page keys) المعرَّفة بـ ALL_PAGES بملف
  // frontend/src/contexts/AppContext.js — يفرض على مستوى الخادم نفس الصلاحية
  // المستخدمة حالياً بالفرونت إند لإخفاء/إظهار عناصر القائمة الجانبية فقط.
  // حساب admin يتجاوز هذا الفحص دائماً (انظر requirePermission.js).
  // ── استيراد جماعي من Excel ────────────────────────────────────────────────────
  // يضيف POST /api/patients/import-excel و POST /api/doctors/import-excel
  // (و GET .../import-template لتحميل قالب فارغ). يُسجَّل عمداً *قبل* pgCrud
  // لنفس الموديول أدناه — Express يطابق المسارات بترتيب التسجيل، ولو سُجِّل
  // بعد pgCrud (الذي يضيف GET /patients/:id)، كان طلب GET /patients/import-template
  // يتطابق خطأً مع نمط /:id (ويعامل "import-template" كأنه معرّف سجل رقمي)،
  // بدل مساره الصريح الأدق. هذا خطأ حقيقي وقعنا فيه واكتُشف بالاختبار الفعلي.
  registerExcelImport(router, 'patients', collectionSchemas.patients, {
    'الاسم': 'name', 'اسم المريض': 'name', 'Name': 'name',
    'رقم المريض': 'patientId', 'Patient ID': 'patientId',
    'الاسم بالإنجليزي': 'nameEn', 'NameEn': 'nameEn', 'Name (English)': 'nameEn',
    'العمر': 'age', 'Age': 'age',
    'الجنس': 'gender', 'Gender': 'gender',
    'الهاتف': 'phone', 'رقم الهاتف': 'phone', 'Phone': 'phone',
    'فصيلة الدم': 'bloodType', 'Blood Type': 'bloodType',
    'الحالة': 'status', 'Status': 'status',
    'التأمين': 'insurance', 'Insurance': 'insurance',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'patients',
    indexedColumns: PATIENT_COLUMNS,
    limiter: importLimiter,
    duplicateCheck: ['name', 'phone'],
    template: [
      { header: 'رقم المريض', example: 'PT-0001' },
      { header: 'الاسم', example: 'أحمد كاظم الجبوري' },
      { header: 'الهاتف', example: '07701234567' },
      { header: 'العمر', example: '45' },
      { header: 'الجنس', example: 'ذكر' },
      { header: 'فصيلة الدم', example: 'A+' },
      { header: 'الحالة', example: 'نشط' },
      { header: 'التأمين', example: '' },
      { header: 'ملاحظات', example: '' },
    ],
  });

  registerExcelImport(router, 'doctors', collectionSchemas.doctors, {
    'الاسم': 'name', 'اسم الطبيب': 'name', 'اسم الدكتور': 'name', 'Name': 'name', 'Doctor Name': 'name',
    'الاسم بالإنجليزي': 'nameEn', 'NameEn': 'nameEn', 'Name (English)': 'nameEn',
    'التخصص': 'specialization', 'الاختصاص': 'specialization', 'الأختصاص': 'specialization', 'Specialization': 'specialization', 'Specialty': 'specialization',
    'الهاتف': 'phone', 'رقم الهاتف': 'phone', 'رقم الهاتف الأول': 'phone', 'رقم الجوال': 'phone', 'Phone': 'phone',
    'رقم الهاتف الثاني': 'phone2', 'هاتف إضافي': 'phone2', 'Phone 2': 'phone2',
    'العنوان': 'address', 'عنوان العيادة': 'address', 'Address': 'address',
    'سنوات الخبرة': 'experience', 'الخبرة': 'experience', 'Experience': 'experience',
    'الجنس': 'gender', 'Gender': 'gender',
    'الحالة': 'status', 'Status': 'status',
    'الملاحظات': 'notes', 'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'doctors',
    // يجب أن يطابق DOCTOR_COLUMNS المستخدَمة بتسجيل pgCrud('doctors', ...)
    // بالأسفل بالضبط — وإلا يُكتب specialization بجدول Excel المستورَد فقط
    // بعمود JSONB، ثم rowToRecord (الذي يقرأ العمود الحقيقي الآن) يُفرغه لاحقاً.
    indexedColumns: DOCTOR_COLUMNS,
    limiter: importLimiter,
    duplicateCheck: ['name', 'phone'],
    template: [
      { header: 'الاسم', example: 'د. أحمد سالم الراشدي' },
      { header: 'الهاتف', example: '07701234567' },
      { header: 'التخصص', example: 'باطنية وصدرية' },
      { header: 'العنوان', example: 'البصرة - العشار' },
      { header: 'سنوات الخبرة', example: '10' },
      { header: 'الجنس', example: 'ذكر' },
      { header: 'الحالة', example: 'نشط' },
      { header: 'الملاحظات', example: '' },
    ],
  });

  // ── دفعة استيراد إضافية: الأقسام، الموظفين، المتقاعدين، المخزون، الأصول،
  //    المشاريع، مركبات الإسعاف ─────────────────────────────────────────────────
  registerExcelImport(router, 'departments', collectionSchemas.departments, {
    'الاسم': 'name', 'اسم القسم': 'name', 'Name': 'name',
    'الوصف': 'description', 'Description': 'description',
    'رئيس القسم': 'head', 'Head': 'head',
    'الحالة': 'status', 'Status': 'status',
  }, {
    hospitalScoped: true, permission: 'departments',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['name'],
    template: [
      { header: 'الاسم', example: 'قسم الباطنية' },
      { header: 'الوصف', example: 'قسم الأمراض الباطنية' },
      { header: 'رئيس القسم', example: 'د. أحمد سالم' },
      { header: 'الحالة', example: 'نشط' },
    ],
  });

  // ── ملاحظة: عمودا "تاريخ استحقاق الترفيع/العلاوة القادم" بصفحة الموظفين
  // (hr/EmployeesTab.js) محسوبان حياً (calcPromotionDue/calcAllowanceDue من
  // hr/promotionCalc.js اعتماداً على lastPromotion/lastAllowance/certificate)
  // وليسا حقلين مخزَّنين بسجل الموظف — فلا يظهران هنا (لا معنى لاستيراد قيمة
  // محسوبة)، ولا يظهران بالتصدير أيضاً (التصدير يعكس الحقول المخزَّنة فقط،
  // راجع GET /:apiName/export-excel بـ pgCrud.js). الشهادة (certificate)
  // وتاريخا آخر ترفيع/علاوة (lastPromotion/lastAllowance) هي المُدخلات
  // الفعلية التي يُحسَب منها ذانك التاريخان، وهي حقول حقيقية مخزَّنة — أُضيفت
  // هنا مع الدرجة/المرحلة بعد التعديل (nextGrade).
  registerExcelImport(router, 'employees', collectionSchemas.employees, {
    'الاسم': 'name', 'اسم الموظف': 'name', 'Name': 'name',
    'المسمى الوظيفي': 'jobTitle', 'Job Title': 'jobTitle',
    'القسم': 'dept', 'Department': 'dept',
    'الدرجة': 'grade', 'Grade': 'grade',
    'المرحلة': 'step', 'Step': 'step',
    'الشهادة': 'certificate', 'Certificate': 'certificate',
    'الراتب': 'salary', 'Salary': 'salary',
    'تاريخ التعيين': 'hireDate', 'Hire Date': 'hireDate',
    'تاريخ الميلاد': 'birthDate', 'Birth Date': 'birthDate',
    'الهاتف': 'phone', 'Phone': 'phone',
    'آخر ترفيع': 'lastPromotion', 'Last Promotion': 'lastPromotion',
    'آخر علاوة': 'lastAllowance', 'Last Allowance': 'lastAllowance',
    'الدرجة/المرحلة بعد التعديل': 'nextGrade', 'Grade/Step After Adjustment': 'nextGrade',
    'الحالة': 'status', 'Status': 'status',
  }, {
    hospitalScoped: true, permission: 'hr',
    limiter: importLimiter,
    duplicateCheck: ['name', 'jobTitle'],
    indexedColumns: [
      { field: 'name', column: 'name' },
      { field: 'jobTitle', column: 'job_title' },
      { field: 'status', column: 'status' },
    ],
    template: [
      { header: 'الاسم', example: 'رنا محمد النجار' },
      { header: 'المسمى الوظيفي', example: 'سكرتيرة' },
      { header: 'القسم', example: 'الإدارة' },
      { header: 'الدرجة', example: 'الرابعة' },
      { header: 'المرحلة', example: '3' },
      { header: 'الشهادة', example: 'بكالوريوس' },
      { header: 'الراتب', example: '480000' },
      { header: 'تاريخ التعيين', example: '2024-01-15' },
      { header: 'الهاتف', example: '07701234567' },
      { header: 'آخر ترفيع', example: '2023-01-15' },
      { header: 'آخر علاوة', example: '2025-06-01' },
      { header: 'الدرجة/المرحلة بعد التعديل', example: 'الرابعة/4' },
      { header: 'الحالة', example: 'نشط' },
    ],
  });

  registerExcelImport(router, 'retired', collectionSchemas.retired, {
    'الاسم': 'name', 'Name': 'name',
    'المسمى الوظيفي': 'jobTitle', 'Job Title': 'jobTitle',
    'القسم': 'dept', 'Department': 'dept',
    'تاريخ التقاعد': 'retireDate', 'Retire Date': 'retireDate',
    'راتب التقاعد': 'retireSalary', 'Retire Salary': 'retireSalary',
    'رقم التقاعد': 'pensionNo', 'Pension No': 'pensionNo',
    'الهاتف': 'phone', 'Phone': 'phone',
  }, {
    hospitalScoped: true, permission: 'hr',
    limiter: importLimiter,
    duplicateCheck: ['name', 'jobTitle'],
    indexedColumns: [
      { field: 'name', column: 'name' },
      { field: 'jobTitle', column: 'job_title' },
    ],
    template: [
      { header: 'الاسم', example: 'باسم علي الكربلائي' },
      { header: 'المسمى الوظيفي', example: 'فني مختبر' },
      { header: 'القسم', example: 'التحاليل' },
      { header: 'تاريخ التقاعد', example: '2026-01-01' },
      { header: 'راتب التقاعد', example: '500000' },
      { header: 'رقم التقاعد', example: 'P-1234' },
      { header: 'الهاتف', example: '07701234567' },
    ],
  });

  registerExcelImport(router, 'inventory', collectionSchemas.inventory, {
    'الرمز': 'code', 'Code': 'code',
    'الاسم': 'name', 'Name': 'name',
    'الاسم بالإنجليزي': 'nameEn', 'NameEn': 'nameEn',
    'التصنيف': 'category', 'Category': 'category',
    'الوحدة': 'unit', 'Unit': 'unit',
    'الكمية': 'qty', 'Quantity': 'qty',
    'الحد الأدنى': 'minQty', 'Min Quantity': 'minQty',
    'الحد الأعلى': 'maxQty', 'Max Quantity': 'maxQty',
    'تكلفة الوحدة': 'unitCost', 'Unit Cost': 'unitCost',
    'المورّد': 'supplier', 'Supplier': 'supplier',
    'الموقع': 'location', 'Location': 'location',
    'تاريخ الانتهاء': 'expiry', 'Expiry': 'expiry',
    'الحالة': 'status', 'Status': 'status',
  }, {
    hospitalScoped: true, permission: 'inventory',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['code'],
    template: [
      { header: 'الرمز', example: 'MED-001' },
      { header: 'الاسم', example: 'باراسيتامول 500mg' },
      { header: 'التصنيف', example: 'medicine' },
      { header: 'الوحدة', example: 'Box' },
      { header: 'الكمية', example: '100' },
      { header: 'الحد الأدنى', example: '20' },
      { header: 'تكلفة الوحدة', example: '1500' },
      { header: 'المورّد', example: 'شركة الرافدين للأدوية' },
      { header: 'الحالة', example: 'نشط' },
    ],
  });

  registerExcelImport(router, 'assets', collectionSchemas.assets, {
    'رقم الأصل': 'assetNo', 'Asset No': 'assetNo',
    'الاسم': 'name', 'Name': 'name',
    'الاسم بالإنجليزي': 'nameEn', 'NameEn': 'nameEn',
    'التصنيف': 'category', 'Category': 'category',
    'الماركة': 'brand', 'Brand': 'brand',
    'الموديل': 'model', 'Model': 'model',
    'الرقم التسلسلي': 'serial', 'Serial': 'serial',
    'تاريخ الشراء': 'purchaseDate', 'Purchase Date': 'purchaseDate',
    'تكلفة الشراء': 'purchaseCost', 'Purchase Cost': 'purchaseCost',
    'القيمة الحالية': 'currentValue', 'Current Value': 'currentValue',
    'الحالة الفنية': 'condition', 'Condition': 'condition',
    'الموقع': 'location', 'Location': 'location',
    'الحالة': 'status', 'Status': 'status',
    'المسؤول': 'responsiblePerson', 'Responsible Person': 'responsiblePerson',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'assets',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['assetNo'],
    // ── إصلاح: "القيمة الحالية" (currentValue) كانت غائبة تماماً من هذا
    // الاستيراد — AssetsPage.js يحسب نسبة الاستهلاك المعروضة كـ
    // `(1 - currentValue/purchaseCost) * 100`، فأي أصل مستورَد بدون
    // currentValue يطلع "NaN%" بصمت. الآن تُحسَب هنا تلقائياً (استهلاك خطي
    // على مدى 10 سنوات كعمر افتراضي، بحد أدنى 10% من التكلفة كقيمة إنقاذ)
    // إن لم تُقدَّم صراحةً بالملف.
    afterParse: (row) => {
      const rest = { ...row };
      const cost = Number(rest.purchaseCost) || 0;
      if (rest.currentValue === undefined || rest.currentValue === '' || rest.currentValue === null) {
        if (cost > 0 && rest.purchaseDate) {
          const ageYears = (Date.now() - new Date(rest.purchaseDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
          const usefulLife = 10;
          const salvageFraction = 0.10;
          const fractionLeft = Math.max(salvageFraction, 1 - (Math.min(ageYears, usefulLife) / usefulLife) * (1 - salvageFraction));
          rest.currentValue = Math.round(cost * fractionLeft);
        } else {
          rest.currentValue = cost;
        }
      } else {
        rest.currentValue = Number(rest.currentValue) || 0;
      }
      return rest;
    },
    template: [
      { header: 'رقم الأصل', example: 'AST-2026-001' },
      { header: 'الاسم', example: 'جهاز أشعة سينية' },
      { header: 'التصنيف', example: 'radiology' },
      { header: 'الماركة', example: 'Siemens' },
      { header: 'تاريخ الشراء', example: '2024-05-01' },
      { header: 'تكلفة الشراء', example: '15000000' },
      { header: 'القيمة الحالية', example: '' },
      { header: 'الحالة الفنية', example: 'good' },
      { header: 'الموقع', example: 'قسم الأشعة' },
      { header: 'الحالة', example: 'active' },
    ],
  });

  registerExcelImport(router, 'projects', collectionSchemas.projects, {
    'الرمز': 'code', 'Code': 'code',
    'الاسم': 'name', 'Name': 'name',
    'الاسم بالإنجليزي': 'nameEn', 'NameEn': 'nameEn',
    'المدير': 'manager', 'Manager': 'manager',
    'الميزانية': 'budget', 'Budget': 'budget',
    'تاريخ البدء': 'startDate', 'Start Date': 'startDate',
    'تاريخ الانتهاء': 'endDate', 'End Date': 'endDate',
    'الحالة': 'status', 'Status': 'status',
    'الأولوية': 'priority', 'Priority': 'priority',
    // ── إصلاح: هذه الأعمدة كانت ناقصة تماماً — أي مشروع مستورَد كانت هذه
    // الحقول تطلع له undefined بالواجهة (يظهر "NaN%" بشريط التقدم، و
    // "undefined/undefined" بعدد المراحل). الآن اختيارية بالاستيراد، وتُملأ
    // بصفر تلقائياً لو تُركت فاضية (راجع afterParse بالأسفل).
    'المصروف': 'spent', 'Spent': 'spent',
    'نسبة الإنجاز': 'progress', 'Progress': 'progress',
    'عدد المراحل': 'milestones', 'Milestones': 'milestones',
    'المراحل المنجزة': 'completedMilestones', 'Completed Milestones': 'completedMilestones',
  }, {
    hospitalScoped: true, permission: 'projects',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['code'],
    // ── إصلاح: تعبئة افتراضية للحقول الرقمية غير المتوفرة بملف Excel —
    // بدل ما تبقى undefined وتكسر عرض شريط التقدم ودوائر المراحل بالواجهة
    afterParse: (row) => ({
      ...row,
      spent: row.spent || 0,
      progress: row.progress || 0,
      milestones: row.milestones || 0,
      completedMilestones: row.completedMilestones || 0,
    }),
    template: [
      { header: 'الرمز', example: 'PRJ-2026-01' },
      { header: 'الاسم', example: 'تحديث نظام الأشعة' },
      { header: 'المدير', example: 'م. نور المشاريع' },
      { header: 'الميزانية', example: '50000000' },
      { header: 'تاريخ البدء', example: '2026-01-01' },
      { header: 'الحالة', example: 'planning' },
    ],
  });

  registerExcelImport(router, 'ambulanceVehicles', collectionSchemas.ambulanceVehicles, {
    'الرمز': 'code', 'Code': 'code',
    'رقم اللوحة': 'plate', 'Plate': 'plate',
    'النوع': 'type', 'Type': 'type',
    'الموديل': 'model', 'Model': 'model',
    'الطاقم': 'crew', 'Crew': 'crew',
    'الحالة': 'status', 'Status': 'status',
    'الموقع': 'location', 'Location': 'location',
  }, {
    hospitalScoped: true, permission: 'ambulance',
    limiter: importLimiter,
    duplicateCheck: ['plate'],
    tableName: 'ambulance_vehicles',
    // status عمود حقيقي فعلاً بهذا الجدول (رُقِّي بـ 004_promote_batch2.sql
    // ومسجَّل بتسجيل pgCrud أدناه). كان فارغاً (NULL) لكل الصفوف رغم وجود
    // القيمة الصحيحة بـJSONB — تمت تعبئته يدوياً مرة واحدة قبل هذا الإصلاح
    // (UPDATE ... SET status = data->>'status') ليطابق القيم الفعلية، والآن
    // يُخزَّن بالعمود الحقيقي مباشرة.
    indexedColumns: [{ field: 'status', column: 'status' }],
    template: [
      { header: 'الرمز', example: 'AMB-01' },
      { header: 'رقم اللوحة', example: '12345 بصرة' },
      { header: 'النوع', example: 'advanced' },
      { header: 'الموديل', example: 'Toyota Hiace 2022' },
      { header: 'الطاقم', example: 'سائق + ممرض' },
      { header: 'الحالة', example: 'available' },
      { header: 'الموقع', example: 'المستشفى' },
    ],
  });

  // ── إضافة: استيراد Excel لطلبات المختبر (lab_tests) ───────────────────────
  // كانت غير مسجَّلة أصلاً (فقط pgCrud بدون registerExcelImport)، فما كان
  // زر الاستيراد يظهر لصفحة المختبر إطلاقاً. مسجَّل هنا عمداً *قبل* استدعاء
  // pgCrud(router, 'labTests', ...) بالأسفل — نفس القاعدة المتبعة لكل موديول
  // آخر بهذا الملف، لتفادي تعارض GET /labTests/:id مع GET /labTests/import-template.
  // indexedColumns مطابقة تماماً لمصفوفة pgCrud(router, 'labTests', ...) بالأسفل.
  // القيم المقبولة لحقول category/status/priority هي القيم الخام الإنجليزية
  // المستخدمة فعلياً بكائنات CATEGORIES/STATUSES بملف LaboratoryPage.js
  // (مثل hematology, pending, urgent)، وليست النص العربي المعروض بالواجهة.
  registerExcelImport(router, 'labTests', collectionSchemas.labTests, {
    'رقم الطلب': 'reqNo', 'Request No': 'reqNo',
    'اسم المريض': 'patientName', 'Patient Name': 'patientName',
    'رقم المريض': 'patientId', 'Patient ID': 'patientId',
    'الطبيب المحول': 'doctorName', 'Referring Doctor': 'doctorName',
    'نوع التحليل': 'testType', 'Test Type': 'testType',
    'الفئة': 'category', 'Category': 'category',
    'تاريخ الطلب': 'requestDate', 'Request Date': 'requestDate',
    'الأولوية': 'priority', 'Priority': 'priority',
    'الحالة': 'status', 'Status': 'status',
    'النتيجة': 'resultRaw', 'Result': 'resultRaw',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'laboratory',
    tableName: 'lab_tests',
    // status/priority أعمدة حقيقية فعلاً بهذا الجدول (رُقِّيت بـ
    // 004_promote_batch2.sql ومسجَّلة بتسجيل pgCrud أدناه) — تُخزَّن الآن
    // بالأعمدة الحقيقية مباشرة. ملاحظة: services/hl7/hl7Listener.js يكتب
    // status مباشرة على العمود الحقيقي فعلاً (بمعزل عن هذا المسار)، فهو
    // متوافق مع هذا الإصلاح تلقائياً بلا أي تعديل إضافي هناك.
    indexedColumns: [
      { field: 'status', column: 'status' },
      { field: 'priority', column: 'priority' },
    ],
    limiter: importLimiter,
    duplicateCheck: ['reqNo'],
    // ── إصلاح: النتيجة تُخزَّن فعلياً بكائن متداخل results:{value, notes}
    // بالواجهة (راجع LaboratoryPage.js) — لا يمكن لـ columnMap تعيين حقل
    // متداخل مباشرة، لذا نستقبل عمود "النتيجة" مؤقتاً بحقل مسطّح resultRaw
    // ثم نحوّله هنا لبنية results الصحيحة قبل الحفظ. بدون هذا الإصلاح، كانت
    // قيمة النتيجة تُفقد أو تُدمَج خطأً بحقل "ملاحظات" العادي.
    afterParse: (row) => {
      const { resultRaw, ...rest } = row;
      if (resultRaw) {
        rest.results = { value: resultRaw, notes: rest.notes || '' };
      }
      return rest;
    },
    template: [
      { header: 'رقم الطلب', example: 'LAB-2026-0100' },
      { header: 'اسم المريض', example: 'محمد عبدالله' },
      { header: 'رقم المريض', example: 'PT-0001' },
      { header: 'الطبيب المحول', example: 'د. أحمد سالم' },
      { header: 'نوع التحليل', example: 'CBC' },
      { header: 'الفئة', example: 'hematology' },
      { header: 'تاريخ الطلب', example: '2026-07-22' },
      { header: 'الأولوية', example: 'normal' },
      { header: 'الحالة', example: 'completed' },
      { header: 'النتيجة', example: '10 10^9/L (طبيعي: 4.0–10.0)' },
      { header: 'ملاحظات', example: '' },
    ],
  });

  // ── إضافة: رقم الطلب التالي لطلبات المختبر (reqNo) ────────────────────────
  // LaboratoryPage.js يحتاج أعلى تسلسل reqNo مستخدَم هذا العام (نمط
  // LAB-{year}-{seq}) لتوليد رقم طلب جديد لا يتكرر، سواء عند إضافة طلب واحد
  // أو إنشاء دفعة من حزمة فحوصات (TEST_PANELS). كان هذا يتطلّب جلب كل
  // سجلات labTests (20,000+ سجل، ~5.76 ميجابايت) فقط لحساب رقم واحد. هذا
  // المسار يحسبها على الخادم ويُعيد الرقم فقط — مسجَّل عمداً *قبل* استدعاء
  // pgCrud(router, 'labTests', ...) بالأسفل، لتفادي تعارض GET /labTests/:id
  // مع GET /labTests/next-req-no (نفس القاعدة المتبعة لكل موديول بهذا الملف).
  // نفس فلترة hospitalScoped المستخدمة بتسجيل pgCrud لهذا الموديول أدناه —
  // إدمن بلا hospitalId (مستوى الوزارة) يرى تسلسل كل المنشآت مجتمعة، بالضبط
  // كما كان الحساب القديم على الفرونت إند (كان يفحص كل السجلات بلا فلترة
  // لهذا الحساب أيضاً).
  router.get('/labTests/next-req-no', auth, requirePermission('laboratory'), async (req, res, next) => {
    try {
      const year = parseInt(req.query.year, 10) || new Date().getFullYear();
      const prefix = `LAB-${year}-`;
      const conditions = [`data->>'reqNo' LIKE $1`];
      const params = [`${prefix}%`];
      if (req.user?.hospitalId) {
        params.push(req.user.hospitalId);
        conditions.push(`data->>'hospitalId' = $${params.length}`);
      }
      const result = await pool.query(
        `SELECT data->>'reqNo' AS req_no FROM lab_tests WHERE ${conditions.join(' AND ')}`,
        params
      );
      let maxSeq = 0;
      for (const row of result.rows) {
        const v = parseInt(row.req_no.slice(prefix.length), 10);
        if (Number.isFinite(v) && v > maxSeq) maxSeq = v;
      }
      res.json({ maxSeq });
    } catch (err) { next(err); }
  });

  // ── إضافة: استيراد Excel لطلبات الأشعة والتصوير الطبي (radiology) ─────────
  // كانت غير مسجَّلة أصلاً (فقط pgCrud بدون registerExcelImport)، فما كان
  // زر الاستيراد يظهر لصفحة الأشعة إطلاقاً. مسجَّل هنا عمداً *قبل* استدعاء
  // pgCrud(router, 'radiology', ...) — نفس القاعدة المتبعة لكل موديول آخر
  // بهذا الملف، لتفادي تعارض GET /radiology/:id مع GET /radiology/import-template.
  // القيم المقبولة لحقل "نوع التصوير" هي المفاتيح الخام المستخدمة فعلياً
  // بكائن MODALITIES بملف RadiologyPage.js (xray, ultrasound, ct, mri,
  // mammogram, other)، وليست النص العربي المعروض بالواجهة. نفس الأمر لحقل
  // "الحالة" (pending, scheduled, examined, reported, cancelled).
  registerExcelImport(router, 'radiology', collectionSchemas.radiology, {
    'رقم الطلب': 'reqNo', 'Request No': 'reqNo',
    'اسم المريض': 'patientName', 'Patient Name': 'patientName',
    'رقم المريض': 'patientId', 'Patient ID': 'patientId',
    'الطبيب المحول': 'doctorName', 'Referring Doctor': 'doctorName',
    'نوع التصوير': 'modality', 'Modality': 'modality',
    'منطقة الجسم': 'bodyPart', 'Body Part': 'bodyPart',
    'تاريخ الطلب': 'requestDate', 'Request Date': 'requestDate',
    'الأولوية': 'priority', 'Priority': 'priority',
    'الحالة': 'status', 'Status': 'status',
    'المشاهدات': 'findings', 'Findings': 'findings',
    'الاستنتاج': 'impression', 'Impression': 'impression',
    'عدد الصور': 'images', 'Images': 'images',
  }, {
    hospitalScoped: true, permission: 'radiology',
    tableName: 'radiology',
    // status/modality أعمدة حقيقية فعلاً بهذا الجدول (رُقِّيت بـ
    // 004_promote_batch2.sql ومسجَّلة بتسجيل pgCrud أدناه) — تُخزَّن الآن
    // بالأعمدة الحقيقية مباشرة. ملاحظة: services/dicom/orthancIntegration.js
    // يكتب status/modality مباشرة على الأعمدة الحقيقية فعلاً (بمعزل عن هذا
    // المسار)، فهو متوافق مع هذا الإصلاح تلقائياً بلا أي تعديل إضافي هناك.
    indexedColumns: [
      { field: 'status', column: 'status' },
      { field: 'modality', column: 'modality' },
    ],
    limiter: importLimiter,
    duplicateCheck: ['reqNo'],
    template: [
      { header: 'رقم الطلب', example: 'RAD-2026-0100' },
      { header: 'اسم المريض', example: 'محمد عبدالله' },
      { header: 'رقم المريض', example: 'PT-0001' },
      { header: 'الطبيب المحول', example: 'د. أحمد سالم' },
      { header: 'نوع التصوير', example: 'xray' },
      { header: 'منطقة الجسم', example: 'الصدر' },
      { header: 'تاريخ الطلب', example: '2026-07-22' },
      { header: 'الأولوية', example: 'normal' },
      { header: 'الحالة', example: 'reported' },
      { header: 'المشاهدات', example: 'رئتان طبيعيتان' },
      { header: 'الاستنتاج', example: 'لا توجد نتائج مرضية' },
      { header: 'عدد الصور', example: '1' },
    ],
  });

  // ── إضافة: استيراد Excel لوصفات الصيدلية (pharmacyOrders) ─────────────────
  // كانت غير مسجَّلة أصلاً. مسجَّلة هنا عمداً *قبل* pgCrud(router, 'pharmacyOrders', ...)
  // — نفس القاعدة المتبعة بكل موديول آخر بهذا الملف، لتفادي تعارض GET
  // /pharmacyOrders/:id مع GET /pharmacyOrders/import-template.
  // ── ملاحظة بنيوية مهمة: كل وصفة (rxForm) تحمل items[] (مصفوفة أدوية)
  // بالواجهة، وليس حقلاً مسطّحاً — لا يمكن لـ columnMap تعيين مصفوفة مباشرة.
  // نستقبل عمود دواء واحد بكل صف Excel (drugName/qty/unit/dosage) عبر حقول
  // مؤقتة مسطّحة، ثم نبنيها هنا كعنصر وحيد داخل items[] قبل الحفظ — يعني كل
  // صف بملف Excel يُنشئ وصفة منفصلة بدواء واحد (نفس المنطق المستخدم فعلياً
  // بمصدر البيانات: كل مطالبة تأمين/صرف واحدة لدواء واحد بمناسبة واحدة).
  registerExcelImport(router, 'pharmacyOrders', collectionSchemas.pharmacyOrders, {
    'رقم الوصفة': 'prescNo', 'Rx Number': 'prescNo',
    'اسم المريض': 'patientName', 'Patient Name': 'patientName',
    'رقم المريض': 'patientId', 'Patient ID': 'patientId',
    'الطبيب': 'doctorName', 'Doctor': 'doctorName',
    'التاريخ': 'date', 'Date': 'date',
    'اسم الدواء': 'drugNameRaw', 'Drug Name': 'drugNameRaw',
    'الكمية': 'qtyRaw', 'Qty': 'qtyRaw',
    'الوحدة': 'unitRaw', 'Unit': 'unitRaw',
    'الجرعة': 'dosageRaw', 'Dosage': 'dosageRaw',
    'التكلفة الإجمالية': 'totalCost', 'Total Cost': 'totalCost',
    'الحالة': 'status', 'Status': 'status',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'pharmacy',
    tableName: 'pharmacy_orders',
    // status عمود حقيقي فعلاً بهذا الجدول (رُقِّي بـ 004_promote_batch2.sql
    // ومسجَّل بتسجيل pgCrud أدناه) — يُخزَّن الآن بالعمود الحقيقي مباشرة.
    indexedColumns: [{ field: 'status', column: 'status' }],
    limiter: importLimiter,
    duplicateCheck: ['prescNo'],
    afterParse: (row) => {
      const { drugNameRaw, qtyRaw, unitRaw, dosageRaw, ...rest } = row;
      if (drugNameRaw) {
        rest.items = [{
          id: Date.now() + Math.floor(Math.random() * 100000),
          name: drugNameRaw,
          qty: Number(qtyRaw) || 1,
          unit: unitRaw || 'حبة',
          dosage: dosageRaw || '',
        }];
      } else {
        rest.items = [];
      }
      if (!rest.status) rest.status = 'dispensed';
      return rest;
    },
    template: [
      { header: 'رقم الوصفة', example: 'RX-2026-0100' },
      { header: 'اسم المريض', example: 'محمد عبدالله' },
      { header: 'رقم المريض', example: 'PT-0001' },
      { header: 'الطبيب', example: 'د. أحمد سالم' },
      { header: 'التاريخ', example: '2026-07-22' },
      { header: 'اسم الدواء', example: 'ميتفورمين 500 ملغ' },
      { header: 'الكمية', example: '30' },
      { header: 'الوحدة', example: 'حبة' },
      { header: 'الجرعة', example: 'حبة صباحاً ومساءً' },
      { header: 'التكلفة الإجمالية', example: '5000' },
      { header: 'الحالة', example: 'dispensed' },
      { header: 'ملاحظات', example: '' },
    ],
  });

  // ── إضافة: استيراد Excel للمواعيد (appointments) ──────────────────────────
  // مسجَّلة هنا عمداً *قبل* pgCrud(router, 'appointments', ...) — نفس القاعدة
  // المتبعة بكل موديول آخر بهذا الملف، لتفادي تعارض GET /appointments/:id
  // مع GET /appointments/import-template. indexedColumns مطابقة تماماً
  // لمصفوفة pgCrud(router, 'appointments', ...) بالأسفل (patient, doctor,
  // date, status). القيم المقبولة لحقل "الحالة" هي المفاتيح الخام الإنجليزية
  // (confirmed, pending, completed, cancelled)، وحقل "نوع الزيارة" كذلك
  // (checkup, followup, consult, emergency) — نفس القيم الداخلية الفعلية
  // المستخدمة بملف AppointmentsPage.js، وليست النص العربي المعروض بالواجهة.
  registerExcelImport(router, 'appointments', collectionSchemas.appointments, {
    'المريض': 'patient', 'اسم المريض': 'patient', 'Patient': 'patient',
    'الطبيب': 'doctor', 'Doctor': 'doctor',
    'القسم': 'department', 'Department': 'department',
    'التاريخ': 'date', 'Date': 'date',
    'الوقت': 'time', 'Time': 'time',
    'نوع الزيارة': 'type', 'Visit Type': 'type',
    'الحالة': 'status', 'Status': 'status',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'appointments',
    indexedColumns: [
      { field: 'patient', column: 'patient' },
      { field: 'doctor', column: 'doctor' },
      { field: 'date', column: 'date' },
      { field: 'status', column: 'status' },
    ],
    limiter: importLimiter,
    duplicateCheck: ['patient', 'date', 'time'],
    template: [
      { header: 'المريض', example: 'Test Patient CBC 1' },
      { header: 'الطبيب', example: 'د. أحمد سالم الراشدي' },
      { header: 'القسم', example: 'الفحوصات الطبية' },
      { header: 'التاريخ', example: '2026-07-22' },
      { header: 'الوقت', example: '09:00' },
      { header: 'نوع الزيارة', example: 'checkup' },
      { header: 'الحالة', example: 'confirmed' },
      { header: 'ملاحظات', example: '' },
    ],
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ── دفعة استيراد إضافية: أسعار الخدمات، الحسابات، الجودة، الردهات، صالة
  //    الولادة، العلاج الطبيعي، المشتريات، الوثائق، متابعات CRM، الكتب
  //    الصادرة/الواردة، الإجازات المرضية، ومأموريات الإسعاف — كلها مسجَّلة
  //    هنا عمداً *قبل* استدعاءات pgCrud المقابلة لها بالأسفل، لنفس السبب
  //    المذكور أعلى الملف (تعارض GET /module/:id مع GET /module/import-template).
  // ══════════════════════════════════════════════════════════════════════════

  // ── الفوترة: قائمة الأسعار الافتراضية (servicePrices) ──────────────────────
  registerExcelImport(router, 'servicePrices', collectionSchemas.servicePrices, {
    'الفئة': 'category', 'Category': 'category',
    'الاسم بالعربي': 'nameAr', 'Name (Arabic)': 'nameAr',
    'الاسم بالإنجليزي': 'nameEn', 'Name (English)': 'nameEn',
    'السعر': 'price', 'Price': 'price',
  }, {
    hospitalScoped: true, permission: 'billing',
    tableName: 'service_prices',
    indexedColumns: [{ field: 'category', column: 'category' }],
    limiter: importLimiter,
    duplicateCheck: ['nameAr', 'category'],
    template: [
      { header: 'الفئة', example: 'consultation' },
      { header: 'الاسم بالعربي', example: 'كشفية طبيب اختصاص' },
      { header: 'الاسم بالإنجليزي', example: 'Specialist Consultation' },
      { header: 'السعر', example: '25000' },
    ],
  });

  // ── الحسابات: المعاملات المالية العامة (transactions) ──────────────────────
  registerExcelImport(router, 'transactions', collectionSchemas.transactions, {
    'التاريخ': 'date', 'Date': 'date',
    'الوصف': 'desc', 'Description': 'desc',
    'الوصف بالإنجليزي': 'descEn', 'Description (English)': 'descEn',
    'الفئة': 'category', 'Category': 'category',
    'النوع': 'type', 'Type': 'type',
    'المبلغ': 'amount', 'Amount': 'amount',
    'طريقة الدفع': 'method', 'Method': 'method',
    'المرجع': 'ref', 'Reference': 'ref',
  }, {
    hospitalScoped: true, permission: 'accounts',
    // status أصبح عموداً حقيقياً فعلاً بهذا الجدول (رُقِّي بـ
    // 004_promote_batch2.sql ومسجَّل بتسجيل pgCrud أدناه)، لكن استيراد Excel
    // هذا لا يقبل أصلاً حقل status بـcolumnMap أعلاه — فتبقى [] هنا صحيحة
    // فعلياً (لا شيء لتوجيهه للعمود الحقيقي عبر هذا المسار تحديداً).
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['ref'],
    // ── إصلاح: type بالواجهة قيمته الفعلية عربية (دخل/مصروف)، بينما category
    // وmethod قيمتهما الفعلية مفاتيح إنجليزية (revenue/donation/... وcash/
    // bank/card/check) — عكس توقّعي الأول. نطبّع أي نص عربي أو إنجليزي شائع
    // للقيمة الصحيحة حتى لا تنكسر إحصائيات الإيراد/المصروف بصمت.
    afterParse: (row) => {
      const typeMap = { 'دخل': 'دخل', income: 'دخل', 'مصروف': 'مصروف', expense: 'مصروف' };
      const catMap = {
        'إيراد': 'revenue', revenue: 'revenue', 'تبرع': 'donation', donation: 'donation', 'منحة': 'grant', grant: 'grant',
        'رواتب': 'salaries', salaries: 'salaries', 'مستلزمات': 'supplies', supplies: 'supplies',
        'صيانة': 'maintenance', maintenance: 'maintenance', 'إيجار': 'rent', rent: 'rent',
        'كهرباء وماء': 'utilities', utilities: 'utilities', 'أخرى': 'other', other: 'other',
      };
      const methodMap = { 'نقداً': 'cash', cash: 'cash', 'تحويل': 'bank', bank: 'bank', 'بطاقة': 'card', card: 'card', check: 'check' };
      const t = (row.type || '').toString().trim();
      const c = (row.category || '').toString().trim();
      const m = (row.method || '').toString().trim();
      return {
        ...row,
        type: typeMap[t] || typeMap[t.toLowerCase()] || 'دخل',
        category: catMap[c] || catMap[c.toLowerCase()] || 'other',
        method: methodMap[m] || methodMap[m.toLowerCase()] || 'cash',
      };
    },
    template: [
      { header: 'التاريخ', example: '2026-07-01' },
      { header: 'الوصف', example: 'إيراد كشفيات شهر تموز' },
      { header: 'الفئة', example: 'revenue' },
      { header: 'النوع', example: 'دخل' },
      { header: 'المبلغ', example: '1500000' },
      { header: 'طريقة الدفع', example: 'cash' },
      { header: 'المرجع', example: 'REF-0001' },
    ],
  });

  // ── الحسابات: سجل الترفيعات والعلاوات المُوحَّد (promotionsAllowances) ──────────
  // دمج جدولي الترفيعات والعلاوات السابقين بجدول واحد — كل صف Excel قد يحمل
  // جانب الترفيع و/أو جانب العلاوة معاً، وكل جانب له رقم/تاريخ قرار مستقلان
  // تماماً (بدل حقل "رقم القرار" المشترك سابقاً). راجع
  // migrations-sql/014_merge_promotions_allowances.sql.
  // ملاحظة: tableName صريح هنا لأن الجدول الفعلي promotions_allowances
  // (بشرطة سفلية) بينما اسم apiName بصيغة camelCase — بدونه يحاول الاستيراد
  // الكتابة على جدول "promotionsallowances" غير الموجود (Postgres يُحوِّل أي
  // معرِّف غير مُقتبَس تلقائياً لحروف صغيرة).
  registerExcelImport(router, 'promotionsAllowances', collectionSchemas.promotionsAllowances, {
    'الاسم': 'name', 'Name': 'name',
    'من درجة': 'fromGrade', 'From Grade': 'fromGrade',
    'إلى درجة': 'toGrade', 'To Grade': 'toGrade',
    'تاريخ الترفيع': 'promotionDate', 'Promotion Date': 'promotionDate',
    'الراتب قبل': 'salaryBefore', 'Salary Before': 'salaryBefore',
    'الراتب بعد': 'salaryAfter', 'Salary After': 'salaryAfter',
    'رقم قرار الترفيع': 'promotionDecisionNo', 'Promotion Decision No': 'promotionDecisionNo',
    'تاريخ قرار الترفيع': 'promotionDecisionDate', 'Promotion Decision Date': 'promotionDecisionDate',
    'حالة الترفيع': 'promotionStatus', 'Promotion Status': 'promotionStatus',
    'نوع العلاوة': 'allowanceType', 'Allowance Type': 'allowanceType',
    'مبلغ العلاوة': 'amount', 'Allowance Amount': 'amount',
    'تاريخ العلاوة': 'allowanceDate', 'Allowance Date': 'allowanceDate',
    'رقم قرار العلاوة': 'allowanceDecisionNo', 'Allowance Decision No': 'allowanceDecisionNo',
    'تاريخ قرار العلاوة': 'allowanceDecisionDate', 'Allowance Decision Date': 'allowanceDecisionDate',
    'حالة العلاوة': 'allowanceStatus', 'Allowance Status': 'allowanceStatus',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'accounts',
    tableName: 'promotions_allowances',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['name', 'promotionDecisionNo', 'allowanceDecisionNo'],
    // ── الحالة تُعبَّأ فقط لو أُدخِلت فعلاً (لا نفرض قيمة افتراضية على جانب لم
    // يُستخدَم إطلاقاً بهذا الصف — قد يكون الصف ترفيعاً فقط أو علاوة فقط أو كليهما).
    afterParse: (row) => {
      const promoMap = { 'منجز': 'مُنجَز', 'مُنجَز': 'مُنجَز', done: 'مُنجَز', 'مستحق': 'مستحق', due: 'مستحق', 'قيد المعالجة': 'قيد المعالجة', process: 'قيد المعالجة' };
      const allowMap = { 'مصرف': 'مدفوع', 'مُصرَف': 'مدفوع', 'مصروف': 'مدفوع', 'مدفوع': 'مدفوع', paid: 'مدفوع', 'مستحقة': 'مستحقة', due: 'مستحقة', 'قيد المعالجة': 'قيد المعالجة', process: 'قيد المعالجة' };
      if (row.promotionStatus) {
        const ps = row.promotionStatus.toString().trim();
        row.promotionStatus = promoMap[ps] || promoMap[ps.toLowerCase()] || ps;
      }
      if (row.allowanceStatus) {
        const as = row.allowanceStatus.toString().trim();
        row.allowanceStatus = allowMap[as] || allowMap[as.toLowerCase()] || as;
      }
      return row;
    },
    template: [
      { header: 'الاسم', example: 'محمد علي حسن' },
      { header: 'من درجة', example: 'الرابعة/3' },
      { header: 'إلى درجة', example: 'الرابعة/4' },
      { header: 'تاريخ الترفيع', example: '2026-07-01' },
      { header: 'الراتب قبل', example: '450000' },
      { header: 'الراتب بعد', example: '480000' },
      { header: 'رقم قرار الترفيع', example: 'DEC-2026-01' },
      { header: 'تاريخ قرار الترفيع', example: '2026-07-05' },
      { header: 'حالة الترفيع', example: 'مُنجَز' },
      { header: 'نوع العلاوة', example: '' },
      { header: 'مبلغ العلاوة', example: '' },
      { header: 'تاريخ العلاوة', example: '' },
      { header: 'رقم قرار العلاوة', example: '' },
      { header: 'تاريخ قرار العلاوة', example: '' },
      { header: 'حالة العلاوة', example: '' },
      { header: 'ملاحظات', example: '' },
    ],
  });

  // ── الحسابات: الرواتب (salaries) ────────────────────────────────────────────
  // ── ملاحظة بنيوية: additions[]/deductions[] مصفوفتان بالواجهة، وليستا
  // حقلين مسطّحين — نفس نمط pharmacyOrders.items[] أعلاه. نستقبل بند إضافة
  // واحد وبند خصم واحد اختياريين بكل صف Excel عبر حقول مؤقتة مسطّحة، ثم
  // نبنيهما هنا كعنصر وحيد داخل كل مصفوفة قبل الحفظ.
  registerExcelImport(router, 'salaries', collectionSchemas.salaries, {
    'الاسم': 'name', 'Name': 'name',
    'المسمى الوظيفي': 'jobTitle', 'Job Title': 'jobTitle',
    'القسم': 'dept', 'Department': 'dept',
    'الدرجة': 'grade', 'Grade': 'grade',
    'الراتب الاسمي': 'baseSalary', 'Nominal Salary': 'baseSalary',
    // ── إصلاح: "الراتب الأساسي" أُعيد تسميته "الراتب الاسمي" بكل الواجهة —
    // يبقى مقبولاً هنا كمرادف قديم حتى لا يُكسَر استيراد أي ملف Excel محفوظ
    // مسبقاً بالتسمية السابقة.
    'الراتب الأساسي': 'baseSalary', 'Base Salary': 'baseSalary',
    'الشهر': 'month', 'Month': 'month',
    'اسم بند الإضافة': 'additionLabelRaw', 'Addition Label': 'additionLabelRaw',
    'مبلغ الإضافة': 'additionAmountRaw', 'Addition Amount': 'additionAmountRaw',
    'اسم بند الخصم': 'deductionLabelRaw', 'Deduction Label': 'deductionLabelRaw',
    'مبلغ الخصم': 'deductionAmountRaw', 'Deduction Amount': 'deductionAmountRaw',
    'الحالة': 'status', 'Status': 'status',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'accounts',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['name', 'month'],
    afterParse: (row) => {
      const { additionLabelRaw, additionAmountRaw, deductionLabelRaw, deductionAmountRaw, ...rest } = row;
      rest.additions = additionLabelRaw ? [{ label: additionLabelRaw, amount: Number(additionAmountRaw) || 0 }] : [];
      rest.deductions = deductionLabelRaw ? [{ label: deductionLabelRaw, amount: Number(deductionAmountRaw) || 0 }] : [];
      // ── إصلاح: "amount" يمثّل صافي الراتب (نفس دلالته بـtransactions/allowances —
      // القيمة المالية الإجمالية النهائية للسجل)، أي baseSalary + مجموع additions
      // - مجموع deductions، مطابقاً تماماً لدالة calcNet() بالواجهة
      // (frontend/src/pages/accounts/shared.js). كان يُعبَّى سابقاً بقيمة
      // baseSalary وحدها فقط لتفادي فشل تحقق قديم بمخطط الاستيراد — الحقل الآن
      // غير مطلوب أصلاً بـcollectionSchemas.salaries، لكن نحسبه صحيحاً هنا
      // بأي حال حتى يبقى صافياً حقيقياً لأي طرف يقرأه لاحقاً (تقرير، تصدير...)
      // بدل الاعتماد على أنه دائماً يُعاد حسابه بالواجهة فقط.
      const totalAdd = rest.additions.reduce((s, a) => s + (Number(a.amount) || 0), 0);
      const totalDed = rest.deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);
      rest.amount = (Number(rest.baseSalary) || 0) + totalAdd - totalDed;
      const map = { 'مصرف': 'مدفوع', 'مُصرَف': 'مدفوع', 'مصروف': 'مدفوع', 'مدفوع': 'مدفوع', paid: 'مدفوع', 'معلق': 'معلق', pending: 'معلق', 'مرفوض': 'مرفوض', rejected: 'مرفوض' };
      const s = (rest.status || '').toString().trim();
      rest.status = map[s] || map[s.toLowerCase()] || 'معلق';
      return rest;
    },
    template: [
      { header: 'الاسم', example: 'رنا محمد النجار' },
      { header: 'المسمى الوظيفي', example: 'سكرتيرة' },
      { header: 'القسم', example: 'الإدارة' },
      { header: 'الراتب الاسمي', example: '450000' },
      { header: 'الشهر', example: '2026-07' },
      { header: 'اسم بند الإضافة', example: 'علاوة اجتماعية' },
      { header: 'مبلغ الإضافة', example: '30000' },
      { header: 'اسم بند الخصم', example: 'ضريبة' },
      { header: 'مبلغ الخصم', example: '10000' },
      { header: 'الحالة', example: 'معلق' },
    ],
  });

  // ── الموارد البشرية: الكتب الصادرة (outgoing) ───────────────────────────────
  registerExcelImport(router, 'outgoing', collectionSchemas.outgoing, {
    'رقم الصادر': 'ref', 'Ref No': 'ref',
    'عنوان الكتاب': 'title', 'Letter Title': 'title',
    'الجهة المُرسَلة إليها': 'to', 'Sent To': 'to',
    'التاريخ': 'date', 'Date': 'date',
    'الموضوع': 'subject', 'Subject': 'subject',
    'الحالة': 'status', 'Status': 'status',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'hr',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['ref'],
    template: [
      { header: 'رقم الصادر', example: 'ص-2026-001' },
      { header: 'عنوان الكتاب', example: 'طلب تجهيز مستلزمات طبية' },
      { header: 'الجهة المُرسَلة إليها', example: 'دائرة صحة البصرة' },
      { header: 'التاريخ', example: '2026-07-01' },
      { header: 'الموضوع', example: 'تجهيز مستلزمات' },
      { header: 'الحالة', example: 'مُرسَل' },
    ],
  });

  // ── الموارد البشرية: الكتب الواردة (incoming) ───────────────────────────────
  registerExcelImport(router, 'incoming', collectionSchemas.incoming, {
    'رقم الوارد': 'ref', 'Ref No': 'ref',
    'عنوان الكتاب': 'title', 'Letter Title': 'title',
    'الجهة المُرسِلة': 'from', 'From': 'from',
    'رقم صادر الجهة': 'incomingRef', 'Sender Ref': 'incomingRef',
    'التاريخ': 'date', 'Date': 'date',
    'الموضوع': 'subject', 'Subject': 'subject',
    'الحالة': 'status', 'Status': 'status',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'hr',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['ref'],
    template: [
      { header: 'رقم الوارد', example: 'و-2026-001' },
      { header: 'عنوان الكتاب', example: 'إشعار زيارة تفتيشية' },
      { header: 'الجهة المُرسِلة', example: 'دائرة صحة البصرة' },
      { header: 'رقم صادر الجهة', example: '4521' },
      { header: 'التاريخ', example: '2026-07-01' },
      { header: 'الموضوع', example: 'زيارة تفتيشية' },
      { header: 'الحالة', example: 'مُستلَم' },
    ],
  });

  // ── الموارد البشرية: الإجازات المرضية (medicalLeaves) ───────────────────────
  registerExcelImport(router, 'medicalLeaves', collectionSchemas.medicalLeaves, {
    'الموظف': 'employee', 'Employee': 'employee',
    'القسم': 'dept', 'Department': 'dept',
    'النوع': 'type', 'Type': 'type',
    'من تاريخ': 'from', 'From': 'from',
    'إلى تاريخ': 'to', 'To': 'to',
    'عدد الأيام': 'days', 'Days': 'days',
    'التشخيص': 'diagnosis', 'Diagnosis': 'diagnosis',
    'الطبيب': 'doctor', 'Doctor': 'doctor',
    'الحالة': 'status', 'Status': 'status',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'medical-leave',
    tableName: 'medical_leaves',
    // status عمود حقيقي فعلاً بهذا الجدول (رُقِّي بـ 004_promote_batch2.sql
    // ومسجَّل بتسجيل pgCrud أدناه) — يُخزَّن الآن بالعمود الحقيقي مباشرة.
    indexedColumns: [{ field: 'status', column: 'status' }],
    limiter: importLimiter,
    duplicateCheck: ['employee', 'from', 'to'],
    // ── إصلاح: الواجهة تفلتر الإحصائيات بمقارنة صارمة على مفاتيح إنجليزية
    // فعلية (approved/review/rejected) — أي نص عربي خام بعمود "الحالة" (حتى
    // لو مطابق تماماً لنص الشارة المعروضة بالجدول) ما يطابق أي شرط، فتطلع كل
    // البطاقات صفراً رغم وجود بيانات فعلية بكل حالة. نطبّع القيمة هنا لأي
    // نص عربي أو إنجليزي شائع، وأي قيمة غير معروفة تُعامَل كـ"قيد المراجعة"
    // (الافتراضي بنموذج الإضافة اليدوي نفسه).
    afterParse: (row) => {
      const raw = (row.status || '').toString().trim();
      const map = {
        'موافق عليه': 'approved', 'موافق عليها': 'approved', 'مقبولة': 'approved', 'approved': 'approved',
        'مرفوضة': 'rejected', 'مرفوض': 'rejected', 'rejected': 'rejected',
        'قيد المراجعة': 'review', 'قيد المعالجة': 'review', 'review': 'review', 'pending': 'review',
      };
      return { ...row, status: map[raw] || map[raw.toLowerCase()] || 'review' };
    },
    template: [
      { header: 'الموظف', example: 'محمد علي حسن' },
      { header: 'القسم', example: 'قسم الطوارئ' },
      { header: 'النوع', example: 'مرضية' },
      { header: 'من تاريخ', example: '2026-07-01' },
      { header: 'إلى تاريخ', example: '2026-07-05' },
      { header: 'عدد الأيام', example: '5' },
      { header: 'التشخيص', example: 'التهاب حاد' },
      { header: 'الطبيب', example: 'د. أحمد الكريم' },
      { header: 'الحالة', example: 'موافق عليه' },
    ],
  });

  // ── ضبط الوثائق (documents) ──────────────────────────────────────────────────
  // ── ملاحظة: حقل tags[] مصفوفة بالواجهة — لا يُستورَد من Excel، تبدأ فاضية
  // دائماً عبر afterParse ويمكن إضافتها لاحقاً من الواجهة.
  registerExcelImport(router, 'documents', collectionSchemas.documents, {
    'رقم الوثيقة': 'docNo', 'Doc No': 'docNo',
    'النوع': 'type', 'Type': 'type',
    'العنوان': 'title', 'Title': 'title',
    'المصدر / الجهة': 'from', 'From': 'from',
    'التاريخ': 'date', 'Date': 'date',
    'تاريخ الاستلام': 'receivedDate', 'Received Date': 'receivedDate',
    'الأولوية': 'priority', 'Priority': 'priority',
    'الحالة': 'status', 'Status': 'status',
    'الموضوع': 'subject', 'Subject': 'subject',
    'مسؤول المعالجة': 'assignedTo', 'Assigned To': 'assignedTo',
  }, {
    hospitalScoped: true, permission: 'documents',
    // type/status/priority أعمدة حقيقية فعلاً بهذا الجدول (رُقِّيت بـ
    // 004_promote_batch2.sql ومسجَّلة بتسجيل pgCrud أدناه) — تُخزَّن الآن
    // بالأعمدة الحقيقية مباشرة.
    indexedColumns: [
      { field: 'type', column: 'type' },
      { field: 'status', column: 'status' },
      { field: 'priority', column: 'priority' },
    ],
    limiter: importLimiter,
    duplicateCheck: ['docNo'],
    afterParse: (row) => ({ ...row, tags: row.tags || [] }),
    template: [
      { header: 'رقم الوثيقة', example: 'IN-2026-0001' },
      { header: 'النوع', example: 'incoming' },
      { header: 'العنوان', example: 'كتاب تعميم إداري' },
      { header: 'المصدر / الجهة', example: 'دائرة صحة البصرة' },
      { header: 'التاريخ', example: '2026-07-01' },
      { header: 'الأولوية', example: 'normal' },
      { header: 'الحالة', example: 'pending' },
      { header: 'الموضوع', example: 'تعميم' },
    ],
  });

  // ── المشتريات (procurement) ──────────────────────────────────────────────────
  registerExcelImport(router, 'procurement', collectionSchemas.procurement, {
    'رقم أمر الشراء': 'poNo', 'PO Number': 'poNo',
    'عنوان المشتريات': 'title', 'Title': 'title',
    'العنوان بالإنجليزي': 'titleEn', 'Title (English)': 'titleEn',
    'المورد': 'supplier', 'Supplier': 'supplier',
    'المورد بالإنجليزي': 'supplierEn', 'Supplier (English)': 'supplierEn',
    'تاريخ الطلب': 'date', 'Order Date': 'date',
    'تاريخ التسليم المتوقع': 'deliveryDate', 'Expected Delivery': 'deliveryDate',
    'المبلغ الإجمالي': 'totalAmount', 'Total Amount': 'totalAmount',
    'عدد الأصناف': 'items', 'Items Count': 'items',
    'الأولوية': 'priority', 'Priority': 'priority',
    'الحالة': 'status', 'Status': 'status',
  }, {
    hospitalScoped: true, permission: 'procurement',
    // status عمود حقيقي فعلاً بهذا الجدول (رُقِّي بـ 004_promote_batch2.sql
    // ومسجَّل بتسجيل pgCrud أدناه) — يُخزَّن الآن بالعمود الحقيقي مباشرة.
    indexedColumns: [{ field: 'status', column: 'status' }],
    limiter: importLimiter,
    duplicateCheck: ['poNo'],
    template: [
      { header: 'رقم أمر الشراء', example: 'PO-2026-001' },
      { header: 'عنوان المشتريات', example: 'تجهيز مستلزمات مختبر' },
      { header: 'المورد', example: 'شركة الرافدين للأدوية' },
      { header: 'تاريخ الطلب', example: '2026-07-01' },
      { header: 'المبلغ الإجمالي', example: '3500000' },
      { header: 'الأولوية', example: 'normal' },
      { header: 'الحالة', example: 'pending' },
    ],
  });

  // ── CRM المرضى: المتابعات والتذكيرات (crmFollowUps) ─────────────────────────
  // ── ملاحظة مهمة: "معرّف المريض" هنا هو الرقم الداخلي الرقمي لسجل المريض
  // بقاعدة البيانات (عمود id بجدول patients)، وليس رمز المريض النصي
  // (patientId code مثل PT-0001) المستخدَم بموديولات أخرى كالمختبر والأشعة.
  // يمكن الحصول عليه من تصدير Excel لصفحة المرضى.
  // ── ملاحظة مُحدَّثة: صار يقبل الآن "اسم المريض" مباشرة ويحوّله لـpatientId
  // الرقمي الحقيقي بالبحث المباشر بجدول patients (نفس أسلوب wardId/
  // admissionId) — بدل الاعتماد على معرفة رقم داخلي يدوياً، مما يصعب توفيره
  // فعلياً بملف Excel عادي. لو الاسم ما تطابق بالضبط مع مريض حقيقي، السطر
  // يُرفَض بخطأ واضح (patientId مطلوب) بدل حفظه بربط خاطئ صامت.
  registerExcelImport(router, 'crmFollowUps', collectionSchemas.crmFollowUps, {
    'اسم المريض': 'patientName', 'Patient Name': 'patientName',
    'معرّف المريض': 'patientId', 'Patient Numeric ID': 'patientId',
    'نوع المتابعة': 'followUpType', 'Follow-up Type': 'followUpType',
    'العنوان': 'title', 'Title': 'title',
    'تاريخ الاستحقاق': 'dueDate', 'Due Date': 'dueDate',
    'قناة التذكير': 'reminderChannel', 'Reminder Channel': 'reminderChannel',
    'الحالة': 'status', 'Status': 'status',
  }, {
    hospitalScoped: true, permission: 'crm',
    tableName: 'crm_follow_ups',
    indexedColumns: [{ field: 'patientId', column: 'patient_id' }, { field: 'status', column: 'status' }],
    limiter: importLimiter,
    duplicateCheck: ['patientId', 'title', 'dueDate'],
    // ── إصلاح استباقي (نفس علة medicalLeaves): الواجهة تقارن status/
    // followUpType/reminderChannel بمفاتيح إنجليزية صارمة فقط. نطبّع أي نص
    // عربي شائع (أو إنجليزي بأي حالة أحرف) للمفتاح الصحيح قبل الحفظ.
    afterParse: async (row, hospitalId) => {
      const statusMap = {
        'قيد الانتظار': 'pending', 'مكتملة': 'completed', 'فائتة': 'missed', 'ملغاة': 'cancelled',
        pending: 'pending', completed: 'completed', missed: 'missed', cancelled: 'cancelled',
      };
      const typeMap = {
        'موعد': 'appointment', 'فحص دوري': 'checkup', 'لقاح': 'vaccination',
        'نتيجة مختبر': 'lab_result', 'دواء': 'medication', 'أخرى': 'other',
        appointment: 'appointment', checkup: 'checkup', vaccination: 'vaccination',
        lab_result: 'lab_result', medication: 'medication', other: 'other',
      };
      const channelMap = { 'اتصال': 'call', sms: 'sms', whatsapp: 'whatsapp', call: 'call' };
      const s = (row.status || '').toString().trim();
      const t = (row.followUpType || '').toString().trim();
      const c = (row.reminderChannel || '').toString().trim();
      const { patientName, ...rest } = row;
      if (patientName && !rest.patientId) {
        try {
          const conditions = ['name = $1'];
          const values = [patientName];
          if (hospitalId) { values.push(hospitalId); conditions.push(`data->>'hospitalId' = $${values.length}`); }
          const result = await pool.query(`SELECT id FROM patients WHERE ${conditions.join(' AND ')} LIMIT 1`, values);
          if (result.rows.length > 0) rest.patientId = result.rows[0].id;
        } catch { /* فشل البحث — patientId يبقى فارغاً، الصف يُرفَض لاحقاً بخطأ واضح بدل ربط خاطئ */ }
      }
      return {
        ...rest,
        status: statusMap[s] || statusMap[s.toLowerCase()] || 'pending',
        followUpType: typeMap[t] || typeMap[t.toLowerCase()] || 'other',
        reminderChannel: channelMap[c] || channelMap[c.toLowerCase()] || 'sms',
      };
    },
    template: [
      { header: 'اسم المريض', example: 'Test Patient CBC 1' },
      { header: 'نوع المتابعة', example: 'checkup' },
      { header: 'العنوان', example: 'فحص دوري للضغط' },
      { header: 'تاريخ الاستحقاق', example: '2026-08-01' },
      { header: 'قناة التذكير', example: 'sms' },
    ],
  });

  // ── إدارة الجودة (quality) ────────────────────────────────────────────────────
  registerExcelImport(router, 'qualityAudits', collectionSchemas.qualityAudits, {
    'العنوان': 'title', 'Title': 'title',
    'العنوان بالإنجليزي': 'titleEn', 'Title (English)': 'titleEn',
    'النطاق': 'scope', 'Scope': 'scope',
    'المدقق': 'auditor', 'Auditor': 'auditor',
    'التاريخ': 'date', 'Date': 'date',
    'النوع': 'type', 'Type': 'type',
    'الحالة': 'status', 'Status': 'status',
  }, {
    hospitalScoped: true, permission: 'quality',
    tableName: 'quality_audits',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['title', 'date'],
    template: [
      { header: 'العنوان', example: 'مراجعة قسم المختبر' },
      { header: 'النطاق', example: 'إجراءات السلامة' },
      { header: 'المدقق', example: 'م. هدى عبد العظيم' },
      { header: 'التاريخ', example: '2026-07-01' },
      { header: 'النوع', example: 'internal' },
      { header: 'الحالة', example: 'planned' },
    ],
  });

  registerExcelImport(router, 'qualityNCs', collectionSchemas.qualityNCs, {
    'العنوان': 'title', 'Title': 'title',
    'العنوان بالإنجليزي': 'titleEn', 'Title (English)': 'titleEn',
    'التصنيف': 'classification', 'Classification': 'classification',
    'القسم': 'department', 'Department': 'department',
    'المسؤول عن التصحيح': 'owner', 'Owner': 'owner',
    'تاريخ الفتح': 'openDate', 'Open Date': 'openDate',
    'تاريخ الإغلاق المتوقع': 'dueDate', 'Due Date': 'dueDate',
    'السبب الجذري': 'rootCause', 'Root Cause': 'rootCause',
    'الإجراء التصحيحي': 'corrective', 'Corrective Action': 'corrective',
    'الحالة': 'status', 'Status': 'status',
  }, {
    hospitalScoped: true, permission: 'quality',
    tableName: 'quality_ncs',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['title', 'openDate'],
    afterParse: (row) => ({ ...row, status: row.status || 'open' }),
    template: [
      { header: 'العنوان', example: 'نقص بمخزون قفازات معقمة' },
      { header: 'التصنيف', example: 'minor' },
      { header: 'القسم', example: 'المخزون' },
      { header: 'المسؤول عن التصحيح', example: 'أمين المخزن' },
      { header: 'تاريخ الفتح', example: '2026-07-01' },
      { header: 'الحالة', example: 'open' },
    ],
  });

  registerExcelImport(router, 'qualityKPIs', collectionSchemas.qualityKPIs, {
    'اسم المؤشر': 'name', 'KPI Name': 'name',
    'الهدف': 'target', 'Target': 'target',
    'القيمة الحالية': 'actual', 'Current Value': 'actual',
    'الوحدة': 'unit', 'Unit': 'unit',
    'الفترة': 'period', 'Period': 'period',
  }, {
    hospitalScoped: true, permission: 'quality',
    tableName: 'quality_kpis',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['name', 'period'],
    template: [
      { header: 'اسم المؤشر', example: 'نسبة رضا المرضى' },
      { header: 'الهدف', example: '90' },
      { header: 'القيمة الحالية', example: '85' },
      { header: 'الوحدة', example: '%' },
      { header: 'الفترة', example: '2026-Q3' },
    ],
  });

  // ── الردهات (wards / admissions) ────────────────────────────────────────────
  registerExcelImport(router, 'wards', collectionSchemas.wards, {
    'اسم الردهة': 'name', 'Ward Name': 'name',
    'الاسم بالإنجليزي': 'nameEn', 'Name (English)': 'nameEn',
    'عدد الأسرّة': 'bedCount', 'Bed Count': 'bedCount',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'wards',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['name'],
    template: [
      { header: 'اسم الردهة', example: 'ردهة الباطنية' },
      { header: 'عدد الأسرّة', example: '20' },
    ],
  });

  // ── ملاحظة: "الردهة" (wardId) مرجع رقمي داخلي (foreign key) لجدول wards —
  // لا يمكن تعيينه تلقائياً من اسم نصي عبر الاستيراد الجماعي، فيبقى فارغاً
  // بالسجلات المستورَدة ويُحدَّد لاحقاً يدوياً من الواجهة (زر تعديل).
  // ── ملاحظة مُحدَّثة: بعد إصلاح excelImportRoutes.js ليدعم afterParse
  // غير متزامن (async)، صار ممكناً تحويل اسم الردهة النصي بملف Excel إلى
  // wardId رقمي فعلي بالبحث المباشر بجدول wards أثناء المعالجة — بدل ما يبقى
  // فارغاً كما كان بالنسخة السابقة. الشرط الوحيد: اسم الردهة بالعمود يطابق
  // *بالضبط* اسم ردهة موجود فعلاً بجدول wards (نفس النص المستورَد بملف
  // wards_import.xlsx) — لو لم يوجد تطابق، wardId يبقى فارغاً وتحتاج ربطه
  // يدوياً كما كان الحال سابقاً، بدل ما يفشل الصف كاملاً.
  registerExcelImport(router, 'admissions', collectionSchemas.admissions, {
    'اسم المريض': 'patientName', 'Patient Name': 'patientName',
    'الردهة': 'wardName', 'Ward': 'wardName',
    'رقم السرير': 'bedNo', 'Bed No': 'bedNo',
    'تاريخ الإدخال': 'admissionDate', 'Admission Date': 'admissionDate',
    'التشخيص': 'diagnosis', 'Diagnosis': 'diagnosis',
    'الطبيب المعالج': 'treatingDoctor', 'Treating Doctor': 'treatingDoctor',
    'الحالة': 'status', 'Status': 'status',
    'تاريخ الخروج': 'dischargeDate', 'Discharge Date': 'dischargeDate',
    'ملاحظات الخروج': 'dischargeNotes', 'Discharge Notes': 'dischargeNotes',
  }, {
    hospitalScoped: true, permission: 'wards',
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['patientName', 'admissionDate'],
    afterParse: async (row, hospitalId) => {
      const { wardName, ...rest } = row;
      rest.status = rest.status || 'admitted';
      if (wardName) {
        try {
          const conditions = [`data->>'name' = $1`];
          const values = [wardName];
          if (hospitalId) { values.push(hospitalId); conditions.push(`data->>'hospitalId' = $${values.length}`); }
          const result = await pool.query(`SELECT id FROM wards WHERE ${conditions.join(' AND ')} LIMIT 1`, values);
          if (result.rows.length > 0) rest.wardId = result.rows[0].id;
        } catch { /* فشل البحث — يبقى wardId فارغاً، الصف يُستورَد بدون ربط ردهة بدل الفشل كاملاً */ }
      }
      return rest;
    },
    template: [
      { header: 'اسم المريض', example: 'Test Patient CBC 1' },
      { header: 'الردهة', example: 'الباطنية العامة' },
      { header: 'رقم السرير', example: '3' },
      { header: 'تاريخ الإدخال', example: '2026-07-01' },
      { header: 'التشخيص', example: 'التهاب رئوي' },
      { header: 'الطبيب المعالج', example: 'د. أحمد سالم' },
      { header: 'الحالة', example: 'admitted' },
    ],
  });

  // ── صالة الولادة (deliveries) ────────────────────────────────────────────────
  registerExcelImport(router, 'deliveries', collectionSchemas.deliveries, {
    'اسم الأم': 'motherName', 'Mother Name': 'motherName',
    'عمر الأم': 'motherAge', 'Mother Age': 'motherAge',
    'تاريخ الدخول': 'admissionDate', 'Admission Date': 'admissionDate',
    'الموعد المتوقع': 'expectedDate', 'Expected Date': 'expectedDate',
    'تاريخ الولادة': 'deliveryDate', 'Delivery Date': 'deliveryDate',
    'وقت الولادة': 'deliveryTime', 'Delivery Time': 'deliveryTime',
    'نوع الولادة': 'deliveryType', 'Delivery Type': 'deliveryType',
    'الطبيب المشرف': 'attendingDoctor', 'Attending Doctor': 'attendingDoctor',
    'القابلة': 'midwife', 'Midwife': 'midwife',
    'اسم الطفل': 'babyName', 'Baby Name': 'babyName',
    'جنس المولود': 'babyGender', 'Baby Gender': 'babyGender',
    'وزن المولود': 'babyWeight', 'Baby Weight': 'babyWeight',
    'درجة أبغار': 'apgarScore', 'Apgar Score': 'apgarScore',
    'المضاعفات': 'complications', 'Complications': 'complications',
    'حالة الأم': 'motherStatus', "Mother's Status": 'motherStatus',
    'حالة المولود': 'babyStatus', "Baby's Status": 'babyStatus',
    'المرحلة': 'stage', 'Stage': 'stage',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'delivery',
    // stage/baby_status أعمدة حقيقية فعلاً بهذا الجدول (رُقِّيت بـ
    // 004_promote_batch2.sql ومسجَّلة بتسجيل pgCrud أدناه). اسم الحقل
    // بالواجهة babyStatus (camelCase) بينما اسم العمود baby_status —
    // تُخزَّن الآن بالأعمدة الحقيقية مباشرة.
    indexedColumns: [
      { field: 'stage', column: 'stage' },
      { field: 'babyStatus', column: 'baby_status' },
    ],
    limiter: importLimiter,
    duplicateCheck: ['motherName', 'admissionDate'],
    afterParse: (row) => ({ ...row, stage: row.stage || (row.deliveryDate ? 'delivered' : 'admitted') }),
    template: [
      { header: 'اسم الأم', example: 'زينب علي حسين' },
      { header: 'تاريخ الدخول', example: '2026-07-01' },
      { header: 'تاريخ الولادة', example: '2026-07-02' },
      { header: 'نوع الولادة', example: 'normal' },
      { header: 'الطبيب المشرف', example: 'د. فاطمة الموسوي' },
      { header: 'حالة الأم', example: 'stable' },
      { header: 'حالة المولود', example: 'healthy' },
      { header: 'المرحلة', example: 'delivered' },
    ],
  });

  // ── العلاج الطبيعي (ptEquipment / ptSessions) ────────────────────────────────
  registerExcelImport(router, 'ptEquipment', collectionSchemas.ptEquipment, {
    'اسم الجهاز': 'name', 'Equipment Name': 'name',
    'الاسم بالإنجليزي': 'nameEn', 'Name (English)': 'nameEn',
    'النوع': 'type', 'Type': 'type',
    'الحالة': 'status', 'Status': 'status',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'physiotherapy',
    tableName: 'pt_equipment',
    // status عمود حقيقي فعلاً بهذا الجدول (رُقِّي بـ 004_promote_batch2.sql
    // ومسجَّل بتسجيل pgCrud أدناه) — يُخزَّن الآن بالعمود الحقيقي مباشرة.
    indexedColumns: [{ field: 'status', column: 'status' }],
    limiter: importLimiter,
    duplicateCheck: ['name'],
    template: [
      { header: 'اسم الجهاز', example: 'جهاز مقاومة كهربائي' },
      { header: 'النوع', example: 'كهربائي' },
      { header: 'الحالة', example: 'available' },
    ],
  });

  registerExcelImport(router, 'ptSessions', collectionSchemas.ptSessions, {
    'اسم المريض': 'patientName', 'Patient Name': 'patientName',
    'المعالج': 'therapist', 'Therapist': 'therapist',
    'التاريخ': 'date', 'Date': 'date',
    'الجهاز المستخدم': 'equipmentUsed', 'Equipment Used': 'equipmentUsed',
    'نوع العلاج': 'treatmentType', 'Treatment Type': 'treatmentType',
    'المدة': 'duration', 'Duration': 'duration',
    'التقدّم الملاحَظ': 'progress', 'Observed Progress': 'progress',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'physiotherapy',
    tableName: 'pt_sessions',
    // status/date أعمدة حقيقية فعلاً بهذا الجدول (رُقِّيت بـ
    // 004_promote_batch2.sql ومسجَّلة بتسجيل pgCrud أدناه) — تُخزَّن الآن
    // بالأعمدة الحقيقية مباشرة. عمود date من نوع DATE فعلي (وليس نصاً)،
    // يقبل مباشرة نص 'YYYY-MM-DD' القادم من الواجهة بلا أي تحويل إضافي.
    indexedColumns: [
      { field: 'status', column: 'status' },
      { field: 'date', column: 'date' },
    ],
    limiter: importLimiter,
    duplicateCheck: ['patientName', 'date'],
    template: [
      { header: 'اسم المريض', example: 'Test Patient CBC 1' },
      { header: 'المعالج', example: 'أ. سلام كاظم' },
      { header: 'التاريخ', example: '2026-07-01' },
      { header: 'نوع العلاج', example: 'تمارين إطالة' },
      { header: 'المدة', example: '30' },
    ],
  });

  // ── الإسعاف: المأموريات (ambulanceMissions) ─────────────────────────────────
  // ── ملاحظة: "المركبة" (vehicleId) مرجع رقمي داخلي (foreign key) لجدول
  // ambulanceVehicles — يبقى فارغاً بالسجلات المستورَدة ويُحدَّد لاحقاً يدوياً
  // من الواجهة، لنفس سبب wardId أعلاه. تحقق من أسماء الحقول هنا مقابل
  // EMPTY_MISS الفعلي بـ AmbulancePage.js قبل أول استخدام حقيقي — أُنشئت
  // بأفضل معرفة متوفرة عن نموذج المأمورية دون رؤية الكود الكامل للنموذج.
  registerExcelImport(router, 'ambulanceMissions', collectionSchemas.ambulanceMissions, {
    'اسم المريض': 'patientName', 'Patient Name': 'patientName',
    'هاتف المتصل': 'callerPhone', 'Caller Phone': 'callerPhone',
    'العنوان': 'address', 'Address': 'address',
    'وقت الاتصال': 'callTime', 'Call Time': 'callTime',
    'الأولوية': 'priority', 'Priority': 'priority',
    'الحالة': 'status', 'Status': 'status',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'ambulance',
    tableName: 'ambulance_missions',
    // status عمود حقيقي فعلاً بهذا الجدول (رُقِّي بـ 004_promote_batch2.sql
    // ومسجَّل بتسجيل pgCrud أدناه) — يُخزَّن الآن بالعمود الحقيقي مباشرة.
    indexedColumns: [{ field: 'status', column: 'status' }],
    limiter: importLimiter,
    duplicateCheck: ['address', 'callTime'],
    template: [
      { header: 'اسم المريض', example: 'مواطن' },
      { header: 'العنوان', example: 'حي الجزائر - البصرة' },
      { header: 'وقت الاتصال', example: '2026-07-01T14:30' },
      { header: 'الأولوية', example: 'normal' },
      { header: 'الحالة', example: 'completed' },
    ],
  });

  pgCrud(router, 'patients', collectionSchemas.patients, PATIENT_COLUMNS, undefined, { hospitalScoped: true, permission: 'patients', openRead: true, searchFields: ['patientId', 'bloodType', 'nationalId'], extraFilterFields: ['patientId', 'bloodType', 'nationalId'], dateRangeColumn: 'created_at' });
  // ── المرحلة الثانية: كاش Redis ─────────────────────────────────────────────
  // قائمة الأطباء تُقرأ من صفحات كثيرة جداً (قوائم منسدلة بالمواعيد، الوصفات،
  // التحويلات...) وتتغيّر نادراً (إضافة/تعديل طبيب مناسبة نادرة نسبياً) —
  // مرشّح مثالي للتخزين المؤقت. 5 دقائق (300 ثانية) توازن بين تقليل ضغط
  // قاعدة البيانات وبقاء البيانات حديثة بما يكفي بلا أي إبطال يدوي إضافي
  // (وأي كتابة فعلية على الموديول تُبطِل الكاش فوراً بأي حال — راجع
  // routes/pgCrud.js).
  pgCrud(router, 'doctors', collectionSchemas.doctors, DOCTOR_COLUMNS, undefined, { hospitalScoped: true, permission: 'doctors', openRead: true, searchFields: ['specialization'], extraFilterFields: ['specialization'], cache: { ttlSeconds: 300 } });
  pgCrud(router, 'appointments', collectionSchemas.appointments, [
    { field: 'patient', column: 'patient' },
    { field: 'doctor', column: 'doctor' },
    { field: 'date', column: 'date' },
    { field: 'status', column: 'status' },
  ], undefined, { hospitalScoped: true, permission: 'appointments', openRead: true, dateRangeField: 'date' });
  // ── الفوترة: الفواتير (invoices) — سجلات فواتير مدفوعة تاريخياً ──────────────
  // ── نفس أسلوب حل patientId المستخدم بـ crmFollowUps: تقبل "اسم المريض"
  // مباشرة وتحوّله لمعرّف رقمي حقيقي بالبحث بجدول patients. كل صف Excel يمثّل
  // فاتورة بخدمة واحدة (الحالة الأشيع لفواتير تاريخية بسيطة) — لفواتير بعدة
  // خدمات بنفس الزيارة، تُضاف كصفوف منفصلة بنفس اسم المريض ونفس المرجع
  // (referenceCode)، وتبقى فواتير منفصلة بقاعدة البيانات (الاستيراد الحالي
  // ما يجمّعها بفاتورة واحدة تلقائياً).
  registerExcelImport(router, 'invoices', collectionSchemas.invoices, {
    'اسم المريض': 'patientName', 'Patient Name': 'patientName',
    'الخدمة': 'description', 'Service': 'description',
    'الفئة': 'category', 'Category': 'category',
    'السعر': 'price', 'Price': 'price',
    'الكمية': 'qty', 'Qty': 'qty',
    'طريقة الدفع': 'paymentMethod', 'Payment Method': 'paymentMethod',
    'المرجع': 'referenceCode', 'Reference': 'referenceCode',
    'تاريخ الدفع': 'paidAt', 'Paid At': 'paidAt',
  }, {
    hospitalScoped: true, permission: 'billing',
    indexedColumns: [
      { field: 'patientId', column: 'patient_id' },
      { field: 'status', column: 'status' },
      { field: 'total', column: 'total' },
    ],
    limiter: importLimiter,
    duplicateCheck: ['patientId', 'referenceCode', 'description'],
    afterParse: async (row, hospitalId) => {
      const { patientName, category, price, qty, ...rest } = row;
      const description = rest.description;
      if (patientName) {
        try {
          const conditions = ['name = $1'];
          const values = [patientName];
          if (hospitalId) { values.push(hospitalId); conditions.push(`data->>'hospitalId' = $${values.length}`); }
          const result = await pool.query(`SELECT id FROM patients WHERE ${conditions.join(' AND ')} LIMIT 1`, values);
          if (result.rows.length > 0) rest.patientId = result.rows[0].id;
        } catch { /* فشل البحث — patientId يبقى فارغاً، الصف يُرفَض لاحقاً بخطأ واضح بدل ربط خاطئ */ }
      }
      const p = Number(price) || 0;
      const q = Number(qty) || 1;
      rest.items = [{ id: Date.now() + Math.floor(Math.random() * 1000), description: description || '', category: category || 'other', price: p, qty: q }];
      rest.total = p * q;
      rest.status = 'paid';
      rest.paidAt = rest.paidAt || new Date().toISOString();
      return rest;
    },
    template: [
      { header: 'اسم المريض', example: 'Test Patient CBC 1' },
      { header: 'الخدمة', example: 'كشفية طبيب اختصاص' },
      { header: 'الفئة', example: 'consultation' },
      { header: 'السعر', example: '25000' },
      { header: 'الكمية', example: '1' },
      { header: 'طريقة الدفع', example: 'cash' },
      { header: 'المرجع', example: 'INV-2026-0001' },
      { header: 'تاريخ الدفع', example: '2026-07-01' },
    ],
  });

  pgCrud(router, 'invoices', collectionSchemas.invoices, [
    { field: 'patientId', column: 'patient_id' },
    { field: 'status', column: 'status' },
    { field: 'total', column: 'total' },
  ], undefined, { hospitalScoped: true, permission: 'billing' });
  // كاش Redis: بيانات الموظفين (الطاقم) تُقرأ بصفحات كثيرة (الرواتب،
  // الترفيعات، الإضابير الشخصية...) وتتغيّر نادراً — نفس منطق doctors أعلاه.
  pgCrud(router, 'employees', collectionSchemas.employees, [
    { field: 'name', column: 'name' },
    { field: 'jobTitle', column: 'job_title' },
    { field: 'status', column: 'status' },
  ], undefined, { hospitalScoped: true, permission: 'hr', dateRangeField: 'hireDate', cache: { ttlSeconds: 300 } });
  pgCrud(router, 'retired', collectionSchemas.retired, [
    { field: 'name', column: 'name' },
    { field: 'jobTitle', column: 'job_title' },
  ], undefined, { hospitalScoped: true, permission: 'hr' });

  // باقي الموديولات: تخزين JSONB بحت بدون أعمدة فهرسة إضافية (انظر تعليق
  // المخطط بملف postgres_schema.sql لشرح السبب). اسم الجدول snake_case دائماً
  // حتى لو كان اسم الموديول camelCase بالفرونت إند (مثل medicalLeaves -> medical_leaves).
  // كلها مفعّل عليها الفلترة حسب المنشأة الآن (المرحلة 4 من دعم المنشآت المتعددة).
  pgCrud(router, 'departments', collectionSchemas.departments, [], undefined, { hospitalScoped: true, permission: 'departments', openRead: true });
  pgCrud(router, 'outgoing', collectionSchemas.outgoing, [], undefined, { hospitalScoped: true, permission: 'hr' });
  pgCrud(router, 'incoming', collectionSchemas.incoming, [], undefined, { hospitalScoped: true, permission: 'hr' });
  // ── التطعيمات (vaccinations) ─────────────────────────────────────────────────
  registerExcelImport(router, 'vaccinations', collectionSchemas.vaccinations, {
    'المريض': 'patient', 'اسم المريض': 'patient', 'Patient': 'patient',
    'اللقاح': 'vaccine', 'Vaccine': 'vaccine',
    'الجرعة': 'dose', 'Dose': 'dose',
    'تاريخ التطعيم': 'date', 'Date': 'date',
    'الموعد القادم': 'nextDate', 'Next Date': 'nextDate',
    'الحالة': 'status', 'Status': 'status',
    'المقدم': 'provider', 'Provider': 'provider',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'vaccinations',
    // status عمود حقيقي فعلاً بهذا الجدول (رُقِّي بـ 004_promote_batch2.sql
    // ومسجَّل بتسجيل pgCrud أدناه)، لكن مسار استيراد Excel هذا عمداً ما زال
    // يخزّنه ضمن JSONB فقط هنا (لا تُغيَّر ضمن هذا الإصلاح) — يعني السجلات
    // المستوردة من Excel تبقى بعمود status الحقيقي فارغاً حتى لو أُصلح لاحقاً.
    indexedColumns: [],
    limiter: importLimiter,
    duplicateCheck: ['patient', 'vaccine', 'date'],
    afterParse: (row) => ({ ...row, status: row.status || 'completed' }),
    template: [
      { header: 'المريض', example: 'Test Patient CBC 1' },
      { header: 'اللقاح', example: 'MMR' },
      { header: 'الجرعة', example: 'الجرعة الأولى' },
      { header: 'تاريخ التطعيم', example: '2026-07-01' },
      { header: 'الحالة', example: 'completed' },
    ],
  });

  pgCrud(router, 'vaccinations', collectionSchemas.vaccinations, [{ field: 'status', column: 'status' }], undefined, { hospitalScoped: true, permission: 'vaccinations', extraFilterFields: ['status'] });
  pgCrud(router, 'medicalLeaves', collectionSchemas.medicalLeaves, [{ field: 'status', column: 'status' }], 'medical_leaves', { hospitalScoped: true, permission: 'medical-leave', extraFilterFields: ['status'] });
  pgCrud(router, 'dossiers', collectionSchemas.dossiers, [], undefined, { hospitalScoped: true, permission: 'hr' });
  pgCrud(router, 'labTests', collectionSchemas.labTests, [
    { field: 'status', column: 'status' },
    { field: 'priority', column: 'priority' },
  ], 'lab_tests', {
    hospitalScoped: true, permission: 'laboratory', extraFilterFields: ['status', 'priority', 'category'],
    // Added so LaboratoryPage.js can page through this table server-side
    // (20,000+ rows) instead of fetching everything — these match exactly
    // the fields its own search box and date-range filter already used
    // client-side, just evaluated on the server now.
    searchFields: ['patientName', 'reqNo', 'testType'],
    dateRangeField: 'requestDate',
  });
  pgCrud(router, 'radiology', collectionSchemas.radiology, [
    { field: 'status', column: 'status' },
    { field: 'modality', column: 'modality' },
  ], undefined, { hospitalScoped: true, permission: 'radiology', extraFilterFields: ['status', 'modality'] });
  pgCrud(router, 'pharmacyOrders', collectionSchemas.pharmacyOrders, [{ field: 'status', column: 'status' }], 'pharmacy_orders', { hospitalScoped: true, permission: 'pharmacy', extraFilterFields: ['status'] });
  pgCrud(router, 'assets', collectionSchemas.assets, [], undefined, { hospitalScoped: true, permission: 'assets', searchFields: ['assetNo'], extraFilterFields: ['category', 'status'] });
  // ── إصلاح: سجل صيانة حقيقي بدل الكتابة فوق تاريخ آخر صيانة كل مرة ──────────
  pgCrud(router, 'assetMaintenanceLog', collectionSchemas.assetMaintenanceLog, [
    { field: 'assetId', column: 'asset_id' },
  ], 'asset_maintenance_log', { hospitalScoped: true, permission: 'assets' });
  // كاش Redis: قائمة المخزون (تتضمّن الأدوية — لا يوجد موديول "medicines"
  // منفصل، الأدوية سجلات inventory بـcategory='medicine') تُقرأ باستمرار
  // (الصيدلية، الوصفات، تقارير النفاد...). مدة أقصر (3 دقائق) من doctors/
  // employees لأن الكميات (qty) قد تتغيّر بوتيرة أعلى (صرف/استلام يومي).
  pgCrud(router, 'inventory', collectionSchemas.inventory, [], undefined, { hospitalScoped: true, permission: 'inventory', searchFields: ['code'], extraFilterFields: ['category', 'status'], dateRangeField: 'expiry', cache: { ttlSeconds: 180 } });
  pgCrud(router, 'procurement', collectionSchemas.procurement, [{ field: 'status', column: 'status' }], undefined, { hospitalScoped: true, permission: 'procurement', extraFilterFields: ['status'] });
  pgCrud(router, 'projects', collectionSchemas.projects, [], undefined, { hospitalScoped: true, permission: 'projects', searchFields: ['code', 'manager', 'name'], extraFilterFields: ['status'] });
  pgCrud(router, 'documents', collectionSchemas.documents, [
    { field: 'type', column: 'type' },
    { field: 'status', column: 'status' },
    { field: 'priority', column: 'priority' },
  ], undefined, { hospitalScoped: true, permission: 'documents', extraFilterFields: ['type', 'status', 'priority'] });
  pgCrud(router, 'servicePrices', collectionSchemas.servicePrices, [{ field: 'category', column: 'category' }], 'service_prices', { hospitalScoped: true, permission: 'billing', extraFilterFields: ['category'] });
  pgCrud(router, 'transactions', collectionSchemas.transactions, [{ field: 'status', column: 'status' }], undefined, { hospitalScoped: true, permission: 'accounts' });
  // ── سجل الترفيعات والعلاوات المُوحَّد (دمج promotions/allowances السابقين،
  // راجع migrations-sql/014_merge_promotions_allowances.sql) ─────────────────
  pgCrud(router, 'promotionsAllowances', collectionSchemas.promotionsAllowances, [], 'promotions_allowances', { hospitalScoped: true, permission: 'accounts' });
  pgCrud(router, 'salaries', collectionSchemas.salaries, [], undefined, { hospitalScoped: true, permission: 'accounts' });
  pgCrud(router, 'ambulanceVehicles', collectionSchemas.ambulanceVehicles, [{ field: 'status', column: 'status' }], 'ambulance_vehicles', { hospitalScoped: true, permission: 'ambulance', extraFilterFields: ['status'] });
  // ── إصلاح: سجل صيانة حقيقي بدل الكتابة فوق تاريخ آخر صيانة كل مرة ──────────
  pgCrud(router, 'ambulanceMaintenanceLog', collectionSchemas.ambulanceMaintenanceLog, [
    { field: 'vehicleId', column: 'vehicle_id' },
  ], 'ambulance_maintenance_log', { hospitalScoped: true, permission: 'ambulance' });
  pgCrud(router, 'ambulanceMissions', collectionSchemas.ambulanceMissions, [{ field: 'status', column: 'status' }], 'ambulance_missions', { hospitalScoped: true, permission: 'ambulance', extraFilterFields: ['status'] });

  // CRM المرضى — indexedColumns تختلف عن الاسم الافتراضي (name/phone/status)
  pgCrud(router, 'crmInteractions', collectionSchemas.crmInteractions, [
    { field: 'patientId', column: 'patient_id' },
  ], 'crm_interactions', { hospitalScoped: true, permission: 'crm' });
  pgCrud(router, 'crmSegments', collectionSchemas.crmSegments, [
    { field: 'patientId', column: 'patient_id' },
    { field: 'segmentCode', column: 'segment_code' },
  ], 'crm_patient_segments', { hospitalScoped: true, permission: 'crm' });
  pgCrud(router, 'crmFollowUps', collectionSchemas.crmFollowUps, [
    { field: 'patientId', column: 'patient_id' },
    { field: 'status', column: 'status' },
  ], 'crm_follow_ups', { hospitalScoped: true, permission: 'crm' });
  pgCrud(router, 'crmCampaigns', collectionSchemas.crmCampaigns, [
    { field: 'status', column: 'status' },
  ], 'crm_campaigns', { hospitalScoped: true, permission: 'crm' });
  pgCrud(router, 'crmCampaignTargets', collectionSchemas.crmCampaignTargets, [
    { field: 'campaignId', column: 'campaign_id' },
    { field: 'patientId', column: 'patient_id' },
  ], 'crm_campaign_targets', { hospitalScoped: true, permission: 'crm' });

  // ── إصلاح: إدارة الجودة (ISO) — كانت بدون أي اتصال بقاعدة بيانات ────────────
  // راجع middleware/schemas.js وdatabase/postgres_schema.sql لتفاصيل
  // الإصلاح الكامل. indexedColumns فاضية عمداً (JSONB بحت) — الحقول
  // (auditNo, ncNo, status...) لا تحتاج بحثاً سريعاً بحجم بيانات هذا الموديول
  // الطبيعي (عشرات-مئات السجلات كحد أقصى واقعي بمستشفى واحد).
  pgCrud(router, 'qualityAudits', collectionSchemas.qualityAudits, [], 'quality_audits', { hospitalScoped: true, permission: 'quality' });
  pgCrud(router, 'qualityNCs', collectionSchemas.qualityNCs, [], 'quality_ncs', { hospitalScoped: true, permission: 'quality' });
  pgCrud(router, 'qualityKPIs', collectionSchemas.qualityKPIs, [], 'quality_kpis', { hospitalScoped: true, permission: 'quality' });

  // ── الردهات (إدارة المرضى الداخليين) ──────────────────────────────────────
  pgCrud(router, 'wards', collectionSchemas.wards, [], undefined, { hospitalScoped: true, permission: 'wards' });
  pgCrud(router, 'admissions', collectionSchemas.admissions, [], undefined, { hospitalScoped: true, permission: 'wards' });
  // ── الردهات: جدول الأدوية اليومي (medicationOrders) ─────────────────────────
  // ── ملاحظة: "معرّف حالة الإدخال" (admissionId) مرجع رقمي داخلي (foreign key)
  // لجدول admissions — نفس قيد wardId/vehicleId أعلاه، لا يمكن حله من اسم
  // مريض نصي عبر استيراد جماعي. يبقى فارغاً إن تُرك عمود الاستيراد فارغاً،
  // ويجب ربط الوصفة بحالة الإدخال يدوياً من الواجهة (زر 💊 بجانب المريض)
  // ليظهر الدواء بجدول الأدوية اليومي وتُحسَب مواعيد جرعاته. مواعيد الجرعات
  // (scheduledTimes) تُحتسَب هنا تلقائياً من "عدد المرات باليوم" بنفس خوارزمية
  // computeScheduleTimes المستخدمة بالواجهة (WardsPage.js) — توزيع متساوٍ على
  // 24 ساعة، أول جرعة الساعة 08:00.
  // ── نفس أسلوب حل wardId أعلاه: admissionId (مرجع رقمي لحالة إدخال) يُحَل
  // الآن فعلياً من "اسم المريض" + "تاريخ الإدخال" بالبحث المباشر بجدول
  // admissions — بدل ما يبقى فارغاً ويحتاج ربطاً يدوياً لكل سجل. الشرط: اسم
  // المريض وتاريخ الإدخال يطابقان *بالضبط* سجل إدخال موجود فعلاً (نفس القيم
  // المستوردة بملف admissions_import.xlsx).
  registerExcelImport(router, 'medicationOrders', collectionSchemas.medicationOrders, {
    'اسم المريض': 'patientName', 'Patient Name': 'patientName',
    'تاريخ الإدخال': 'admissionDate', 'Admission Date': 'admissionDate',
    'اسم الدواء': 'drugName', 'Drug Name': 'drugName',
    'الجرعة': 'dose', 'Dose': 'dose',
    'طريقة الإعطاء': 'route', 'Route': 'route',
    'عدد المرات باليوم': 'timesPerDay', 'Times Per Day': 'timesPerDay',
    'الطبيب الكاتب': 'prescribedBy', 'Prescribed By': 'prescribedBy',
    'تاريخ البدء': 'startDate', 'Start Date': 'startDate',
    'تاريخ الانتهاء': 'endDate', 'End Date': 'endDate',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'wards',
    tableName: 'medication_orders',
    // admission_id عمود حقيقي فعلاً بهذا الجدول (رُقِّي بـ 004_promote_batch2.sql
    // ومسجَّل بتسجيل pgCrud أدناه). اسم الحقل بالواجهة/afterParse هو admissionId
    // (camelCase، يُحلّ فعلياً أعلاه بالبحث بجدول admissions) بينما اسم العمود
    // الفعلي snake_case — يُخزَّن الآن بالعمود الحقيقي مباشرة.
    indexedColumns: [{ field: 'admissionId', column: 'admission_id' }],
    limiter: importLimiter,
    duplicateCheck: ['admissionId', 'drugName', 'startDate'],
    afterParse: async (row, hospitalId) => {
      const { patientName, admissionDate, ...rest } = row;
      if (patientName && admissionDate) {
        try {
          const conditions = [`data->>'patientName' = $1`, `data->>'admissionDate' = $2`];
          const values = [patientName, admissionDate];
          if (hospitalId) { values.push(hospitalId); conditions.push(`data->>'hospitalId' = $${values.length}`); }
          const result = await pool.query(`SELECT id FROM admissions WHERE ${conditions.join(' AND ')} LIMIT 1`, values);
          if (result.rows.length > 0) rest.admissionId = result.rows[0].id;
        } catch { /* فشل البحث — يبقى admissionId فارغاً بدل فشل الصف كاملاً */ }
      }
      const n = Math.max(1, Math.min(12, Number(rest.timesPerDay) || 1));
      const intervalMin = Math.floor((24 * 60) / n);
      const times = [];
      let mins = 8 * 60;
      for (let i = 0; i < n; i++) {
        const h = Math.floor((mins % (24 * 60)) / 60);
        const m = (mins % (24 * 60)) % 60;
        times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        mins += intervalMin;
      }
      const hours = Math.round((24 / n) * 10) / 10;
      return {
        ...rest,
        timesPerDay: n,
        scheduledTimes: times,
        frequency: `كل ${hours} ساعة`,
        route: rest.route || 'فموي',
      };
    },
    template: [
      { header: 'اسم المريض', example: 'Test Patient CBC 1' },
      { header: 'تاريخ الإدخال', example: '2026-07-01' },
      { header: 'اسم الدواء', example: 'أوغمنتين 1 غم' },
      { header: 'الجرعة', example: 'حبة واحدة' },
      { header: 'طريقة الإعطاء', example: 'فموي' },
      { header: 'عدد المرات باليوم', example: '2' },
      { header: 'الطبيب الكاتب', example: 'د. أحمد سالم' },
      { header: 'تاريخ البدء', example: '2026-07-01' },
    ],
  });

  pgCrud(router, 'medicationOrders', collectionSchemas.medicationOrders, [{ field: 'admissionId', column: 'admission_id' }], 'medication_orders', { hospitalScoped: true, permission: 'wards', extraFilterFields: ['admissionId'] });
  pgCrud(router, 'medicationAdministrations', collectionSchemas.medicationAdministrations, [], 'medication_administrations', { hospitalScoped: true, permission: 'wards', extraFilterFields: ['orderId'] });

  // ── صالة الولادة ──────────────────────────────────────────────────────────
  pgCrud(router, 'deliveries', collectionSchemas.deliveries, [
    { field: 'stage', column: 'stage' },
    { field: 'babyStatus', column: 'baby_status' },
  ], undefined, { hospitalScoped: true, permission: 'delivery', extraFilterFields: ['stage', 'babyStatus'] });

  // ── العلاج الطبيعي ────────────────────────────────────────────────────────
  pgCrud(router, 'ptEquipment', collectionSchemas.ptEquipment, [{ field: 'status', column: 'status' }], 'pt_equipment', { hospitalScoped: true, permission: 'physiotherapy', extraFilterFields: ['status'] });
  pgCrud(router, 'ptSessions', collectionSchemas.ptSessions, [
    { field: 'status', column: 'status' },
    { field: 'date', column: 'date' },
  ], 'pt_sessions', { hospitalScoped: true, permission: 'physiotherapy', extraFilterFields: ['status', 'date'] });

  // ── إدارة الطابور ─────────────────────────────────────────────────────────
  // ── إدارة الطابور (queueTickets) ─────────────────────────────────────────────
  // ── ملاحظة: رقم التذكرة (ticketNo) بالاستخدام الطبيعي تسلسلي يومي لكل قسم
  // (يُحسَب بالواجهة عند إصدار تذكرة جديدة). لا نملك نفس السياق هنا (كم تذكرة
  // صدرت فعلاً اليوم لهذا القسم)، فنقبله اختيارياً من عمود Excel، وإن تُرك
  // فارغاً نولّد رقماً تقريبياً غير مضمون التسلسل — هذا الموديول بطبيعته يومي/
  // مؤقت، فالاستيراد الجماعي مناسب لبيانات اختبار أو تذاكر تاريخية وليس
  // للاستخدام التشغيلي اليومي المعتاد.
  registerExcelImport(router, 'queueTickets', collectionSchemas.queueTickets, {
    'اسم المريض': 'patientName', 'Patient Name': 'patientName',
    'القسم': 'department', 'Department': 'department',
    'الأولوية': 'priority', 'Priority': 'priority',
    'رقم التذكرة': 'ticketNo', 'Ticket No': 'ticketNo',
    'الحالة': 'status', 'Status': 'status',
    'وقت الإصدار': 'createdAt', 'Created At': 'createdAt',
    'من نادى': 'calledBy', 'Called By': 'calledBy',
    'ملاحظات': 'notes', 'Notes': 'notes',
  }, {
    hospitalScoped: true, permission: 'queue',
    tableName: 'queue_tickets',
    // department/status أعمدة حقيقية فعلاً بهذا الجدول (رُقِّيت بـ
    // 004_promote_batch2.sql ومسجَّلة بتسجيل pgCrud أدناه) — تُخزَّن الآن
    // بالأعمدة الحقيقية مباشرة. ملاحظة: مسار /queue-display العام بـ
    // server.js يقرأ هذين العمودين الحقيقيين مباشرة أصلاً (وليس JSONB)،
    // فكان يعرض قيماً قديمة لأي تذكرة تُحدَّث (تُنادى/تُخدَم) بعد إنشائها —
    // هذا الإصلاح يجعل تحديثات الحالة تصل فعلياً لذلك العمود من الآن فصاعداً.
    indexedColumns: [
      { field: 'department', column: 'department' },
      { field: 'status', column: 'status' },
    ],
    limiter: importLimiter,
    duplicateCheck: ['patientName', 'department', 'createdAt'],
    // ── إصلاح: كانت calledAt/servedAt تُصفَّر دائماً بغض النظر عن الحالة —
    // تذكرة مستورَدة بحالة "served" كانت تُحفَظ بدون وقت استلام فعلي، وهو
    // تناقض منطقي (خدمة "منجَزة" بدون وقت إنجاز). الآن تُحتسَب زمنياً بعد
    // وقت الإصدار بفارق معقول حسب الحالة.
    afterParse: (row) => {
      const created = row.createdAt ? new Date(row.createdAt) : new Date();
      const status = row.status || 'waiting';
      let calledAt = null, servedAt = null;
      if (status === 'called' || status === 'served' || status === 'noshow') {
        calledAt = new Date(created.getTime() + 5 * 60000).toISOString();
      }
      if (status === 'served') {
        servedAt = new Date(created.getTime() + 15 * 60000).toISOString();
      }
      return {
        ...row,
        priority: row.priority || 'normal',
        status,
        ticketNo: row.ticketNo ? Number(row.ticketNo) : Math.floor(Math.random() * 9000) + 1000,
        createdAt: created.toISOString(),
        calledAt, servedAt,
        calledBy: row.calledBy || null,
      };
    },
    template: [
      { header: 'اسم المريض', example: 'Test Patient CBC 1' },
      { header: 'القسم', example: 'المختبر' },
      { header: 'الأولوية', example: 'normal' },
    ],
  });

  pgCrud(router, 'queueTickets', collectionSchemas.queueTickets, [
    { field: 'department', column: 'department' },
    { field: 'status', column: 'status' },
  ], 'queue_tickets', { hospitalScoped: true, permission: 'queue', extraFilterFields: ['department', 'status'] });

};

module.exports = registerAllModules;
