// backend/agents/billingAnomalyAgent.js
//
// كشف القيم المتطرفة بالمشتريات/الفوترة — تحليل إحصائي حتمي بحت (لا
// استدعاء AI بالكشف الأساسي إطلاقاً؛ هذه أداة مالية/إدارية، ليست سريرية،
// ويجب أن تبقى سريعة وحتمية وقابلة للتفسير الكامل بمجرد رقمين: المتوسط
// والانحراف المعياري). شرح AI اختياري بلغة بسيطة يُطلَب لاحقاً لكل عنصر
// مُعلَّم على حدة (راجع explainAnomaly أدناه) — لا يشارك إطلاقاً بقرار
// التعليم نفسه، ولا يُستدعى تلقائياً لأي نتيجة.
//
// ثلاث قواعد كشف (راجع migrations/procurement — 800 أمر شراء حقيقي، بيانات
// SCMS التاريخية):
//   1) vendor_price_outlier     — سعر وحدة أمر الشراء أعلى من متوسط نفس
//      المورد+الفئة بأكثر من STDDEV_THRESHOLD انحراف معياري.
//   2) duplicate_invoice        — نفس المورد + نفس المبلغ الإجمالي + تاريخ
//      قريب (خلال DUPLICATE_WINDOW_DAYS يوماً) من أمر شراء آخر.
//   3) category_price_deviation — سعر الوحدة أعلى من متوسط نفس الفئة عبر
//      كل الموردين بأكثر من STDDEV_THRESHOLD انحراف معياري.
//
// ── ملاحظتان بنيويتان مهمتان (راجعهما قبل تعديل أي عتبة) ────────────────────
// سعر الوحدة = totalAmount / items (عدد الأصناف بالأمر). البيانات الحقيقية
// لا تحمل سعراً لكل صنف منفرد، فقط إجمالي الأمر وعدد أصنافه — المقارنة على
// الإجمالي الخام مباشرة كانت ستُعلِّم أي أمر بعدد أصناف كبير كـ"مرتفع السعر"
// زوراً بلا علاقة فعلية بالسعر الفعلي.
// الفئة نفسها مُشتقّة من الجزء الأول بحقل "title" قبل "—" (مثال:
// "Pediatric — 4 صنف" ← الفئة "Pediatric") — لا يوجد حقل category منفصل
// بالبيانات الحقيقية؛ تحقّقنا يدوياً إن هذا الجزء يمثّل فعلاً تصنيفاً
// طبياً حقيقياً بالبيانات (Adult/Pediatric/HIV test/HIV test - Ancillary/
// Malaria/ACT)، وليس نصاً عشوائياً.
const { query } = require('../config/database');
const { routeTextCall } = require('../utils/aiProviderRouter');

const STDDEV_THRESHOLD = 2;
const DUPLICATE_WINDOW_DAYS = 3;
const MIN_GROUP_SIZE_VENDOR = 3;   // أقل عدد أوامر لمورد+فئة قبل اعتبار متوسطها ذا معنى إحصائياً
const MIN_GROUP_SIZE_CATEGORY = 5; // نفس الفكرة لمتوسط الفئة عبر كل الموردين

function categoryOf(title) {
  const parts = (title || '').split('—');
  return (parts[0] || '').trim() || null;
}

function meanStd(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0, n };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance), n };
}

function daysBetween(d1, d2) {
  const t1 = new Date(d1).getTime();
  const t2 = new Date(d2).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return Infinity;
  return Math.abs(t1 - t2) / (1000 * 60 * 60 * 24);
}

// يجلب كل سجلات procurement (بحدود منشأة المستخدم لو النظام متعدد المنشآت)
// ويطبِّعها لشكل موحَّد جاهز للتحليل — يستبعد أي سجل بلا مبلغ/مورد/فئة/تاريخ
// صالح (لا معنى لتحليله إحصائياً، وليس خطأً يستحق فشل الطلب كاملاً).
async function loadNormalizedRecords(hospitalId) {
  const conditions = [];
  const params = [];
  if (hospitalId) { params.push(hospitalId); conditions.push(`data->>'hospitalId' = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(`SELECT id, data FROM procurement ${where}`, params);

  return result.rows
    .map(row => {
      const d = row.data || {};
      const totalAmount = Number(d.totalAmount);
      const items = Number(d.items) || 1;
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) return null;
      return {
        id: row.id,
        poNo: d.poNo || null,
        supplier: (d.supplier || '').trim(),
        title: d.title || '',
        category: categoryOf(d.title),
        date: d.date || null,
        totalAmount,
        items,
        unitPrice: totalAmount / items,
      };
    })
    .filter(r => r && r.supplier && r.category && r.date);
}

// القاعدتان 1 و3 (نفس المنطق، مجموعة مختلفة فقط): يُعلِّم أي سجل بمجموعته
// (مورد+فئة، أو فئة وحدها) لو سعر وحدته أعلى من متوسط مجموعته بأكثر من
// STDDEV_THRESHOLD انحراف معياري. مجموعات صغيرة جداً (أقل من minGroupSize)
// تُتجاهَل — متوسط 1-2 قيمة فقط ليس ذا معنى إحصائي.
function detectPriceOutliers(records, groupKeyFn, minGroupSize, type) {
  const groups = new Map();
  records.forEach(r => {
    const key = groupKeyFn(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  const flags = [];
  groups.forEach(group => {
    if (group.length < minGroupSize) return;
    const { mean, std } = meanStd(group.map(g => g.unitPrice));
    if (std === 0) return; // كل الأسعار متطابقة تماماً — لا انحراف يُقاس
    group.forEach(r => {
      const zScore = (r.unitPrice - mean) / std;
      if (zScore > STDDEV_THRESHOLD) {
        flags.push({
          type, recordId: r.id, poNo: r.poNo, supplier: r.supplier, title: r.title, category: r.category,
          date: r.date, amount: r.totalAmount,
          unitPrice: Math.round(r.unitPrice * 100) / 100,
          groupMean: Math.round(mean * 100) / 100,
          groupStd: Math.round(std * 100) / 100,
          zScore: Math.round(zScore * 100) / 100,
          groupSize: group.length,
        });
      }
    });
  });
  return flags;
}

// القاعدة 2: نفس المورد + نفس المبلغ + تاريخ قريب (بأي اتجاه) من سجل آخر —
// كل سجل يُعلَّم مرة واحدة كحد أقصى بهذه القاعدة حتى لو تطابق مع أكثر من
// سجل آخر (يكفي لفت الانتباه له مرة، لا تكرار الشارة). المجموعة تُرتَّب
// بالتاريخ أولاً حتى تصح خطوة break المبكرة (أي فجوة تتجاوز النافذة تعني كل
// ما بعدها بالترتيب أبعد أيضاً).
function detectDuplicates(records) {
  const groups = new Map();
  records.forEach(r => {
    const key = `${r.supplier}|${r.totalAmount}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  const flags = [];
  groups.forEach(group => {
    if (group.length < 2) return;
    const sorted = [...group].sort((a, b) => new Date(a.date) - new Date(b.date));
    const flaggedIds = new Set();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const gap = daysBetween(sorted[i].date, sorted[j].date);
        if (gap > DUPLICATE_WINDOW_DAYS) break;
        [[sorted[i], sorted[j]], [sorted[j], sorted[i]]].forEach(([self, other]) => {
          if (flaggedIds.has(self.id)) return;
          flaggedIds.add(self.id);
          flags.push({
            type: 'duplicate_invoice', recordId: self.id, poNo: self.poNo, supplier: self.supplier,
            title: self.title, category: self.category, date: self.date, amount: self.totalAmount,
            matchedPoNo: other.poNo, matchedDate: other.date,
            daysApart: Math.round(gap * 10) / 10,
          });
        });
      }
    }
  });
  return flags;
}

// التحليل الكامل — حتمي بالكامل، بلا أي استدعاء AI. يُعيد كل السجلات
// المُعلَّمة (سجل واحد قد يحمل أكثر من سبب معاً) مع إحصاءات عامة.
async function detectAnomalies(hospitalId) {
  const records = await loadNormalizedRecords(hospitalId);
  if (records.length === 0) {
    return { available: true, totalRecordsAnalyzed: 0, totalFlagged: 0, flaggedRecords: [], generatedAt: new Date().toISOString() };
  }

  const allFlags = [
    ...detectPriceOutliers(records, r => `${r.supplier}|${r.category}`, MIN_GROUP_SIZE_VENDOR, 'vendor_price_outlier'),
    ...detectPriceOutliers(records, r => r.category, MIN_GROUP_SIZE_CATEGORY, 'category_price_deviation'),
    ...detectDuplicates(records),
  ];

  // تجميع كل الأسباب لنفس السجل معاً بدل صف منفصل لكل سبب.
  const byRecord = new Map();
  allFlags.forEach(f => {
    const { type, recordId, poNo, supplier, title, category, date, amount, ...reasonFields } = f;
    if (!byRecord.has(recordId)) {
      byRecord.set(recordId, { recordId, poNo, supplier, title, category, date, amount, reasons: [] });
    }
    byRecord.get(recordId).reasons.push({ type, ...reasonFields });
  });

  const flaggedRecords = [...byRecord.values()].sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    available: true,
    totalRecordsAnalyzed: records.length,
    totalFlagged: flaggedRecords.length,
    flaggedRecords,
    generatedAt: new Date().toISOString(),
  };
}

function buildExplainPrompts(lang, item) {
  const isEn = lang === 'en';
  const reasonsText = (item.reasons || []).map(r => r.type).join(', ');
  const detail = isEn
    ? `Purchase order ${item.poNo || item.recordId} from supplier "${item.supplier}", item category "${item.category}", amount ${item.amount}, date ${item.date}. Flagged reasons: ${reasonsText}. Details: ${JSON.stringify(item.reasons)}.`
    : `أمر الشراء ${item.poNo || item.recordId} من المورد "${item.supplier}"، فئة الصنف "${item.category}"، المبلغ ${item.amount}، التاريخ ${item.date}. أسباب التعليم: ${reasonsText}. التفاصيل: ${JSON.stringify(item.reasons)}.`;

  const systemPrompt = isEn
    ? 'You are a financial auditor assistant for a hospital ERP system, explaining a statistically-flagged procurement outlier value in plain, non-technical language for an accounts clerk. Use the term "outlier value" (not "anomaly") when referring to it. Be concise (2-4 sentences). Do not invent facts not present in the data given. Respond ONLY with valid JSON matching the exact schema requested — no markdown, no extra text.'
    : 'أنت مساعد تدقيق مالي بنظام مستشفى إلكتروني، تشرح قيمة متطرفة (outlier) بأمر شراء تم كشفها إحصائياً، بلغة بسيطة غير تقنية لموظف حسابات. استخدم مصطلح "القيمة المتطرفة" تحديداً (وليس "الشاذة") عند الإشارة إليها. كن مختصراً (2-4 جمل). لا تختلق حقائق غير موجودة بالبيانات المُعطاة. أجب فقط بصيغة JSON صالحة مطابقة تماماً للمخطط المطلوب — بدون Markdown وبدون أي نص إضافي خارج الـ JSON.';

  const userPrompt = isEn
    ? `${detail}\n\nRespond with JSON only: {"explanation":"..."}`
    : `${detail}\n\nأجب بصيغة JSON فقط: {"explanation":"..."}`;

  return { systemPrompt, userPrompt };
}

// شرح اختياري بلغة بسيطة لعنصر واحد مُعلَّم مسبقاً (item = أحد عناصر
// flaggedRecords الراجعة من detectAnomalies) — لا يُستدعى تلقائياً لكل
// النتائج (قد تكون عشرات لكل تحليل)، فقط عند طلب المستخدم صراحة لعنصر
// محدَّد بالواجهة. detectAnomalies لا يعتمد عليه إطلاقاً ولا يستدعيه أبداً.
async function explainAnomaly(item, lang, mode) {
  const { systemPrompt, userPrompt } = buildExplainPrompts(lang, item || {});
  const aiResult = await routeTextCall('billingAnomaly', systemPrompt, userPrompt, mode);
  if (aiResult.available) {
    const parsed = aiResult.parsed || {};
    return { available: true, provider: aiResult.provider, explanation: parsed.explanation || null };
  }
  if (aiResult.error) console.error(`⚠️  [billing-anomaly-agent] فشل استدعاء ${aiResult.provider}:`, aiResult.error);
  return { available: false };
}

module.exports = { detectAnomalies, explainAnomaly, categoryOf, meanStd };
