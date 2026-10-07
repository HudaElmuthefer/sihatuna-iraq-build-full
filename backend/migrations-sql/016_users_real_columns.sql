-- إصلاح بنيوي: جدول users الحقيقي بـPostgreSQL كان ناقصاً تماماً — حتى عمودَي
-- username وpassword (الأهم على الإطلاق لتسجيل الدخول) لم يكونا موجودين فيه
-- إطلاقاً. كل حسابات المستخدمين الفعلية كانت تُقرأ/تُكتَب من ملف مسطّح
-- (backend/data/db.json عبر utils/db.js) بلا أي قيود فعلية بجانب قاعدة
-- البيانات (لا تفرّد، لا مفاتيح خارجية، لا فحص تزامن) — راجع
-- backend/scripts/migrateUsersFromJson.js لسكربت الترحيل لمرة واحدة.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username              VARCHAR(100),
    ADD COLUMN IF NOT EXISTS password               TEXT,
    ADD COLUMN IF NOT EXISTS job_title               VARCHAR(200),
    ADD COLUMN IF NOT EXISTS avatar                  VARCHAR(20),
    ADD COLUMN IF NOT EXISTS color                   VARCHAR(20),
    ADD COLUMN IF NOT EXISTS permissions             JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS dashboard_layout        JSONB,
    ADD COLUMN IF NOT EXISTS must_change_password    BOOLEAN NOT NULL DEFAULT FALSE,
    -- يحل محل التحقق القديم المُثبَّت بالكود (id == 1) لمنع حذف الحساب
    -- الجذري الوحيد الذي أُنشئ به النظام أول مرة — لا معنى لربطه بمعرّف رقمي
    -- محدَّد بعد التحول لمعرّفات UUID (راجع routes/usersRoutes.js).
    ADD COLUMN IF NOT EXISTS is_primary_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMPTZ DEFAULT now();

-- تفرّد اسم المستخدم إلزامي لتسجيل الدخول (username أو email، راجع
-- routes/authRoutes.js) — فهرس جزئي (WHERE NOT NULL) بدل قيد UNIQUE مباشر
-- على العمود، لأن الأعمدة أُضيفت هنا بـALTER TABLE على جدول قد يحوي صفوفاً
-- موجودة مسبقاً بلا username (لن يحصل عملياً بهذا المشروع، لكن يبقي الترقية
-- آمنة على أي حالة).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users (username) WHERE username IS NOT NULL;
