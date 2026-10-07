// backend/middleware/requireAdmin.js
//
// middleware فحص صلاحية "إدمن" فقط. يُستخدم دائماً بعد auth (يحتاج req.user
// جاهزاً من قبله). كان هذا الفحص مكرَّراً سطراً بسطر بأماكن متعددة من
// server.js (hospitals, backups, audit-log, system-settings) — استُخرج هنا
// كملف مشترك حتى تستخدمه أيضاً مسارات الدفع الحساسة (paymentRoutes.js)
// التي كانت بلا أي فحص إطلاقاً.
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'هذه الصفحة للإدمن فقط' });
  }
  next();
};

module.exports = requireAdmin;
