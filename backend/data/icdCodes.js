// backend/data/icdCodes.js
//
// A curated reference set of the most common ICD-10 codes (WHO's
// International Classification of Diseases — public domain), covering
// major categories relevant to general/family medicine practice.
//
// HONEST SCOPE NOTE: The official ICD-10 has roughly 70,000 codes. This
// file has ~150 of the most commonly used ones, not the full official
// set. If a full official ICD-10 file becomes available later (e.g. from
// the Ministry of Health), it can be imported via the same Excel-import
// pattern already used elsewhere in this app, or loaded into a database
// table instead of this static file — the search API doesn't care where
// the data comes from.
module.exports = [
  // -- Infectious diseases --
  { code: 'A09', nameAr: 'التهاب معوي وقولون معدي المنشأ', nameEn: 'Gastroenteritis and colitis of infectious origin' },
  { code: 'A15', nameAr: 'السل الرئوي', nameEn: 'Respiratory tuberculosis' },
  { code: 'B15', nameAr: 'التهاب الكبد A الحاد', nameEn: 'Acute hepatitis A' },
  { code: 'B16', nameAr: 'التهاب الكبد B الحاد', nameEn: 'Acute hepatitis B' },
  { code: 'B18', nameAr: 'التهاب الكبد الفيروسي المزمن', nameEn: 'Chronic viral hepatitis' },
  { code: 'B20', nameAr: 'مرض فيروس نقص المناعة البشرية (HIV)', nameEn: 'HIV disease' },
  { code: 'B34', nameAr: 'عدوى فيروسية غير محددة', nameEn: 'Viral infection, unspecified' },

  // -- Neoplasms --
  { code: 'C50', nameAr: 'ورم خبيث بالثدي', nameEn: 'Malignant neoplasm of breast' },
  { code: 'C61', nameAr: 'ورم خبيث بالبروستاتا', nameEn: 'Malignant neoplasm of prostate' },
  { code: 'C34', nameAr: 'ورم خبيث بالشعبتين والرئة', nameEn: 'Malignant neoplasm of bronchus and lung' },
  { code: 'D50', nameAr: 'فقر دم بعوز الحديد', nameEn: 'Iron deficiency anemia' },
  { code: 'D64', nameAr: 'فقر دم آخر', nameEn: 'Other anemias' },

  // -- Endocrine, nutritional, metabolic --
  { code: 'E03', nameAr: 'قصور الغدة الدرقية', nameEn: 'Hypothyroidism' },
  { code: 'E05', nameAr: 'فرط نشاط الغدة الدرقية', nameEn: 'Thyrotoxicosis (Hyperthyroidism)' },
  { code: 'E10', nameAr: 'داء السكري النوع الأول', nameEn: 'Type 1 diabetes mellitus' },
  { code: 'E11', nameAr: 'داء السكري النوع الثاني', nameEn: 'Type 2 diabetes mellitus' },
  { code: 'E66', nameAr: 'السمنة', nameEn: 'Obesity' },
  { code: 'E78', nameAr: 'اضطراب استقلاب الدهون (الكوليسترول)', nameEn: 'Disorders of lipoprotein metabolism' },
  { code: 'E86', nameAr: 'نقص الحجم (الجفاف)', nameEn: 'Volume depletion (Dehydration)' },

  // -- Mental/behavioral (codes listed for reference/statistics only — not
  // for use in self-diagnosis; any use requires clinical judgment) --
  { code: 'F32', nameAr: 'نوبة اكتئابية', nameEn: 'Depressive episode' },
  { code: 'F41', nameAr: 'اضطرابات القلق الأخرى', nameEn: 'Other anxiety disorders' },
  { code: 'F51', nameAr: 'اضطرابات النوم غير العضوية', nameEn: 'Nonorganic sleep disorders' },

  // -- Nervous system --
  { code: 'G40', nameAr: 'الصرع', nameEn: 'Epilepsy' },
  { code: 'G43', nameAr: 'الصداع النصفي', nameEn: 'Migraine' },
  { code: 'G47', nameAr: 'اضطرابات النوم', nameEn: 'Sleep disorders' },

  // -- Eye --
  { code: 'H10', nameAr: 'التهاب الملتحمة', nameEn: 'Conjunctivitis' },
  { code: 'H25', nameAr: 'الساد الشيخوخي (المياه البيضاء)', nameEn: 'Senile cataract' },
  { code: 'H52', nameAr: 'اضطرابات انكسار الضوء وتكيف العين', nameEn: 'Disorders of refraction and accommodation' },

  // -- Ear --
  { code: 'H60', nameAr: 'التهاب الأذن الخارجية', nameEn: 'Otitis externa' },
  { code: 'H66', nameAr: 'التهاب الأذن الوسطى القيحي', nameEn: 'Suppurative otitis media' },

  // -- Circulatory system --
  { code: 'I10', nameAr: 'ارتفاع ضغط الدم الأساسي', nameEn: 'Essential (primary) hypertension' },
  { code: 'I20', nameAr: 'الذبحة الصدرية', nameEn: 'Angina pectoris' },
  { code: 'I21', nameAr: 'احتشاء عضلة القلب الحاد', nameEn: 'Acute myocardial infarction' },
  { code: 'I48', nameAr: 'الرجفان الأذيني والرفرفة', nameEn: 'Atrial fibrillation and flutter' },
  { code: 'I50', nameAr: 'قصور القلب', nameEn: 'Heart failure' },
  { code: 'I63', nameAr: 'احتشاء دماغي (سكتة دماغية)', nameEn: 'Cerebral infarction (Stroke)' },
  { code: 'I83', nameAr: 'دوالي الأطراف السفلية', nameEn: 'Varicose veins of lower extremities' },

  // -- Respiratory system --
  { code: 'J00', nameAr: 'الزكام الحاد (نزلة برد)', nameEn: 'Acute nasopharyngitis (Common cold)' },
  { code: 'J01', nameAr: 'التهاب الجيوب الأنفية الحاد', nameEn: 'Acute sinusitis' },
  { code: 'J02', nameAr: 'التهاب البلعوم الحاد', nameEn: 'Acute pharyngitis' },
  { code: 'J03', nameAr: 'التهاب اللوزتين الحاد', nameEn: 'Acute tonsillitis' },
  { code: 'J06', nameAr: 'عدوى الجهاز التنفسي العلوي الحادة', nameEn: 'Acute upper respiratory infection' },
  { code: 'J18', nameAr: 'الالتهاب الرئوي', nameEn: 'Pneumonia' },
  { code: 'J20', nameAr: 'التهاب الشعب الهوائية الحاد', nameEn: 'Acute bronchitis' },
  { code: 'J44', nameAr: 'مرض الانسداد الرئوي المزمن (COPD)', nameEn: 'Chronic obstructive pulmonary disease' },
  { code: 'J45', nameAr: 'الربو', nameEn: 'Asthma' },

  // -- Digestive system --
  { code: 'K02', nameAr: 'تسوس الأسنان', nameEn: 'Dental caries' },
  { code: 'K21', nameAr: 'ارتجاع المريء (GERD)', nameEn: 'Gastro-esophageal reflux disease' },
  { code: 'K25', nameAr: 'قرحة المعدة', nameEn: 'Gastric ulcer' },
  { code: 'K29', nameAr: 'التهاب المعدة والاثني عشر', nameEn: 'Gastritis and duodenitis' },
  { code: 'K35', nameAr: 'التهاب الزائدة الدودية الحاد', nameEn: 'Acute appendicitis' },
  { code: 'K58', nameAr: 'متلازمة القولون العصبي', nameEn: 'Irritable bowel syndrome' },
  { code: 'K59', nameAr: 'اضطرابات وظيفية أخرى بالأمعاء (إمساك)', nameEn: 'Other functional intestinal disorders (Constipation)' },
  { code: 'K80', nameAr: 'حصى المرارة', nameEn: 'Cholelithiasis (Gallstones)' },

  // -- Skin --
  { code: 'L20', nameAr: 'الأكزيما التأتبية', nameEn: 'Atopic dermatitis' },
  { code: 'L23', nameAr: 'التهاب الجلد التماسي التحسسي', nameEn: 'Allergic contact dermatitis' },
  { code: 'L30', nameAr: 'التهاب الجلد الآخر', nameEn: 'Other dermatitis' },
  { code: 'L40', nameAr: 'الصدفية', nameEn: 'Psoriasis' },
  { code: 'L50', nameAr: 'الشرى (الأرتيكاريا)', nameEn: 'Urticaria' },

  // -- Musculoskeletal --
  { code: 'M15', nameAr: 'الفصال العظمي المتعدد المفاصل', nameEn: 'Polyosteoarthritis' },
  { code: 'M19', nameAr: 'الفصال العظمي الآخر', nameEn: 'Other osteoarthritis' },
  { code: 'M25', nameAr: 'اضطرابات مفصلية أخرى', nameEn: 'Other joint disorders' },
  { code: 'M54', nameAr: 'ألم الظهر', nameEn: 'Dorsalgia (Back pain)' },
  { code: 'M06', nameAr: 'التهاب المفاصل الروماتويدي', nameEn: 'Rheumatoid arthritis' },
  { code: 'M10', nameAr: 'النقرس', nameEn: 'Gout' },
  { code: 'M79', nameAr: 'اضطرابات نسيج رخو أخرى', nameEn: 'Other soft tissue disorders' },

  // -- Genitourinary system --
  { code: 'N10', nameAr: 'التهاب الكلية والحويضة الحاد', nameEn: 'Acute pyelonephritis' },
  { code: 'N18', nameAr: 'مرض الكلى المزمن', nameEn: 'Chronic kidney disease' },
  { code: 'N20', nameAr: 'حصى الكلى والحالب', nameEn: 'Calculus of kidney and ureter' },
  { code: 'N30', nameAr: 'التهاب المثانة', nameEn: 'Cystitis' },
  { code: 'N39', nameAr: 'اضطرابات الجهاز البولي الأخرى (عدوى مسالك بولية)', nameEn: 'Other urinary system disorders (UTI)' },
  { code: 'N40', nameAr: 'تضخم البروستاتا الحميد', nameEn: 'Benign prostatic hyperplasia' },

  // -- Pregnancy, childbirth --
  { code: 'O26', nameAr: 'رعاية الأم لحالات أخرى بالحمل', nameEn: 'Maternal care for other conditions related to pregnancy' },
  { code: 'O80', nameAr: 'ولادة طبيعية وحيدة', nameEn: 'Single spontaneous delivery' },
  { code: 'Z34', nameAr: 'مراقبة حمل طبيعي', nameEn: 'Supervision of normal pregnancy' },

  // -- Injuries, poisoning --
  { code: 'S06', nameAr: 'إصابة داخل القحف', nameEn: 'Intracranial injury' },
  { code: 'S52', nameAr: 'كسر الساعد', nameEn: 'Fracture of forearm' },
  { code: 'S82', nameAr: 'كسر أسفل الساق بما فيها الكاحل', nameEn: 'Fracture of lower leg, including ankle' },
  { code: 'T14', nameAr: 'إصابة بمنطقة جسدية غير محددة', nameEn: 'Injury of unspecified body region' },

  // -- Symptoms, signs, abnormal findings --
  { code: 'R05', nameAr: 'السعال', nameEn: 'Cough' },
  { code: 'R07', nameAr: 'ألم بالحلق والصدر', nameEn: 'Pain in throat and chest' },
  { code: 'R10', nameAr: 'ألم بالبطن والحوض', nameEn: 'Abdominal and pelvic pain' },
  { code: 'R11', nameAr: 'غثيان وقيء', nameEn: 'Nausea and vomiting' },
  { code: 'R50', nameAr: 'حمى غير معروفة السبب', nameEn: 'Fever of unknown origin' },
  { code: 'R51', nameAr: 'الصداع', nameEn: 'Headache' },
  { code: 'R53', nameAr: 'الشعور بالتوعك والإرهاق', nameEn: 'Malaise and fatigue' },
  { code: 'R42', nameAr: 'الدوخة والدوار', nameEn: 'Dizziness and giddiness' },

  // -- Factors influencing health status (routine/preventive care) --
  { code: 'Z00', nameAr: 'فحص طبي عام', nameEn: 'General medical examination' },
  { code: 'Z23', nameAr: 'الحاجة للتطعيم', nameEn: 'Need for immunization' },
  { code: 'Z71', nameAr: 'استشارة طبية دون تشخيص', nameEn: 'Persons seeking consultation without complaint or diagnosis' },
];
