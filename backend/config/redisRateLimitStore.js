// backend/config/redisRateLimitStore.js
//
// Store مخصَّص لـexpress-rate-limit (v7 — راجع واجهة Store بملف
// node_modules/express-rate-limit/dist/index.d.ts) مبني على Redis، بديل عن
// الذاكرة الداخلية الافتراضية (MemoryStore). كانت المشكلة: بعد التحويل
// لـPM2 cluster mode (عدة عمليات worker منفصلة، كل وحدة بذاكرتها الخاصة —
// راجع تعليق ecosystem.config.js)، أي حد "300 طلب/5 دقائق" فعلياً يتضاعف
// تلقائياً بعدد أنوية المعالج (كل worker يعدّ من الصفر بذاكرته المنفصلة)،
// ونفس الأمر لحد محاولات تسجيل الدخول — يُضعف الحماية ضد التخمين
// (Brute Force) فعلياً بقدر ما يزيد عدد الأنوية. Redis (مصدر عدّاد واحد
// مشترك فعلياً بين كل العمليات) يصحّح هذا.
//
// ── fail-open عند تعذّر الوصول لـRedis ────────────────────────────────────
// تحديد المعدل أقل أهمية بكثير من استمرار عمل النظام — لا يصح أن يفشل كل
// طلب تسجيل دخول أو كل طلب API بالنظام لمجرد انقطاع Redis لحظياً. كل خطأ
// هنا يُعامَل كـ"لا حد بعد" (كأنه أول طلب بهذه النافذة)، وليس كخطأ يوقف
// الطلب. راجع نفس الفلسفة المشروحة بأعلى utils/redisService.js.
const { getClient } = require('../utils/redisService');

class RedisRateLimitStore {
  // prefix: مطلوب ومنفصل لكل limiter (login/general/import/...) حتى لا
  // تتشارك عدة محدِّدات مختلفة نفس مساحة المفاتيح بـRedis رغم استخدامها
  // نفس نوع المفتاح (IP أو user:id) بالمصادفة.
  constructor(prefix) {
    this.prefix = prefix;
  }

  // يُستدعى مرة واحدة تلقائياً من express-rate-limit عند إعداد الـ
  // middleware، ويمرر إعدادات الحد (windowMs) — نحتاجه لضبط مدة صلاحية
  // مفتاح Redis بنفس مدة النافذة الزمنية المُعدَّة بكل limiter.
  init(options) {
    this.windowMs = options.windowMs;
  }

  key(k) {
    return `rl:${this.prefix}:${k}`;
  }

  async get(k) {
    try {
      const client = getClient();
      const redisKey = this.key(k);
      const [totalHitsRaw, ttl] = await Promise.all([client.get(redisKey), client.pttl(redisKey)]);
      if (totalHitsRaw === null) return undefined;
      return { totalHits: parseInt(totalHitsRaw, 10), resetTime: ttl > 0 ? new Date(Date.now() + ttl) : undefined };
    } catch {
      return undefined;
    }
  }

  async increment(k) {
    try {
      const client = getClient();
      const redisKey = this.key(k);
      const totalHits = await client.incr(redisKey);
      let ttl = await client.pttl(redisKey);
      if (ttl < 0) {
        // مفتاح جديد (أول طلب بهذه النافذة) — نضبط مدة صلاحيته الآن فقط،
        // وليس بكل زيادة (وإلا نافذة الحد تنزلق للأمام مع كل طلب ولا تنتهي أبداً)
        await client.pexpire(redisKey, this.windowMs);
        ttl = this.windowMs;
      }
      return { totalHits, resetTime: new Date(Date.now() + ttl) };
    } catch (err) {
      console.warn('⚠️  [redis-rate-limit] تعذّر الوصول لـRedis (fail-open — لا حد مؤقتاً):', err.message);
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(k) {
    try { await getClient().decr(this.key(k)); } catch { /* غير حرج — تحديد المعدل فقط */ }
  }

  async resetKey(k) {
    try { await getClient().del(this.key(k)); } catch { /* غير حرج */ }
  }
}

module.exports = RedisRateLimitStore;
