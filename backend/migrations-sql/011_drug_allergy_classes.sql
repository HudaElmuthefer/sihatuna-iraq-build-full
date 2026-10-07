-- جدول عائلات الحساسية الدوائية (فحص فوري بلا استدعاء ذكاء اصطناعي) — يُستخدم
-- كطبقة أولى (bot/rules) من backend/agents/allergyAgent.js قبل أي استدعاء AI.
-- الفكرة: حساسية دوائية حقيقية لا تعني فقط "نفس الاسم بالضبط" — مريض عنده
-- حساسية من "البنسلين" (اسم عائلة، أو أي دواء بنسلين محدَّد) يجب أن يُحذَّر
-- أيضاً لو وُصف له "أموكسيسيلين" (دواء آخر بنفس العائلة)، لا فقط لو تطابق
-- الاسمان حرفياً.
--
-- ── تصميم الجدول: كل صف يربط اسم دواء (أو اسم عائلة نفسها كـ"اسم دواء" مرادف)
-- بعائلة حساسية واحدة (allergy_class، مفتاح إنجليزي ثابت داخلياً). المطابقة
-- تصير بـJOIN ذاتي على نفس العائلة بين اسم الدواء الموصوف واسم حساسية
-- المريض المسجَّلة — راجع findClassMatch() بـallergyAgent.js. تسجيل اسم
-- العائلة نفسه كصف إضافي (مثلاً 'Penicillin' → 'Penicillin') يسمح بمطابقة
-- مريض سجّل حساسيته كاسم عائلة عام ("بنسلين") لا دواء محدَّد.
CREATE TABLE IF NOT EXISTS drug_allergy_classes (
  id SERIAL PRIMARY KEY,
  drug_name VARCHAR(200) NOT NULL,
  allergy_class VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drug_allergy_classes_pair_unique ON drug_allergy_classes (LOWER(drug_name), LOWER(allergy_class));
-- فهرس إضافي على allergy_class وحده — يُسرِّع الـJOIN الذاتي بـfindClassMatch
-- (يُطابَق عليه بكثرة، بعكس id الذي لا يُستخدَم بالاستعلام إطلاقاً).
CREATE INDEX IF NOT EXISTS idx_drug_allergy_classes_class ON drug_allergy_classes (LOWER(allergy_class));

-- ── بذر أولي: ست عائلات حساسية دوائية شائعة سريرياً، بأدوية منها موجودة
-- أصلاً بجداول dosage_limits/drug_interactions (Amoxicillin، Aspirin،
-- Ibuprofen، Ciprofloxacin، Clarithromycin) — يسمح بسيناريوهات اختبار
-- واقعية متسقة مع بقية بيانات النظام. كل عائلة تتضمن اسم العائلة نفسه
-- (عربي/إنجليزي) كصف إضافي، ليُطابَق مباشرة لو سجّل المريض حساسيته كاسم
-- عائلة عام بدل دواء محدَّد.
INSERT INTO drug_allergy_classes (drug_name, allergy_class) VALUES
  -- عائلة البنسلين
  ('Penicillin', 'Penicillin'), ('بنسلين', 'Penicillin'),
  ('Amoxicillin', 'Penicillin'), ('أموكسيسيلين', 'Penicillin'),
  ('Ampicillin', 'Penicillin'), ('أمبيسيلين', 'Penicillin'),
  ('Penicillin V', 'Penicillin'), ('Penicillin G', 'Penicillin'),
  -- عائلة السيفالوسبورين
  ('Cephalosporin', 'Cephalosporin'), ('سيفالوسبورين', 'Cephalosporin'),
  ('Cephalexin', 'Cephalosporin'), ('سيفاليكسين', 'Cephalosporin'),
  ('Ceftriaxone', 'Cephalosporin'), ('سيفترياكسون', 'Cephalosporin'),
  ('Cefuroxime', 'Cephalosporin'), ('سيفوروكسيم', 'Cephalosporin'),
  -- عائلة السلفوناميد
  ('Sulfonamide', 'Sulfonamide'), ('سلفوناميد', 'Sulfonamide'),
  ('Sulfamethoxazole', 'Sulfonamide'), ('سلفاميثوكسازول', 'Sulfonamide'),
  ('Co-trimoxazole', 'Sulfonamide'), ('كوتريموكسازول', 'Sulfonamide'),
  ('Sulfasalazine', 'Sulfonamide'), ('سلفاسالازين', 'Sulfonamide'),
  -- مضادات الالتهاب غير الستيرويدية (NSAID) — تحسّس تصالبي حقيقي معروف سريرياً
  ('NSAID', 'NSAID'), ('مضاد التهاب غير ستيرويدي', 'NSAID'),
  ('Aspirin', 'NSAID'), ('أسبرين', 'NSAID'),
  ('Ibuprofen', 'NSAID'), ('إيبوبروفين', 'NSAID'),
  ('Diclofenac', 'NSAID'), ('ديكلوفيناك', 'NSAID'),
  ('Naproxen', 'NSAID'), ('نابروكسين', 'NSAID'),
  -- عائلة الماكروليد
  ('Macrolide', 'Macrolide'), ('ماكروليد', 'Macrolide'),
  ('Clarithromycin', 'Macrolide'), ('كلاريثروميسين', 'Macrolide'),
  ('Azithromycin', 'Macrolide'), ('أزيثروميسين', 'Macrolide'),
  ('Erythromycin', 'Macrolide'), ('إريثروميسين', 'Macrolide'),
  -- عائلة الفلوروكينولون
  ('Fluoroquinolone', 'Fluoroquinolone'), ('فلوروكينولون', 'Fluoroquinolone'),
  ('Ciprofloxacin', 'Fluoroquinolone'), ('سيبروفلوكساسين', 'Fluoroquinolone'),
  ('Levofloxacin', 'Fluoroquinolone'), ('ليفوفلوكساسين', 'Fluoroquinolone'),
  ('Moxifloxacin', 'Fluoroquinolone'), ('موكسيفلوكساسين', 'Fluoroquinolone')
ON CONFLICT (LOWER(drug_name), LOWER(allergy_class)) DO NOTHING;
