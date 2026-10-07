-- توسيع جدول dosage_limits (راجع migrations-sql/009_dosage_limits.sql للبنية
-- الكاملة والمبدأ الأمني الأساسي: "لا بيانات" لا يعني أبداً "آمن") بـ6 أدوية
-- إضافية شائعة، بنفس المنهجية — كل رقم من مرجع سريري حقيقي مذكور بالتعليق.
-- migrations-sql/009 استخدم فهرساً فريداً بلا COALESCE على أعمدة الوزن أصلاً
-- (أُصلح لاحقاً بنفس الملف) — هذا الملف يُطبَّق بعد ذاك الإصلاح مباشرة،
-- فيستخدم الفهرس الصحيح (يشمل نطاق الوزن) من البداية.
--
-- ── لماذا لا وارفارين هنا؟ (قرار متعمَّد، لا إغفال) ──────────────────────────
-- جرعة الوارفارين تُعاير فردياً بالكامل حسب نتائج تحليل INR الدوري لكل مريض
-- على حدة (تبدأ عادة 2-10 مجم، لكن "الحد الأقصى الآمن" الفعلي يختلف جذرياً
-- من مريض لآخر ولا معنى لرقم سقف عام واحد يناسب الجميع) — تخزين أي رقم هنا
-- كان سيعطي إحساساً كاذباً بالدقة لدواء يحتاج فعلياً مراقبة مخبرية مستمرة لا
-- مقارنة رقمية بسيطة. تُركَت عمداً بلا صف بالجدول، فتُحال أي محاولة فحصها
-- تلقائياً لطبقة AI الاحتياطية (التي تستطيع توضيح هذه النقطة بالضبط بدل رقم
-- سقف وهمي) — نفس فلسفة available:false بدل افتراض 'safe' بغياب معلومة كافية.
INSERT INTO dosage_limits (drug_name, min_age, max_age, min_weight_kg, max_weight_kg, max_daily_dose, unit, notes, recommendation) VALUES
  -- سيبروفلوكساسين/Ciprofloxacin — استخدام الأطفال محدود ويحتاج إشراف
  -- طبي صارم (خطر على نمو الغضاريف) — 10-15 مجم/كجم كل 12 ساعة، حتى سقف
  -- 1 غم/يوم؛ سقف البالغين 1500 مجم/يوم (التهابات معقّدة). المصدر: Mayo
  -- Clinic Ciprofloxacin، Drugs.com Ciprofloxacin Dosage Guide.
  ('سيبروفلوكساسين', 0, 17, 3, 50, 1000, 'mg', 'الاستخدام بالأطفال محدود لحالات ضرورية فقط بإشراف طبي صارم (خطر على نمو الغضاريف) — 10-15 مجم/كجم كل 12 ساعة', 'لا يُستخدَم للأطفال إلا بقرار طبيب مختص صراحة، وبأقصر مدة ممكنة'),
  ('Ciprofloxacin', 0, 17, 3, 50, 1000, 'mg', 'Pediatric use is restricted to necessary cases under strict medical supervision (cartilage growth risk) — 10-15mg/kg every 12 hours', 'Only use in children when explicitly directed by a specialist physician, for the shortest duration possible'),
  ('سيبروفلوكساسين', 18, NULL, 50, NULL, 1500, 'mg', 'سقف البالغين لالتهابات معقّدة (750 مجم كل 12 ساعة)؛ التهابات بسيطة تحتاج جرعة أقل عادة', 'استخدم أقل جرعة فعالة حسب نوع وشدة الالتهاب'),
  ('Ciprofloxacin', 18, NULL, 50, NULL, 1500, 'mg', 'Adult ceiling for complicated infections (750mg every 12 hours); simple infections usually need a lower dose', 'Use the lowest effective dose for the infection type and severity'),

  -- ليسينوبريل/Lisinopril — يبدأ 0.07 مجم/كجم/يوم لعمر 6+ سنوات، سقف
  -- مدروس 0.61 مجم/كجم (حتى 40 مجم)؛ غير مُوصى به لأقل من 6 سنوات. سقف
  -- البالغين 40 مجم/يوم. المصدر: FDA Zestril Label، Drugs.com Lisinopril
  -- Dosage Guide.
  ('ليسينوبريل', 6, 17, NULL, NULL, 40, 'mg', 'غير مُوصى به لأقل من 6 سنوات؛ يبدأ 0.07 مجم/كجم/يوم، الجرعات فوق 0.61 مجم/كجم أو 40 مجم لم تُدرَس بالأطفال', 'يحتاج مراقبة وظائف الكلى ومستوى البوتاسيوم بالدم دورياً'),
  ('Lisinopril', 6, 17, NULL, NULL, 40, 'mg', 'Not recommended under 6 years old; starts at 0.07mg/kg/day, doses above 0.61mg/kg or 40mg have not been studied in children', 'Requires periodic monitoring of kidney function and blood potassium levels'),
  ('ليسينوبريل', 18, NULL, NULL, NULL, 40, 'mg', 'سقف البالغين المعتاد', 'يبدأ عادة بجرعة منخفضة (2.5-10 مجم) مع زيادة تدريجية حسب الاستجابة'),
  ('Lisinopril', 18, NULL, NULL, NULL, 40, 'mg', 'Standard adult ceiling', 'Usually starts at a low dose (2.5-10mg) with gradual increases based on response'),

  -- أتورفاستاتين/Atorvastatin — عمر 10-17 سنة (فرط كوليسترول عائلي):
  -- سقف مدروس 20 مجم/يوم (جرعات أعلى غير مدروسة بهذه الفئة)؛ سقف
  -- البالغين 80 مجم/يوم. المصدر: GoodRx Atorvastatin Dosage، Drugs.com
  -- Atorvastatin.
  ('أتورفاستاتين', 10, 17, NULL, NULL, 20, 'mg', 'لعلاج فرط الكوليسترول العائلي بالمراهقين — الجرعات فوق 20 مجم لم تُدرَس بهذه الفئة العمرية (باستثناء حالات نادرة متجانسة الشكل بإشراف متخصص)', 'يحتاج إشراف طبيب أطفال متخصص بأمراض القلب/الأيض'),
  ('Atorvastatin', 10, 17, NULL, NULL, 20, 'mg', 'For familial hypercholesterolemia in adolescents — doses above 20mg have not been studied in this age group (except rare homozygous cases under specialist care)', 'Requires supervision by a pediatric cardiology/metabolic specialist'),
  ('أتورفاستاتين', 18, NULL, NULL, NULL, 80, 'mg', 'سقف البالغين المعتاد', 'يُفضَّل تناوله مساءً؛ يحتاج مراقبة دورية لإنزيمات الكبد'),
  ('Atorvastatin', 18, NULL, NULL, NULL, 80, 'mg', 'Standard adult ceiling', 'Best taken in the evening; requires periodic liver enzyme monitoring'),

  -- لوزارتان/Losartan — عمر 6+ سنوات: يبدأ 0.7 مجم/كجم/يوم، سقف معتاد
  -- 50 مجم/يوم (قد يصل لـ100 مجم بتقدير الطبيب المعالج فقط)؛ غير مُوصى
  -- به لأقل من 6 سنوات. سقف البالغين 100 مجم/يوم. المصدر: GoodRx Cozaar
  -- Dosage، Drugs.com Losartan Dosage Guide.
  ('لوزارتان', 6, 17, NULL, NULL, 50, 'mg', 'غير مُوصى به لأقل من 6 سنوات؛ يبدأ 0.7 مجم/كجم/يوم — سقف 50 مجم هو السقف المعتاد، قد يصل الطبيب المعالج لـ100 مجم بتقديره الخاص فقط', 'يحتاج مراقبة وظائف الكلى دورياً'),
  ('Losartan', 6, 17, NULL, NULL, 50, 'mg', 'Not recommended under 6 years old; starts at 0.7mg/kg/day — 50mg is the usual ceiling, the treating physician may go up to 100mg at their own discretion only', 'Requires periodic kidney function monitoring'),
  ('لوزارتان', 18, NULL, NULL, NULL, 100, 'mg', 'سقف البالغين المعتاد', 'يبدأ عادة بـ50 مجم/يوم مع تعديل حسب الاستجابة'),
  ('Losartan', 18, NULL, NULL, NULL, 100, 'mg', 'Standard adult ceiling', 'Usually starts at 50mg/day with adjustment based on response'),

  -- ميترونيدازول/Metronidazole — جرعة الأطفال 30-40 مجم/كجم/يوم مقسّمة
  -- (حتى 2.25 غم/يوم كسقف)؛ سقف البالغين 4 غم/يوم (لا يُتجاوَز خلال 24
  -- ساعة). المصدر: Mayo Clinic Metronidazole، Drugs.com Metronidazole
  -- Dosage Guide.
  ('ميترونيدازول', 0, 17, 3, 70, 2250, 'mg', '30-40 مجم/كجم/يوم مقسَّمة كل 8 ساعات تقريباً؛ هذا السقف يعكس الحد الأقصى المرجعي (2.25 غم/يوم) لا الجرعة القياسية الأقل', 'استخدم الجرعة القياسية إلا لو وصف الطبيب جرعة أعلى صراحة لالتهاب شديد'),
  ('Metronidazole', 0, 17, 3, 70, 2250, 'mg', '~30-40mg/kg/day divided roughly every 8 hours; this ceiling reflects the reference maximum (2.25g/day), not the lower standard dose', 'Use standard dosing unless a physician has explicitly prescribed a higher dose for a severe infection'),
  ('ميترونيدازول', 18, NULL, 70, NULL, 4000, 'mg', 'لا يُتجاوَز 4 غم خلال 24 ساعة؛ الجرعة المعتادة لأغلب الالتهابات أقل بكثير (~1500 مجم/يوم)', 'الجرعات العليا محفوظة لالتهابات شديدة محدَّدة فقط بتوجيه طبي'),
  ('Metronidazole', 18, NULL, 70, NULL, 4000, 'mg', 'Do not exceed 4g within 24 hours; the usual dose for most infections is much lower (~1500mg/day)', 'Higher doses are reserved for specific severe infections only, under medical guidance'),

  -- كلاريثروميسين/Clarithromycin — جرعة الأطفال 15 مجم/كجم/يوم (حتى
  -- جرعة البالغين)؛ سقف البالغين 1000 مجم/يوم (500 مجم كل 12 ساعة).
  -- المصدر: Drugs.com Clarithromycin Dosage Guide، Mayo Clinic
  -- Clarithromycin.
  ('كلاريثروميسين', 0, 17, 3, 70, 1000, 'mg', '15 مجم/كجم/يوم مقسَّمة كل 12 ساعة، حتى سقف جرعة البالغين', 'لا تتجاوز جرعة البالغين حتى لو كان وزن الطفل مرتفعاً'),
  ('Clarithromycin', 0, 17, 3, 70, 1000, 'mg', '15mg/kg/day divided every 12 hours, up to the adult dose ceiling', 'Do not exceed the adult dose even if the child weighs relatively more'),
  ('كلاريثروميسين', 18, NULL, 70, NULL, 1000, 'mg', 'سقف البالغين (500 مجم كل 12 ساعة) لالتهابات المتفطرات؛ التهابات أخرى قد تحتاج جرعة أقل (250-500 مجم كل 12 ساعة)', 'استخدم أقل جرعة فعالة حسب نوع الالتهاب'),
  ('Clarithromycin', 18, NULL, 70, NULL, 1000, 'mg', 'Adult ceiling (500mg every 12 hours) for mycobacterial infections; other infections may need a lower dose (250-500mg every 12 hours)', 'Use the lowest effective dose for the infection type')
ON CONFLICT (LOWER(drug_name), COALESCE(min_age,-1), COALESCE(max_age,-1), COALESCE(min_weight_kg,-1), COALESCE(max_weight_kg,-1)) DO NOTHING;
