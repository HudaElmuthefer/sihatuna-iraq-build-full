// server/services/paymentGatewayService.js
// النقطة المركزية: تقرأ إعدادات البوابة المفعّلة من جدول hospital_payment_gateways
// (الذي يحدده الإدمن)، تفك تشفير الـ credentials، وتنادي الـ Adapter المناسب.
// إضافة بوابة جديدة مستقبلاً = سطر واحد بـ ADAPTER_REGISTRY + ملف Adapter جديد.

const { query } = require('../config/database');
const { decryptCredentials } = require('../utils/credentialsCrypto');

const CashAdapter = require('./gateways/CashAdapter');
const ZainCashAdapter = require('./gateways/ZainCashAdapter');
const FastPayAdapter = require('./gateways/FastPayAdapter');
const QiCardAdapter = require('./gateways/QiCardAdapter');
const BankCardAdapter = require('./gateways/BankCardAdapter');
const PayPalAdapter = require('./gateways/PayPalAdapter');
const WesternUnionAdapter = require('./gateways/WesternUnionAdapter');

const ADAPTER_REGISTRY = {
  cash: CashAdapter,
  zaincash: ZainCashAdapter,
  fastpay: FastPayAdapter,
  qicard: QiCardAdapter,
  bank_card: BankCardAdapter,
  paypal: PayPalAdapter,
  western_union: WesternUnionAdapter,
};

// يقرأ بيانات اعتماد كل بوابة من ملف .env (المكان البسيط الموصى به)
// راجع التعليق "💳 اكتب بيانات بوابة الدفع هنا" في ملف backend/.env
function _credentialsFromEnv(providerCode) {
  const map = {
    zaincash:  { merchant_id: process.env.ZAINCASH_MERCHANT_ID, secret_key: process.env.ZAINCASH_SECRET_KEY },
    fastpay:   { merchant_id: process.env.FASTPAY_MERCHANT_ID, api_key: process.env.FASTPAY_API_KEY },
    qicard:    { terminal_id: process.env.QICARD_TERMINAL_ID, api_key: process.env.QICARD_API_KEY },
    bank_card: { gateway_url: process.env.BANK_CARD_GATEWAY_URL, merchant_id: process.env.BANK_CARD_MERCHANT_ID, api_key: process.env.BANK_CARD_API_KEY },
    paypal:    { client_id: process.env.PAYPAL_CLIENT_ID, client_secret: process.env.PAYPAL_CLIENT_SECRET },
    cash: {},
    western_union: {},
  };
  return map[providerCode] || {};
}

// يتحقق هل تم تعبئة بيانات بوابة معينة فعلياً في ملف .env (وليست فارغة)
function isProviderConfigured(providerCode) {
  const creds = _credentialsFromEnv(providerCode);
  const values = Object.values(creds);
  if (values.length === 0) return true; // بوابات مثل cash/western_union لا تحتاج مفاتيح
  return values.every(v => v && v.trim() !== '');
}

/**
 * يرجع كل بوابات الدفع المفعّلة لمستشفى معين (لعرضها بشاشة الدفع للمريض/الكاشير)
 */
async function getActiveGatewaysForHospital(hospitalId) {
  const result = await query(
    `SELECT hpg.provider_code, pp.name_ar, pp.name_en, pp.provider_type, hpg.display_order
     FROM hospital_payment_gateways hpg
     JOIN payment_providers pp ON pp.code = hpg.provider_code
     WHERE hpg.hospital_id = $1 AND hpg.is_active = TRUE
     ORDER BY hpg.display_order ASC`,
    [hospitalId]
  );
  return result.rows;
}

/**
 * يبني Adapter جاهز للاستخدام لبوابة معينة بمستشفى معين
 */
async function _buildAdapter(hospitalId, providerCode) {
  const AdapterClass = ADAPTER_REGISTRY[providerCode];
  if (!AdapterClass) {
    throw new Error(`لا يوجد Adapter مسجّل لبوابة "${providerCode}"`);
  }

  // المصدر الأساسي والبسيط: ملف .env (راجع "💳 اكتب بيانات بوابة الدفع هنا")
  const envCredentials = _credentialsFromEnv(providerCode);
  const hasEnvCredentials = Object.keys(envCredentials).length === 0 || Object.values(envCredentials).some(v => v && v.trim() !== '');

  if (hasEnvCredentials) {
    return new AdapterClass(envCredentials, { isSandbox: process.env.NODE_ENV !== 'production' });
  }

  // مصدر متقدم اختياري: قاعدة بيانات PostgreSQL مشفّرة (إن كانت مفعّلة)
  const result = await query(
    `SELECT * FROM hospital_payment_gateways
     WHERE hospital_id = $1 AND provider_code = $2 AND is_active = TRUE`,
    [hospitalId, providerCode]
  );
  if (result.rowCount === 0) {
    throw new Error(`بوابة الدفع "${providerCode}" غير مُعدّة — عبّ بياناتها بملف backend/.env`);
  }
  const row = result.rows[0];
  const credentials = row.credentials_encrypted ? decryptCredentials(row.credentials_encrypted) : {};
  return new AdapterClass(credentials, { isSandbox: row.is_sandbox, ...row.extra_config });
}

/**
 * يبدأ عملية دفع جديدة ويسجلها بجدول payments بحالة pending
 */
async function initiatePayment({ hospitalId, invoiceId, patientId, providerCode, amount, currency, metadata, userId }) {
  const adapter = await _buildAdapter(hospitalId, providerCode);
  const result = await adapter.initPayment({ amount, currency, invoiceId, patientId, metadata });

  if (!result.success) {
    throw new Error(result.error || 'فشل بدء عملية الدفع');
  }

  const insertResult = await query(
    `INSERT INTO payments
       (hospital_id, invoice_id, patient_id, provider_code, amount, currency, status, gateway_transaction_id, processed_by)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8)
     RETURNING *`,
    [hospitalId, invoiceId, patientId, providerCode, amount, currency, result.gatewayTransactionId, userId]
  );

  return { payment: insertResult.rows[0], redirectUrl: result.redirectUrl };
}

/**
 * يتحقق من حالة دفعة معينة عبر البوابة، ويحدّث السجل محلياً
 */
async function verifyAndUpdatePayment(paymentId) {
  const paymentRes = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
  if (paymentRes.rowCount === 0) throw new Error('عملية الدفع غير موجودة');
  const payment = paymentRes.rows[0];

  const adapter = await _buildAdapter(payment.hospital_id, payment.provider_code);
  const verification = await adapter.verifyPayment(payment.gateway_transaction_id);

  const updateRes = await query(
    `UPDATE payments SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [verification.status, paymentId]
  );

  // إذا اكتمل الدفع بالكامل، حدّث حالة الفاتورة تلقائياً
  if (verification.status === 'completed') {
    await query(
      `UPDATE invoices SET status = 'paid', updated_at = now()
       WHERE id = $1 AND total <= (
         SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id = $1 AND status = 'completed'
       )`,
      [payment.invoice_id]
    );
  }

  return updateRes.rows[0];
}

/**
 * تأكيد يدوي (يُستخدم لبوابات مثل Western Union أو الحوالات البنكية)
 */
async function manuallyConfirmPayment(paymentId, referenceNote, userId) {
  const result = await query(
    `UPDATE payments
     SET status = 'completed', reference_note = $1, processed_by = $2, updated_at = now()
     WHERE id = $3 RETURNING *`,
    [referenceNote, userId, paymentId]
  );
  if (result.rowCount === 0) throw new Error('عملية الدفع غير موجودة');

  const payment = result.rows[0];
  await query(
    `UPDATE invoices SET status = 'paid', updated_at = now()
     WHERE id = $1 AND total <= (
       SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id = $1 AND status = 'completed'
     )`,
    [payment.invoice_id]
  );
  return payment;
}

module.exports = {
  getActiveGatewaysForHospital,
  initiatePayment,
  verifyAndUpdatePayment,
  manuallyConfirmPayment,
};
