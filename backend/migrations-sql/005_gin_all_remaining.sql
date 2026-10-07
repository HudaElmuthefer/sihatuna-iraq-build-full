-- ============================================================================
-- SIHATUNA IRAQ ERP — تجهيز الـ37 جدول الباقية لأي بحث/فلترة مستقبلية
-- ============================================================================
-- هذه الجداول لا يوجد لها حالياً أي بحث أو فلترة من جهة السيرفر لأي حقل —
-- فلا يوجد حقل معيّن نرقّيه اليوم (سيكون تخميناً). بدل هذا، نضيف فهرساً
-- GIN عاماً على عمود data كاملاً لكل جدول منها. هذا يجهّز البنية التحتية
-- لتتحمّل أي طلب فلترة/بحث يُضاف مستقبلاً على أي حقل، بسرعة معقولة،
-- من اليوم الأول الذي يُحتاج إليه فيه — بدون انتظار migration جديد وقتها.
--
-- عندما يطلب مستخدم فعلياً فلترة بحقل معيّن بموديول معيّن (مثلاً فلترة
-- الإجازات المرضية بنوع الإجازة)، عندها نرقّي ذاك الحقل تحديداً
-- لعمود حقيقي مفهرس (نفس أسلوب patients/doctors اليوم) — سيكون أسرع من
-- الفهرس العام هذا، لكن الفهرس العام يضمن أداء معقولاً بالانتظار.
--
-- آمن 100%: إضافة فهارس فقط، صفر تغيير على أي كود أو بيانات موجودة.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_retired_data_gin ON retired USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_departments_data_gin ON departments USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_outgoing_data_gin ON outgoing USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_incoming_data_gin ON incoming USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_vaccinations_data_gin ON vaccinations USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_medical_leaves_data_gin ON medical_leaves USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_dossiers_data_gin ON dossiers USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_lab_tests_data_gin ON lab_tests USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_radiology_data_gin ON radiology USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_data_gin ON pharmacy_orders USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_asset_maintenance_log_data_gin ON asset_maintenance_log USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_procurement_data_gin ON procurement USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_documents_data_gin ON documents USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_service_prices_data_gin ON service_prices USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_transactions_data_gin ON transactions USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_promotions_data_gin ON promotions USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_allowances_data_gin ON allowances USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_salaries_data_gin ON salaries USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_ambulance_vehicles_data_gin ON ambulance_vehicles USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_ambulance_maintenance_log_data_gin ON ambulance_maintenance_log USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_ambulance_missions_data_gin ON ambulance_missions USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_data_gin ON crm_interactions USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_crm_patient_segments_data_gin ON crm_patient_segments USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_crm_follow_ups_data_gin ON crm_follow_ups USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_crm_campaigns_data_gin ON crm_campaigns USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_crm_campaign_targets_data_gin ON crm_campaign_targets USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_quality_audits_data_gin ON quality_audits USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_quality_ncs_data_gin ON quality_ncs USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_quality_kpis_data_gin ON quality_kpis USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_wards_data_gin ON wards USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_admissions_data_gin ON admissions USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_medication_orders_data_gin ON medication_orders USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_medication_administrations_data_gin ON medication_administrations USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_deliveries_data_gin ON deliveries USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_pt_equipment_data_gin ON pt_equipment USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_pt_sessions_data_gin ON pt_sessions USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_queue_tickets_data_gin ON queue_tickets USING GIN (data);
