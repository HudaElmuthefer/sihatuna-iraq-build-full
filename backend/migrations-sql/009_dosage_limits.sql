-- جدول حدود الجرعات الآمنة (فحص فوري بلا استدعاء ذكاء اصطناعي) — نفس فلسفة
-- migrations-sql/008_drug_interactions.sql بالضبط: طبقة أولى (bot/rules)
-- من backend/agents/dosageAgent.js قبل أي استدعاء AI — أرخص، أسرع، ولا
-- يعتمد على توفّر مفتاح API.
--
-- ── لماذا نطاقات عمر/وزن (min/max) بدل معدّل مجم/كجم واحد؟ ───────────────────
-- الجرعات الحقيقية (خصوصاً للأطفال) تُحسَب عادةً كمعدّل لكل كيلوغرام
-- (مثال: باراسيتامول 60 مجم/كجم/يوم)، لا كرقم مطلق ثابت. لتبسيط الفحص هنا
-- (مقارنة رقمية مباشرة بلا حساب معادلات وقت الطلب)، نخزّن سقفاً مطلقاً
-- محسوباً مسبقاً لكل نطاق عمر/وزن — بنفس أسلوب جداول الجرعات السريعة
-- المستخدَمة فعلياً بالمستشفيات (نطاق وزن ← جرعة واحدة)، وليس حساباً دقيقاً
-- لكل كيلوغرام بالضبط. هذا يعني الفحص هنا **تقريبي بالتصميم** — حالات حدّية
-- (وزن/عمر عند حافة نطاقين، أو دواء غير مُدرَج) تُحال تلقائياً لطبقة AI
-- الاحتياطية، وتبقى مراجعة الصيدلاني/الطبيب ضرورية دائماً (نفس تحذير باقي
-- ميزات الذكاء الاصطناعي بهذا المشروع — راجع DosageCheckPage.js بالفرونت
-- إند للتحذير الظاهر للمستخدم).
--
-- min_age/max_age بالسنوات، min_weight_kg/max_weight_kg بالكيلوغرام — أي
-- منهم NULL يعني "بلا حد بهذا الاتجاه" (مثال: max_age NULL يعني يشمل كل
-- الأعمار الأكبر ضمن هذا الصف). max_daily_dose = 0 يُستخدَم صراحة لتمثيل
-- "ممنوع منعاً باتاً بهذا العمر" (مثال: أسبرين للأطفال — راجع البذر أدناه)
-- بدل صف مفقود قد يُفسَّر خطأً كـ"لا بيانات" المحايدة.
CREATE TABLE IF NOT EXISTS dosage_limits (
  id SERIAL PRIMARY KEY,
  drug_name VARCHAR(200) NOT NULL,
  min_age NUMERIC(5,2),
  max_age NUMERIC(5,2),
  min_weight_kg NUMERIC(6,2),
  max_weight_kg NUMERIC(6,2),
  max_daily_dose NUMERIC(10,2) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'mg',
  notes TEXT,
  recommendation TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dosage_limits_drug_name ON dosage_limits (LOWER(drug_name));
-- فهرس فريد يمنع تكرار نفس الصف بالضبط (نفس الدواء + نفس نطاق عمر/وزن) عند
-- إعادة تشغيل هذا الملف (idempotent) — لا يمنع عدة نطاقات مختلفة لنفس
-- الدواء (وهذا مقصود ومطلوب: باراسيتامول له صف أطفال وصف بالغين). لازم
-- يشمل نطاق الوزن أيضاً لا العمر فقط — إصلاح: أوميبرازول له نطاقا وزن
-- مختلفان (10-20كغ، 20كغ فأكثر) بنفس نطاق العمر بالضبط (1-11 سنة)؛ فهرس
-- بالعمر فقط كان يعتبرهما "نفس الصف" ويُسقِط الثاني بصمت عبر ON CONFLICT
-- DO NOTHING أدناه (تحقّقنا فعلياً: هذا حصل بالضبط قبل هذا الإصلاح).
-- COALESCE يحوّل NULL إلى قيمة ثابتة (-1) لأن NULL لا يساوي NULL أبداً
-- بفهرس التفرّد (UNIQUE)، فبدونها صفوف بنفس القيم لكن حداً NULL كانت
-- ستُعتبَر "مختلفة" دائماً ولا تمنع تكرار إدراج idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dosage_limits_unique_band
  ON dosage_limits (LOWER(drug_name), COALESCE(min_age,-1), COALESCE(max_age,-1), COALESCE(min_weight_kg,-1), COALESCE(max_weight_kg,-1));

-- ── بذر أولي: 6 أدوية شائعة (نفس أدوية migrations-sql/008 حيثما أمكن
-- للاتساق)، بصيغتين (عربي/إنجليزي) كنفس نمط جدول التفاعلات — كل نطاق
-- عمر/وزن مبني على مرجع سريري حقيقي (مصادر مذكورة بالتعليق فوق كل دواء)،
-- لا أرقام مُختلَقة. هذا بذر أولي أساسي فقط، لا قائمة شاملة — نطاق ضيق
-- عمداً حتى يبقى كل رقم قابلاً للتحقق من مصدره الفعلي.
INSERT INTO dosage_limits (drug_name, min_age, max_age, min_weight_kg, max_weight_kg, max_daily_dose, unit, notes, recommendation) VALUES
  -- باراسيتامول/Paracetamol — 10-15 مجم/كجم/جرعة كل 4-6 ساعات، سقف
  -- 60-75 مجم/كجم/يوم للأطفال (استُخدم 60 الأكثر تحفظاً)؛ سقف البالغين
  -- 3000-4000 مجم/يوم (استُخدم 3000 الأكثر أماناً حسب التوصيات الحديثة).
  -- المصدر: MSF Medical Guidelines، St. Louis Children's Hospital Dose
  -- Table، Drugs.com Acetaminophen Dosage Guide.
  ('باراسيتامول', 0, 11, 3, 40, 2400, 'mg', 'جرعة الأطفال 60 مجم/كجم/يوم تقريباً (مقسَّمة كل 4-6 ساعات) — هذا سقف تقريبي لنطاق الوزن، لا حساب دقيق لكل كيلوغرام', 'لا تتجاوز 5 جرعات خلال 24 ساعة؛ راجع جدول جرعات دقيق حسب الوزن الفعلي'),
  ('Paracetamol', 0, 11, 3, 40, 2400, 'mg', '~60mg/kg/day (divided every 4-6h) — approximate ceiling for this weight band, not an exact per-kg calculation', 'Do not exceed 5 doses in 24 hours; consult a precise weight-based dosing chart'),
  ('باراسيتامول', 12, NULL, 40, NULL, 3000, 'mg', 'سقف البالغين المُوصى به حديثاً للأمان (بعض المراجع تسمح حتى 4000 مجم/يوم)', 'لا تتجاوز 3000 مجم يومياً إلا بتوجيه طبي صريح'),
  ('Paracetamol', 12, NULL, 40, NULL, 3000, 'mg', 'Modern safety-recommended adult ceiling (some references allow up to 4000mg/day)', 'Do not exceed 3000mg/day without explicit physician guidance'),

  -- إيبوبروفين/Ibuprofen — 4-10 مجم/كجم/جرعة، سقف 40 مجم/كجم/يوم حتى
  -- 1200 مجم/يوم (نفس السقف للبالغين). غير مُوصى به لأقل من 6 أشهر.
  -- المصدر: Medscape Pediatric Ibuprofen Oral Dosing، St. Louis
  -- Children's Hospital، Drugs.com Ibuprofen Dosage Guide.
  ('إيبوبروفين', 0.5, 11, 5, 30, 1200, 'mg', '40 مجم/كجم/يوم تقريباً حتى سقف 1200 مجم؛ غير مُوصى به لعمر أقل من 6 أشهر', 'الجرعة الواحدة القصوى 400 مجم كل 6-8 ساعات'),
  ('Ibuprofen', 0.5, 11, 5, 30, 1200, 'mg', '~40mg/kg/day up to a 1200mg ceiling; not recommended under 6 months of age', 'Max single dose 400mg every 6-8 hours'),
  ('إيبوبروفين', 12, NULL, 30, NULL, 1200, 'mg', 'نفس سقف البالغين تماماً', 'الجرعة الواحدة القصوى 400 مجم، لا تتجاوز 1200 مجم يومياً بلا توجيه طبي'),
  ('Ibuprofen', 12, NULL, 30, NULL, 1200, 'mg', 'Same ceiling as adults', 'Max single dose 400mg; do not exceed 1200mg/day without medical guidance'),

  -- أموكسيسيلين/Amoxicillin — الجرعة القياسية 45 مجم/كجم/يوم، جرعة
  -- عالية (بعض الالتهابات) حتى 90 مجم/كجم/يوم؛ سقف البالغين 1500 مجم/يوم
  -- عادةً (حتى أعلى بتوجيه طبي للحالات الشديدة). المصدر: Pharmacy Times
  -- Pediatric Amoxicillin Dosing Guide، UCSF ID Management Program،
  -- Drugs.com Amoxicillin Dosage Guide.
  ('أموكسيسيلين', 0, 11, 3, 40, 3600, 'mg', 'الجرعة القياسية 45 مجم/كجم/يوم، وحتى 90 مجم/كجم/يوم (جرعة عالية) لبعض الالتهابات — هذا السقف يعكس الجرعة العالية القصوى', 'استخدم الجرعة القياسية (45 مجم/كجم) إلا لو وصف الطبيب جرعة عالية صراحة'),
  ('Amoxicillin', 0, 11, 3, 40, 3600, 'mg', 'Standard dosing is 45mg/kg/day; up to 90mg/kg/day (high-dose) for select infections — this ceiling reflects the high-dose maximum', 'Use standard dosing (45mg/kg) unless a physician has explicitly prescribed high-dose therapy'),
  ('أموكسيسيلين', 12, NULL, 40, NULL, 1500, 'mg', 'الجرعة القياسية للبالغين — التهابات شديدة قد تحتاج جرعة أعلى بتوجيه طبي', 'لا تتجاوز 1500 مجم يومياً إلا بتوجيه طبي صريح لالتهاب شديد'),
  ('Amoxicillin', 12, NULL, 40, NULL, 1500, 'mg', 'Standard adult dosing — severe infections may need a higher dose under physician guidance', 'Do not exceed 1500mg/day without explicit physician guidance for a severe infection'),

  -- أسبرين/Aspirin — ممنوع منعاً باتاً للأطفال والمراهقين دون 16 سنة (خطر
  -- متلازمة راي Reye's Syndrome — لا توجد جرعة آمنة إطلاقاً، ليس فقط حدّاً
  -- أعلى). max_daily_dose=0 هنا يمثّل هذا المنع الكامل صراحةً، لا مجرد نطاق
  -- منخفض. سقف البالغين 3900 مجم/يوم. المصدر: MedSafe NZ (Use of Aspirin
  -- in Children is Not Recommended)، GoodRx Aspirin Dosage Guide.
  ('أسبرين', 0, 15, NULL, NULL, 0, 'mg', 'ممنوع منعاً باتاً للأطفال والمراهقين دون 16 سنة — خطر متلازمة راي (Reye''s Syndrome)، لا توجد جرعة آمنة إطلاقاً بهذا العمر إلا بحالات استثنائية محدَّدة (داء كاواساكي، ما بعد جراحة قلبية) بإشراف طبي صارم', 'لا تُعطى الأسبرين لهذا العمر إطلاقاً إلا بتوجيه طبيب قلب أطفال متخصص صراحة'),
  ('Aspirin', 0, 15, NULL, NULL, 0, 'mg', 'Contraindicated in children and teens under 16 — Reye''s syndrome risk, no safe dose exists at this age except specific exceptions (Kawasaki disease, post-cardiac-surgery) under strict medical supervision', 'Do not give aspirin at this age unless explicitly directed by a pediatric cardiologist'),
  ('أسبرين', 16, NULL, NULL, NULL, 3900, 'mg', 'سقف البالغين لتسكين الألم/الحمى — جرعة القلب الوقائية أقل بكثير (81 مجم/يوم عادةً) ولا تُستخدم إلا بوصفة طبية', 'لا تتجاوز 3900 مجم يومياً؛ استخدام القلب الوقائي المنخفض بوصفة طبية فقط'),
  ('Aspirin', 16, NULL, NULL, NULL, 3900, 'mg', 'Adult ceiling for pain/fever relief — preventive cardiac dosing is much lower (typically 81mg/day) and prescription-only', 'Do not exceed 3900mg/day; low-dose cardiac use is prescription-only'),

  -- ميتفورمين/Metformin — غير معتمد لأقل من 10 سنوات؛ سقف الأطفال (10-17
  -- سنة) 2000 مجم/يوم؛ سقف البالغين 2550 مجم/يوم (2000 مجم لمديد
  -- المفعول). المصدر: UVA Pediatrics Metformin Guide، GoodRx Metformin
  -- Dosage Guide، Drugs.com Metformin Package Insert.
  ('ميتفورمين', 10, 17, NULL, NULL, 2000, 'mg', 'غير معتمد لأقل من 10 سنوات لعلاج السكري النوع الثاني', 'يبدأ عادة بـ500 مجم مرتين يومياً مع الوجبات، لا يتجاوز 2000 مجم يومياً'),
  ('Metformin', 10, 17, NULL, NULL, 2000, 'mg', 'Not approved for type 2 diabetes under age 10', 'Typically starts at 500mg twice daily with meals; do not exceed 2000mg/day'),
  ('ميتفورمين', 18, NULL, NULL, NULL, 2550, 'mg', 'سقف البالغين (مديد المفعول: 2000 مجم كسقف بديل)', 'لا يتجاوز 2550 مجم يومياً (أو 2000 مجم لصيغة مديدة المفعول)'),
  ('Metformin', 18, NULL, NULL, NULL, 2550, 'mg', 'Adult ceiling (extended-release: 2000mg alternate ceiling)', 'Do not exceed 2550mg/day (or 2000mg/day for extended-release)'),

  -- أوميبرازول/Omeprazole — جرعات الأطفال حسب الوزن (جدول FDA): أقل من
  -- 10كغ→5مجم، 10-20كغ→10مجم، 20كغ فأكثر→20مجم يومياً؛ سقف البالغين
  -- 40 مجم/يوم عادة (حتى 80 مجم مقسَّمة بحالات خاصة). المصدر: GoodRx
  -- Omeprazole Dosage Guide، Drugs.com Omeprazole Dosage Guide.
  ('أوميبرازول', 1, 11, 10, 20, 10, 'mg', 'جرعة الأطفال حسب الوزن (جدول FDA): 10-20 كغ → 10 مجم يومياً', 'جرعة واحدة يومياً قبل الأكل'),
  ('Omeprazole', 1, 11, 10, 20, 10, 'mg', 'FDA weight-based pediatric dosing: 10-20kg → 10mg once daily', 'Once daily, before a meal'),
  ('أوميبرازول', 1, 11, 20, NULL, 20, 'mg', 'جرعة الأطفال حسب الوزن (جدول FDA): 20 كغ فأكثر → 20 مجم يومياً', 'جرعة واحدة يومياً قبل الأكل'),
  ('Omeprazole', 1, 11, 20, NULL, 20, 'mg', 'FDA weight-based pediatric dosing: 20kg and above → 20mg once daily', 'Once daily, before a meal'),
  ('أوميبرازول', 12, NULL, NULL, NULL, 40, 'mg', 'سقف البالغين المعتاد؛ جرعات أعلى من 80 مجم تُقسَّم على جرعتين بإشراف طبي', 'الجرعة المعتادة 20-40 مجم يومياً قبل الأكل'),
  ('Omeprazole', 12, NULL, NULL, NULL, 40, 'mg', 'Typical adult ceiling; doses above 80mg are given in divided doses under medical supervision', 'Usual dose is 20-40mg once daily before a meal')
ON CONFLICT (LOWER(drug_name), COALESCE(min_age,-1), COALESCE(max_age,-1), COALESCE(min_weight_kg,-1), COALESCE(max_weight_kg,-1)) DO NOTHING;
