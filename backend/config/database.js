// server/config/database.js
// اتصال PostgreSQL عبر مكتبة pg (خفيفة، بدون ORM ثقيل، متوافقة مع النمط الحالي للمشروع)
// ثبّت المكتبة أولاً: npm install pg

// يجب أن نحمّل .env هنا مباشرة (وليس الاعتماد على أن server.js حمّله قبلنا) — بملفات
// الاختبار (tests/testUtils.js)، هذا الملف يُستورَد قبل require('../server')،
// فلو انتظرنا dotenv.config() من server.js، الـ Pool تحته يتبنى فعلياً بكلمة
// مرور فارغة (القيمة الافتراضية) بدل القيمة الحقيقية من .env — لأن إعدادات
// pg.Pool تُلتقط لحظة الإنشاء، وليس بشكل كسول لاحق.
require('dotenv').config();
const { Pool, types } = require('pg');

// Fix DATE column timezone shift at the source: by default, node-postgres
// parses SQL DATE columns (OID 1082) into a JS Date object at local
// midnight. When that Date object is later serialized via JSON.stringify
// (res.json), it converts to UTC via toISOString(), which shifts the
// calendar date backward by a day for any timezone ahead of UTC (Iraq is
// UTC+3) — e.g. a stored "2026-07-15" would round-trip through the API as
// "2026-07-14T21:00:00.000Z". Registering this parser makes DATE columns
// come back as the raw "YYYY-MM-DD" string instead, skipping the Date/
// timezone conversion entirely. This only affects how values are READ back
// from a query result — it has no effect on INSERT/UPDATE, which already
// send plain date strings as query parameters.
types.setTypeParser(types.builtins.DATE, (value) => value);

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'sihatuna_iraq',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected connection error:', err);
});

// ── تحسين تشغيل: فحص اتصال مبكر وواضح ────────────────────────────────────────
// قبل هذا، لو PostgreSQL لا يعمل أو بيانات الاتصال بـ.env خاطئة، الخادم كان
// يقلع بصمت وكأن كل شيء تمام — والمشكلة تظهر فقط لاحقاً كخطأ 503 غامض بأول
// طلب فعلي من المستخدم (بالضبط الالتباس الذي واجهناه فعلياً أثناء تشخيص
// مشاكل سابقة). هذه الدالة تختبر الاتصال فوراً عند الإقلاع وتطبع رسالة عربية
// واضحة بالمشكلة والحل، بدل ترك المستخدم يكتشفها صدفة بمنتصف استخدامه للنظام.
async function testConnection() {
  try {
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}

// دالة مساعدة موحّدة للاستعلامات (يمكن استخدامها بكل الملفات بدل تكرار pool.query)
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('[PG QUERY]', { text, duration, rows: res.rowCount });
  }
  return res;
}

module.exports = { pool, query, testConnection };
