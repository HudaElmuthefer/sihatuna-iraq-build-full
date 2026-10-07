// backend/agents/dosageAgent.js
//
// فحص الجرعة الآمنة — نفس معمارية agents/interactionAgent.js بالضبط:
// طبقتان، قاعدة بيانات (bot/rules) أولاً، ذكاء اصطناعي احتياطياً فقط لو
// الدواء/النطاق العمري غير موجود بالجدول (راجع migrations-sql/
// 009_dosage_limits.sql للبذر الأولي والمصادر السريرية الحقيقية لكل رقم).
//
// ── مبدأ أمان جوهري: "لا بيانات" لا يعني أبداً "آمن" ─────────────────────────
// بعكس فحص التضارب الدوائي (حيث "لا تطابق بالجدول" يُفحَص لاحقاً بـAI بلا
// عواقب خطيرة لو AI أيضاً غير متاح — النتيجة تبقى بلا أي ادّعاء وهمي)، فحص
// الجرعة أكثر حساسية: أي مسار هنا (لا تطابق بالجدول + لا AI متاح، أو AI رجع
// رداً غير واضح) **يجب** أن يرجع available:false أو status:'unknown' بصراحة
// تامة — أبداً لا نفترض 'safe' لمجرد غياب دليل على العكس. راجع أيضاً
// DosageCheckPage.js بالفرونت إند: تصميم الشارات هناك يفرّق بصرياً بوضوح
// بين "آمن" (أخضر) و"لا بيانات كافية" (رمادي محايد) — لا يجمعهما أبداً.
const { query } = require('../config/database');
const { routeTextCall } = require('../utils/aiProviderRouter');

function buildAIPrompts(lang, drugName, dose, unit, ageYears, weightKg) {
  const isEn = lang === 'en';
  const patientDesc = isEn
    ? `age: ${ageYears ?? 'unknown'} years, weight: ${weightKg ?? 'unknown'} kg`
    : `العمر: ${ageYears ?? 'غير محدد'} سنة، الوزن: ${weightKg ?? 'غير محدد'} كجم`;

  const systemPrompt = isEn
    ? 'You are a clinical pharmacist assisting with a preliminary dosage safety check for a hospital ERP system. Only assess drugs/doses you are reasonably confident about — if genuinely uncertain, say so explicitly rather than guessing. Always include a disclaimer that this does not replace a pharmacist or physician review. Respond ONLY with valid JSON matching the exact schema requested — no markdown, no extra text.'
    : 'أنت صيدلاني سريري تساعد بفحص أولي لسلامة جرعة دوائية ضمن نظام مستشفى إلكتروني. قيّم فقط الأدوية/الجرعات التي متأكد منها بشكل معقول — لو غير متأكد فعلاً، صرّح بذلك بدل التخمين. اذكر دائماً إن هذا لا يغني عن مراجعة صيدلاني أو طبيب. أجب فقط بصيغة JSON صالحة مطابقة تماماً للمخطط المطلوب — بدون Markdown وبدون أي نص إضافي خارج الـ JSON.';

  const userPrompt = isEn
    ? `Assess this dosage: drug "${drugName}", dose ${dose}${unit}/day, patient ${patientDesc}.\n\nRespond with JSON only: {"status":"safe|exceeds|contraindicated|unknown","reasoning":"...","recommendation":"..."}. Use "unknown" honestly if you cannot assess this drug/dose combination with reasonable confidence — do not guess "safe".`
    : `قيّم هذه الجرعة: الدواء "${drugName}"، الجرعة ${dose}${unit}/يوم، المريض ${patientDesc}.\n\nأجب بصيغة JSON فقط: {"status":"safe|exceeds|contraindicated|unknown","reasoning":"...","recommendation":"..."}. استخدم "unknown" بصدق لو لم تستطع تقييم هذا الدواء/الجرعة بثقة معقولة — لا تخمّن "safe".`;

  return { systemPrompt, userPrompt };
}

// أكثر صف تطابقاً تخصيصاً (specificity) يفوز لو تعدّدت التطابقات — راجع
// migrations-sql/009_dosage_limits.sql لشرح كامل لماذا NULL بأي عمود يعني
// "بلا حد بهذا الاتجاه"، ولماذا نطلب توفّر عمر أو وزن واحد على الأقل (يُفرَض
// هذا بـroutes/dosageRoutes.js، لا هنا) قبل محاولة أي تطابق إطلاقاً.
async function findDbMatch(drugName, ageYears, weightKg) {
  const result = await query(
    `SELECT * FROM dosage_limits
     WHERE LOWER(drug_name) = LOWER($1)
       AND ($2::numeric IS NULL OR min_age IS NULL OR $2 >= min_age)
       AND ($2::numeric IS NULL OR max_age IS NULL OR $2 <= max_age)
       AND ($3::numeric IS NULL OR min_weight_kg IS NULL OR $3 >= min_weight_kg)
       AND ($3::numeric IS NULL OR max_weight_kg IS NULL OR $3 <= max_weight_kg)
     ORDER BY (
       (CASE WHEN min_age IS NOT NULL THEN 1 ELSE 0 END) +
       (CASE WHEN max_age IS NOT NULL THEN 1 ELSE 0 END) +
       (CASE WHEN min_weight_kg IS NOT NULL THEN 1 ELSE 0 END) +
       (CASE WHEN max_weight_kg IS NOT NULL THEN 1 ELSE 0 END)
     ) DESC
     LIMIT 1`,
    [drugName, ageYears ?? null, weightKg ?? null]
  );
  return result.rows[0] || null;
}

// دالة الفحص الموحَّدة — تُستدعى مباشرة من routes/dosageRoutes.js.
// drugName/dose مطلوبان دائماً؛ ageYears/weightKg: واحد منهما على الأقل
// مطلوب فعلياً (يُفرَض بالراوت) حتى يكون لأي تطابق بالجدول معنى — لو كلاهما
// غير متوفرين، لا نحاول تطابقاً بالجدول إطلاقاً (كل الصفوف كانت ستُعتبَر
// "متطابقة" بالخطأ، راجع شرح findDbMatch)، ننتقل لـAI مباشرة.
async function checkDosage(drugName, dose, unit, ageYears, weightKg, lang, mode) {
  const hasPatientInfo = ageYears != null || weightKg != null;

  if (hasPatientInfo) {
    const row = await findDbMatch(drugName, ageYears, weightKg);
    if (row) {
      const maxDose = Number(row.max_daily_dose);
      const contraindicated = maxDose === 0;
      const exceeds = !contraindicated && Number(dose) > maxDose;
      return {
        available: true,
        source: 'db',
        status: contraindicated ? 'contraindicated' : (exceeds ? 'exceeds' : 'safe'),
        limit: {
          maxDailyDose: maxDose,
          unit: row.unit,
          minAge: row.min_age != null ? Number(row.min_age) : null,
          maxAge: row.max_age != null ? Number(row.max_age) : null,
          minWeightKg: row.min_weight_kg != null ? Number(row.min_weight_kg) : null,
          maxWeightKg: row.max_weight_kg != null ? Number(row.max_weight_kg) : null,
        },
        notes: row.notes,
        recommendation: row.recommendation,
      };
    }
  }

  // لا تطابق بالجدول (دواء غير مُدرَج، أو نطاق عمر/وزن خارج كل الصفوف
  // المعروفة، أو لا معلومات مريض إطلاقاً) — نسأل AI تحديداً.
  const { systemPrompt, userPrompt } = buildAIPrompts(lang, drugName, dose, unit, ageYears, weightKg);
  const aiResult = await routeTextCall('dosageValidation', systemPrompt, userPrompt, mode);

  if (aiResult.available) {
    const parsed = aiResult.parsed || {};
    const status = ['safe', 'exceeds', 'contraindicated', 'unknown'].includes(parsed.status) ? parsed.status : 'unknown';
    return {
      available: true,
      source: 'ai',
      provider: aiResult.provider,
      status,
      reasoning: parsed.reasoning || null,
      recommendation: parsed.recommendation || null,
    };
  }

  if (aiResult.error) console.error(`⚠️  [dosage-agent] فشل استدعاء ${aiResult.provider}:`, aiResult.error);

  // AI غير متاح أو فشل الاستدعاء، ولا تطابق بالجدول — لا بيانات كافية
  // إطلاقاً. available:false هنا يعني صراحة "لم نُقيِّم هذا"، لا "آمن".
  return { available: false };
}

module.exports = { checkDosage, findDbMatch };
