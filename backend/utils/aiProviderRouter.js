// backend/utils/aiProviderRouter.js
//
// نقطة توزيع واحدة موحَّدة لكل ميزات الذكاء الاصطناعي (قراءة
// الفواتير، التضارب الدوائي، قراءة الوصفات، التشخيص الذكي، فحص الجرعات،
// فحص الحساسية الدوائية، وشرح القيم المتطرفة بالفوترة) — تقرأ اختيار
// المستخدم المحفوظ بجدول system_settings (لا localStorage — يبقى الاختيار
// موحّداً بين كل أجهزة/متصفحات المستخدمين، ويستطيع الإدمن إدارته مركزياً)
// كإعداد افتراضي، أو تأخذ اختياراً صريحاً لطلب واحد (requestedMode أدناه —
// من AiModeSelect.js بالفرونت إند) لو وصل، وتوزّع كل استدعاء لمصدره الصحيح:
//   'bot'     — بلا أي استدعاء AI إطلاقاً. لتفاعلات الأدوية: يعني الاعتماد
//               فقط على جدول drug_interactions (راجع agents/interactionAgent
//               .js — يتعامل مع رد {available:false} هنا تماماً كما يتعامل
//               مع "AI غير مُعدّ أصلاً"، فيرجع نتيجة الجدول وحدها). لقراءة
//               الفواتير/الوصفات: يعني نص OCR فقط بلا أي هيكلة AI للحقول.
//   'online'  — Gemini/Claude (utils/aiProvider.js) — بحاجة اتصال إنترنت.
//   'offline' — Ollama محلي (utils/ollamaService.js) — يعمل بلا إنترنت، لكن
//               يحتاج خادم Ollama يعمل فعلياً على الجهاز (أو
//               host.docker.internal لو داخل Docker).
//
// ── ملاحظة مهمة: OCR ليس أحد الخيارات الثلاثة أعلاه ─────────────────────────
// PaddleOCR (راجع agents/ocrAgent.js) خطوة تمهيدية دائمة الحدوث قبل أي من
// الخيارات الثلاثة، لا بديلاً عنها — تعمل بغض النظر عن الاختيار هنا (حتى
// بوضع 'bot'، الفواتير/الوصفات تُقرَأ بصرياً عبر OCR أولاً، فقط لا AI يهيكل
// نتيجتها لاحقاً).
const { query } = require('../config/database');
const { activeProvider, callAI, callAIWithImage } = require('./aiProvider');
const { ollamaAvailable, callOllama, callOllamaWithImage } = require('./ollamaService');

const SETTINGS_KEY = 'ai_provider_settings';
// أسماء الميزات بالضبط كما تُستخدَم بمفاتيح الإعداد المحفوظ.
const FEATURES = ['invoiceReader', 'drugInteractions', 'prescriptionReader', 'aiDiagnosis', 'dosageValidation', 'allergyCheck', 'billingAnomaly', 'inventoryPrediction'];
const VALID_MODES = ['bot', 'online', 'offline'];
// الافتراضي 'online' يطابق تماماً السلوك الحالي قبل هذه الميزة (Gemini أولاً
// دائماً) — لا يكسر أي نشر موجود لم يُعدِّل الإعداد صراحة بعد.
const DEFAULT_MODE = 'online';

function normalizeSettings(raw) {
  const settings = {};
  for (const feature of FEATURES) {
    const value = raw?.[feature];
    settings[feature] = VALID_MODES.includes(value) ? value : DEFAULT_MODE;
  }
  return settings;
}

async function getSettings() {
  const result = await query('SELECT value FROM system_settings WHERE key=$1', [SETTINGS_KEY]);
  return normalizeSettings(result.rows[0]?.value);
}

async function getMode(feature) {
  const settings = await getSettings();
  return settings[feature] || DEFAULT_MODE;
}

// updates: { invoiceReader?, drugInteractions?, prescriptionReader? } — تحديث
// جزئي (أي حقول تُرسَل فقط)؛ الباقي يبقى كما كان. قيمة غير صالحة لأي حقل
// تُتجاهَل بصمت (لا تكسر التحديثات الأخرى الصحيحة بنفس الطلب).
async function setSettings(updates) {
  const current = await getSettings();
  const merged = { ...current };
  for (const feature of FEATURES) {
    if (VALID_MODES.includes(updates?.[feature])) merged[feature] = updates[feature];
  }
  await query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(merged)]
  );
  return merged;
}

// requestedMode: اختيار المستخدم لهذا الطلب تحديداً (من واجهة الصفحة نفسها،
// راجع frontend/src/components/AiModeSelect.js) — لو صالح، يتفوّق على
// الإعداد الافتراضي المحفوظ بجدول system_settings بلا أي قراءة قاعدة بيانات
// إضافية. أي قيمة غير صالحة (غير مُرسَلة، فارغة، أو نص عشوائي) تُتجاهَل
// بصمت وترجع للسلوك المعتاد (الإعداد المحفوظ) — لا تكسر أي مستدعٍ قديم لم
// يُمرِّر هذا الوسيط بعد.
async function resolveMode(feature, requestedMode) {
  if (VALID_MODES.includes(requestedMode)) return requestedMode;
  return getMode(feature);
}

// ── لا نكشف أبداً اسم المزوّد "الإنترنت" الفعلي (Gemini/Claude/...) بأي رد ──
// حتى بحقل provider الخام بالـJSON، لا فقط بالنصوص المعروضة بالواجهة — المزوّد
// الحقيقي يُضبَط بـ.env وقد يتغيّر، فأي مستهلك لهذا الـAPI (الفرونت إند
// الحالي، أو أي عميل مستقبلي) ما يصير يعتمد على اسم مزوّد محدَّد. 'bot'
// و'ollama' مسموحان لأنهما مذكوران صراحة بواجهة الاختيار نفسها (AiModeSelect
// .js: "Bot only" / "Offline AI (Ollama)") — الاسم المخفي فقط هو مزوّد وضع
// 'online' تحديداً (gemini/anthropic حالياً بـutils/aiProvider.js).
function sanitizeProvider(provider) {
  if (!provider || provider === 'bot' || provider === 'ollama') return provider;
  return 'online';
}

// نفس شكل callAI()/callAIWithImage() بالضبط ({available, provider, parsed}
// أو {available:false, ...}) — أي مستدعٍ حالي (interactionAgent.js،
// invoiceReadProcessor.js، prescriptionAgent.js) يستبدل استدعاء aiProvider
// المباشر بهذا بلا أي تغيير آخر بمنطقه. حقل provider يُعقَّم هنا قبل رجوعه
// لأي مستدعٍ — راجع sanitizeProvider أعلاه.
async function routeTextCall(feature, systemPrompt, userPrompt, requestedMode) {
  const mode = await resolveMode(feature, requestedMode);
  if (mode === 'bot') return { available: false, provider: 'bot' };
  if (mode === 'offline') return callOllama(systemPrompt, userPrompt);
  const result = await callAI(systemPrompt, userPrompt);
  return result.provider ? { ...result, provider: sanitizeProvider(result.provider) } : result;
}

async function routeImageCall(feature, systemPrompt, userPrompt, imageBase64, mimeType, requestedMode) {
  const mode = await resolveMode(feature, requestedMode);
  if (mode === 'bot') return { available: false, provider: 'bot' };
  if (mode === 'offline') return callOllamaWithImage(systemPrompt, userPrompt, imageBase64, mimeType);
  const result = await callAIWithImage(systemPrompt, userPrompt, imageBase64, mimeType);
  return result.provider ? { ...result, provider: sanitizeProvider(result.provider) } : result;
}

// حالة صادقة لميزة محدَّدة — تحل محل الفحص القديم "Gemini/Claude مُعدّ أو لا"
// المستخدَم بمسارات /status الثلاثة (كان يتجاهل اختيار 'bot'/'offline'
// كلياً). فحص حي فعلي حسب الوضع المُختار فعلاً، لا افتراض واحد للجميع:
//   'bot'     — متاح دائماً (جدول محلي/OCR فقط، لا يعتمد على خدمة خارجية).
//   'online'  — متاح لو مفتاح Gemini أو Claude مُعدّ (نفس الفحص القديم).
//   'offline' — متاح لو خادم Ollama يستجيب فعلياً الآن (فحص حي، لا افتراض).
async function getFeatureStatus(feature) {
  const mode = await getMode(feature);
  if (mode === 'bot') return { mode, available: true, provider: 'bot' };
  if (mode === 'offline') return { mode, available: await ollamaAvailable(), provider: 'ollama' };
  const provider = activeProvider();
  return { mode, available: Boolean(provider), provider: sanitizeProvider(provider) };
}

module.exports = { getSettings, setSettings, getMode, getFeatureStatus, routeTextCall, routeImageCall, sanitizeProvider, FEATURES, VALID_MODES, DEFAULT_MODE };
