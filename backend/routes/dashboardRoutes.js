// backend/routes/dashboardRoutes.js
//
// Additive-only aggregate endpoint for the Dashboard page's 5 KPI numbers.
// Each value used to require fetching a full dataset (patients, doctors,
// appointments, wards, admissions — ~1.1 MiB combined) just to read one
// count or sum off it. This endpoint runs the equivalent COUNT/SUM queries
// directly on the server instead. It does not replace or change any
// existing route — every dataset below remains fully available through its
// own existing endpoint for every other page that still needs the full
// records (e.g. PatientsPage, WardsPage).
const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const auth = require('../middleware/auth');
const { pool } = require('../config/database');

const router = express.Router();

// ── إصلاح: الفحص كان صلاحية واحدة ('dashboard') لكل الأرقام الخمسة، رغم أن
// المصادر الأصلية (GET /patients، /doctors، /appointments، /wards،
// /admissions، /labTests) كانت تفرض صلاحيات مختلفة فعلياً — patients/doctors/
// appointments مسجَّلة openRead (مفتوحة لأي مستخدم مسجّل دخول)، بينما wards/
// admissions تتطلّبان 'wards' وlabTests تتطلّب 'laboratory' تحديداً. أي حساب
// غير إدمن له 'dashboard' فقط بلا 'wards'/'laboratory' (الحالة الفعلية لكل
// حسابات nurse/doctor/accountant الحالية) كان يرى إشغال الأسرّة وعدد
// التحاليل الحقيقيَين هنا، رغم عدم امتلاكه صلاحية رؤية هذه البيانات أصلاً من
// مصدرها المباشر — توسيع صلاحيات حقيقي غير مقصود. الإصلاح: نفس فحص الصلاحية
// لكل رقم بمصدره الأصلي بالضبط، بدل فحص واحد موحَّد على المسار كله.
router.get('/dashboard/summary', auth, asyncHandler(async (req, res) => {
  // Same hospital-scoping convention as every pgCrud module: filtered to
  // the caller's hospital when they have one, unfiltered (all-hospitals
  // aggregate) for a ministry-level admin with no hospitalId.
  const hospitalId = req.user?.hospitalId || null;
  const hospitalFilter = hospitalId ? `AND data->>'hospitalId' = $1` : '';
  const params = hospitalId ? [hospitalId] : [];

  const isAdmin = req.user?.role === 'admin';
  const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  const canReadWards = isAdmin || perms.includes('wards');
  const canReadLab = isAdmin || perms.includes('laboratory');

  const [patientsResult, doctorsResult, appointmentsResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM patients WHERE true ${hospitalFilter}`, params),
    pool.query(`SELECT COUNT(*) FROM doctors WHERE (status = 'active' OR status IS NULL) ${hospitalFilter}`, params),
    pool.query(`SELECT COUNT(*) FROM appointments WHERE date = CURRENT_DATE ${hospitalFilter}`, params),
  ]);

  // Matches the old /labTests call's behavior when it 403'd: the count
  // stayed at 0 rather than being fetched at all.
  let dailyLabTests = 0;
  if (canReadLab) {
    const labTestsResult = await pool.query(`SELECT COUNT(*) FROM lab_tests WHERE true ${hospitalFilter}`, params);
    dailyLabTests = parseInt(labTestsResult.rows[0].count, 10);
  }

  // Matches the old /wards + /admissions calls' behavior when either
  // 403'd: both datasets fell back to [], giving totalBeds=0,
  // occupiedBeds=0, and rate=null (no beds to compute a rate from).
  let totalBeds = 0;
  let occupiedBeds = 0;
  let rate = null;
  if (canReadWards) {
    const [wardsResult, admissionsResult] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM((data->>'bedCount')::numeric), 0) AS total FROM wards WHERE true ${hospitalFilter}`, params),
      pool.query(`SELECT COUNT(*) FROM admissions WHERE data->>'status' = 'admitted' ${hospitalFilter}`, params),
    ]);
    totalBeds = Number(wardsResult.rows[0].total) || 0;
    occupiedBeds = parseInt(admissionsResult.rows[0].count, 10) || 0;
    rate = totalBeds > 0 ? Number(((occupiedBeds / totalBeds) * 100).toFixed(1)) : null;
  }

  res.json({
    totalPatients: parseInt(patientsResult.rows[0].count, 10),
    activeDoctors: parseInt(doctorsResult.rows[0].count, 10),
    todayAppointments: parseInt(appointmentsResult.rows[0].count, 10),
    dailyLabTests,
    bedOccupancy: {
      totalBeds,
      occupiedBeds,
      rate,
    },
  });
}));

module.exports = router;
