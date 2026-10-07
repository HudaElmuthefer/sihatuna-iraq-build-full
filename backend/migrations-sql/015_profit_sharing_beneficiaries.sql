-- تقسيم الحصص: قائمة مستفيدين حرة غير محدودة العدد لكل منشأة (مستثمر/طبيب/
-- صيدلي/أي أحد — name وtype وصفيان حران بلا قيد enum)، كل واحد بنسبته
-- المئوية من إجمالي إيرادات المنشأة. أعمدة حقيقية (لا JSONB) عمداً — فحص
-- "مجموع النسب لا يتجاوز 100%" (راجع routes/profitSharingRoutes.js) يحتاج
-- SUM(percentage) بسيط وموثوق بجانب الخادم، وهذا أبسط بكثير كعمود رقمي حقيقي
-- من استخراج JSONB. راجع utils/revenueAggregation.js لحساب المستحقات.
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
