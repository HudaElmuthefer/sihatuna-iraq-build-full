// backend/agents/inventoryPredictionAgent.js
//
// توقّع استهلاك المخزون — تحليل إحصائي حتمي بحت (لا استدعاء AI بالحساب
// الأساسي إطلاقاً؛ نفس فلسفة billingAnomalyAgent.js بالضبط: أداة إدارية
// حتمية سريعة، ليست سريرية). ملاحظة AI اختيارية بلغة بسيطة عن اتجاه
// الاستهلاك (ارتفاع/انخفاض) تُطلَب لاحقاً لكل صنف على حدة — لا تشارك أبداً
// بالحساب نفسه.
//
// ── فجوة بنيوية حقيقية بالبيانات الحالية (اقرأ قبل أي تعديل على العتبات) ────
// لا يوجد أي سجل استهلاك تاريخي مرتبط فعلياً بجدول inventory بهذا النظام
// حالياً — تحقّق مباشر من قاعدة البيانات الحقيقية: أسماء أصناف inventory
// (500 صنف، بيانات مولَّدة اصطناعياً مثل "Xetonyx 25mg Tablet CR") لا تتطابق
// إطلاقاً (لا تاماً ولا جزئياً) مع أسماء أصناف pharmacy_orders (2305 سجل
// صرف حقيقي الشكل مثل "METFORMIN TABLETS 500MG 500S") ولا medication_orders
// (3781 سجل، بعضه بيانات اختبار واضحة مثل "bnvnbv"). لا يوجد أيضاً أي جدول
// سجل حركة مخزون (stock movement log) بالنظام — حتى زر "استلام/صرف" بصفحة
// المخزون (InventoryPage.js) يُحدِّث الكمية الحالية مباشرة بلا أي سجل
// تاريخي مؤرَّخ. النتيجة الحالية: كل صنف سيُعلَّم بصراحة "بيانات غير كافية"
// — هذا سلوك صحيح مقصود (راجع مبدأ "لا بيانات لا يعني نتيجة وهمية" بأعلى
// dosageAgent.js لنفس الفلسفة)، وليس خطأً، حتى تتوفر بيانات استهلاك حقيقية
// مرتبطة فعلياً بجدول inventory (عبر اسم أو رمز صنف مشترك حقيقي).
//
// المطابقة أدناه بالاسم الحرفي المُطبَّع (case-insensitive/trim) فقط، بلا
// أي تخمين جزئي (substring) — لتفادي ربط أصناف مختلفة فعلياً بالخطأ بمجرد
// تشابه نصي جزئي لاحقاً عند توفر بيانات حقيقية.
//
// المصدر الوحيد المستخدَم فعلياً لحساب الاستهلاك هو pharmacy_orders (سجل
// صرف فعلي: كمية + تاريخ). medication_orders سجل وصفة طبية (جرعة/تكرار/
// مدة)، لا كمية "صُرِفت من المخزون" مباشرة — تقدير الكمية منه أضعف بكثير
// ولا داعي له طالما لا يوجد حتى تطابق أسماء أصلاً. medication_administrations
// (18 سجلاً فقط حالياً) أقل من أي حد أدنى ذي معنى لأي صنف.
const { query } = require('../config/database');
const { routeTextCall } = require('../utils/aiProviderRouter');

const DEFAULT_REORDER_BUFFER_DAYS = 14; // أسبوعان افتراضياً، قابل للتخصيص لكل تحليل
const MIN_DATA_POINTS = 3; // أقل عدد أحداث صرف قبل اعتبار معدل الاستهلاك ذا معنى إحصائياً

function normalizeName(name) {
  return (name || '').toString().trim().toLowerCase();
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// يجمع كل أحداث صرف pharmacy_orders (كل عنصر ضمن مصفوفة items بكل طلب، مع
// تاريخ الطلب نفسه) مفهرَسة بالاسم المُطبَّع.
async function loadConsumptionEvents(hospitalId) {
  const conditions = [];
  const params = [];
  if (hospitalId) { params.push(hospitalId); conditions.push(`data->>'hospitalId' = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(`SELECT data FROM pharmacy_orders ${where}`, params);

  const byName = new Map();
  result.rows.forEach(row => {
    const items = Array.isArray(row.data?.items) ? row.data.items : [];
    const date = row.data?.date;
    if (!date) return;
    items.forEach(it => {
      const key = normalizeName(it.name);
      const qty = Number(it.qty);
      if (!key || !Number.isFinite(qty) || qty <= 0) return;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ date, qty });
    });
  });
  return byName;
}

async function loadInventoryItems(hospitalId) {
  const conditions = [];
  const params = [];
  if (hospitalId) { params.push(hospitalId); conditions.push(`data->>'hospitalId' = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(`SELECT id, data FROM inventory ${where}`, params);
  return result.rows.map(row => ({ id: row.id, ...row.data }));
}

// حساب معدل الاستهلاك واتجاهه (ارتفاع/انخفاض) حتمياً بالكامل لصنف واحد —
// events: [{date, qty}] مرتبطة فعلياً بهذا الصنف تحديداً (مطابقة اسم حرفية).
function calcConsumption(currentQty, events, reorderBufferDays) {
  if (events.length < MIN_DATA_POINTS) {
    return { available: false, reason: 'insufficient-data', dataPoints: events.length };
  }
  const sorted = [...events].sort((a, b) => new Date(a.date) - new Date(b.date));
  const spanDays = (new Date(sorted[sorted.length - 1].date) - new Date(sorted[0].date)) / (1000 * 60 * 60 * 24);
  if (spanDays <= 0) {
    // كل الأحداث بنفس اليوم — لا مدى زمني لحساب معدل استهلاك ذي معنى.
    return { available: false, reason: 'insufficient-data', dataPoints: events.length };
  }
  const totalQty = sorted.reduce((s, e) => s + e.qty, 0);
  const ratePerWeek = totalQty / (spanDays / 7);
  const ratePerMonth = totalQty / (spanDays / 30);

  // اتجاه الاستهلاك: مقارنة حتمية بسيطة (نصف الفترة الأول مقابل الثاني) —
  // حساب رقمي بحت على نفس البيانات، وليس تخميناً بالذكاء الاصطناعي.
  const midTime = (new Date(sorted[0].date).getTime() + new Date(sorted[sorted.length - 1].date).getTime()) / 2;
  const firstHalf = sorted.filter(e => new Date(e.date).getTime() < midTime);
  const secondHalf = sorted.filter(e => new Date(e.date).getTime() >= midTime);
  const firstHalfQty = firstHalf.reduce((s, e) => s + e.qty, 0);
  const secondHalfQty = secondHalf.reduce((s, e) => s + e.qty, 0);
  let trend = 'stable';
  if (firstHalf.length > 0 && secondHalf.length > 0) {
    if (secondHalfQty > firstHalfQty * 1.2) trend = 'rising';
    else if (secondHalfQty < firstHalfQty * 0.8) trend = 'falling';
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const stockOutDays = ratePerWeek > 0 ? (currentQty / ratePerWeek) * 7 : null;
  const stockOutDate = stockOutDays != null ? addDays(todayStr, Math.round(stockOutDays)) : null;
  const reorderDate = stockOutDate != null ? addDays(stockOutDate, -reorderBufferDays) : null;
  const daysUntilStockOut = stockOutDate != null
    ? Math.round((new Date(stockOutDate).getTime() - new Date(todayStr).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    available: true,
    dataPoints: sorted.length,
    totalQtyConsumed: totalQty,
    spanDays: Math.round(spanDays),
    ratePerWeek: Math.round(ratePerWeek * 100) / 100,
    ratePerMonth: Math.round(ratePerMonth * 100) / 100,
    trend,
    stockOutDate,
    daysUntilStockOut,
    reorderDate,
    currentQty,
  };
}

// التحليل الكامل — حتمي بالكامل، بلا أي استدعاء AI. reorderBufferDays قابل
// للتخصيص لكل استدعاء (راجع POST /inventory-prediction/analyze).
async function predictInventory(hospitalId, reorderBufferDays = DEFAULT_REORDER_BUFFER_DAYS) {
  const bufferDays = Number.isFinite(Number(reorderBufferDays)) && Number(reorderBufferDays) >= 0
    ? Number(reorderBufferDays)
    : DEFAULT_REORDER_BUFFER_DAYS;

  const [items, consumptionByName] = await Promise.all([
    loadInventoryItems(hospitalId),
    loadConsumptionEvents(hospitalId),
  ]);

  const predictions = items.map(item => {
    const key = normalizeName(item.name);
    const events = consumptionByName.get(key) || [];
    const currentQty = Number(item.qty) || 0;
    const calc = calcConsumption(currentQty, events, bufferDays);
    return {
      itemId: item.id,
      code: item.code || null,
      name: item.name || null,
      unit: item.unit || null,
      currentQty,
      minQty: Number(item.minQty) || 0,
      ...calc,
    };
  });

  const itemsWithData = predictions.filter(p => p.available).length;

  return {
    available: true,
    reorderBufferDays: bufferDays,
    totalItemsAnalyzed: predictions.length,
    itemsWithData,
    itemsInsufficientData: predictions.length - itemsWithData,
    predictions,
    generatedAt: new Date().toISOString(),
  };
}

function buildTrendNotePrompts(lang, item) {
  const isEn = lang === 'en';
  const detail = isEn
    ? `Item "${item.name}" (code ${item.code || item.itemId}), current stock ${item.currentQty} ${item.unit || ''}. Consumption trend: ${item.trend}. Average rate: ${item.ratePerWeek} units/week over the last ${item.spanDays} days (${item.dataPoints} dispensing records). Projected stock-out: ${item.stockOutDate || 'unknown'}.`
    : `الصنف "${item.name}" (الرمز ${item.code || item.itemId})، الكمية الحالية ${item.currentQty} ${item.unit || ''}. اتجاه الاستهلاك: ${item.trend}. المعدل: ${item.ratePerWeek} وحدة/أسبوع خلال آخر ${item.spanDays} يوماً (${item.dataPoints} سجل صرف). تاريخ نفاد المخزون المتوقَّع: ${item.stockOutDate || 'غير معروف'}.`;

  const systemPrompt = isEn
    ? "You are an inventory management assistant for a hospital ERP system, writing a short plain-language note (1-3 sentences) about a stock item's consumption trend for a warehouse clerk, based only on the statistics given. Do not invent facts not present in the data. Respond ONLY with valid JSON matching the exact schema requested — no markdown, no extra text."
    : 'أنت مساعد إدارة مخزون بنظام مستشفى إلكتروني، تكتب ملاحظة قصيرة بلغة بسيطة (1-3 جمل) عن اتجاه استهلاك صنف مخزون لموظف المستودع، بالاعتماد فقط على الإحصاءات المُعطاة. لا تختلق حقائق غير موجودة بالبيانات. أجب فقط بصيغة JSON صالحة مطابقة تماماً للمخطط المطلوب — بدون Markdown وبدون أي نص إضافي خارج الـ JSON.';

  const userPrompt = isEn
    ? `${detail}\n\nRespond with JSON only: {"note":"..."}`
    : `${detail}\n\nأجب بصيغة JSON فقط: {"note":"..."}`;

  return { systemPrompt, userPrompt };
}

// ملاحظة اختيارية بلغة بسيطة عن اتجاه استهلاك صنف واحد مُحلَّل مسبقاً (item
// = أحد عناصر predictions الراجعة من predictInventory، بشرط available:true)
// — لا تُستدعى تلقائياً لكل النتائج، فقط عند طلب المستخدم صراحة لصنف محدَّد.
// predictInventory لا يعتمد عليها إطلاقاً ولا يستدعيها أبداً.
async function explainTrend(item, lang, mode) {
  const { systemPrompt, userPrompt } = buildTrendNotePrompts(lang, item || {});
  const aiResult = await routeTextCall('inventoryPrediction', systemPrompt, userPrompt, mode);
  if (aiResult.available) {
    const parsed = aiResult.parsed || {};
    return { available: true, provider: aiResult.provider, note: parsed.note || null };
  }
  if (aiResult.error) console.error(`⚠️  [inventory-prediction-agent] فشل استدعاء ${aiResult.provider}:`, aiResult.error);
  return { available: false };
}

module.exports = { predictInventory, explainTrend, calcConsumption, normalizeName, DEFAULT_REORDER_BUFFER_DAYS };
