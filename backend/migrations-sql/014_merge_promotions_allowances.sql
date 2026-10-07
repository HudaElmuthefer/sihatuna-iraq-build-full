-- دمج جدولي الترفيعات (promotions) والعلاوات (allowances) بجدول واحد
-- "سجل الترفيعات والعلاوات" — كل سجل الآن يمثّل حدث ترفيع و/أو علاوة لموظف
-- واحد معاً (بدل صفّين منفصلين بجدولين مختلفين)، مع أربعة حقول قرار مستقلة
-- (رقم/تاريخ قرار الترفيع، رقم/تاريخ قرار العلاوة) بدل حقل "رقم القرار"
-- الواحد المشترك سابقاً. راجع accounts/PromotionsAllowancesTab.js.
--
-- عمود status الفعلي بالجدولين القديمين لم يستخدمه أي طرف بالتطبيق فعلياً
-- للفلترة الفعلية بجانب الخادم (كل الفلترة كانت تجري محلياً بالواجهة على
-- القائمة الكاملة المجلوبة أصلاً) — فلا حاجة لعمود مفهرس مماثل بالجدول
-- الجديد؛ الحالتان (promotionStatus/allowanceStatus) تُخزَّنان ضمن data
-- JSONB مباشرة كبقية جداول المشروع.
CREATE TABLE IF NOT EXISTS promotions_allowances (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ترحيل بيانات الترفيعات الحقيقية الموجودة فعلياً — status كان عموداً حقيقياً
-- منفصلاً بالجدول القديم (وليس ضمن data JSONB)، يُدمَج هنا يدوياً ضمن data.
INSERT INTO promotions_allowances (data, created_at, updated_at)
SELECT
  (data || jsonb_build_object(
    'promotionDate', data->'date',
    'promotionDecisionNo', data->'decisionNo',
    'promotionDecisionDate', NULL,
    'promotionStatus', to_jsonb(status)
  )) - 'date' - 'decisionNo',
  created_at, updated_at
FROM promotions;

-- ترحيل بيانات العلاوات الحقيقية الموجودة فعلياً بنفس الطريقة.
INSERT INTO promotions_allowances (data, created_at, updated_at)
SELECT
  (data || jsonb_build_object(
    'allowanceType', data->'type',
    'allowanceDate', data->'date',
    'allowanceDecisionNo', data->'decisionNo',
    'allowanceDecisionDate', NULL,
    'allowanceStatus', to_jsonb(status)
  )) - 'date' - 'decisionNo' - 'type',
  created_at, updated_at
FROM allowances;

DROP TABLE promotions;
DROP TABLE allowances;
