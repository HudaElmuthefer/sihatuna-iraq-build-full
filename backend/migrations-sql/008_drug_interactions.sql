-- جدول تفاعلات دوائية معروفة (فحص فوري بلا استدعاء ذكاء اصطناعي) — يُستخدم
-- كطبقة أولى (bot/rules) من backend/agents/interactionAgent.js قبل أي
-- استدعاء AI: أرخص، أسرع، ولا يعتمد على توفّر مفتاح API. مطابقة الزوج غير
-- حساسة لحالة الأحرف ولا لترتيب الدواءين (A,B تكافي B,A تماماً — يُتحقَّق
-- من الاتجاهين وقت البحث بالكود، لا بقيد هنا).
CREATE TABLE IF NOT EXISTS drug_interactions (
  id SERIAL PRIMARY KEY,
  drug_a VARCHAR(200) NOT NULL,
  drug_b VARCHAR(200) NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('low','medium','high')),
  notes TEXT,
  recommendation TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- فهرس فريد (لا عادي فقط) — ضروري لجعل INSERT أدناه (ON CONFLICT) صحيح
-- ومتكرر التنفيذ بأمان (idempotent) فعلاً، وليس مجرد تسريع بحث.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drug_interactions_pair_unique ON drug_interactions (LOWER(drug_a), LOWER(drug_b));

-- ── بذر أولي: نفس الخمسة تضاربات كانت مكتوبة سابقاً بكود الفرونت إند
-- (frontend/src/pages/DrugInteractionsPage.js) كاحتياط محلي وقت انقطاع
-- الذكاء الاصطناعي — انتقلت هنا لتصير مصدر الفحص الأساسي (bot) بدل احتياط
-- طارئ فقط، ومتاحة الآن للباك إند نفسه لا الفرونت إند وحده. كل تضارب
-- مُدرَج بصيغتين (عربي/إنجليزي) لأن طلب الفحص يصل بأي من اللغتين حسب لغة
-- واجهة المستخدم وقت الإرسال (راجع drugInteractionRoutes.js).
INSERT INTO drug_interactions (drug_a, drug_b, severity, notes, recommendation) VALUES
  ('أسبرين', 'وارفارين', 'high', 'زيادة خطر النزيف بشكل كبير', 'تجنب الاستخدام المشترك أو مراقبة دقيقة'),
  ('Aspirin', 'Warfarin', 'high', 'Significantly increases bleeding risk', 'Avoid combined use or monitor closely'),
  ('إيبوبروفين', 'ليسينوبريل', 'medium', 'إضعاف تأثير مخفض ضغط الدم', 'استخدم باراسيتامول بديلاً'),
  ('Ibuprofen', 'Lisinopril', 'medium', 'Reduces effectiveness of blood pressure medication', 'Use paracetamol as an alternative'),
  ('ميتفورمين', 'ألوبيورينول', 'low', 'قد يزيد من تأثير خفض السكر', 'مراقبة مستوى السكر بانتظام'),
  ('Metformin', 'Allopurinol', 'low', 'May enhance blood sugar lowering effect', 'Monitor blood sugar regularly'),
  ('سيبروفلوكساسين', 'ريفامبيسين', 'high', 'تقليل فعالية المضاد الحيوي بشكل حاد', 'تجنب الاستخدام المشترك'),
  ('Ciprofloxacin', 'Rifampicin', 'high', 'Severely reduces antibiotic effectiveness', 'Avoid combined use'),
  ('أوميبرازول', 'كلاريثروميسين', 'low', 'زيادة مستوى الأوميبرازول في الدم', 'مراقبة الآثار الجانبية'),
  ('Omeprazole', 'Clarithromycin', 'low', 'Increases omeprazole blood levels', 'Monitor for side effects')
ON CONFLICT (LOWER(drug_a), LOWER(drug_b)) DO NOTHING;
