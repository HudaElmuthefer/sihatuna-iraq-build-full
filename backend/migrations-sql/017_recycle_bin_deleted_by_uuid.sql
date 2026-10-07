-- إصلاح ناتج مباشرة عن ترحيل المستخدمين لـPostgreSQL (راجع
-- migrations-sql/016_users_real_columns.sql): معرّف المستخدم صار UUID (بدل
-- رقم تسلسلي)، لكن recycle_bin.deleted_by بقي INTEGER — أي عملية حذف (تنقل
-- السجل لسلة المحذوفات أولاً، راجع routes/pgCrud.js) كانت ستفشل بخطأ
-- "invalid input syntax for type integer" لأنها تحاول إدخال UUID بعمود
-- INTEGER. عمودا hospital_payment_gateways.created_by وpayments.processed_by
-- كانا مصمَّمين UUID REFERENCES users(id) من البداية (توقّعاً لهذا الترحيل)؛
-- هذا العمود الوحيد المتبقي بالنوع القديم.
-- Made idempotent for this release's fresh-database bootstrap path: a
-- brand-new database's recycle_bin.deleted_by column (and its matching
-- foreign key) already comes from postgres_schema.sql as UUID, so this
-- migration has nothing left to do there — only a database created before
-- this fix, where the column is still the old INTEGER type, needs it applied.
DO $$
BEGIN
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'recycle_bin' AND column_name = 'deleted_by') = 'integer' THEN
        ALTER TABLE recycle_bin
            ALTER COLUMN deleted_by TYPE UUID USING NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'recycle_bin_deleted_by_fkey'
    ) THEN
        ALTER TABLE recycle_bin
            ADD CONSTRAINT recycle_bin_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
