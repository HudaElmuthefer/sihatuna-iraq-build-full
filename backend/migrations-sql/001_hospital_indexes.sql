-- ============================================================================
-- SIHATUNA IRAQ ERP — فهارس تسريع فلترة hospitalId
-- ============================================================================
-- المشكلة: 45 جدول تُفلتَر بـ WHERE data->>'hospitalId' = $1 (hospitalScoped)
-- بكل طلب GET، لكن ولا فهرس واحد موجود على هذا التعبير — يعني Sequential Scan
-- كامل على كل جدول بكل طلب قائمة. هذا آمن 100%: إضافة فهارس فقط، صفر تغيير
-- على pgCrud.js أو أي كود آخر أو أي بيانات موجودة. تشغيله لا يوقف الخادم.
--
-- طريقة التشغيل: افتح pgAdmin أو psql على قاعدة sihatuna_iraq وشغّل الملف كامل،
-- أو من موجه الأوامر:
--   psql -U postgres -d sihatuna_iraq -f migration_add_hospital_indexes.sql
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_patients_hospital_id ON patients ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_doctors_hospital_id ON doctors ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_appointments_hospital_id ON appointments ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_invoices_hospital_id ON invoices ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_employees_hospital_id ON employees ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_retired_hospital_id ON retired ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_departments_hospital_id ON departments ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_outgoing_hospital_id ON outgoing ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_incoming_hospital_id ON incoming ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_vaccinations_hospital_id ON vaccinations ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_medical_leaves_hospital_id ON medical_leaves ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_dossiers_hospital_id ON dossiers ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_lab_tests_hospital_id ON lab_tests ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_radiology_hospital_id ON radiology ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_hospital_id ON pharmacy_orders ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_assets_hospital_id ON assets ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_asset_maintenance_log_hospital_id ON asset_maintenance_log ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_inventory_hospital_id ON inventory ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_procurement_hospital_id ON procurement ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_projects_hospital_id ON projects ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_documents_hospital_id ON documents ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_service_prices_hospital_id ON service_prices ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_transactions_hospital_id ON transactions ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_promotions_hospital_id ON promotions ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_allowances_hospital_id ON allowances ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_salaries_hospital_id ON salaries ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_ambulance_vehicles_hospital_id ON ambulance_vehicles ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_ambulance_maintenance_log_hospital_id ON ambulance_maintenance_log ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_ambulance_missions_hospital_id ON ambulance_missions ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_crm_interactions_hospital_id ON crm_interactions ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_crm_patient_segments_hospital_id ON crm_patient_segments ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_crm_follow_ups_hospital_id ON crm_follow_ups ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_crm_campaigns_hospital_id ON crm_campaigns ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_crm_campaign_targets_hospital_id ON crm_campaign_targets ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_quality_audits_hospital_id ON quality_audits ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_quality_ncs_hospital_id ON quality_ncs ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_quality_kpis_hospital_id ON quality_kpis ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_wards_hospital_id ON wards ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_admissions_hospital_id ON admissions ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_medication_orders_hospital_id ON medication_orders ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_medication_administrations_hospital_id ON medication_administrations ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_deliveries_hospital_id ON deliveries ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_pt_equipment_hospital_id ON pt_equipment ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_pt_sessions_hospital_id ON pt_sessions ((data->>'hospitalId'));
CREATE INDEX IF NOT EXISTS idx_queue_tickets_hospital_id ON queue_tickets ((data->>'hospitalId'));

-- ============================================================================
-- فهارس إضافية لحقول JSONB تُستخدم بالبحث (searchFields) بشكل متكرر
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_doctors_specialization ON doctors ((data->>'specialization'));
CREATE INDEX IF NOT EXISTS idx_assets_assetno ON assets ((data->>'assetNo'));
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets ((data->>'category'));
CREATE INDEX IF NOT EXISTS idx_inventory_code ON inventory ((data->>'code'));
CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory ((data->>'category'));
CREATE INDEX IF NOT EXISTS idx_projects_code ON projects ((data->>'code'));
CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects ((data->>'manager'));
