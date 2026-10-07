// backend/utils/revenueAggregation.js
//
// تجميع كل الإيرادات الحقيقية للمستشفى من مصادرها الفعلية بدل إدخال يدوي
// مكرَّر — يُستخدَم من routes/revenueRoutes.js (تبويب "الإيرادات") و
// routes/profitSharingRoutes.js (حساب مستحقات المستفيدين). أي تعديل هنا
// ينعكس تلقائياً على الاثنين معاً.
//
// ── لماذا invoices لا payments لمصدر "مريض" ─────────────────────────────────
// جدول payments (بوابات الدفع الإلكترونية) يُخزَّن دائماً بـhospital_id يساوي
// getDefaultHospitalId() (راجع config/defaultHospital.js وcontrollers/
// paymentController.js) — أول منشأة أُنشئت بقاعدة البيانات، بغض النظر تماماً
// عن منشأة الفاتورة/المريض الفعلية. هذا اختصار متعمَّد بمرحلة تطوير سابقة
// افترضت منشأة واحدة فقط، ولم يُحدَّث بعد لدعم تعدد المنشآت — الاعتماد عليه
// هنا سيُسنِد كل دفعات كل المنشآت خطأً للمنشأة الأولى. جدول invoices مُقسَّم
// فعلياً وبشكل صحيح (hospitalScoped عبر pgCrud.js)، ومسارا الدفع اليدوي
// والإلكتروني كلاهما (AppContext.js: payInvoice/processPayment) ينتهيان
// بتحديث نفس سجل الفاتورة لـstatus:'paid' — فهو المصدر الموثوق للاثنين معاً.
const { query } = require('../config/database');

// شرط منشأة موحَّد: لو hospitalId فارغ (إدمن عام يشاهد كل المنشآت) لا نُصفّي
// إطلاقاً؛ وإلا نطابق data->>'hospitalId' بنفس التعبير المستخدَم حرفياً
// بـpgCrud.js لكل الموديولات hospitalScoped الأخرى، حفاظاً على تناسق العزل.
function buildHospitalCondition(hospitalId, params) {
  if (!hospitalId) return '';
  params.push(hospitalId);
  return ` AND data->>'hospitalId' = $${params.length}`;
}

function buildDateConditions(dateExpr, from, to, params) {
  let sql = '';
  if (from) {
    params.push(from);
    sql += ` AND ${dateExpr} >= $${params.length}::date`;
  }
  if (to) {
    params.push(to);
    sql += ` AND ${dateExpr} <= $${params.length}::date`;
  }
  return sql;
}

async function getPatientRevenueRows({ hospitalId, from, to }) {
  const params = [];
  const hospCond = buildHospitalCondition(hospitalId, params);
  const dateExpr = `COALESCE((data->>'paidAt')::timestamptz, updated_at)::date`;
  const dateCond = buildDateConditions(dateExpr, from, to, params);
  const res = await query(
    `SELECT id, total AS amount, ${dateExpr} AS date, patient_id AS patient_id
     FROM invoices
     WHERE status = 'paid'${hospCond}${dateCond}
     ORDER BY ${dateExpr} DESC`,
    params
  );
  return res.rows.map(r => ({
    id: `INV-${r.id}`,
    source: 'patient',
    amount: Number(r.amount) || 0,
    date: r.date,
    ref: `INV-${r.id}`,
  }));
}

async function getPharmacyRevenueRows({ hospitalId, from, to }) {
  const params = [];
  const hospCond = buildHospitalCondition(hospitalId, params);
  const dateExpr = `COALESCE(NULLIF(data->>'date','')::date, updated_at::date)`;
  const dateCond = buildDateConditions(dateExpr, from, to, params);
  const res = await query(
    `SELECT id, (data->>'totalCost')::numeric AS amount, ${dateExpr} AS date
     FROM pharmacy_orders
     WHERE status = 'dispensed'${hospCond}${dateCond}
     ORDER BY ${dateExpr} DESC`,
    params
  );
  return res.rows.map(r => ({
    id: `RX-${r.id}`,
    source: 'pharmacy',
    amount: Number(r.amount) || 0,
    date: r.date,
    ref: `RX-${r.id}`,
  }));
}

async function getOtherRevenueRows({ hospitalId, from, to }) {
  const params = [];
  const hospCond = buildHospitalCondition(hospitalId, params);
  const dateExpr = `COALESCE(NULLIF(data->>'date','')::date, updated_at::date)`;
  const dateCond = buildDateConditions(dateExpr, from, to, params);
  const res = await query(
    // GeneralTab.js's TX_TYPE_ALIASES: bulk-imported legacy rows use the
    // Arabic literal 'دخل' instead of 'income' for the same meaning.
    `SELECT id, (data->>'amount')::numeric AS amount, ${dateExpr} AS date, data->>'ref' AS ref
     FROM transactions
     WHERE data->>'category' = 'revenue' AND data->>'type' IN ('income','دخل')${hospCond}${dateCond}
     ORDER BY ${dateExpr} DESC`,
    params
  );
  return res.rows.map(r => ({
    id: `TXN-${r.id}`,
    source: 'other',
    amount: Number(r.amount) || 0,
    date: r.date,
    ref: r.ref || `TXN-${r.id}`,
  }));
}

// { hospitalId, from, to } — hospitalId فارغ = بلا تصفية منشأة (إدمن عام).
// from/to بصيغة 'YYYY-MM-DD'، اختياريان (بلا أي منهما = كل الفترة).
async function getRevenue({ hospitalId, from, to } = {}) {
  const [patientRows, pharmacyRows, otherRows] = await Promise.all([
    getPatientRevenueRows({ hospitalId, from, to }),
    getPharmacyRevenueRows({ hospitalId, from, to }),
    getOtherRevenueRows({ hospitalId, from, to }),
  ]);
  const rows = [...patientRows, ...pharmacyRows, ...otherRows].sort((a, b) => (a.date < b.date ? 1 : -1));
  const bySource = {
    patient: patientRows.reduce((s, r) => s + r.amount, 0),
    pharmacy: pharmacyRows.reduce((s, r) => s + r.amount, 0),
    other: otherRows.reduce((s, r) => s + r.amount, 0),
  };
  const totalRevenue = bySource.patient + bySource.pharmacy + bySource.other;
  return { rows, totalRevenue, bySource };
}

module.exports = { getRevenue };
