-- ============================================================================
-- SIHATUNA IRAQ ERP — ترقية حقول JSONB مختارة لأعمدة حقيقية (الدفعة الأولى)
-- ============================================================================
-- هذا أول جدولين (patients, doctors) من خطة تدريجية لترقية الحقول الأكثر
-- قيمة من JSONB لأعمدة حقيقية. كل خطوة هنا إضافية وآمنة: تضيف عمود جديد،
-- تنسخ له القيم الموجودة فعلاً من data JSONB، ثم تفهرسه. البيانات الأصلية
-- بعمود data تبقى كما هي (لا حذف، لا تغيير) — يمكن التراجع الكامل بحذف
-- الأعمدة الجديدة فقط لو احتجت ذلك.
--
-- بعد تشغيل هذا الملف، يجب أيضاً تطبيق تعديل الكود المرفق بملف modules.js
-- (راجع رسالة Claude) حتى يبدأ النظام فعلياً يقرأ/يكتب من الأعمدة الجديدة.
-- ============================================================================

-- ── جدول المرضى (patients) ──────────────────────────────────────────────────
ALTER TABLE patients ADD COLUMN IF NOT EXISTS patient_code VARCHAR(50);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS blood_type   VARCHAR(10);

-- نسخ القيم الموجودة فعلاً من JSONB للعمود الجديد (مرة وحدة، لا يمس أي سجل جديد لاحقاً)
UPDATE patients SET patient_code = data->>'patientId' WHERE patient_code IS NULL AND data ? 'patientId';
UPDATE patients SET blood_type   = data->>'bloodType'  WHERE blood_type   IS NULL AND data ? 'bloodType';

CREATE INDEX IF NOT EXISTS idx_patients_patient_code ON patients(patient_code);
CREATE INDEX IF NOT EXISTS idx_patients_blood_type   ON patients(blood_type);

-- ── جدول الأطباء (doctors) ──────────────────────────────────────────────────
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS specialization VARCHAR(150);

UPDATE doctors SET specialization = data->>'specialization' WHERE specialization IS NULL AND data ? 'specialization';

CREATE INDEX IF NOT EXISTS idx_doctors_specialization ON doctors(specialization);

-- فهرس GIN/trigram القديم على data->>'specialization' (من migration سابق اليوم)
-- صار زائداً الآن بما إن specialization عمود حقيقي مفهرس — احذفه للتنظيف
-- (اختياري، لا يسبب أي ضرر لو تركته، لكن يوفّر مساحة بسيطة بدون فائدة):
-- DROP INDEX IF EXISTS idx_doctors_specialization_trgm;
