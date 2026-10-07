// backend/utils/alerts.js
//
// أداة إرسال تنبيهات لأحداث حرجة (السيرفر متوقف، قاعدة البيانات غير متصلة...).
// النظام لا يملك خدمة بريد إلكتروني مُجهَّزة افتراضياً، فالتصميم هنا مبني على
// طبقتين:
//   1) سجل محلي دائماً (data/alerts-log.json) — يعمل دائماً بدون أي إعداد،
//      تستطيع فتحه بأي وقت أو ربطه بأي أداة قراءة سجلات لاحقاً.
//   2) بريد إلكتروني فعلي *اختياري* — يعمل فقط لو حدَّدت بيانات SMTP بملف
//      .env (راجع .env.example). بدون هذه البيانات، التنبيه يبقى بالسجل
//      المحلي بس، مع رسالة واضحة بالكونسول تلفت الانتباه فوراً.
const fs = require('fs');
const path = require('path');

const ALERTS_LOG_PATH = process.env.ALERTS_LOG_PATH || path.join(__dirname, '..', 'data', 'alerts-log.json');
const MAX_ALERTS = 500;

function logAlertLocally(alert) {
  try {
    let log = [];
    if (fs.existsSync(ALERTS_LOG_PATH)) {
      log = JSON.parse(fs.readFileSync(ALERTS_LOG_PATH, 'utf8'));
    }
    log.push({ id: log.length > 0 ? log[log.length - 1].id + 1 : 1, timestamp: new Date().toISOString(), ...alert });
    if (log.length > MAX_ALERTS) log = log.slice(log.length - MAX_ALERTS);
    fs.writeFileSync(ALERTS_LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
  } catch (err) {
    console.error('⚠️  فشل تسجيل التنبيه محلياً:', err.message);
  }
}

async function sendEmailAlert(subject, message) {
  // ── إصلاح: تعطيل البريد الفعلي أثناء الاختبارات الآلية (Jest) فقط ──────────
  // أثناء npm test، أخطاء 500 كثيرة تُثار عمداً للتحقق من سلوك الكود (ليست
  // أحداثاً حقيقية بالنظام)، وكل واحد منها كان يفتح اتصال SMTP حقيقي فعلياً
  // (يرسل بريداً فعلياً لصندوق واردك، ويبقي الاتصال مفتوحاً بعد انتهاء
  // الاختبارات فيمنع Jest من الخروج طبيعياً). هذا لا يؤثر إطلاقاً على
  // التنبيهات الحقيقية بالسيرفر المنشور فعلياً — هناك NODE_ENV تكون
  // 'production' أو غير مضبوطة، وليست 'test'، فالبريد يُرسَل هناك كالمعتاد.
  if (process.env.NODE_ENV === 'test') {
    return { sent: false, reason: 'معطَّل أثناء بيئة الاختبار (NODE_ENV=test)' };
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !ALERT_EMAIL_TO) {
    return { sent: false, reason: 'SMTP غير مُعدّ بملف .env (راجع SMTP_HOST/SMTP_USER/SMTP_PASS/ALERT_EMAIL_TO)' };
  }
  try {
    // nodemailer تحميل كسول (lazy require) — حتى لا يفشل تحميل الملف كله لو
    // المكتبة غير مثبَّتة بمشروع لا يستخدم هذه الميزة أصلاً
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({
      from: `"SIHATUNA IRAQ - مراقبة النظام" <${SMTP_USER}>`,
      to: ALERT_EMAIL_TO,
      subject: `🚨 ${subject}`,
      text: message,
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

// نقطة الدخول الرئيسية — تُستدعى من أي مكان بالنظام (السيرفر نفسه، أو
// monitor.js المستقل) عند حدث حرج. تسجّل محلياً دائماً، وتحاول بريد إلكتروني
// لو مُعدّ، وتطبع بالكونسول بوضوح شديد بكل الأحوال.
async function sendAlert(subject, message) {
  console.error('\n╔════════════════════════════════════════════════════════════╗');
  console.error(`║  🚨 تنبيه: ${subject}`);
  console.error('╚════════════════════════════════════════════════════════════╝');
  console.error(`  ${message}\n`);

  logAlertLocally({ subject, message });

  const emailResult = await sendEmailAlert(subject, message);
  if (emailResult.sent) {
    console.error('  ✅ أُرسِل تنبيه بريد إلكتروني.\n');
  } else {
    console.error(`  ℹ️  لم يُرسَل بريد إلكتروني (${emailResult.reason}) — التنبيه مسجَّل محلياً بس.\n`);
  }
  return emailResult;
}

module.exports = { sendAlert, ALERTS_LOG_PATH };
