// backend/middleware/validate.js
//
// تحقق خفيف من صحة المدخلات بجانب الخادم (Server-side Validation)، بدون أي
// مكتبة خارجية إضافية. قبل هذا الملف، كان التحقق من البيانات (مثل "الاسم
// مطلوب") موجوداً فقط داخل واجهة الفرونت إند — أي استدعاء مباشر لواجهة
// الـ API (عبر Postman مثلاً، أو كود خبيث) كان بإمكانه إرسال بيانات فارغة أو
// من نوع خاطئ فتُقبل مباشرة وتُكتب في قاعدة البيانات.
//
// صيغة المخطط (schema) البسيطة:
//   { fieldName: { required: true, type: 'string', minLength: 2, maxLength: 200, pattern: /^\S+@\S+\.\S+$/ } }
//
// أنواع مدعومة بـ type: 'string' | 'number' | 'array'
//
// الاستخدام:
//   router.post('/patients', auth, validate(schemas.patients), (req, res) => {...})
//
// تمرير schema بقيمة undefined (أي موديول بدون مخطط معرَّف بعد) يجعل الدالة
// تتجاوز التحقق بالكامل وتستدعي next() مباشرة — بهذا يمكن إضافة مخططات
// تدريجياً لأهم الموديولات دون كسر الموديولات الأخرى التي لم تُغطَّ بعد.
//
// ── إصلاح: حد أقصى افتراضي لطول أي حقل نصي ────────────────────────────────────
// قبل هذا التعديل لم يكن هناك أي حد أقصى لطول النصوص — حقل مثل "الاسم" كان
// يقبل نظرياً ملايين الأحرف بطلب واحد (لحد الحد العام 50 ميجا لكل الطلب،
// المضبوط بـ express.json). هذا يفتح باب إساءة استخدام (تخزين بيانات ضخمة
// غير منطقية بحقل صغير، أو محاولة إبطاء قاعدة البيانات). الحد الافتراضي هنا
// 5000 حرف لأي حقل نصي ليس له maxLength مخصَّص في المخطط — كافٍ جداً لأطول
// حقل نصي منطقي بالنظام (ملاحظات، عناوين...)، ويمكن لأي حقل أن يحدد رقماً
// أصغر أو أكبر صراحة في مخططه الخاص إذا احتاج إلى ذلك.
const DEFAULT_MAX_LENGTH = 5000;

// ── دالة تحقق خام قابلة لإعادة الاستخدام ─────────────────────────────────────
// نفس منطق التحقق أعلاه بالضبط، لكن كدالة مستقلة تعمل على أي كائن (object)
// مباشرة بدل الاعتماد على req/res — هذا يسمح باستخدام نفس قواعد التحقق
// بسياقات غير HTTP، مثل التحقق من كل صف عند استيراد بيانات من ملف Excel
// (انظر routes/excelImport.js)، بدل تكرار نفس المنطق بمكانين مختلفين.
const validateFields = (schema, obj) => {
  if (!schema) return [];
  const errors = [];
  for (const [field, rules] of Object.entries(schema)) {
    const value = obj ? obj[field] : undefined;
    const isEmpty = value === undefined || value === null || value === '';

    if (rules.required && isEmpty) {
      errors.push(`الحقل "${field}" مطلوب`);
      continue;
    }
    if (isEmpty) continue;

    if (rules.type === 'string' && typeof value !== 'string') {
      errors.push(`الحقل "${field}" يجب أن يكون نصاً`);
    } else if (rules.type === 'number' && typeof value !== 'number') {
      errors.push(`الحقل "${field}" يجب أن يكون رقماً`);
    } else if (rules.type === 'array' && !Array.isArray(value)) {
      errors.push(`الحقل "${field}" يجب أن يكون قائمة`);
    } else if (rules.minLength && typeof value === 'string' && value.trim().length < rules.minLength) {
      errors.push(`الحقل "${field}" يجب ألا يقل عن ${rules.minLength} حرفاً`);
    } else if (typeof value === 'string') {
      const maxLen = rules.maxLength || DEFAULT_MAX_LENGTH;
      if (value.length > maxLen) {
        errors.push(`الحقل "${field}" يجب ألا يزيد عن ${maxLen} حرفاً`);
      } else if (rules.pattern && !rules.pattern.test(value)) {
        errors.push(`الحقل "${field}" بصيغة غير صحيحة`);
      }
    }
  }
  return errors;
};

const validate = (schema) => (req, res, next) => {
  const errors = validateFields(schema, req.body);
  if (errors.length > 0) {
    return res.status(400).json({ message: 'بيانات غير صالحة', errors });
  }
  next();
};

module.exports = validate;
module.exports.validateFields = validateFields;
