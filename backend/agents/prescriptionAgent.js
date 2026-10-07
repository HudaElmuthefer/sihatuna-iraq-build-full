// backend/agents/prescriptionAgent.js
//
// قراءة وصفة طبية بالذكاء الاصطناعي — سير عمل متعدد الوكلاء (multi-agent)
// داخل نفس عملية Node، بدون أي استدعاء HTTP بين الوكلاء (راجع قرار
// المعمارية بمحادثة التخطيط): استدعاءات دوال JavaScript عادية مباشرة.
//
//   1) agents/ocrAgent.js       — PaddleOCR يستخرج نصاً أولياً من صورة الوصفة
//   2) هذا الملف (AI)           — يهيكل النص/الصورة إلى قائمة أدوية منظَّمة
//   3) agents/interactionAgent.js — يفحص التضارب الدوائي بين الأدوية المُستخرَجة
//   4) agents/allergyAgent.js     — يفحص تضارب الحساسية الدوائية، فقط لو
//      مريض مربوط صراحةً بهذه الوصفة (patientAllergies أدناه) — راجع شرح
//      كامل بـPharmacyPage.js لسبب اشتراط ربط صريح (لا مطابقة تلقائية
//      بالاسم المُستخرَج من الصورة، تجنّباً لخطر ربط حساسيات مريض خاطئ بصمت).
//
// نفس نهج invoiceReadProcessor.js تماماً بالخطوتين 1-2 (OCR كسياق مساعد
// فقط، الصورة نفسها تبقى المصدر الأساسي المُرسَل لـGemini) — راجع شرح
// كامل هناك لسبب هذا القرار (جودة OCR بالعربية أضعف من رؤية Gemini
// المباشرة). الإضافة الحقيقية هنا هي الخطوتان 3-4.
const { routeImageCall } = require('../utils/aiProviderRouter');
const { extractText } = require('./ocrAgent');
const { checkInteractions } = require('./interactionAgent');
const { checkAllergies } = require('./allergyAgent');
const { devLog } = require('../utils/logger');

const SYSTEM_PROMPT_AR = 'أنت نظام استخراج بيانات وصفات طبية دقيق لنظام مستشفى إلكتروني. اقرأ صورة الوصفة الطبية المرفقة (ومعها نص استخراج ضوئي (OCR) أولي كمرجع مساعد فقط — قد يحتوي أخطاء، والصورة نفسها هي المصدر الأدق)، واستخرج البيانات بدقة. لو حقل غير واضح أو غير موجود، اتركه فارغاً (null) — لا تخمّن قيمة، وخصوصاً أسماء الأدوية (خطأ باسم الدواء قد يُخفي تضارباً دوائياً حقيقياً). أجب فقط بصيغة JSON صالحة مطابقة تماماً للمخطط المطلوب، بدون Markdown وبدون أي نص إضافي خارج الـ JSON.';

const RESULT_SCHEMA_AR = `{
  "patientName": "اسم المريض",
  "doctorName": "اسم الطبيب",
  "date": "YYYY-MM-DD",
  "medicines": [
    { "name": "اسم الدواء", "dosage": "تعليمات الجرعة (مثال: قرص واحد 3 مرات يومياً)", "quantity": 0, "unit": "قرص/كبسولة/..." }
  ],
  "confidence": "high|medium|low"
}`;

function buildUserPrompt(ocrText) {
  const ocrSection = ocrText
    ? `نص استخراج ضوئي (OCR) أولي للوصفة (مرجع مساعد فقط، قد يحتوي أخطاء — اعتمد على الصورة نفسها للدقة):\n"""\n${ocrText}\n"""\n\n`
    : '';
  return `${ocrSection}اقرأ صورة الوصفة الطبية المرفقة واستخرج:\n${RESULT_SCHEMA_AR}`;
}

// readPrescription: يُستدعى مباشرة من services/queue/prescriptionReadProcessor.js
// (المهمة الخلفية BullMQ) — وأيضاً مصمَّم للاستدعاء المباشر لاحقاً من أي
// مسار آخر يحتاج نفس السير الكامل (OCR → AI → فحص تضارب) بلا وسيط.
async function readPrescription(imageBase64, mimeType, lang, mode, patientAllergies) {
  const ocrResult = await extractText(imageBase64);
  if (!ocrResult.available) {
    devLog(`ℹ️  [prescription-agent] PaddleOCR غير متاح (${ocrResult.error}) — نكمل بالصورة وحدها`);
  }

  const userPrompt = buildUserPrompt(ocrResult.available ? ocrResult.text : null);
  // routeImageCall تقرأ اختيار المستخدم المحفوظ (bot/online/offline) وتوزّع
  // الاستدعاء تبعاً له — راجع utils/aiProviderRouter.js. فحص التضارب
  // بالخطوة التالية (checkInteractions) يقرأ اختياره الخاص هو (drugInteractions)
  // بشكل مستقل تماماً — قد يختلف عن اختيار استخراج الوصفة نفسها.
  const aiResult = await routeImageCall('prescriptionReader', SYSTEM_PROMPT_AR, userPrompt, imageBase64, mimeType, mode);

  if (!aiResult.available) {
    return { available: false, error: aiResult.error, provider: aiResult.provider };
  }

  const medicines = aiResult.parsed?.medicines || [];

  // فحص التضارب الدوائي بين الأدوية المُستخرَجة — يحتاج دواءين على الأقل
  // ليكون لهما معنى (نفس شرط drugInteractionRoutes.js). وصفة بدواء واحد أو
  // بلا أدوية إطلاقاً (قراءة فاشلة/غير واضحة) تُرجَع بلا فحص تضارب، لا خطأ.
  let interactionResult = null;
  const medicineNames = medicines.map((m) => m.name).filter(Boolean);
  if (medicineNames.length >= 2) {
    interactionResult = await checkInteractions(medicineNames, lang);
  }

  const interactions = interactionResult?.available ? interactionResult.interactions : [];

  // فحص الحساسية الدوائية — فقط لو الطالب مرَّر قائمة حساسيات مريض مربوط
  // صراحةً (راجع التعليق أعلى الاستيرادات). قائمة فارغة تعني "مريض بلا
  // حساسيات مسجَّلة" (نتيجة صحيحة بذاتها)، بينما undefined/null تعني "لا
  // مريض مربوط إطلاقاً" — لا نفحص شيئاً بهذه الحالة (لا available:false ولا
  // ادّعاء أي نتيجة، الحقل ببساطة null بالرد).
  let allergyResult = null;
  const medicineNamesForAllergy = medicines.map((m) => m.name).filter(Boolean);
  const allergyChecked = Array.isArray(patientAllergies) && medicineNamesForAllergy.length > 0;
  if (allergyChecked) {
    allergyResult = await checkAllergies(patientAllergies, medicineNamesForAllergy, lang, mode);
  }
  const allergyConflicts = allergyResult?.available ? (allergyResult.conflicts || []) : [];

  return {
    available: true,
    provider: aiResult.provider,
    ocrUsed: ocrResult.available,
    patientName: aiResult.parsed?.patientName ?? null,
    doctorName: aiResult.parsed?.doctorName ?? null,
    date: aiResult.parsed?.date ?? null,
    confidence: aiResult.parsed?.confidence ?? null,
    medicines,
    interactions,
    interactionSource: interactionResult?.source ?? null,
    interactionIncomplete: Boolean(interactionResult?.incomplete),
    hasInteractions: interactions.length > 0,
    // أعلى شدة تضارب مكتشَفة — يستخدمها الفرونت إند لتلوين التحذير مباشرة
    // بدل إعادة حساب هذا المنطق بجافاسكربت الواجهة.
    highestSeverity: interactions.reduce((max, i) => {
      const rank = { low: 1, medium: 2, high: 3 };
      return (rank[i.severity] || 0) > (rank[max] || 0) ? i.severity : max;
    }, null),
    allergyChecked,
    allergyAvailable: allergyChecked ? Boolean(allergyResult?.available) : null,
    allergyConflicts,
    allergySource: allergyResult?.source ?? null,
    allergyIncomplete: Boolean(allergyResult?.incomplete),
    allergyNoneOnFile: Boolean(allergyResult?.noAllergiesOnFile),
    hasAllergyConflicts: allergyConflicts.length > 0,
  };
}

module.exports = { readPrescription, buildUserPrompt };
