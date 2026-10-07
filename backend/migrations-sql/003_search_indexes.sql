-- ============================================================================
-- SIHATUNA IRAQ ERP — فهرسة حقول البحث النصي داخل JSONB (وقائي)
-- ============================================================================
-- المشكلة: كل حقول البحث النصي (searchFields) بملف modules.js تُستعلَم بنمط
--   data->>'field' ILIKE '%كلمة%'
-- وهذا النمط (بحث بأي مكان بالنص، وليس فقط بداية النص) لا يستفيد من فهرس عادي
-- (btree) حتى لو أضفناه — يحتاج نوع فهرس خاص اسمه GIN + امتداد pg_trgm
-- (يقسّم النص لمقاطع صغيرة "trigrams" ويفهرسها، فيسرّع البحث بأي مكان بالنص).
--
-- هذا إجراء وقائي بحت: حاليًا حجم بياناتك صغير فما تحسّين فرق ملموس، لكن مع
-- نمو البيانات (آلاف الأطباء، آلاف الأصول...) البحث بدون هذا الفهرس يصبح
-- أبطأ خطياً مع كل سجل إضافي. آمن 100%: إضافة فهارس فقط، صفر تغيير على أي
-- كود أو بيانات موجودة.
--
-- طريقة التشغيل:
--   psql -U postgres -d sihatuna_iraq -f migration_add_search_indexes.sql
-- ============================================================================

-- تفعيل امتداد pg_trgm (مطلوب مرة وحدة فقط لكامل قاعدة البيانات)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- فهارس GIN trigram — حقل واحد لكل حقل بحث فعلي مُعرَّف بـ searchFields
-- (doctors.specialization, assets.assetNo, inventory.code,
--  projects.code / manager / name)
CREATE INDEX IF NOT EXISTS idx_doctors_specialization_trgm
  ON doctors USING GIN ((data->>'specialization') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_assets_assetno_trgm
  ON assets USING GIN ((data->>'assetNo') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_code_trgm
  ON inventory USING GIN ((data->>'code') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_projects_code_trgm
  ON projects USING GIN ((data->>'code') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_projects_manager_trgm
  ON projects USING GIN ((data->>'manager') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_projects_name_trgm
  ON projects USING GIN ((data->>'name') gin_trgm_ops);

-- ============================================================================
-- فهرس GIN عام على عمود data كامل — شبكة أمان إضافية
-- ============================================================================
-- هذا يسرّع أي استعلام مستقبلي يستخدم عوامل JSONB الأصلية (@>, ?) بدل
-- data->>'field'، حتى لو ما استخدمها الكود الحالي بعد. تكلفته: مساحة تخزين
-- إضافية بسيطة ووقت إدراج أبطأ قليلاً جداً (كل INSERT/UPDATE يحدّث الفهرس)،
-- لكن هذا تبادل معقول لجدول بيانات مرضى/فواتير لا يُكتب فيه آلاف المرات
-- بالثانية. لو لاحظت مستقبلاً بطء بعمليات الحفظ تحديداً (وليس القراءة)،
-- هذا أول مكان تراجعه (احذف الفهارس أدناه لو صار عبء بدل فائدة).
CREATE INDEX IF NOT EXISTS idx_patients_data_gin ON patients USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_doctors_data_gin ON doctors USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_appointments_data_gin ON appointments USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_invoices_data_gin ON invoices USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_employees_data_gin ON employees USING GIN (data);
