-- تراجُع كامل عن نظام حساب الاستحقاق القائم على جداول منفصلة (سواء الشكل
-- الأول: adjustment_types/promotion_cycles/promotion_adjustments، أو الشكل
-- الثاني الذي جُرِّب لاحقاً بنفس الجلسة: promotion_tracking/allowance_tracking)
-- — بعد المراجعة الفعلية، تقرَّر الاكتفاء بحقلين محسوبين مباشرة بصفحة
-- الموظفين (lastPromotion/lastAllowance + منطق حساب داخل الكود، بلا أي جدول
-- تخزين إضافي) بدل أي تبويب أو جدول منفصل. لا توجد بيانات إنتاجية حقيقية
-- بأي من هذه الجداول، فحذفها آمن.
DROP TABLE IF EXISTS promotion_adjustments;
DROP TABLE IF EXISTS promotion_cycles;
DROP TABLE IF EXISTS adjustment_types;
DROP TABLE IF EXISTS promotion_tracking;
DROP TABLE IF EXISTS allowance_tracking;
