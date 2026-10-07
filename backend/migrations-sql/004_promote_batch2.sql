-- ============================================================================
-- SIHATUNA IRAQ ERP — ترقية حقول JSONB لأعمدة حقيقية (الدفعة الثانية)
-- ============================================================================
-- كل حقل هنا مُختار بناءً على دليل فعلي من كود الفرونت إند (فلترة حقيقية
-- تُستخدم اليوم بكل صفحة على حدة)، وليس تخميناً. الموديولات المستثناة عمداً
-- (qualityAudits, qualityNCs, qualityKPIs) تُركت JSONB بحت بقرار سابق موثّق
-- بالكود (حجم بيانات طبيعي صغير جداً بمستشفى واحد، ما يستاهل التعقيد).
-- ============================================================================

ALTER TABLE vaccinations ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE vaccinations SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
CREATE INDEX IF NOT EXISTS idx_vaccinations_status ON vaccinations(status);

ALTER TABLE medical_leaves ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE medical_leaves SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
CREATE INDEX IF NOT EXISTS idx_medical_leaves_status ON medical_leaves(status);

ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS status VARCHAR(30);
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS priority VARCHAR(30);
UPDATE lab_tests SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
UPDATE lab_tests SET priority = data->>'priority' WHERE priority IS NULL AND data ? 'priority';
CREATE INDEX IF NOT EXISTS idx_lab_tests_status ON lab_tests(status);
CREATE INDEX IF NOT EXISTS idx_lab_tests_priority ON lab_tests(priority);

ALTER TABLE radiology ADD COLUMN IF NOT EXISTS status VARCHAR(30);
ALTER TABLE radiology ADD COLUMN IF NOT EXISTS modality VARCHAR(30);
UPDATE radiology SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
UPDATE radiology SET modality = data->>'modality' WHERE modality IS NULL AND data ? 'modality';
CREATE INDEX IF NOT EXISTS idx_radiology_status ON radiology(status);
CREATE INDEX IF NOT EXISTS idx_radiology_modality ON radiology(modality);

ALTER TABLE pharmacy_orders ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE pharmacy_orders SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_status ON pharmacy_orders(status);

ALTER TABLE procurement ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE procurement SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
CREATE INDEX IF NOT EXISTS idx_procurement_status ON procurement(status);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS type VARCHAR(30);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS status VARCHAR(30);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS priority VARCHAR(30);
UPDATE documents SET type = data->>'type' WHERE type IS NULL AND data ? 'type';
UPDATE documents SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
UPDATE documents SET priority = data->>'priority' WHERE priority IS NULL AND data ? 'priority';
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_priority ON documents(priority);

ALTER TABLE service_prices ADD COLUMN IF NOT EXISTS category VARCHAR(50);
UPDATE service_prices SET category = data->>'category' WHERE category IS NULL AND data ? 'category';
CREATE INDEX IF NOT EXISTS idx_service_prices_category ON service_prices(category);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE transactions SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE promotions SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status);

ALTER TABLE allowances ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE allowances SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
CREATE INDEX IF NOT EXISTS idx_allowances_status ON allowances(status);

ALTER TABLE ambulance_vehicles ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE ambulance_vehicles SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
CREATE INDEX IF NOT EXISTS idx_ambulance_vehicles_status ON ambulance_vehicles(status);

ALTER TABLE ambulance_missions ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE ambulance_missions SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
CREATE INDEX IF NOT EXISTS idx_ambulance_missions_status ON ambulance_missions(status);

ALTER TABLE medication_orders ADD COLUMN IF NOT EXISTS admission_id INTEGER;
UPDATE medication_orders SET admission_id = (data->>'admissionId')::INTEGER WHERE admission_id IS NULL AND data ? 'admissionId';
CREATE INDEX IF NOT EXISTS idx_medication_orders_admission_id ON medication_orders(admission_id);

ALTER TABLE medication_administrations ADD COLUMN IF NOT EXISTS order_id INTEGER;
UPDATE medication_administrations SET order_id = (data->>'orderId')::INTEGER WHERE order_id IS NULL AND data ? 'orderId';
CREATE INDEX IF NOT EXISTS idx_medication_administrations_order_id ON medication_administrations(order_id);

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS stage VARCHAR(30);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS baby_status VARCHAR(30);
UPDATE deliveries SET stage = data->>'stage' WHERE stage IS NULL AND data ? 'stage';
UPDATE deliveries SET baby_status = data->>'babyStatus' WHERE baby_status IS NULL AND data ? 'babyStatus';
CREATE INDEX IF NOT EXISTS idx_deliveries_stage ON deliveries(stage);
CREATE INDEX IF NOT EXISTS idx_deliveries_baby_status ON deliveries(baby_status);

ALTER TABLE pt_equipment ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE pt_equipment SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
CREATE INDEX IF NOT EXISTS idx_pt_equipment_status ON pt_equipment(status);

ALTER TABLE pt_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(30);
ALTER TABLE pt_sessions ADD COLUMN IF NOT EXISTS date DATE;
UPDATE pt_sessions SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
UPDATE pt_sessions SET date = NULLIF(data->>'date','')::DATE WHERE date IS NULL AND data ? 'date';
CREATE INDEX IF NOT EXISTS idx_pt_sessions_status ON pt_sessions(status);
CREATE INDEX IF NOT EXISTS idx_pt_sessions_date ON pt_sessions(date);

ALTER TABLE queue_tickets ADD COLUMN IF NOT EXISTS department VARCHAR(100);
ALTER TABLE queue_tickets ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE queue_tickets SET department = data->>'department' WHERE department IS NULL AND data ? 'department';
UPDATE queue_tickets SET status = data->>'status' WHERE status IS NULL AND data ? 'status';
CREATE INDEX IF NOT EXISTS idx_queue_tickets_department ON queue_tickets(department);
CREATE INDEX IF NOT EXISTS idx_queue_tickets_status ON queue_tickets(status);
