// backend/config/defaultHospital.js
//
// المخطط الأصلي (postgres_schema.sql) مصمَّم لدعم أكثر من مستشفى (Multi-tenant)
// بجدول "hospitals"، وهذا مفيد لو النظام يُباع لعدة جهات مستقبلاً. لكن حالياً
// عندك منشأة واحدة فقط، فلا داعي لتعقيد الواجهة بطلب اختيار مستشفى في كل مرة.
//
// هذه الدالة تضمن وجود سجل مستشفى افتراضي واحد بقاعدة البيانات (تُنشئه أول
// مرة فقط لو ما كان موجوداً)، وتُعيد معرّفه (id) — يُستخدم هذا المعرّف داخلياً
// بكل مسارات بوابات الدفع وCRM بدل ما نطلب من المستخدم اختيار مستشفى يدوياً.
// النتيجة تُخزَّن بذاكرة العملية (cache) بعد أول استدعاء، فلا تتكرر القراءة
// من قاعدة البيانات بكل طلب.
const { pool } = require('./database');

let cachedHospitalId = null;

async function getDefaultHospitalId() {
  if (cachedHospitalId) return cachedHospitalId;

  const existing = await pool.query('SELECT id FROM hospitals ORDER BY created_at ASC LIMIT 1');
  if (existing.rows.length > 0) {
    cachedHospitalId = existing.rows[0].id;
    return cachedHospitalId;
  }

  const inserted = await pool.query(
    `INSERT INTO hospitals (name_ar, name_en) VALUES ($1, $2) RETURNING id`,
    ['المنشأة الرئيسية', 'Main Facility']
  );
  cachedHospitalId = inserted.rows[0].id;
  console.log(`🏥 تم إنشاء سجل المنشأة الافتراضي تلقائياً (id=${cachedHospitalId})`);
  return cachedHospitalId;
}

module.exports = { getDefaultHospitalId };
