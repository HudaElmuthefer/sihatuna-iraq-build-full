// backend/agents/allergyAgent.js
//
// فحص تضارب الحساسية الدوائية — نفس معمارية agents/interactionAgent.js
// وagents/dosageAgent.js بالضبط: قاعدة بيانات (bot/rules) أولاً عبر جدول
// drug_allergy_classes (راجع migrations-sql/011_drug_allergy_classes.sql)،
// ذكاء اصطناعي احتياطياً فقط للأدوية غير المغطاة بالجدول.
//
// ── الفرق الجوهري عن فحص التضارب الدوائي العادي: تحسّس تصالبي بين العائلات ──
// حساسية دوائية حقيقية لا تعني فقط "نفس اسم الدواء بالضبط" — مريض عنده
// حساسية من "البنسلين" يجب أن يُحذَّر أيضاً لو وُصف له "أموكسيسيلين" (دواء
// آخر بنفس العائلة الدوائية)، لا فقط لو تطابق الاسمان حرفياً. راجع
// findClassMatch() أدناه.
//
// ── نفس مبدأ dosageAgent.js: "لا بيانات" لا يعني أبداً "آمن" ─────────────────
// لو الجدول ما لقى تطابقاً ولا AI متاح، النتيجة يجب أن ترجع available:false
// بصراحة — أبداً لا نفترض "لا تضارب" لمجرد غياب دليل على العكس. راجع أيضاً
// AllergyCheckPage.js بالفرونت إند: تصميم الشارات هناك يفرّق بصرياً بوضوح
// بين "لا تضارب" (أخضر) و"لا بيانات كافية" (رمادي محايد) — لا يجمعهما أبداً.
const { query } = require('../config/database');
const { routeTextCall } = require('../utils/aiProviderRouter');

// أسماء عرض ثنائية اللغة لعائلات الحساسية — الجدول نفسه يخزّن مفتاحاً
// إنجليزياً ثابتاً واحداً لكل عائلة (allergy_class)، هذا فقط لعرضه بلغة طلب
// المستخدم الحالية بدل الاسم التقني الخام.
const CLASS_LABELS = {
  Penicillin:      { ar: 'البنسلين',                                   en: 'Penicillin' },
  Cephalosporin:   { ar: 'السيفالوسبورين',                             en: 'Cephalosporins' },
  Sulfonamide:      { ar: 'السلفوناميد',                                en: 'Sulfonamides' },
  NSAID:            { ar: 'مضادات الالتهاب غير الستيرويدية (NSAID)',    en: 'NSAIDs' },
  Macrolide:        { ar: 'الماكروليد',                                 en: 'Macrolides' },
  Fluoroquinolone:  { ar: 'الفلوروكينولون',                             en: 'Fluoroquinolones' },
};

function classLabel(allergyClass, lang) {
  const entry = CLASS_LABELS[allergyClass];
  if (!entry) return allergyClass;
  return lang === 'en' ? entry.en : entry.ar;
}

function explainMatch(match, lang) {
  const isEn = lang === 'en';
  if (match.via === 'direct') {
    return isEn
      ? 'Matches the exact substance recorded as a patient allergy'
      : 'نفس المادة المسجَّلة كحساسية لدى المريض تماماً';
  }
  const label = classLabel(match.allergyClass, lang);
  return isEn
    ? `Belongs to the same drug class (${label}) as a recorded patient allergy`
    : `ينتمي لنفس العائلة الدوائية (${label}) لحساسية مسجَّلة لدى المريض`;
}

const GENERIC_RECOMMENDATION = {
  ar: 'تجنّب استخدام هذا الدواء واستشر الطبيب أو الصيدلاني لاختيار بديل آمن.',
  en: 'Avoid this drug and consult a physician or pharmacist for a safe alternative.',
};

function buildAIPrompts(lang, allergyNames, drugNames) {
  const isEn = lang === 'en';
  const systemPrompt = isEn
    ? 'You are a clinical pharmacist assisting with a preliminary drug-allergy cross-reactivity check for a hospital ERP system. Only report conflicts you are reasonably confident about (known direct matches or well-established drug-class cross-reactivity) — do not invent conflicts. Always include a disclaimer that this does not replace a pharmacist or physician review. Respond ONLY with valid JSON matching the exact schema requested — no markdown, no extra text.'
    : 'أنت صيدلاني سريري تساعد بفحص أولي لتضارب الحساسية الدوائية ضمن نظام مستشفى إلكتروني. اذكر فقط التضاربات اللي متأكد منها بشكل معقول (تطابق مباشر معروف، أو تحسّس تصالبي موثّق بين عائلات دوائية) — لا تختلق تضاربات غير موثوقة. اذكر دائماً إن هذا لا يغني عن مراجعة صيدلاني أو طبيب. أجب فقط بصيغة JSON صالحة مطابقة تماماً للمخطط المطلوب — بدون Markdown وبدون أي نص إضافي خارج الـ JSON.';

  const userPrompt = isEn
    ? `Patient has these known allergies: ${allergyNames.join(', ')}.\nCheck whether any of these prescribed drugs have a known direct match or cross-reactivity risk with any of the patient's allergies: ${drugNames.join(', ')}.\n\nRespond with JSON only: {"conflicts":[{"drug":"...","allergyName":"...","severity":"mild|moderate|severe|unknown","explanation":"...","recommendation":"..."}]}. If no conflict exists for any combination, respond with {"conflicts":[]}.`
    : `المريض عنده حساسيات معروفة من: ${allergyNames.join('، ')}.\nافحص هل أي من هذه الأدوية الموصوفة عندها تطابق مباشر أو خطر تحسّس تصالبي مع أي من حساسيات المريض: ${drugNames.join('، ')}.\n\nأجب بصيغة JSON فقط: {"conflicts":[{"drug":"...","allergyName":"...","severity":"mild|moderate|severe|unknown","explanation":"...","recommendation":"..."}]}. لو لم يوجد تضارب بأي توليفة، أجب بـ{"conflicts":[]}.`;

  return { systemPrompt, userPrompt };
}

// مطابقة غير حساسة لحالة الأحرف بين اسم دواء موصوف واسم حساسية مسجَّلة —
// ثلاث حالات: (1) تطابق مباشر بالاسمين، (2) اسم الحساسية نفسه اسم عائلة
// دوائية ينتمي لها الدواء الموصوف، (3) الاسمان دواءان محدَّدان مختلفان لكن
// من نفس العائلة الدوائية (JOIN ذاتي بجدول drug_allergy_classes).
async function findClassMatch(drugName, allergyName) {
  if (drugName.trim().toLowerCase() === allergyName.trim().toLowerCase()) {
    return { matched: true, via: 'direct', allergyClass: null };
  }
  const result = await query(
    `SELECT a.allergy_class FROM drug_allergy_classes a
     JOIN drug_allergy_classes b ON LOWER(a.allergy_class) = LOWER(b.allergy_class)
     WHERE LOWER(a.drug_name) = LOWER($1) AND LOWER(b.drug_name) = LOWER($2)
     LIMIT 1`,
    [drugName, allergyName]
  );
  if (result.rows[0]) return { matched: true, via: 'class', allergyClass: result.rows[0].allergy_class };
  return { matched: false };
}

// دالة الفحص الموحَّدة — تُستدعى مباشرة من routes/allergyRoutes.js، ومن
// agents/prescriptionAgent.js (المرحلة الرابعة: فحص حساسية إضافي على نفس
// أدوية الوصفة المُستخرَجة، لو مريض مربوط صراحةً بالوصفة — راجع شرح هناك).
//
// patientAllergies: [{ name, severity }] — قائمة حساسيات المريض كما هي
// محفوظة بسجله (راجع AllergyPicker.js بالفرونت إند لشكلها الكامل؛ هنا
// نستخدم فقط name وseverity). drugs: اسم دواء واحد (نص) أو قائمة أسماء.
async function checkAllergies(patientAllergies, drugs, lang, mode) {
  const allergies = Array.isArray(patientAllergies) ? patientAllergies.filter((a) => a && a.name) : [];
  const drugList = (Array.isArray(drugs) ? drugs : [drugs]).filter(Boolean);

  // ── لا حساسيات مسجَّلة إطلاقاً لهذا المريض ────────────────────────────────
  // هذه حالة مختلفة جذرياً عن "لا بيانات كافية للفحص" (available:false) —
  // هنا فحصنا فعلياً وما فيه شيء نتحقق منه، لأن سجل المريض نفسه فارغ. راجع
  // noAllergiesOnFile بالفرونت إند: يُعرَض بشارة مختلفة صراحة عن "لا تضارب".
  if (allergies.length === 0) {
    return { available: true, source: 'db', conflicts: [], noAllergiesOnFile: true };
  }

  const conflicts = [];
  const uncoveredDrugs = [];

  for (const drug of drugList) {
    let matchedForDrug = false;
    for (const allergy of allergies) {
      const match = await findClassMatch(drug, allergy.name);
      if (match.matched) {
        conflicts.push({
          drug,
          allergyName: allergy.name,
          severity: allergy.severity || null,
          explanation: explainMatch(match, lang),
          recommendation: lang === 'en' ? GENERIC_RECOMMENDATION.en : GENERIC_RECOMMENDATION.ar,
          source: 'db',
        });
        matchedForDrug = true;
      }
    }
    if (!matchedForDrug) uncoveredDrugs.push(drug);
  }

  // كل الأدوية مغطاة بالجدول (تطابقت أو لا) — لا حاجة لاستدعاء AI إطلاقاً.
  if (uncoveredDrugs.length === 0) {
    return { available: true, source: 'db', conflicts };
  }

  const allergyNames = allergies.map((a) => a.name);
  const { systemPrompt, userPrompt } = buildAIPrompts(lang, allergyNames, uncoveredDrugs);
  const aiResult = await routeTextCall('allergyCheck', systemPrompt, userPrompt, mode);

  if (aiResult.available) {
    const aiConflicts = (aiResult.parsed?.conflicts || []).map((c) => ({ ...c, source: 'ai' }));
    return {
      available: true,
      source: conflicts.length > 0 ? 'mixed' : 'ai',
      provider: aiResult.provider,
      conflicts: [...conflicts, ...aiConflicts],
    };
  }

  if (aiResult.error) console.error(`⚠️  [allergy-agent] فشل استدعاء ${aiResult.provider}:`, aiResult.error);

  // AI غير متاح أو فشل الاستدعاء — لو الجدول أعطانا تضاربات حقيقية بالفعل
  // (لأدوية أخرى بنفس الطلب)، نرجعها بدل available:false بالكامل؛ أفضل من
  // معلومة جزئية صحيحة من لا شيء إطلاقاً. incomplete:true يوضح للمستدعي إن
  // بعض الأدوية لم تُفحَص فعلياً (لا "تأكدنا إنها آمنة").
  if (conflicts.length > 0) {
    return { available: true, source: 'db', conflicts, incomplete: true };
  }
  return { available: false };
}

module.exports = { checkAllergies, findClassMatch };
