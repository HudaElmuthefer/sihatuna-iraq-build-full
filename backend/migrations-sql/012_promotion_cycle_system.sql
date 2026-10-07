-- نظام حساب استحقاق العلاوة/الترفيع — ثلاثة جداول عامة (نفس نمط JSONB البحت
-- المستخدَم أصلاً بجداول promotions/allowances/salaries — id + data + طوابع
-- زمنية فقط، بدون أعمدة مفهرسة إضافية، مسجَّلة عبر pgCrud بـroutes/modules.js).
--
-- ── adjustment_types: جدول أنواع التعديلات القابل للتوسيع ───────────────────
-- بدل تثبيت "كتاب شكر / إجازة / عقوبة" كأنواع ثابتة بالكود، هذا الجدول يسمح
-- لقسم الموارد البشرية بإضافة أنواع جديدة مستقبلاً (لو تغيّرت الأنظمة) من
-- نفس الواجهة، بلا أي تعديل برمجي. كل نوع يحدد فقط اتجاهه (direction):
-- "advances" يقدّم تاريخ الاستحقاق، "delays" يؤخّره — المدة الفعلية تبقى
-- حقلاً متغيراً بكل سجل تعديل فردي (promotion_adjustments أدناه)، لا قيمة
-- ثابتة بنوع التعديل نفسه.
CREATE TABLE IF NOT EXISTS adjustment_types (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- بذر أولي بالأنواع الثلاثة المعروفة حالياً — أي نوع إضافي يُضاف لاحقاً من
-- واجهة الموارد البشرية نفسها، لا حاجة لتعديل هذا الملف.
INSERT INTO adjustment_types (data) VALUES
  ('{"name":"كتاب شكر وتقدير","nameEn":"Commendation Letter","direction":"advances","notes":"يقدّم تاريخ الاستحقاق (علاوة أو ترفيع) بمقدار مدة السجل"}'::jsonb),
  ('{"name":"إجازة","nameEn":"Leave","direction":"delays","notes":"يؤخّر تاريخ الاستحقاق بمقدار مدة السجل — راجع مع الموارد البشرية أي أنواع الإجازات الفعلية تُطبَّق عليها"}'::jsonb),
  ('{"name":"عقوبة","nameEn":"Penalty","direction":"delays","notes":"يؤخّر تاريخ الاستحقاق بمقدار مدة السجل"}'::jsonb)
ON CONFLICT DO NOTHING;

-- ── promotion_cycles: جدول مدة الدورة حسب الشهادة/الدرجة الوظيفية ───────────
-- كل صف: شهادة معيّنة (واختيارياً درجة وظيفية محدَّدة ضمنها) → عدد سنوات
-- الدورة الكاملة (علاوات سنوية حتى يستحق الترفيع). grade فارغ = ينطبق على
-- كل الدرجات لتلك الشهادة ما لم يوجد صف أدق (شهادة+درجة معاً) — يُفضَّل
-- التطابق الأدق دائماً بمنطق البحث (راجع promotionCalc.js بالفرونت إند).
--
-- ── تنبيه: القيم أدناه بيانات مبدئية توضيحية فقط (ليست أرقاماً رسمية) ───────
-- تُعرَض بالواجهة بعلامة تنبيه صريحة، ويجب استبدالها بالقيم الرسمية الفعلية
-- من قسم الموارد البشرية بمجرد توفرها — عبر نفس واجهة تعديل الجدول، بلا
-- حاجة لأي تعديل برمجي.
CREATE TABLE IF NOT EXISTS promotion_cycles (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

INSERT INTO promotion_cycles (data) VALUES
  ('{"certificate":"دبلوم","certificateEn":"Diploma","grade":"","cycleYears":5,"isPlaceholder":true,"notes":"قيمة مبدئية توضيحية — يجب تأكيدها من الموارد البشرية"}'::jsonb),
  ('{"certificate":"بكالوريوس","certificateEn":"Bachelor''s","grade":"","cycleYears":4,"isPlaceholder":true,"notes":"قيمة مبدئية توضيحية — يجب تأكيدها من الموارد البشرية"}'::jsonb),
  ('{"certificate":"ماجستير","certificateEn":"Master''s","grade":"","cycleYears":3,"isPlaceholder":true,"notes":"قيمة مبدئية توضيحية — يجب تأكيدها من الموارد البشرية"}'::jsonb),
  ('{"certificate":"دكتوراه","certificateEn":"Doctorate","grade":"","cycleYears":3,"isPlaceholder":true,"notes":"قيمة مبدئية توضيحية — يجب تأكيدها من الموارد البشرية"}'::jsonb)
ON CONFLICT DO NOTHING;

-- ── promotion_adjustments: سجلات التعديل الفعلية لكل موظف ───────────────────
-- كل صف: موظف محدَّد (employeeId) + نوع تعديل (adjustmentTypeId، مع direction
-- منسوخاً وقت الإدخال لثبات الحساب التاريخي حتى لو تغيّر تعريف النوع لاحقاً)
-- + مدة بالأشهر (durationMonths، حقل متغيّر بكل سجل — لا قيمة ثابتة بالنوع).
CREATE TABLE IF NOT EXISTS promotion_adjustments (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
