// backend/utils/aiProvider.js
//
// منطق موحَّد للاتصال بذكاء اصطناعي حقيقي (Gemini المجاني أولاً، Claude
// المدفوع بديلاً) — مُستخرَج من routes/aiDiagnosisRoutes.js حتى تستطيع أي
// ميزة ثانية بالنظام (تفاعلات دوائية، تقارير ذكية مستقبلاً...) تستخدم نفس
// المنطق بدون تكرار الكود. راجع routes/aiDiagnosisRoutes.js للشرح الكامل
// لماذا هذا الاستدعاء يصير من الباك إند (خادم لخادم) لا الفرونت إند مباشرة.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// ── ملاحظة: النموذج الفعلي المتاح لحسابات جديدة يتغيّر بسرعة من طرف Google ──
// لو صار خطأ 404 "no longer available to new users"، افتح
// aistudio.google.com → Playground → Build → Code and Chat، شوفي أي نموذج
// معروض هناك فعلياً، وحدّث GEMINI_MODEL بملف .env (بدون حاجة لتعديل الكود).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

// أي مزوّد فعّال حالياً؟ (Gemini المجاني له الأولوية دائماً)
function activeProvider() {
  if (GEMINI_API_KEY) return 'gemini';
  if (ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

async function callGemini(systemPrompt, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      // Gemini يدعم فرض إخراج JSON صريح — يمنع مشاكل التغليف بـ Markdown نهائياً
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return JSON.parse(rawText);
}

async function callAnthropic(systemPrompt, userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic ${response.status}: ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  const rawText = data.content?.[0]?.text || '';
  // Claude أحياناً يحيط الـ JSON بعلامات ```json — نزيلها قبل التحليل
  const cleaned = rawText.replace(/```json\s*|\s*```/g, '').trim();
  return JSON.parse(cleaned);
}

// دالة موحّدة: تستدعي أي مزوّد فعّال حالياً، وتُرجع نتيجة موحَّدة الشكل بدل
// رمي استثناء يكسر الطلب — أي مسار API يستخدمها يقرر بنفسه ماذا يفعل لو فشلت
// (عادةً: يرجع للنظام المحلي الاحتياطي بدل رسالة خطأ جافة للمستخدم).
async function callAI(systemPrompt, userPrompt) {
  const provider = activeProvider();
  if (!provider) return { available: false };
  try {
    const parsed = provider === 'gemini'
      ? await callGemini(systemPrompt, userPrompt)
      : await callAnthropic(systemPrompt, userPrompt);
    return { available: true, provider, parsed };
  } catch (err) {
    return { available: false, provider, error: err.message };
  }
}

async function callGeminiVision(systemPrompt, userPrompt, imageBase64, mimeType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: userPrompt },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!rawText) throw new Error(`رد فارغ من Gemini: ${JSON.stringify(data).slice(0, 300)}`);
  const cleaned = rawText.replace(/```json\s*|\s*```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`رد غير صالح من Gemini: ${cleaned.slice(0, 300)}`);
  }
}

async function callAnthropicVision(systemPrompt, userPrompt, imageBase64, mimeType) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: userPrompt },
        ],
      }],
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic ${response.status}: ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  const rawText = data.content?.[0]?.text || '';
  const cleaned = rawText.replace(/```json\s*|\s*```/g, '').trim();
  return JSON.parse(cleaned);
}

// Same idea as callAI() above, but for prompts that include an image (used
// by the AI invoice reader). imageBase64 must be raw base64 (no
// "data:image/...;base64," prefix) — strip that on the caller side.
async function callAIWithImage(systemPrompt, userPrompt, imageBase64, mimeType) {
  const provider = activeProvider();
  if (!provider) return { available: false };
  try {
    const parsed = provider === 'gemini'
      ? await callGeminiVision(systemPrompt, userPrompt, imageBase64, mimeType)
      : await callAnthropicVision(systemPrompt, userPrompt, imageBase64, mimeType);
    return { available: true, provider, parsed };
  } catch (err) {
    return { available: false, provider, error: err.message };
  }
}

module.exports = { activeProvider, callAI, callAIWithImage };
