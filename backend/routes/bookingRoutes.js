// backend/routes/bookingRoutes.js
//
// مسار حجز مخصَّص لصفحة "الخدمات الشخصية" (PersonalServicesPage.js) —
// منفصل عمداً عن مسار appointments العام (POST /api/appointments عبر
// pgCrud القياسي)، لأنه يحتاج فحص تعارض وقت حقيقي على مستوى قاعدة
// البيانات قبل الإدراج: مريضين ما يصير يحجزون نفس الطبيب بنفس التاريخ
// والوقت بالضبط. فحص كهذا لا يمكن أن يتم بالفرونت إند وحده بشكل موثوق —
// لو مستخدمين مختلفين ضغطوا "تأكيد الحجز" بنفس اللحظة تقريباً، كل واحد
// عنده نسخته المحلية القديمة من appointments ولا يرى حجز الثاني إلا بعد
// ما يوصل فعلياً، فيصير تعارض حقيقي رغم إن الفحص المحلي بالواجهة ما كان
// يرفضه وقتها. الفحص هنا يصير داخل نفس طلب الإدراج على قاعدة البيانات
// الحقيقية مباشرة، فيمسك التعارض حتى لو صار بنفس اللحظة تقريباً.
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { validateFields } = require('../middleware/validate');
const collectionSchemas = require('../middleware/schemas');

router.post('/booking/book-appointment', auth, async (req, res, next) => {
  try {
    const { patient, patientPhone, doctor, doctorEn, department, date, time, notes } = req.body || {};
    if (!patient || !doctor || !date || !time) {
      return res.status(400).json({ message: 'المريض والطبيب والتاريخ والوقت كلها مطلوبة' });
    }

    // ── فحص التعارض الحقيقي: نفس الطبيب + نفس التاريخ + نفس الوقت، ولحالة
    // غير ملغاة. patient/doctor/date/status أعمدة حقيقية مفهرسة أصلاً
    // (نفس مصفوفة pgCrud لموديول appointments بـ modules.js)، أما "time"
    // فمخزَّن فقط داخل عمود data (JSONB) — نستعلمه من هناك.
    const conflict = await pool.query(
      `SELECT id FROM appointments
       WHERE doctor = $1 AND date = $2 AND data->>'time' = $3 AND status != 'cancelled'
       LIMIT 1`,
      [doctor, date, time]
    );
    if (conflict.rows.length > 0) {
      return res.status(409).json({ message: 'هذا الموعد محجوز فعلاً لهذا الطبيب — اختر وقتاً آخر' });
    }

    const data = {
      patient, patientPhone: patientPhone || null,
      doctor, doctorEn: doctorEn || doctor,
      department: department || '',
      date, time,
      status: 'pending', type: 'consult',
      notes: notes || '',
      hospitalId: req.user?.hospitalId || null,
    };

    const errors = validateFields(collectionSchemas.appointments, data);
    if (errors.length > 0) return res.status(400).json({ message: errors.join('، ') });

    const result = await pool.query(
      `INSERT INTO appointments (patient, doctor, date, status, data) VALUES ($1, $2, $3, $4, $5) RETURNING id, data`,
      [patient, doctor, date, 'pending', JSON.stringify(data)]
    );
    res.status(201).json({ id: result.rows[0].id, ...result.rows[0].data });
  } catch (err) { next(err); }
});

module.exports = router;
