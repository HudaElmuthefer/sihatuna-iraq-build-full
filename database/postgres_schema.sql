-- ============================================================================
-- SIHATUNA IRAQ ERP — PostgreSQL Schema
-- يغطي: الهيكل الأساسي (مختصر) + نظام الدفع القابل للتهيئة + CRM المرضى الشامل
-- ملاحظة: هذا Schema إضافي/ترقية. الجداول الأساسية (patients, users, ...) موجودة
-- بشكل مختصر هنا لضمان الترابط (Foreign Keys) — عدّل الأعمدة لتطابق حقولك الفعلية
-- بعد قراءة ملفات JSON الحالية.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1) المستشفيات / المنشآت (Multi-tenant — كل نسخة منصبة على مستشفى معين)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitals (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_ar         VARCHAR(200) NOT NULL,
    name_en         VARCHAR(200) NOT NULL,
    address         TEXT,
    phone           VARCHAR(50),
    is_active       BOOLEAN DEFAULT TRUE,
    -- قائمة مفاتيح الصفحات المفعّلة لهذه المنشأة تحديداً (مثل ['patients',
    -- 'doctors','appointments']). NULL أو مصفوفة فارغة = كل الصفحات مفعّلة
    -- (سلوك افتراضي متوافق تماماً مع أي منشأة موجودة مسبقاً، ولا يكسر شيء).
    enabled_pages   JSONB,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 1ب) إعدادات النظام العامة (مفتاح/قيمة) — أول استخدام: تفعيل نظام المنشآت
-- المتعددة. تصميم مستقبلي: نشر مركزي واحد (مثلاً بسيرفر مديرية صحة) يخدم
-- عدة مستشفيات تابعة، كل واحدة ترى بياناتها الخاصة بمعزل عن الباقي.
-- المرحلة الحالية أساس بسيط فقط (مفتاح تشغيل + جدول مستشفيات + ربط المرضى
-- بمستشفى)، بدون فلترة فعلية شاملة لكل الموديولات بعد — هذا يأتي بمرحلة لاحقة
-- منفصلة بعد وضوح المتطلبات الفعلية من الجهة المستفيدة.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
    key             VARCHAR(100) PRIMARY KEY,
    value           JSONB NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now()
);
INSERT INTO system_settings (key, value) VALUES ('multi_hospital_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2) المستخدمين (حسابات تسجيل الدخول الفعلية — كل حقل هنا مطابق تماماً لما
-- تقرأه/تكتبه routes/authRoutes.js وroutes/usersRoutes.js؛ راجع
-- migrations-sql/016_users_real_columns.sql لتاريخ إضافة الأعمدة أدناه على
-- قاعدة أُنشئت قبل هذا التصحيح).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hospital_id           UUID REFERENCES hospitals(id) ON DELETE SET NULL,
    full_name             VARCHAR(200) NOT NULL,
    username              VARCHAR(100),
    password              TEXT,                          -- تجزئة bcrypt، ليست نصاً صريحاً أبداً
    email                 VARCHAR(200) UNIQUE,
    role                  VARCHAR(50) NOT NULL DEFAULT 'staff', -- admin | staff | doctor | nurse | accountant | ...
    job_title             VARCHAR(200),
    avatar                VARCHAR(20),
    color                 VARCHAR(20),
    permissions           JSONB NOT NULL DEFAULT '[]'::jsonb,
    dashboard_layout      JSONB,
    must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
    -- الحساب الجذري الوحيد الذي أُنشئ به النظام أول مرة — لا يمكن حذفه (راجع
    -- routes/usersRoutes.js)، بغض النظر عن قيمة id (UUID، لا معنى لتمييزه بقيمة ثابتة).
    is_primary_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active             BOOLEAN DEFAULT TRUE,
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users (username) WHERE username IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3) المرضى
-- ----------------------------------------------------------------------------
-- ملاحظة تصميم مهمة: نستخدم هنا معرّفاً رقمياً بسيطاً (SERIAL) بدل UUID،
-- ليطابق النمط الحالي المستخدم بباقي النظام (db.json) ويسهّل ترحيل البيانات
-- الحالية دون تغيير أي معرّف موجود مسبقاً بالواجهة.
-- عمود "data" (JSONB) يخزّن كامل بيانات المريض كما ترسلها الواجهة تماماً —
-- هذا يتجنّب مشكلة حقيقية واجهناها سابقاً: أي افتراض خاطئ بأسماء الأعمدة
-- (كما حصل بمخطط تحقق المواعيد) يرفض عمليات الحفظ بصمت. بتخزين البيانات
-- كاملة كـJSONB، أي حقل تضيفه الواجهة مستقبلاً (حتى لو لم نعرف باسمه بعد)
-- يُخزَّن ويُسترجَع بشكل صحيح دون أي حاجة لتعديل بنية الجدول لاحقاً.
-- الأعمدة الصريحة (name, phone, status) موجودة فقط للفهرسة والبحث السريع.
-- patient_code/blood_type/national_id: رُقِّيت من JSONB لأعمدة حقيقية بـ
-- migrations-sql/002_promote_columns.sql و006_national_id.sql — مُضافة هنا
-- مباشرة لتطابق قاعدة مُرحَّلة بكامل سلسلة الترحيلات.
CREATE TABLE IF NOT EXISTS patients (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    phone           VARCHAR(50) NOT NULL,
    status          VARCHAR(30) DEFAULT 'active',
    patient_code    VARCHAR(50),
    blood_type      VARCHAR(10),
    national_id     VARCHAR(50),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status);
CREATE INDEX IF NOT EXISTS idx_patients_patient_code ON patients(patient_code);
CREATE INDEX IF NOT EXISTS idx_patients_blood_type ON patients(blood_type);
CREATE INDEX IF NOT EXISTS idx_patients_national_id ON patients(national_id);

-- ----------------------------------------------------------------------------
-- 3ب) الأطباء (بنفس نمط جدول المرضى تماماً: معرّف رقمي بسيط + تخزين مرن)
-- ----------------------------------------------------------------------------
-- specialization: رُقِّي من JSONB لعمود حقيقي بـ migrations-sql/002_promote_columns.sql
CREATE TABLE IF NOT EXISTS doctors (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    phone           VARCHAR(50) NOT NULL,
    status          VARCHAR(30) DEFAULT 'active',
    specialization  VARCHAR(150),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctors_phone ON doctors(phone);
CREATE INDEX IF NOT EXISTS idx_doctors_status ON doctors(status);
CREATE INDEX IF NOT EXISTS idx_doctors_specialization ON doctors(specialization);

-- ----------------------------------------------------------------------------
-- 3ج) المواعيد
-- ----------------------------------------------------------------------------
-- ملاحظة مهمة: الصفحة الفعلية (AppointmentsPage.js) تخزّن اسم المريض والطبيب
-- كنص مباشر بالحقلين "patient" و"doctor" (وليس معرّفاً رقمياً)، وهذا بالضبط
-- ما اعتمدناه هنا كأعمدة صريحة لتفادي تكرار خطأ سابق واجهناه (افتراض خاطئ
-- بأسماء الأعمدة رفض كل عمليات الحفظ بصمت).
CREATE TABLE IF NOT EXISTS appointments (
    id              SERIAL PRIMARY KEY,
    patient         VARCHAR(200) NOT NULL,
    doctor          VARCHAR(200) NOT NULL,
    date            DATE NOT NULL,
    status          VARCHAR(30) DEFAULT 'pending',
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- ----------------------------------------------------------------------------
-- 3د) الموظفين
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    job_title       VARCHAR(200),
    status          VARCHAR(30) DEFAULT 'active',
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

-- ----------------------------------------------------------------------------
-- 3هـ) المتقاعدين
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retired (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    job_title       VARCHAR(200),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 3و) باقي الموديولات (تخزين JSONB بحت — بدون أعمدة فهرسة إضافية)
-- ----------------------------------------------------------------------------
-- هذه الموديولات لا تحتاج فلترة أو بحث بجانب الخادم حالياً (الفرونت إند يجلب
-- القائمة كاملة ويُفلتر بجافاسكربت محلياً)، فاكتفينا بتخزين كامل السجل داخل
-- عمود data مباشرة. هذا يجنّبنا خطر تكرار خطأ افتراض أسماء أعمدة غير مطابقة
-- (كما حصل سابقاً بمخطط تحقق المواعيد) عبر 21 صفحة مختلفة دفعة واحدة.

CREATE TABLE IF NOT EXISTS departments (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outgoing (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incoming (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- status: رُقِّي من JSONB لعمود حقيقي بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS vaccinations (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vaccinations_status ON vaccinations(status);

-- status: رُقِّي من JSONB لعمود حقيقي بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS medical_leaves (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medical_leaves_status ON medical_leaves(status);

CREATE TABLE IF NOT EXISTS dossiers (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- status/priority: رُقِّيا من JSONB لعمودين حقيقيين بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS lab_tests (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    priority        VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_tests_status ON lab_tests(status);
CREATE INDEX IF NOT EXISTS idx_lab_tests_priority ON lab_tests(priority);

-- status/modality: رُقِّيا من JSONB لعمودين حقيقيين بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS radiology (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    modality        VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_radiology_status ON radiology(status);
CREATE INDEX IF NOT EXISTS idx_radiology_modality ON radiology(modality);

-- status: رُقِّي من JSONB لعمود حقيقي بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS pharmacy_orders (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_status ON pharmacy_orders(status);

CREATE TABLE IF NOT EXISTS assets (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- status: رُقِّي من JSONB لعمود حقيقي بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS procurement (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_procurement_status ON procurement(status);

CREATE TABLE IF NOT EXISTS projects (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- type/status/priority: رُقِّيت من JSONB لأعمدة حقيقية بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS documents (
    id              SERIAL PRIMARY KEY,
    type            VARCHAR(30),
    status          VARCHAR(30),
    priority        VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_priority ON documents(priority);

-- عمود "category" صريح (وليس JSONB فقط) لأن routes/modules.js يسجّله كـ
-- indexedColumns حقيقي عند استيراد Excel (registerExcelImport('servicePrices', ...))
-- — بدونه، أول استيراد Excel لأسعار الخدمات يفشل بخطأ "column category of
-- relation service_prices does not exist" على أي قاعدة بيانات مُنشأة من هذا
-- الملف فقط (كان مضافاً سابقاً فقط عبر migrations-sql/004_promote_batch2.sql
-- على القواعد الموجودة مسبقاً، وغائباً عن هذا الملف الأساسي لتنصيب جديد).
CREATE TABLE IF NOT EXISTS service_prices (
    id              SERIAL PRIMARY KEY,
    category        VARCHAR(50),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_prices_category ON service_prices(category);

-- status: رُقِّي من JSONB لعمود حقيقي بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS transactions (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

-- تقسيم الحصص (Profit Sharing) — راجع migrations-sql/015_profit_sharing_beneficiaries.sql
-- لشرح كامل. أعمدة حقيقية عمداً (لا JSONB) لأجل فحص SUM(percentage) <= 100
-- الموثوق بجانب الخادم (routes/profitSharingRoutes.js).
CREATE TABLE IF NOT EXISTS profit_sharing_beneficiaries (
    id           SERIAL PRIMARY KEY,
    hospital_id  UUID REFERENCES hospitals(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    type         TEXT,
    percentage   NUMERIC(5,2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profit_sharing_beneficiaries_hospital ON profit_sharing_beneficiaries(hospital_id);

-- status: رُقِّي من JSONB لعمود حقيقي بـ migrations-sql/004_promote_batch2.sql
-- ── تنبيه: هذان الجدولان يُدمَجان لاحقاً بـmigrations-sql/014_merge_promotions_allowances.sql
-- بجدول promotions_allowances واحد، ثم يُحذَفان (DROP) — تعمّداً لم يُعدَّلا هنا
-- ليبقيا موجودَين على أي تثبيت جديد، لأن migration 014 (وindex بـ001_hospital_indexes.sql)
-- يفترضان وجودهما فعلياً قبل تشغيلهما. حذفهما من هنا سبق وكسر migrations-sql بالكامل
-- على أي قاعدة بيانات جديدة (run-migrations.js يتوقف عند أول فشل) — لا تُعدهما مطلقاً
-- بدون تحديث migrations-sql/001 وmigrations-sql/014 بنفس الوقت.
CREATE TABLE IF NOT EXISTS promotions (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status);

-- status: رُقِّي من JSONB لعمود حقيقي بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS allowances (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_allowances_status ON allowances(status);

CREATE TABLE IF NOT EXISTS salaries (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- status: رُقِّي من JSONB لعمود حقيقي بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS ambulance_vehicles (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ambulance_vehicles_status ON ambulance_vehicles(status);

-- ── إصلاح: صفحة إدارة الجودة (ISO) كانت بدون أي جدول حقيقي إطلاقاً ──────────
-- كانت البيانات (مراجعات، حالات عدم مطابقة، مؤشرات أداء) تُخزَّن بذاكرة
-- المتصفح المؤقتة فقط (React state محلي) — تُفقَد بمجرد تحديث الصفحة، وترجع
-- لنفس البيانات التجريبية الثابتة بالكود كل مرة. الجداول الثلاثة تحت تحل هذا.
CREATE TABLE IF NOT EXISTS quality_audits (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quality_ncs (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quality_kpis (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── إصلاح: سجل صيانة حقيقي للمركبات والأصول (بدل الكتابة فوق تاريخ آخر صيانة) ──
CREATE TABLE IF NOT EXISTS asset_maintenance_log (
    id              SERIAL PRIMARY KEY,
    asset_id        INTEGER,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_maintenance_log_asset_id ON asset_maintenance_log(asset_id);

CREATE TABLE IF NOT EXISTS ambulance_maintenance_log (
    id              SERIAL PRIMARY KEY,
    vehicle_id      INTEGER,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ambulance_maintenance_log_vehicle_id ON ambulance_maintenance_log(vehicle_id);

-- status: رُقِّي من JSONB لعمود حقيقي بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS ambulance_missions (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ambulance_missions_status ON ambulance_missions(status);

-- ----------------------------------------------------------------------------
-- 4) الفواتير
-- ----------------------------------------------------------------------------
-- بنفس نمط المرضى والأطباء والمواعيد: معرّف رقمي بسيط + تخزين مرن (JSONB).
-- الصفحة الفعلية (BillingPage.js / AppContext.js) ترسل: patientId, items
-- (قائمة كاملة مضمَّنة بالفاتورة نفسها، وليست بجدول منفصل)، status، total،
-- paymentMethod، createdAt، paidAt، referenceCode.
CREATE TABLE IF NOT EXISTS invoices (
    id              SERIAL PRIMARY KEY,
    patient_id      INTEGER REFERENCES patients(id) ON DELETE CASCADE,
    status          VARCHAR(30) DEFAULT 'unpaid',
    total           NUMERIC(14,2) DEFAULT 0,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- جدول تفصيلي اختياري لبنود الفاتورة (غير مستخدَم حالياً من الواجهة —
-- البنود مضمَّنة داخل عمود "data" بجدول invoices مباشرة، وهذا الجدول محفوظ
-- لتقارير مالية تفصيلية مستقبلية إن احتجناها)
CREATE TABLE IF NOT EXISTS invoice_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id      INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
    description_ar  VARCHAR(300),
    description_en  VARCHAR(300),
    quantity        NUMERIC(10,2) DEFAULT 1,
    unit_price      NUMERIC(14,2) NOT NULL,
    line_total      NUMERIC(14,2) NOT NULL
);

-- ============================================================================
-- 5) نظام الدفع القابل للتهيئة من الإدمن (Payment Gateway Configuration)
-- ============================================================================

-- الأنواع المدعومة كمرجع (يمكن توسيعها بإضافة صف جديد فقط، بدون تعديل كود)
CREATE TABLE IF NOT EXISTS payment_providers (
    code            VARCHAR(50) PRIMARY KEY,   -- 'cash','zaincash','fastpay','qicard','bank_card','paypal','western_union'
    name_ar         VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100) NOT NULL,
    provider_type   VARCHAR(20) NOT NULL,      -- 'cash' | 'local_card' | 'international'
    requires_credentials BOOLEAN DEFAULT TRUE
);

INSERT INTO payment_providers (code, name_ar, name_en, provider_type, requires_credentials) VALUES
('cash',           'دفع نقدي',              'Cash',             'cash',          FALSE),
('zaincash',       'زين كاش',               'ZainCash',         'local_card',    TRUE),
('fastpay',        'فاست باي',              'FastPay',          'local_card',    TRUE),
('qicard',         'كي كارد',               'Qi Card',          'local_card',    TRUE),
('bank_card',      'بطاقة مصرفية محلية',    'Local Bank Card',  'local_card',    TRUE),
('paypal',         'باي بال',               'PayPal',           'international', TRUE),
('western_union',  'ويسترن يونيون',         'Western Union',    'international', TRUE)
ON CONFLICT (code) DO NOTHING;

-- إعدادات كل مستشفى: الإدمن يفعّل بوابة أو أكثر ويدخل بياناتها
-- الحقول الحساسة (مفاتيح API) تُخزّن مشفّرة (pgcrypto) وليست نص صريح
CREATE TABLE IF NOT EXISTS hospital_payment_gateways (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hospital_id         UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
    provider_code       VARCHAR(50) NOT NULL REFERENCES payment_providers(code),
    is_active           BOOLEAN DEFAULT TRUE,
    is_sandbox           BOOLEAN DEFAULT TRUE,     -- وضع تجريبي أو حقيقي
    display_order       INT DEFAULT 0,
    credentials_encrypted BYTEA,                    -- JSON مشفر: {api_key, api_secret, merchant_id, ...}
    extra_config         JSONB DEFAULT '{}'::jsonb,  -- إعدادات غير حساسة (رابط webhook، عملة افتراضية...)
    created_by           UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now(),
    UNIQUE (hospital_id, provider_code)
);

-- سجل عمليات الدفع الفعلية
CREATE TABLE IF NOT EXISTS payments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hospital_id         UUID REFERENCES hospitals(id) ON DELETE SET NULL,
    invoice_id          INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    patient_id          INTEGER REFERENCES patients(id) ON DELETE SET NULL,
    provider_code       VARCHAR(50) REFERENCES payment_providers(code),
    amount               NUMERIC(14,2) NOT NULL,
    currency             VARCHAR(10) NOT NULL DEFAULT 'IQD',
    status                VARCHAR(30) NOT NULL DEFAULT 'pending', -- pending|completed|failed|refunded
    gateway_transaction_id VARCHAR(150),   -- الرقم المرجعي من البوابة (أو يدوي لـ WU/Cash)
    reference_note        TEXT,             -- لملاحظات الدفع اليدوي (مثلاً رقم تحويل Western Union)
    processed_by           UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- ============================================================================
-- 6) CRM المرضى — شامل (تواصل + متابعات + حملات توعية)
-- ============================================================================
-- بنفس نمط JSONB المرن المعتمد بكل الموديولات الأخرى (انظر تعليق جدول
-- patients أعلاه للشرح الكامل). معرّف المريض (patient_id) و معرّف الحملة
-- (campaign_id) أعمدة صريحة لأنها روابط فعلية (Foreign Keys) بجداول أخرى،
-- بينما باقي الحقول (نوع المتابعة، القناة، نص الرسالة، إلخ) تُخزَّن كاملة
-- بعمود data مباشرة لتفادي أي تعارض بأسماء أعمدة غير مطابقة للواجهة الفعلية.

CREATE TABLE IF NOT EXISTS crm_interactions (
    id              SERIAL PRIMARY KEY,
    patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_patient ON crm_interactions(patient_id);

CREATE TABLE IF NOT EXISTS crm_patient_segments (
    id              SERIAL PRIMARY KEY,
    patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    segment_code    VARCHAR(50) NOT NULL,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (patient_id, segment_code)
);

CREATE TABLE IF NOT EXISTS crm_follow_ups (
    id              SERIAL PRIMARY KEY,
    patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_followups_status ON crm_follow_ups(status);

CREATE TABLE IF NOT EXISTS crm_campaigns (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(20) DEFAULT 'draft',
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_campaign_targets (
    id              SERIAL PRIMARY KEY,
    campaign_id     INTEGER NOT NULL REFERENCES crm_campaigns(id) ON DELETE CASCADE,
    patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (campaign_id, patient_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_targets_campaign ON crm_campaign_targets(campaign_id);

-- ── سلة المحذوفات (Recycle Bin) ─────────────────────────────────────────────
-- جدول واحد مشترك لكل الموديولات: بدل حذف السجل نهائياً من جدوله الأصلي،
-- pgCrud.js ينقله هنا كاملاً (module_key يحدد أي موديول، original_id رقمه
-- الأصلي، data نسخة كاملة مطابقة تماماً لما كانت تعرضه الواجهة). لا يظهر
-- بقوائم الموديول الأصلي بعد الآن (فعلياً محذوف من جدوله)، لكن يبقى قابلاً
-- للاسترجاع أو الحذف النهائي من صفحة الإعدادات (صلاحية إدمن فقط).
CREATE TABLE IF NOT EXISTS recycle_bin (
    id              SERIAL PRIMARY KEY,
    module_key      VARCHAR(100) NOT NULL,
    original_id     INTEGER NOT NULL,
    data            JSONB NOT NULL,
    hospital_id     TEXT,
    deleted_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    deleted_by_name VARCHAR(200),
    deleted_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recycle_bin_module ON recycle_bin(module_key);
CREATE INDEX IF NOT EXISTS idx_recycle_bin_hospital ON recycle_bin(hospital_id);

-- ── الردهات (إدارة المرضى الداخليين) ────────────────────────────────────────
-- wards: الردهات نفسها (اسم، سعة أسرّة)
CREATE TABLE IF NOT EXISTS wards (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- admissions: كل عملية إدخال مريض لردهة (سرير، تشخيص، الطبيب المعالج، الحالة، الخروج)
CREATE TABLE IF NOT EXISTS admissions (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- medication_orders: الأدوية التي يكتبها الطبيب لكل حالة إدخال (اسم الدواء،
-- الجرعة، التكرار، الطبيب الكاتب، تاريخ البدء/الانتهاء)
-- admission_id: رُقِّي من JSONB (admissionId) لعمود حقيقي بـ
-- migrations-sql/004_promote_batch2.sql — بدون قيد FK فعلي (مطابق للإنتاج).
CREATE TABLE IF NOT EXISTS medication_orders (
    id              SERIAL PRIMARY KEY,
    admission_id    INTEGER,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medication_orders_admission_id ON medication_orders(admission_id);

-- medication_administrations: سجل كل مرة أُعطي فيها الدواء فعلياً (الممرض،
-- الوقت، تأكيد الإعطاء) — سجل منفصل عن الوصفة نفسها لأن دواء واحد يُعطى
-- عدة مرات (مثلاً 3 مرات باليوم لمدة أسبوع = عدة سجلات إعطاء لنفس الوصفة)
-- order_id: رُقِّي من JSONB (orderId) لعمود حقيقي بـ
-- migrations-sql/004_promote_batch2.sql — بدون قيد FK فعلي (مطابق للإنتاج).
CREATE TABLE IF NOT EXISTS medication_administrations (
    id              SERIAL PRIMARY KEY,
    order_id        INTEGER,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medication_administrations_order_id ON medication_administrations(order_id);

-- ── صالة الولادة ─────────────────────────────────────────────────────────
-- stage/baby_status: رُقِّيا من JSONB (stage/babyStatus) لعمودين حقيقيين بـ
-- migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS deliveries (
    id              SERIAL PRIMARY KEY,
    stage           VARCHAR(30),
    baby_status     VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_stage ON deliveries(stage);
CREATE INDEX IF NOT EXISTS idx_deliveries_baby_status ON deliveries(baby_status);

-- ── العلاج الطبيعي ───────────────────────────────────────────────────────
-- status: رُقِّي من JSONB لعمود حقيقي بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS pt_equipment (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pt_equipment_status ON pt_equipment(status);

-- status/date: رُقِّيا من JSONB لعمودين حقيقيين بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS pt_sessions (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(30),
    date            DATE,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pt_sessions_status ON pt_sessions(status);
CREATE INDEX IF NOT EXISTS idx_pt_sessions_date ON pt_sessions(date);

-- ── إدارة الطابور ────────────────────────────────────────────────────────
-- department/status: رُقِّيا من JSONB لعمودين حقيقيين بـ migrations-sql/004_promote_batch2.sql
CREATE TABLE IF NOT EXISTS queue_tickets (
    id              SERIAL PRIMARY KEY,
    department      VARCHAR(100),
    status          VARCHAR(30),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_queue_tickets_department ON queue_tickets(department);
CREATE INDEX IF NOT EXISTS idx_queue_tickets_status ON queue_tickets(status);

