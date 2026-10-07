// backend/utils/redisService.js
//
// عميل Redis مشترك — يُستخدم بثلاثة أماكن: التخزين المؤقت (cache) لبيانات
// تُقرأ كثيراً وتتغيّر نادراً (انظر خيار options.cache بـroutes/pgCrud.js)،
// تحديد المعدل عبر عدة عمليات (config/redisRateLimitStore.js)، وإبطال
// التوكنات عند تسجيل الخروج (utils/tokenRevocation.js). عميل واحد يكفي
// لثلاثتهم (عمليات قراءة/كتابة خفيفة). البند الوحيد المستثنى هو BullMQ
// (services/queue/*) — له اتصال منفصل تماماً لأنه يحتاج إعدادات مختلفة
// جذرياً (maxRetriesPerRequest:null إلزامي من BullMQ نفسه)، راجع
// services/queue/queueConnection.js للتفاصيل.
//
// ── فلسفة التعامل مع فشل Redis: fail-open ────────────────────────────────
// Redis هنا يُحسِّن الأداء (cache) ويصحّح سلوكاً كان معطوباً أصلاً بين
// عمليات PM2 cluster mode (تحديد المعدل، إبطال التوكنات) — لكنه ليس نظاماً
// جوهرياً لعمل التطبيق (بعكس PostgreSQL). لو صار Redis غير متاح مؤقتاً
// (إعادة تشغيل، مشكلة شبكة...)، الأفضل أن يستمر النظام بالعمل (بأداء أبطأ
// قليلاً، وبحماية أضعف مؤقتاً لتحديد المعدل/إبطال التوكنات) بدل توقف كل
// تسجيلات الدخول وكل طلبات الـAPI بسبب انقطاع نظام مساعد. نفس الفلسفة
// المتّبعة بكل مكان ثاني بهذا المشروع (خادم HL7، النسخ الاحتياطي، مزوّدي
// الذكاء الاصطناعي، بوابة الدفع) — فشلها لا يُسقط الوظيفة الأساسية للنظام.
// كل دالة هنا تلتقط أخطاءها بنفسها ولا ترمي أي استثناء للمستدعي أبداً.
const Redis = require('ioredis');
const { devLog } = require('./logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let client = null;
let lastErrorLogAt = 0;
const ERROR_LOG_COOLDOWN_MS = 60 * 1000; // تحذير واحد بالدقيقة كحد أقصى، لا نُغرق السجل بتحذير لكل طلب فاشل أثناء انقطاع طويل

function logRedisError(context, err) {
  const now = Date.now();
  if (now - lastErrorLogAt < ERROR_LOG_COOLDOWN_MS) return;
  lastErrorLogAt = now;
  console.warn(`⚠️  [redis] ${context} — النظام يستمر بالعمل بدون Redis (fail-open):`, err.message);
}

function getClient() {
  if (client) return client;
  client = new Redis(REDIS_URL, {
    // فشل سريع بدل الانتظار: أفضل لواجهة HTTP من محاولات إعادة متكررة تُطيل
    // زمن استجابة كل طلب أثناء انقطاع Redis.
    maxRetriesPerRequest: 1,
    // لا نُكدّس أوامر بالذاكرة أثناء الانقطاع — تفشل فوراً فيلتقطها try/catch
    // المستدعي (fail-open)، بدل تراكم أوامر معلَّقة قد تُنفَّذ كلها دفعة واحدة
    // لاحقاً عند عودة الاتصال (سلوك غير متوقَّع لطلبات HTTP منتهية أصلاً).
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 500, 10000), // يستمر بمحاولة إعادة الاتصال بالخلفية تلقائياً
  });
  client.on('error', (err) => logRedisError('خطأ اتصال', err));
  client.on('connect', () => devLog('✅ [redis] الاتصال بـ Redis يعمل بنجاح.'));
  return client;
}

// ── التخزين المؤقت (Cache) — نمط "الأجيال" (versioned cache) ────────────────
// بدل حذف مفاتيح الكاش واحداً واحداً عند أي تعديل (يحتاج SCAN/KEYS، بطيء وقد
// يحجب Redis لحظياً بجداول كبيرة)، كل موديول+نطاق (hospital) له "رقم جيل"
// واحد بـRedis. كل قراءة تُخزَّن بمفتاح يتضمّن رقم الجيل الحالي وقت القراءة.
// أي كتابة (POST/PUT/DELETE) تزيد رقم الجيل بعملية INCR واحدة فقط (O(1)) —
// فتصير كل مفاتيح الكاش القديمة "يتيمة" تلقائياً (رقم الجيل بمفتاحها القديم
// لا يعود يُطابَق أبداً)، وتُحذف تلقائياً لاحقاً بانتهاء صلاحيتها (TTL) دون
// أي عملية حذف صريحة.
function cacheVersionKey(namespace, scope) {
  return `cv:${namespace}:${scope}`;
}

// ترجع null فقط لو تعذّر الوصول لـRedis أصلاً — يفهمها المستدعي كـ"تجاوز
// الكاش بالكامل لهذا الطلب" (راجع routes/pgCrud.js)، بعكس '0' وهي قيمة جيل
// أولى صالحة تماماً (لا فرق حقيقي بينها وبين رقم جيل حقيقي آخر).
async function getCacheVersion(namespace, scope) {
  try {
    const v = await getClient().get(cacheVersionKey(namespace, scope));
    return v || '0';
  } catch (err) {
    logRedisError(`getCacheVersion(${namespace})`, err);
    return null;
  }
}

async function bumpCacheVersion(namespace, scope) {
  try {
    await getClient().incr(cacheVersionKey(namespace, scope));
  } catch (err) {
    // لا مشكلة حرجة لو فشلت — أسوأ سيناريو: كاش قديم يبقى صالحاً حتى انتهاء
    // TTL الطبيعي (بضع دقائق)، وليس خطأ يوقف عملية الكتابة نفسها.
    logRedisError(`bumpCacheVersion(${namespace})`, err);
  }
}

async function cacheGet(key) {
  try {
    const raw = await getClient().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logRedisError(`cacheGet(${key})`, err);
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds) {
  try {
    await getClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logRedisError(`cacheSet(${key})`, err);
  }
}

// يُستخدم فقط لإغلاق الاتصال بأمان عند إيقاف عملية تحتاج ذلك صراحة (مثل
// تنظيف الاختبارات الآلية — راجع tests/testUtils.js). خارج بيئة الاختبار،
// عملية Node.js الرئيسية (server.js) لا تستدعي هذا إطلاقاً — الاتصال يبقى
// مفتوحاً طوال عمر العملية، بنفس نمط pool الخاص بـPostgreSQL.
async function closeClient() {
  if (!client) return;
  const c = client;
  client = null;
  try { await c.quit(); } catch { c.disconnect(); }
}

module.exports = { getClient, getCacheVersion, bumpCacheVersion, cacheGet, cacheSet, closeClient };
