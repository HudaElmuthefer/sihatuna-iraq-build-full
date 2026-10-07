// server/controllers/paymentSettingsController.js
// شاشة الإدمن: اختيار وتفعيل بوابات الدفع + إدخال بيانات الاعتماد
const { query } = require('../config/database');
const { encryptCredentials } = require('../utils/credentialsCrypto');
const { getDefaultHospitalId } = require('../config/defaultHospital');

// GET /api/admin/payment-providers  -> كل البوابات المتاحة بالنظام (المرجع الثابت)
async function listAllProviders(req, res) {
  const result = await query('SELECT * FROM payment_providers ORDER BY provider_type, name_en');
  res.json(result.rows);
}

// GET /api/admin/payment-gateways -> إعدادات المنشأة الحالية
async function listHospitalGateways(req, res) {
  const hospitalId = await getDefaultHospitalId();
  const result = await query(
    `SELECT hpg.id, hpg.provider_code, pp.name_ar, pp.name_en, pp.provider_type,
            hpg.is_active, hpg.is_sandbox, hpg.display_order, hpg.extra_config,
            (hpg.credentials_encrypted IS NOT NULL) AS has_credentials
     FROM hospital_payment_gateways hpg
     JOIN payment_providers pp ON pp.code = hpg.provider_code
     WHERE hpg.hospital_id = $1
     ORDER BY hpg.display_order`,
    [hospitalId]
  );
  res.json(result.rows);
}

// POST /api/admin/payment-gateways
// body: { providerCode, isActive, isSandbox, credentials: {...}, extraConfig: {...}, displayOrder }
async function upsertHospitalGateway(req, res) {
  const hospitalId = await getDefaultHospitalId();
  const { providerCode, isActive, isSandbox, credentials, extraConfig, displayOrder } = req.body;
  const userId = req.user?.id || null; // يفترض وجود middleware مصادقة يضع req.user

  if (!providerCode) {
    return res.status(400).json({ message: 'providerCode مطلوب' });
  }

  const encrypted = credentials && Object.keys(credentials).length > 0
    ? encryptCredentials(credentials)
    : null;

  const result = await query(
    `INSERT INTO hospital_payment_gateways
       (hospital_id, provider_code, is_active, is_sandbox, credentials_encrypted, extra_config, display_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (hospital_id, provider_code)
     DO UPDATE SET
       is_active = EXCLUDED.is_active,
       is_sandbox = EXCLUDED.is_sandbox,
       credentials_encrypted = COALESCE(EXCLUDED.credentials_encrypted, hospital_payment_gateways.credentials_encrypted),
       extra_config = EXCLUDED.extra_config,
       display_order = EXCLUDED.display_order,
       updated_at = now()
     RETURNING id, provider_code, is_active, is_sandbox, display_order`,
    [hospitalId, providerCode, !!isActive, !!isSandbox, encrypted, extraConfig || {}, displayOrder || 0, userId]
  );

  res.json(result.rows[0]);
}

// DELETE /api/admin/payment-gateways/:providerCode
async function deactivateGateway(req, res) {
  const hospitalId = await getDefaultHospitalId();
  const { providerCode } = req.params;
  await query(
    `UPDATE hospital_payment_gateways SET is_active = FALSE, updated_at = now()
     WHERE hospital_id = $1 AND provider_code = $2`,
    [hospitalId, providerCode]
  );
  res.json({ success: true });
}

module.exports = {
  listAllProviders,
  listHospitalGateways,
  upsertHospitalGateway,
  deactivateGateway,
};
