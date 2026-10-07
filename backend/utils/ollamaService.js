// backend/utils/ollamaService.js
//
// Ollama (ذكاء اصطناعي محلي/بلا اتصال إنترنت) — بديل ثالث لـGemini/Claude
// بجانب utils/aiProvider.js، بنفس شكل الدوال الموحَّد بالضبط (available/
// provider/parsed) حتى يصير استبدالاً مباشراً (drop-in) لـcallAI/
// callAIWithImage من منظور أي مسار يستدعيهما — راجع المرحلة الخامسة
// (aiProviderRouter.js) لمنطق الاختيار الفعلي بين البوت/الإنترنت/المحلي؛
// هذا الملف يوفّر القدرة فقط، بلا أي اختيار مضمَّن هنا.
//
// ── لماذا خادم Ollama منفصل تماماً عن Gemini/Anthropic؟ ─────────────────────
// Gemini/Claude: طلب HTTP لخادم سحابي خارجي بمفتاح API فقط — لا احتياج لأي
// بنية تحتية محلية. Ollama: خادم حقيقي يعمل محلياً (افتراضياً منفذ 11434)
// ويحمّل نموذج ذكاء اصطناعي كامل بذاكرة الجهاز نفسه — يحتاج تثبيت Ollama
// وتنزيل نموذج مسبقاً (`ollama pull <model>`)، ويعمل حتى بدون إنترنت إطلاقاً
// بعد ذلك (هذا هو معنى "غير متصل" هنا) — بعكس Gemini/Claude اللذان يتوقفان
// فوراً بلا إنترنت.
//
// ── نموذجان منفصلان: نصي وrؤية، لا نموذج واحد للاثنين ───────────────────────
// ليس كل نموذج Ollama يدعم قراءة صور (vision) — تأكّدنا فعلياً
// (`ollama show <model>`): qwen2.5 نصي بحت (لا "vision" بقائمة capabilities)،
// بينما gemma3 يدعم الاثنين. النموذج النصي الافتراضي هنا أصغر بكثير (أسرع
// وأخف على الذاكرة) لأن فحص التضارب الدوائي (استخدامه الأساسي) نصي بحت —
// لا داعي لتحميل نموذج رؤية أثقل لمهمة لا تحتاجه.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL || 'qwen2.5:0.5b';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'gemma3:4b';
// الاستدلال محلياً على المعالج (CPU) — بلا تسريع GPU مضمون بكل جهاز — قد
// يأخذ وقتاً أطول بكثير من استدعاء سحابي، خصوصاً لنموذج الرؤية الأثقل على
// جهاز بذاكرة محدودة. مهلة سخية عمداً (تشبه OCR_TIMEOUT_MS بـagents/ocrAgent
// .js لنفس السبب بالضبط)، مع بقائها محدودة لمنع تعليق أبدي حقيقي.
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 120_000;

// فحص سريع: هل خادم Ollama يستجيب أصلاً؟ (لا يتحقق من توفر نموذج معيّن —
// فقط إن الخادم نفسه يعمل). مهلة قصيرة عمداً (فحص توفّر، لا استدعاء حقيقي).
async function ollamaAvailable() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

// نداء عام لـ/api/chat — تُستخدَم داخلياً من الدالتين الموحَّدتين أدناه.
// format:'json' يفرض على Ollama إرجاع JSON صالح فقط (مدعوم من معظم النماذج
// الحديثة، مطابق لـresponseMimeType الخاص بـGemini) — يمنع مشاكل التغليف
// بـMarkdown نفس مشكلة كانت موجودة قبل هذا بـcallGemini/callAnthropic.
async function chatRequest(model, systemPrompt, userPrompt, images) {
  const message = { role: 'user', content: userPrompt };
  if (images) message.images = images;

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, message],
      format: 'json',
      stream: false,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama ${response.status}: ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  const rawText = data.message?.content || '';
  if (!rawText) throw new Error(`رد فارغ من Ollama (${model}): ${JSON.stringify(data).slice(0, 300)}`);
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`رد غير صالح من Ollama (${model}): ${rawText.slice(0, 300)}`);
  }
}

// نفس شكل callAI() بـutils/aiProvider.js بالضبط — استبدال مباشر لها.
async function callOllama(systemPrompt, userPrompt) {
  try {
    const parsed = await chatRequest(OLLAMA_TEXT_MODEL, systemPrompt, userPrompt);
    return { available: true, provider: 'ollama', parsed };
  } catch (err) {
    return { available: false, provider: 'ollama', error: err.message };
  }
}

// نفس شكل callAIWithImage() بـutils/aiProvider.js بالضبط — imageBase64 خام
// (بلا بادئة "data:image/...;base64,")، بنفس شرط المستدعي الحالي تماماً.
async function callOllamaWithImage(systemPrompt, userPrompt, imageBase64, mimeType) {
  try {
    const parsed = await chatRequest(OLLAMA_VISION_MODEL, systemPrompt, userPrompt, [imageBase64]);
    return { available: true, provider: 'ollama', parsed };
  } catch (err) {
    return { available: false, provider: 'ollama', error: err.message };
  }
}

module.exports = { ollamaAvailable, callOllama, callOllamaWithImage, OLLAMA_TEXT_MODEL, OLLAMA_VISION_MODEL };
