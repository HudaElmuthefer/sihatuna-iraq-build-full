// backend/agents/interactionAgent.js
//
// فحص التضارب الدوائي — يستدعيه routes/drugInteractionRoutes.js مباشرة، وسيُعاد
// استخدامه لاحقاً من services/prescriptionAgent.js (قراءة الوصفات — المرحلة
// الثالثة) بلا أي استدعاء HTTP بينهما، فقط دالة عادية داخل نفس عملية Node
// (راجع قرار المعمارية: لا خدمات مصغّرة منفصلة لهذه الميزات الثلاث).
//
// ── طبقتان: قاعدة بيانات (bot/rules) أولاً، ذكاء اصطناعي احتياطياً ──────────
// إصلاح جذري عن النسخة السابقة (كانت تستدعي الذكاء الاصطناعي مباشرة لكل زوج
// أدوية، حتى لو التضارب معروفاً ومحفوظاً مسبقاً): الآن نفحص جدول
// drug_interactions أولاً (استعلام فوري، مجاني، لا يعتمد على توفّر مفتاح
// API) لكل زوج أدوية بالقائمة. فقط الأزواج غير الموجودة بالجدول تُرسَل
// لفحص الذكاء الاصطناعي — يقلل تكلفة/زمن الاستدعاءات، ويبقي النظام مفيداً
// جزئياً حتى بدون أي مزوّد ذكاء اصطناعي مُعدّ (على الأقل للأزواج المعروفة
// مسبقاً بالجدول).
const { query } = require('../config/database');
const { routeTextCall } = require('../utils/aiProviderRouter');

function buildAIPrompts(lang, drugs) {
  const isEn = lang === 'en';
  const systemPrompt = isEn
    ? 'You are a clinical pharmacist assisting with a preliminary drug interaction check for a hospital ERP system. Only report interactions you are reasonably confident about — do not invent interactions. Always include a disclaimer that this does not replace a pharmacist or physician review. Respond ONLY with valid JSON matching the exact schema requested — no markdown, no extra text.'
    : 'أنت صيدلاني سريري تساعد بفحص أولي للتضارب الدوائي ضمن نظام مستشفى إلكتروني. اذكر فقط التضاربات التي متأكد منها بشكل معقول — لا تختلق تضاربات غير موثوقة. اذكر دائماً إن هذا لا يغني عن مراجعة صيدلاني أو طبيب. أجب فقط بصيغة JSON صالحة مطابقة تماماً للمخطط المطلوب — بدون Markdown وبدون أي نص إضافي خارج الـ JSON.';

  const userPrompt = isEn
    ? `Check for drug interactions between these medications: ${drugs.join(', ')}\n\nRespond with JSON only: {"interactions":[{"drugs":["drug1","drug2"],"severity":"low|medium|high","effect":"...","recommendation":"..."}]}. If no known interactions exist between any of these drugs, respond with {"interactions":[]}.`
    : `افحص التضارب الدوائي بين هذه الأدوية: ${drugs.join('، ')}\n\nأجب بصيغة JSON فقط: {"interactions":[{"drugs":["دواء1","دواء2"],"severity":"low|medium|high","effect":"...","recommendation":"..."}]}. لو لم يوجد تضارب معروف بين أي منهم، أجب بـ{"interactions":[]}.`;

  return { systemPrompt, userPrompt };
}

// كل أزواج ممكنة ضمن قائمة أدوية (n اختر 2) — تضارب دوائي دائماً بين
// دواءين، حتى لو المستخدم اختار أكثر من اثنين بنفس الفحص.
function allPairs(drugs) {
  const pairs = [];
  for (let i = 0; i < drugs.length; i++) {
    for (let j = i + 1; j < drugs.length; j++) pairs.push([drugs[i], drugs[j]]);
  }
  return pairs;
}

// مطابقة غير حساسة لحالة الأحرف، وباتجاهي الزوج (A,B تكافئ B,A) — راجع
// migrations-sql/008_drug_interactions.sql للفهرس الفريد المطابق.
async function findDbMatch(drugA, drugB) {
  const result = await query(
    `SELECT drug_a, drug_b, severity, notes, recommendation FROM drug_interactions
     WHERE (LOWER(drug_a) = LOWER($1) AND LOWER(drug_b) = LOWER($2))
        OR (LOWER(drug_a) = LOWER($2) AND LOWER(drug_b) = LOWER($1))
     LIMIT 1`,
    [drugA, drugB]
  );
  return result.rows[0] || null;
}

// دالة الفحص الموحَّدة — تُستدعى مباشرة (drugs: قائمة أسماء أدوية، لغتان
// مدعومتان فقط بالنصوص المولَّدة لاستدعاء AI عند الحاجة؛ أسماء الأدوية
// نفسها تُقارَن كما وصلت، بأي لغة).
async function checkInteractions(drugs, lang, mode) {
  const pairs = allPairs(drugs);
  const dbInteractions = [];
  const uncoveredPairs = [];

  for (const [a, b] of pairs) {
    const row = await findDbMatch(a, b);
    if (row) {
      dbInteractions.push({ drugs: [row.drug_a, row.drug_b], severity: row.severity, effect: row.notes, recommendation: row.recommendation });
    } else {
      uncoveredPairs.push([a, b]);
    }
  }

  // كل الأزواج مغطاة بالجدول — لا حاجة لاستدعاء AI إطلاقاً (أسرع، مجاني،
  // ويعمل حتى بدون أي مفتاح API مُعدّ).
  if (uncoveredPairs.length === 0) {
    return { available: true, source: 'db', interactions: dbInteractions };
  }

  // أزواج غير معروفة بالجدول — نسألها AI تحديداً (الأدوية المتعلقة بها
  // فقط، لا كل القائمة الأصلية، حتى لا نكرر سؤال AI عن أزواج أجبنا عنها
  // من الجدول أصلاً).
  const uncoveredDrugs = [...new Set(uncoveredPairs.flat())];
  const { systemPrompt, userPrompt } = buildAIPrompts(lang, uncoveredDrugs);
  // routeTextCall تقرأ اختيار المستخدم المحفوظ (bot/online/offline) وتوزّع
  // الاستدعاء تبعاً له — راجع utils/aiProviderRouter.js. وضع 'bot' يرجع
  // {available:false} فوراً بلا أي استدعاء شبكة، فتتعامل معه الأسطر التالية
  // بالضبط كما تتعامل مع "AI غير مُعدّ أصلاً" — لا حاجة لأي منطق خاص هنا.
  const aiResult = await routeTextCall('drugInteractions', systemPrompt, userPrompt, mode);

  if (aiResult.available) {
    const aiInteractions = aiResult.parsed?.interactions || [];
    return {
      available: true,
      source: dbInteractions.length > 0 ? 'mixed' : 'ai',
      provider: aiResult.provider,
      interactions: [...dbInteractions, ...aiInteractions],
    };
  }

  if (aiResult.error) console.error(`⚠️  [interaction-agent] فشل استدعاء ${aiResult.provider}:`, aiResult.error);

  // AI غير متاح أو فشل الاستدعاء — لو الجدول أعطانا نتيجة جزئية حقيقية
  // (على الأقل زوج واحد معروف)، نرجعها بدل available:false بالكامل؛ أفضل
  // من معلومة جزئية صحيحة من لا شيء إطلاقاً. incomplete:true يوضح للمستدعي
  // إن بعض الأزواج لم تُفحَص فعلياً.
  if (dbInteractions.length > 0) {
    return { available: true, source: 'db', interactions: dbInteractions, incomplete: true };
  }
  return { available: false };
}

module.exports = { checkInteractions };
