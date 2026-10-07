// backend/utils/backup.js
//
// نظام نسخ احتياطي مزدوج:
// 1) audit-log.json (يبقى كما كان — احتياطي إضافي بسيط لسجل التدقيق فقط.
//    db.json كان هنا سابقاً أيضاً، قبل ترحيل موديول المستخدمين الأخير
//    لـPostgreSQL بالكامل — راجع routes/usersRoutes.js وscripts/
//    migrateUsersFromJson.js. لم يعد له أي دور، فأُزيل من هذه القائمة).
// 2) نسخة كاملة حقيقية من قاعدة بيانات PostgreSQL عبر pg_dump — هذا الجزء
//    أُضيف بعد اكتشاف أن كل البيانات الفعلية (المرضى، الفواتير، المدفوعات)
//    كانت بلا أي نسخ احتياطي إطلاقاً بعد الانتقال من db.json — ثغرة حرجة
//    كانت تعني فقدان كل شيء نهائياً عند أي عطل بالقرص أو حذف خاطئ. يشمل
//    الآن جدول users أيضاً (نفس قاعدة البيانات، pg_dump ينسخها كاملة).
//
// وجهة خارجية اختيارية (EXTERNAL_BACKUP_DIR بملف .env): بدون هذا، كل النسخ
// الاحتياطية محفوظة بنفس القرص الفيزيائي لجهازك — لو تعطّل القرص نفسه أو
// انسرق الجهاز، تُفقد النسخ الاحتياطية مع البيانات الأصلية سوية. إعداد
// مسار خارجي (قرص USB خارجي دائم الاتصال، أو مجلد مزامنة سحابية محلي مثل
// Google Drive / OneDrive) يضمن وجود نسخة بمكان مختلف فعلياً.
//
// كلا النوعين: نسخة تلقائية دورية (كل ساعة)، الاحتفاظ بآخر N نسخة فقط.
//
// ── إضافة: نسخة يدوية بوجهة يحددها المستخدم ─────────────────────────────────
// runBackupWithDestination() تُستخدم فقط من راوت POST /backups/run عندما يمرر
// المستخدم destination (pgadmin / computer / cloud). لا تُستدعى إطلاقاً من
// الجدولة التلقائية (startAutoBackup)، ولا تُغيّر بأي شكل سلوك النسخ الدوري
// الموجود أصلاً — فقط تعيد استخدام runBackup() نفسها ثم تقرر ماذا تفعل
// بالملف الناتج حسب الوجهة المطلوبة.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUPS_DIR = path.join(__dirname, '..', 'backups');
const FILES_TO_BACKUP = ['audit-log.json'];
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // كل ساعة
const MAX_BACKUPS = 48; // نحتفظ بآخر 48 نسخة (يعني تغطية يومين تقريباً بمعدل كل ساعة)

// نمط اسم مجلد نسخة البيانات الاحتياطية (من timestamp() تحت: ISO مع استبدال
// : و . بـ -، مثل 2026-07-28T08-11-48-690Z). يُستخدم لاستثناء backups/code/
// (مجلد نسخ كود المصدر المنفصل تماماً — utils/codeBackup.js) من قوائم/تنظيف
// نسخ البيانات هنا، لأنه مجلد فرعي آخر بنفس BACKUPS_DIR لكنه لا يمثّل نسخة
// بيانات حقيقية.
const BACKUP_FOLDER_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// نسخة احتياطية حقيقية وكاملة لقاعدة بيانات PostgreSQL بأمر pg_dump الرسمي
// (نفس الأداة التي يستخدمها pgAdmin داخلياً). تُحفَظ كملف SQL نصّي عادي —
// يمكن استعادته لاحقاً بلصقه بـ Query Tool أو بأمر psql مباشرة، بدون أي
// تعقيد إضافي، بما يتوافق مع طريقة عملك المعتادة بـ pgAdmin.
function runPostgresBackup(backupFolder) {
  return new Promise((resolve) => {
    const outFile = path.join(backupFolder, 'postgres_backup.sql');
    const args = [
      '-h', process.env.PG_HOST || 'localhost',
      '-p', process.env.PG_PORT || '5432',
      '-U', process.env.PG_USER || 'postgres',
      '-d', process.env.PG_DATABASE || 'sihatuna_iraq',
      '-f', outFile,
      '--no-owner', '--no-privileges',
    ];
    execFile('pg_dump', args, { env: { ...process.env, PGPASSWORD: process.env.PG_PASSWORD || '' } }, (err) => {
      if (err) {
        // لا نوقف تشغيل السيرفر أبداً بسبب فشل النسخ الاحتياطي — فقط نُسجّل
        // تحذيراً واضحاً بالسبب الأكثر شيوعاً (pg_dump غير موجود بمسار PATH)
        console.warn('⚠️  فشل النسخ الاحتياطي لـ PostgreSQL:', err.message);
        console.warn('    تأكد أن مجلد PostgreSQL\\bin مضاف إلى PATH (نفس المطلوب لأمر psql).');
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// ينسخ مجلد نسخة احتياطية كامل إلى الوجهة الخارجية المُعدَّة بـ EXTERNAL_BACKUP_DIR
// (لو موجودة بملف .env). فشل هذه الخطوة (مثلاً القرص الخارجي غير موصول وقتها)
// لا يوقف عملية النسخ الاحتياطي المحلي أبداً — فقط يُسجَّل تحذير واضح.
function copyToExternalDestination(backupFolder, ts) {
  const externalRoot = process.env.EXTERNAL_BACKUP_DIR;
  if (!externalRoot || !externalRoot.trim()) return { attempted: false, ok: false };

  try {
    if (!fs.existsSync(externalRoot)) {
      console.warn(`⚠️  مسار النسخ الاحتياطي الخارجي غير موجود حالياً: ${externalRoot}`);
      console.warn('    (طبيعي لو كان قرصاً خارجياً غير موصول بالجهاز وقت هذه النسخة)');
      return { attempted: true, ok: false };
    }
    const externalFolder = path.join(externalRoot, ts);
    ensureDir(externalFolder);
    fs.readdirSync(backupFolder).forEach((filename) => {
      fs.copyFileSync(path.join(backupFolder, filename), path.join(externalFolder, filename));
    });
    return { attempted: true, ok: true };
  } catch (err) {
    console.warn('⚠️  فشل نسخ النسخة الاحتياطية للوجهة الخارجية:', err.message);
    return { attempted: true, ok: false };
  }
}

// يحذف النسخ الخارجية الزائدة عن MAX_BACKUPS، بنفس سياسة المجلد المحلي
function cleanupOldExternalBackups() {
  const externalRoot = process.env.EXTERNAL_BACKUP_DIR;
  if (!externalRoot || !externalRoot.trim() || !fs.existsSync(externalRoot)) return;
  try {
    const backups = fs.readdirSync(externalRoot)
      .filter(name => fs.statSync(path.join(externalRoot, name)).isDirectory())
      .sort();
    if (backups.length > MAX_BACKUPS) {
      backups.slice(0, backups.length - MAX_BACKUPS).forEach(name => {
        fs.rmSync(path.join(externalRoot, name), { recursive: true, force: true });
      });
    }
  } catch (err) {
    console.warn('⚠️  تعذّر تنظيف النسخ الخارجية القديمة:', err.message);
  }
}

// ── ملاحظة: الآن تُرجع معلومات النسخة المُنشأة (backupFolder, pgOk, backedUpAny)
// بدل عدم إرجاع شيء — إضافة غير مؤثرة على المستدعين الحاليين (startAutoBackup،
// restoreFromBackup) لأنهم لا يستخدمون القيمة المُرجعة أصلاً، لكنها ضرورية
// لـ runBackupWithDestination() الجديدة كي تعرف مكان الملف الناتج.
async function runBackup() {
  ensureDir(BACKUPS_DIR);
  const ts = timestamp();
  const backupFolder = path.join(BACKUPS_DIR, ts);

  let backedUpAny = false;
  FILES_TO_BACKUP.forEach((filename) => {
    const src = path.join(DATA_DIR, filename);
    if (fs.existsSync(src)) {
      ensureDir(backupFolder);
      fs.copyFileSync(src, path.join(backupFolder, filename));
      backedUpAny = true;
    }
  });

  ensureDir(backupFolder);
  const pgOk = await runPostgresBackup(backupFolder);
  if (pgOk) backedUpAny = true;

  let externalNote = '';
  if (backedUpAny) {
    const ext = copyToExternalDestination(backupFolder, ts);
    if (ext.attempted) externalNote = ext.ok ? ' (خارجي ✅)' : ' (خارجي ⚠️ فشل — راجع التحذير أعلاه)';
    cleanupOldExternalBackups();
  }

  if (backedUpAny) {
    console.log(`💾 New backup created: backend/backups/${ts}${pgOk ? ' (PostgreSQL ✅)' : ' (PostgreSQL ⚠️ فشل — راجع التحذير أعلاه)'}${externalNote}`);
  } else if (fs.existsSync(backupFolder)) {
    fs.rmdirSync(backupFolder); // لا يوجد شيء تم نسخه، احذف المجلد الفارغ
  }

  cleanupOldBackups();

  return { backupFolder, pgOk, backedUpAny };
}

function cleanupOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  const backups = fs.readdirSync(BACKUPS_DIR)
    // BACKUP_FOLDER_NAME_PATTERN مُعرَّف تحت — يستثني backups/code/ (نسخ كود
    // المصدر المنفصلة) من هذا التنظيف الخاص بنسخ البيانات فقط
    .filter(name => BACKUP_FOLDER_NAME_PATTERN.test(name) && fs.statSync(path.join(BACKUPS_DIR, name)).isDirectory())
    .sort(); // الأسماء مبنية على timestamp، فالترتيب الأبجدي = الترتيب الزمني

  if (backups.length > MAX_BACKUPS) {
    const toDelete = backups.slice(0, backups.length - MAX_BACKUPS);
    toDelete.forEach(name => {
      fs.rmSync(path.join(BACKUPS_DIR, name), { recursive: true, force: true });
    });
  }
}

// يرجع قائمة بكل النسخ الاحتياطية المتوفرة (الأحدث أول)، مع الإشارة هل كل
// واحدة منسوخة فعلياً للوجهة الخارجية أيضاً (لعرضها بالواجهة)
function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  const externalRoot = process.env.EXTERNAL_BACKUP_DIR;
  return fs.readdirSync(BACKUPS_DIR)
    .filter(name => BACKUP_FOLDER_NAME_PATTERN.test(name) && fs.statSync(path.join(BACKUPS_DIR, name)).isDirectory())
    .sort()
    .reverse()
    .map(name => ({
      name,
      externalCopyExists: !!(externalRoot && fs.existsSync(path.join(externalRoot, name))),
    }));
}

// يستعيد نسخة احتياطية معينة من db.json (يكتب فوق db.json الحالي — استخدمه
// بحذر). ملاحظة: استعادة نسخة PostgreSQL تتم يدوياً حالياً عبر لصق ملف
// postgres_backup.sql بـ Query Tool، وليس تلقائياً — عملية استعادة قاعدة
// بيانات حية تحمل مخاطر حقيقية (فقدان بيانات لاحقة) تستدعي قراراً بشرياً
// واعياً بالتوقيت، وليس أتمتة صامتة.
function restoreFromBackup(backupName) {
  // ── إصلاح أمني ────────────────────────────────────────────────────────────
  // backupName يوصل مباشرة من req.params بمسار API (انظر server.js) — بدون
  // هذا التحقق، اسم يحتوي "../" يمكن أن يجعلها تقرأ/تكتب خارج مجلد BACKUPS_DIR
  // (Path Traversal). المسار محمي أصلاً بصلاحية admin فقط، لكن نمنع المشكلة
  // من جذرها بدل الاعتماد فقط على طبقة الصلاحيات.
  if (typeof backupName !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(backupName)) {
    throw new Error('اسم النسخة الاحتياطية غير صالح');
  }
  const backupFolder = path.join(BACKUPS_DIR, backupName);
  if (!backupFolder.startsWith(BACKUPS_DIR + path.sep)) {
    throw new Error('اسم النسخة الاحتياطية غير صالح');
  }
  if (!fs.existsSync(backupFolder)) {
    throw new Error(`النسخة الاحتياطية "${backupName}" غير موجودة`);
  }
  // ناخذ نسخة أمان من الوضع الحالي قبل الاستعادة (احتياط إضافي)
  runBackup();

  FILES_TO_BACKUP.forEach((filename) => {
    const src = path.join(backupFolder, filename);
    const dest = path.join(DATA_DIR, filename);
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  });
  console.log(`♻️  Restored from backup: ${backupName}`);
  console.log(`    ملاحظة: لاستعادة بيانات PostgreSQL أيضاً، افتح الملف`);
  console.log(`    backend/backups/${backupName}/postgres_backup.sql يدوياً بـ pgAdmin`);
}

// يرفع ملفاً واحداً لرابط سحابي عبر PUT (webhook أو pre-signed URL)
function uploadFileToCloud(filePath, cloudUrl) {
  return new Promise(async (resolve) => {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const response = await fetch(cloudUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/sql' },
        body: fileBuffer,
      });
      resolve({ ok: response.ok, status: response.status });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

// نسخة احتياطية يدوية بوجهة يحددها المستخدم — تُستدعى فقط من راوت
// POST /backups/run عند تمرير destination بالجسم. تُنفّذ runBackup() العادية
// أولاً (فتحصل على db.json + audit-log.json + postgres_backup.sql بنفس آلية
// النسخ التلقائي)، ثم تقرر حسب الوجهة:
//   - pgadmin: لا شيء إضافي، الملف أصلاً محلي وجاهز لفتحه بـ pgAdmin
//   - computer: تُعيد مسار ملف postgres_backup.sql كي يُرسله الراوت كتحميل
//   - cloud: ترفع نفس الملف للرابط المُعطى
async function runBackupWithDestination(destination, cloudUrl) {
  const result = await runBackup();
  if (!result.backedUpAny) {
    const err = new Error('فشل إنشاء النسخة الاحتياطية');
    err.statusCode = 500;
    throw err;
  }

  const sqlFilePath = path.join(result.backupFolder, 'postgres_backup.sql');

  if (destination === 'pgadmin') {
    return { type: 'pgadmin', backupFolder: result.backupFolder, sqlFilePath };
  }

  if (destination === 'computer') {
    return { type: 'computer', sqlFilePath };
  }

  if (destination === 'cloud') {
    if (!cloudUrl || !cloudUrl.trim()) {
      const err = new Error('رابط الخزن السحابي مطلوب');
      err.statusCode = 400;
      throw err;
    }
    const uploadResult = await uploadFileToCloud(sqlFilePath, cloudUrl);
    if (!uploadResult.ok) {
      const err = new Error(`فشل الرفع على الكلاود (${uploadResult.status || uploadResult.error})، لكن النسخة محفوظة محلياً`);
      err.statusCode = 502;
      throw err;
    }
    return { type: 'cloud', backupFolder: result.backupFolder };
  }

  const err = new Error('وجهة غير معروفة');
  err.statusCode = 400;
  throw err;
}

// يبدأ الجدولة التلقائية — تُستدعى مرة وحدة عند إقلاع السيرفر
function startAutoBackup() {
  runBackup(); // نسخة فورية عند التشغيل
  setInterval(runBackup, BACKUP_INTERVAL_MS);
  const extNote = process.env.EXTERNAL_BACKUP_DIR ? ` + external (${process.env.EXTERNAL_BACKUP_DIR})` : ' (no external destination configured)';
  console.log(`💾 Auto-backup enabled (every ${BACKUP_INTERVAL_MS / 60000} min, keeping last ${MAX_BACKUPS} backups)${extNote}`);

  if (!process.env.EXTERNAL_BACKUP_DIR) {
    console.warn('\n╔════════════════════════════════════════════════════════════╗');
    console.warn('║  ⚠️  تنبيه: لا توجد وجهة نسخ احتياطي خارجية!                  ║');
    console.warn('╚════════════════════════════════════════════════════════════╝');
    console.warn('  كل النسخ الاحتياطية محفوظة حالياً بنفس قرص هذا الجهاز فقط.');
    console.warn('  لو تعطّل الجهاز (عطل قرص، سرقة، حريق...) تُفقَد كل البيانات');
    console.warn('  نهائياً بدون أي وسيلة استرجاع، بما فيها النسخ الاحتياطية نفسها.');
    console.warn('  أضف EXTERNAL_BACKUP_DIR بملف backend/.env يشير لمكان ثانٍ');
    console.warn('  (قرص USB خارجي دائم الاتصال، أو مجلد Google Drive/OneDrive مزامَن).\n');
  }
}

module.exports = { startAutoBackup, runBackup, listBackups, restoreFromBackup, runBackupWithDestination };
