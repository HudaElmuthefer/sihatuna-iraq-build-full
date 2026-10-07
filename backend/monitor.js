// backend/monitor.js
//
// سكربت مراقبة مستقل — يفحص صحة السيرفر (وقاعدة البيانات خلفه) بفحص واحد
// لكل تشغيل، ويُصمَّم ليُجدوَل بـ Windows Task Scheduler (كل 5 دقائق مثلاً)
// بدل أن يبقى عملية تعمل بالخلفية بلا توقف — هذا أبسط وأوثق على ويندوز.
//
// المنطق الأهم: **تنبيه واحد فقط عند تغيّر الحالة**، وليس رسالة كل فحص لو
// الخلل مستمر لساعات — غير هذا كان راح تغرق برسائل متكررة لنفس المشكلة.
// يُبلَّغ أيضاً عند "التعافي" (رجوع النظام لطبيعته) حتى تعرف متى انحلّت
// المشكلة بدون ما تراقب يدوياً.
//
// الاستخدام: node monitor.js   (أو عبر monitor.bat)
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { sendAlert } = require('./utils/alerts');

const PORT = process.env.PORT || 8000;
const HEALTH_URL = `http://localhost:${PORT}/api/health`;
const STATE_PATH = process.env.MONITOR_STATE_PATH || path.join(__dirname, 'data', 'monitor-state.json');
const TIMEOUT_MS = 8000;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastStatus: 'unknown', lastCheckedAt: null };
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('⚠️  فشل حفظ حالة المراقبة:', err.message);
  }
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: TIMEOUT_MS }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ reachable: true, healthy: res.statusCode === 200 && json.status === 'ok', details: json });
        } catch {
          resolve({ reachable: true, healthy: false, details: { error: 'استجابة غير صالحة' } });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, healthy: false, details: { error: `لا استجابة خلال ${TIMEOUT_MS / 1000} ثواني` } }); });
    req.on('error', (err) => resolve({ reachable: false, healthy: false, details: { error: err.message } }));
  });
}

async function main() {
  const result = await checkHealth();
  const state = readState();
  const currentStatus = result.healthy ? 'healthy' : 'unhealthy';
  const now = new Date().toISOString();

  console.log(`[${now}] فحص: ${currentStatus}${result.details?.database ? ` | قاعدة البيانات: ${result.details.database}` : ''}`);

  // تنبيه فقط عند *تغيّر* الحالة — يمنع إغراقج برسائل متكررة لنفس الخلل
  if (currentStatus !== state.lastStatus) {
    if (currentStatus === 'unhealthy') {
      const reason = !result.reachable
        ? 'السيرفر لا يستجيب إطلاقاً (متوقف أو معلَّق)'
        : `السيرفر يستجيب لكنه بحالة غير سليمة: ${JSON.stringify(result.details)}`;
      await sendAlert(
        'SIHATUNA IRAQ — السيرفر بمشكلة',
        `${reason}\n\nالوقت: ${now}\nالرابط المفحوص: ${HEALTH_URL}\n\nالخطوة التالية: تأكد إن start-backend.bat يعمل، وشغّل check-system.bat لتشخيص أدق.`
      );
    } else if (state.lastStatus === 'unhealthy') {
      // كانت متعطّلة، والآن رجعت طبيعية — تنبيه "تعافي" حتى تعرف انحلّت المشكلة
      await sendAlert(
        'SIHATUNA IRAQ — السيرفر رجع طبيعي ✅',
        `السيرفر واستجابته سليمة الآن.\n\nالوقت: ${now}`
      );
    }
    // أول تشغيل إطلاقاً (lastStatus === 'unknown') وكانت النتيجة سليمة — لا تنبيه، هذا وضع طبيعي
  }

  writeState({ lastStatus: currentStatus, lastCheckedAt: now, lastDetails: result.details });
}

main().catch((err) => {
  console.error('❌ خطأ غير متوقع بسكربت المراقبة:', err.message);
  process.exit(1);
});
