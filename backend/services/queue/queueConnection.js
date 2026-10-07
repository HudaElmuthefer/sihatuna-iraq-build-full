// backend/services/queue/queueConnection.js
//
// اتصال Redis منفصل تماماً عن utils/redisService.js (المستخدَم للكاش/تحديد
// المعدل/إبطال التوكنات) — مخصَّص فقط لـBullMQ (الطابور services/queue/*).
//
// السبب إلزامي، وليس خيار تصميم: BullMQ يشترط صراحة maxRetriesPerRequest:null
// على اتصال Redis المُمرَّر له (راجع "Production Checklist" بتوثيق BullMQ
// الرسمي) — يعتمد داخلياً على أوامر Redis "حاجبة" (blocking، مثل
// BRPOPLPUSH) يجب أن تنتظر بصبر لا أن تفشل بعد محاولة واحدة، بعكس اتصال
// الكاش/تحديد المعدل المصمَّم عمداً للفشل السريع (fail-open — راجع تعليق
// utils/redisService.js). لهذا اتصالان منفصلان تماماً، لا اتصال واحد
// بإعدادات مختلفة حسب الاستخدام.
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

function createQueueConnection() {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

module.exports = { createQueueConnection };
