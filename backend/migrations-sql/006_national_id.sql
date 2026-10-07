-- Adds a real, indexed national_id column to patients (matches the
-- pattern used earlier today for patient_code / blood_type), since
-- nationalId is now a real searchable field (see modules.js searchFields).
ALTER TABLE patients ADD COLUMN IF NOT EXISTS national_id VARCHAR(50);
UPDATE patients SET national_id = data->>'nationalId' WHERE national_id IS NULL AND data ? 'nationalId';
CREATE INDEX IF NOT EXISTS idx_patients_national_id ON patients(national_id);
