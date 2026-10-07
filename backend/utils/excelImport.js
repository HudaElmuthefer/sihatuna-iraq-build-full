// backend/utils/excelImport.js
//
// أداة تحليل ملفات Excel (.xlsx/.xls) المرفوعة لاستيراد بيانات جماعية
// (مرضى، أطباء...) — تحوّل الملف إلى صفوف بيانات مطابَقة على أسماء الحقول
// الداخلية للنظام، بغض النظر عن اللغة أو حالة الأحرف بعناوين الأعمدة.
const XLSX = require('xlsx');

// يحوّل القيم العربية الشائعة (الجنس، الحالة) لصيغتها الإنجليزية المخزَّنة
// فعلياً بقاعدة البيانات — يقبل أيضاً القيم الإنجليزية مباشرة لمن يفضّلها.
const GENDER_MAP = { 'ذكر': 'male', 'أنثى': 'female', 'انثى': 'female', 'male': 'male', 'female': 'female' };
const STATUS_MAP = { 'نشط': 'active', 'غير نشط': 'inactive', 'active': 'active', 'inactive': 'inactive' };

function normalizeValue(field, rawValue) {
  if (rawValue === undefined || rawValue === null) return '';
  const value = String(rawValue).trim();
  if (field === 'gender') return GENDER_MAP[value.toLowerCase()] || value;
  if (field === 'status') return STATUS_MAP[value.toLowerCase()] || value;
  return value;
}

// columnMap: { 'عنوان العمود بالملف': 'اسم_الحقل_الداخلي', ... } — يمكن تكرار
// نفس الحقل الداخلي بعدة عناوين محتملة (عربي/إنجليزي) بنفس القاموس.
// يُرجع: { rows: [{ rowNumber, data }], error } — rowNumber يطابق رقم الصف
// الفعلي بملف Excel (بعد احتساب صف العناوين) لتسهيل الإبلاغ عن أخطاء دقيقة.
function parseExcelBuffer(buffer, columnMap) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return { rows: [], error: 'تعذّر قراءة الملف — تأكد أنه ملف Excel صالح (.xlsx أو .xls)' };
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { rows: [], error: 'الملف لا يحتوي أي ورقة عمل (sheet)' };

  const sheet = workbook.Sheets[firstSheetName];
  // defval: '' يضمن رجوع خلية فاضية كنص فاضي بدل حذف الحقل من الكائن تماماً
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (rawRows.length === 0) return { rows: [], error: 'الملف فارغ — لا توجد أي صفوف بيانات تحت صف العناوين' };

  // حد أقصى معقول لعدد الصفوف بالاستيراد الواحد — حماية من ملف ضخم بالخطأ
  // (أو متعمَّد) يجمّد الخادم أثناء المعالجة
  if (rawRows.length > 5000) {
    return { rows: [], error: `الملف يحتوي ${rawRows.length} صف — الحد الأقصى المسموح 5000 صف بالمرة الواحدة` };
  }

  // مطابقة عناوين الأعمدة الفعلية (بغض النظر عن حالة الأحرف والمسافات الزائدة)
  const normalizedColumnMap = {};
  Object.entries(columnMap).forEach(([header, field]) => {
    normalizedColumnMap[header.trim().toLowerCase()] = field;
  });

  const rows = rawRows.map((rawRow, index) => {
    const mapped = {};
    Object.entries(rawRow).forEach(([header, value]) => {
      const field = normalizedColumnMap[String(header).trim().toLowerCase()];
      if (field) mapped[field] = normalizeValue(field, value);
    });
    return { rowNumber: index + 2, data: mapped }; // +2: صف العناوين رقم 1، والبيانات تبدأ من الصف 2 فعلياً
  });

  return { rows, error: null };
}

module.exports = { parseExcelBuffer };
