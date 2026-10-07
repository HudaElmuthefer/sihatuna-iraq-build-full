// server/utils/credentialsCrypto.js
// تشفير/فك تشفير بيانات اعتماد بوابات الدفع (API keys/secrets) قبل تخزينها بالجدول
// يستخدم AES-256-GCM. المفتاح يجب أن يكون بمتغير بيئة سري (32 بايت / 64 حرف hex)
//
// ملاحظة أمان مهمة: لا تخزّن CREDENTIALS_ENCRYPTION_KEY داخل الكود أو المستودع.
// أضفه بملف .env (غير مرفوع لـ GitHub) — مثال توليد مفتاح:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const DEFAULT_KEY_HEX = '0'.repeat(64); // مفتاح كله أصفار — معروف للجميع، لا يصلح كمفتاح فعلي أبداً
const KEY_HEX = process.env.CREDENTIALS_ENCRYPTION_KEY || DEFAULT_KEY_HEX;
const KEY = Buffer.from(KEY_HEX, 'hex');

// ── إصلاح أمني ────────────────────────────────────────────────────────────────
// قبل هذا التعديل، كان المفتاح يرجع صامتاً لقيمة كلها أصفار لو .env ما يحدّده،
// بدون أي تحذير — يعني بيانات اعتماد بوابات الدفع (مفاتيح API حساسة) كانت
// "مشفّرة" فعلياً بمفتاح معروف مسبقاً لأي شخص يطّلع على الكود، أي بلا حماية
// حقيقية. نفس منطق التحذير المستخدم مع JWT_SECRET بملف server.js.
if (KEY_HEX === DEFAULT_KEY_HEX) {
  console.error('\n╔════════════════════════════════════════════════════════════════╗');
  console.error('║  ⚠️  تحذير أمان خطير: مفتاح تشفير بيانات الدفع الافتراضي مستخدم!  ║');
  console.error('╚════════════════════════════════════════════════════════════════╝');
  console.error('  CREDENTIALS_ENCRYPTION_KEY غير محدَّد بملف .env، فبيانات اعتماد');
  console.error('  بوابات الدفع (مفاتيح API) "مشفَّرة" بمفتاح معروف للجميع (كله أصفار)،');
  console.error('  أي شخص يستطيع فك تشفيرها لو وصل لقاعدة البيانات.');
  console.error('  أضف CREDENTIALS_ENCRYPTION_KEY بملف backend/.env بقيمة عشوائية قوية.');
  console.error('  توليد مفتاح صالح: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ تم إيقاف التشغيل لأن NODE_ENV=production والمفتاح الافتراضي لا يزال مستخدماً.\n');
    process.exit(1);
  }
}

function encryptCredentials(credentialsObject) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(credentialsObject), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // نخزن iv + authTag + ciphertext كـ Buffer واحد
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptCredentials(buffer) {
  if (!buffer) return {};
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

module.exports = { encryptCredentials, decryptCredentials };
