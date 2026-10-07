// backend/config/uploadConfig.js
//
// إعداد multer المشترك لرفع الملفات (المستندات، الوثائق، مرفقات المتقاعدين...).
// استُخرج من server.js لتصغيره ولإتاحة استخدامه من أي ملف مسارات دون تكرار.
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

// ── إصلاح أمني ────────────────────────────────────────────────────────────────
// ما كان في أي قيد على نوع الملف المرفوع — أي امتداد كان يُقبل (حتى ملفات
// تنفيذية أو HTML/SVG قد تحتوي جافاسكربت). الآن نسمح فقط بأنواع الملفات
// التي فعلاً يحتاجها النظام (وثائق ومستندات ومرفقات طبية/إدارية عادية)،
// ونتحقق من الامتداد *ونوع المحتوى* معاً حتى ما ينفع تمويه ملف خطير باسم مزيّف.
const ALLOWED_UPLOAD_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
};

const uploadFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const expectedMime = ALLOWED_UPLOAD_TYPES[ext];
  if (!expectedMime) {
    const err = new Error('نوع الملف غير مسموح به. الأنواع المسموحة: PDF, JPG, PNG, GIF, WEBP, DOC, DOCX, XLS, XLSX, TXT');
    err.statusCode = 400;
    return cb(err);
  }
  // بعض المتصفحات ترسل mimetype عام (application/octet-stream) لملفات صحيحة —
  // نتساهل بهذه الحالة (الامتداد وحده يكفي)، لكن لو حدّد المتصفح نوعاً صريحاً
  // مختلفاً تماماً عن الممتد (تمويه واضح)، نرفض الملف.
  if (file.mimetype !== expectedMime && file.mimetype !== 'application/octet-stream') {
    const err = new Error('نوع محتوى الملف لا يطابق امتداده — الملف مرفوض');
    err.statusCode = 400;
    return cb(err);
  }
  cb(null, true);
};

const upload = multer({ storage, fileFilter: uploadFileFilter, limits: { fileSize: 20 * 1024 * 1024 } });

// ── حذف ملف مرفوع فعلياً من القرص ──────────────────────────────────────────
// إصلاح: حذف سجل يحمل مرفقاً (وثيقة إضبارة موظف/متقاعد) كان يحذف السطر من
// قاعدة البيانات فقط، ويترك الملف الفعلي بـUPLOADS_DIR يتيماً للأبد — راجع
// نقاط الاستدعاء بـemployeeDossierRoutes.js وrecycleBinRoutes.js (الحذف
// النهائي من سلة المحذوفات تحديداً، وليس النقل لسلة المحذوفات نفسه — يجب أن
// يبقى الملف موجوداً طالما السجل قابلاً للاسترجاع).
// path.basename هنا مقصود كحماية من تلاعب بمسار الملف المخزَّن (Path
// Traversal) — نتجاهل أي مجلدات بالمسار المخزَّن ونستخدم اسم الملف فقط ضمن
// UPLOADS_DIR، حتى لو كان filePath قيمة غير متوقعة قادمة من data قاعدة البيانات.
async function deleteUploadedFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return;
  const filename = path.basename(filePath);
  if (!filename) return;
  try {
    await fs.promises.unlink(path.join(UPLOADS_DIR, filename));
  } catch (err) {
    // ENOENT (الملف أصلاً غير موجود) ليس خطأً يستحق تحذيراً — أي خطأ آخر
    // (صلاحيات، قرص، إلخ) يُسجَّل فقط ولا يُفشِل الطلب (نفس فلسفة fail-open
    // المتّبعة بباقي النظام — حذف السجل أهم من نجاح تنظيف الملف). مُنتظَرة
    // (async/await) لا "أطلق ولا تنتظر" — حتى تنتهي فعلياً قبل رد الطلب،
    // ويصير التحقق منها باختبار حتمياً بلا حاجة لانتظار عشوائي.
    if (err.code !== 'ENOENT') {
      console.warn(`⚠️  [uploadConfig] تعذّر حذف الملف المرفق من القرص (${filename}):`, err.message);
    }
  }
}

module.exports = { upload, UPLOADS_DIR, ALLOWED_UPLOAD_TYPES, deleteUploadedFile };
