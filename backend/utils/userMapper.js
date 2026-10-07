// backend/utils/userMapper.js
//
// يحوّل صف جدول users (أعمدة snake_case حقيقية بـPostgreSQL) لنفس الشكل
// camelCase الذي كان الفرونت إند يقرأه من db.json سابقاً (hospitalId،
// jobTitle، dashboardLayout، isActive، mustChangePassword...) — حتى لا
// تحتاج أي شاشة بالفرونت إند أي تعديل بعد الانتقال الكامل لـPostgreSQL.
// نقطة تحويل واحدة مشتركة (بدل تكرارها بكل مسار بـauthRoutes.js/
// usersRoutes.js) لضمان اتساق الشكل بكل مكان — لا يضمّ عمود password
// إطلاقاً بالنتيجة، فهو آمن دائماً للإرسال مباشرة بأي رد HTTP.
function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.full_name,
    username: row.username,
    email: row.email,
    role: row.role,
    jobTitle: row.job_title,
    avatar: row.avatar,
    color: row.color,
    hospitalId: row.hospital_id,
    permissions: row.permissions || [],
    dashboardLayout: row.dashboard_layout || undefined,
    mustChangePassword: row.must_change_password,
    isActive: row.is_active,
    isPrimaryAdmin: row.is_primary_admin,
    createdAt: row.created_at,
  };
}

module.exports = { mapUserRow };
