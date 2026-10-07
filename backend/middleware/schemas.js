// backend/middleware/schemas.js
//
// مخططات التحقق (validation schemas). المرحلة الأولى غطّت الموديولات الأكثر
// حساسية سريرياً ومالياً (المرضى، الأطباء، المواعيد، الفواتير، الموظفين،
// المتقاعدين)، والمرحلة الثانية أدناه وسّعت التغطية لـ20 موديولاً إضافياً.
// أي موديول غير موجود هنا يبقى بدون تحقق حالياً (سلوكه الحالي بدون تغيير)
// إلى أن يُضاف له مخطط لاحقاً — أضف المخطط هنا فقط دون لمس server.js.
module.exports = {
  patients: {
    name: { required: true, type: 'string', minLength: 2 },
    phone: { required: true, type: 'string' },
  },
  doctors: {
    name: { required: true, type: 'string', minLength: 2 },
    phone: { required: true, type: 'string' },
  },
  appointments: {
    // ملاحظة: الصفحة الفعلية (AppointmentsPage.js) تخزّن اسم المريض والطبيب
    // كنص مباشر بالحقلين "patient" و"doctor"، وليس كمعرّف رقمي (patientId/doctorId)
    // كما افترضتُ بالخطأ بالنسخة الأولى من هذا المخطط — وهذا ما كان يرفض كل
    // حفظ موعد سابقاً. جرى تصحيحه ليطابق البنية الفعلية للبيانات بالضبط.
    patient: { required: true, type: 'string' },
    doctor: { required: true, type: 'string' },
    date: { required: true, type: 'string' },
  },
  invoices: {
    patientId: { required: true },
    items: { required: true, type: 'array' },
  },
  employees: {
    name: { required: true, type: 'string', minLength: 2 },
    jobTitle: { required: true, type: 'string' },
  },
  retired: {
    name: { required: true, type: 'string', minLength: 2 },
  },

  // ── توسيع التغطية (المرحلة الثانية) ──────────────────────────────────────────
  // كل حقل هنا مطابق تماماً لما تتحقق منه الصفحة نفسها بالفرونت إند (فُحصت
  // كل صفحة على حدة قبل الإضافة، لتفادي تكرار خطأ افتراض حقول غير موجودة
  // كما حصل سابقاً بمخطط المواعيد).
  departments: {
    name: { required: true, type: 'string', minLength: 2 },
  },
  labTests: {
    patientName: { required: true, type: 'string' },
    testType: { required: true, type: 'string' },
  },
  radiology: {
    patientName: { required: true, type: 'string' },
    modality: { required: true, type: 'string' },
  },
  pharmacyOrders: {
    patientName: { required: true, type: 'string' },
  },
  assets: {
    assetNo: { required: true, type: 'string' },
    name: { required: true, type: 'string' },
  },
  inventory: {
    code: { required: true, type: 'string' },
    name: { required: true, type: 'string' },
  },
  procurement: {
    supplier: { required: true, type: 'string' },
    title: { required: true, type: 'string' },
  },
  projects: {
    manager: { required: true, type: 'string' },
    name: { required: true, type: 'string' },
  },
  documents: {
    title: { required: true, type: 'string' },
  },
  vaccinations: {
    patient: { required: true, type: 'string' },
    vaccine: { required: true, type: 'string' },
    date: { required: true, type: 'string' },
  },
  medicalLeaves: {
    employee: { required: true, type: 'string' },
    from: { required: true, type: 'string' },
    to: { required: true, type: 'string' },
  },
  transactions: {
    desc: { required: true, type: 'string' },
    amount: { required: true },
  },
  // ── سجل الترفيعات والعلاوات المُوحَّد (دمج promotions/allowances السابقين) —
  // كل سجل قد يمثّل ترفيعاً و/أو علاوة لموظف واحد، لذا لا يُفرَض هنا سوى
  // الاسم؛ صحة حقول كل جانب (grade/amount/...) تُفحَص بالواجهة حسب الجانب
  // المُعبَّأ فعلياً بكل سجل.
  promotionsAllowances: {
    name: { required: true, type: 'string' },
  },
  salaries: {
    name: { required: true, type: 'string' },
  },
  ambulanceVehicles: {
    code: { required: true, type: 'string' },
    plate: { required: true, type: 'string' },
  },
  ambulanceMissions: {
    address: { required: true, type: 'string' },
  },
  outgoing: {
    title: { required: true, type: 'string' },
    to: { required: true, type: 'string' },
  },
  incoming: {
    title: { required: true, type: 'string' },
    from: { required: true, type: 'string' },
  },
  crmFollowUps: {
    patientId: { required: true },
    title: { required: true, type: 'string' },
    dueDate: { required: true, type: 'string' },
  },
  crmCampaigns: {
    nameAr: { required: true, type: 'string' },
  },

  // ── المرحلة الثالثة (تغطية كاملة): آخر 4 موديولات كانت بدون تحقق ──────────────
  dossiers: {
    // مطابق تماماً لتحقق docForm.title بصفحة المتقاعدين (HRPage.js).
    // retiredId ضروري لربط الوثيقة بالمتقاعد الصحيح بالخادم.
    title: { required: true, type: 'string' },
    retiredId: { required: true },
  },
  crmInteractions: {
    // ملاحظة: لا توجد واجهة إضافة مباشرة لهذا الموديول بعد (الدالة addCrmInteraction
    // بملف AppContext.js جاهزة لكن غير مستدعاة من أي صفحة حالياً) — القاعدة هنا
    // دفاعية، تطابق عمود الفهرسة الوحيد (patient_id) المعتمد بالجدول.
    patientId: { required: true },
  },
  crmSegments: {
    // نفس الملاحظة أعلاه (assignCrmSegment غير مستدعاة من واجهة حالياً) —
    // الحقلان هنا يطابقان عمودي الفهرسة الفعليين بالجدول (patient_id, segment_code).
    patientId: { required: true },
    segmentCode: { required: true, type: 'string' },
  },
  crmCampaignTargets: {
    // تُنشأ تلقائياً عبر buildCrmCampaignTargets() وليس بإدخال يدوي مباشر —
    // القاعدة هنا حماية دفاعية تطابق عمودي الفهرسة الفعليين بالجدول.
    campaignId: { required: true },
    patientId: { required: true },
  },
  servicePrices: {
    // ملاحظة: لا توجد واجهة إضافة مباشرة حالياً (addServicePrice بملف
    // AppContext.js جاهزة لكن غير مستدعاة من أي صفحة) — الحقول تطابق ما
    // تعرضه شاشة الفوترة فعلياً (nameAr, category, price).
    nameAr: { required: true, type: 'string' },
    category: { required: true, type: 'string' },
    price: { required: true },
  },
  // ── إصلاح: صفحة إدارة الجودة (ISO) كانت بدون أي اتصال بقاعدة بيانات ──────────
  // كانت البيانات (مراجعات، عدم مطابقة، مؤشرات أداء) تُفقَد بمجرد تحديث
  // الصفحة. الثلاثة مخططات تحت تدعم التخزين الحقيقي — راجع
  // routes/modules.js وdatabase/postgres_schema.sql.
  qualityAudits: {
    title: { required: true, type: 'string' },
  },
  qualityNCs: {
    title: { required: true, type: 'string' },
  },
  qualityKPIs: {
    name: { required: true, type: 'string' },
  },
  // ── إصلاح: حقل "الصيانة" كان مجرد حالة + تاريخ يُكتَب فوقه بدون أي سجل تاريخي ──
  // كل مرة تُنهى صيانة، يُفقَد سجل الصيانة السابقة نهائياً (يُستبدَل فقط بتاريخ
  // جديد). الآن كل حدث صيانة يُسجَّل بشكل مستقل بسجل دائم — راجع
  // routes/modules.js وdatabase/postgres_schema.sql.
  ambulanceMaintenanceLog: {
    vehicleId: { required: true },
    date: { required: true, type: 'string' },
    description: { required: true, type: 'string' },
  },
  assetMaintenanceLog: {
    assetId: { required: true },
    date: { required: true, type: 'string' },
    description: { required: true, type: 'string' },
  },
  // ── الردهات (إدارة المرضى الداخليين) ────────────────────────────────────
  wards: {
    name: { required: true, type: 'string' },
  },
  admissions: {
    patientName: { required: true, type: 'string' },
    wardId: { required: true },
  },
  medicationOrders: {
    admissionId: { required: true },
    drugName: { required: true, type: 'string' },
  },
  medicationAdministrations: {
    orderId: { required: true },
    administeredBy: { required: true, type: 'string' },
  },
  // ── صالة الولادة ────────────────────────────────────────────────────────
  // إصلاح: deliveryDate كان required دائماً، فكان يرفض حفظ سجل "الأم قبل
  // الولادة" (مرحلة admitted) لأنه منطقياً لا يوجد تاريخ ولادة بعد — يُملأ لاحقاً
  // لحظة "إتمام الولادة". الفرونت إند نفسه (DeliveryRoomPage.js) يتحقق من
  // وجود deliveryDate تحديداً بمرحلة إتمام/تسجيل الولادة الكاملة، فلا حاجة
  // لفرضه هنا على كل السجلات بغض النظر عن مرحلتها.
  deliveries: {
    motherName: { required: true, type: 'string' },
  },
  // ── العلاج الطبيعي ──────────────────────────────────────────────────────
  ptEquipment: {
    name: { required: true, type: 'string' },
  },
  ptSessions: {
    patientName: { required: true, type: 'string' },
    date: { required: true, type: 'string' },
  },
  // ── إدارة الطابور ───────────────────────────────────────────────────────
  queueTickets: {
    patientName: { required: true, type: 'string' },
    department: { required: true, type: 'string' },
  },
};
