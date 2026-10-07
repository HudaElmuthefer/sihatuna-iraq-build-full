// backend/services/queue/prescriptionReadProcessor.js
//
// منطق معالجة مهمة "قراءة وصفة طبية" واحدة — غلاف رفيع حول
// agents/prescriptionAgent.js (السير الكامل: OCR → AI → فحص تضارب) يضيف
// فقط تسجيل التدقيق (audit log). مفصول عن BullMQ نفسه بنفس سبب
// invoiceReadProcessor.js — قابل للاختبار مباشرة بلا اتصال Redis حقيقي.
const { readPrescription } = require('../../agents/prescriptionAgent');
const { logAudit } = require('../../utils/auditLog');

async function processPrescriptionReadJob(jobData) {
  const { imageBase64, mimeType, lang, userId, userRole, mode, patientAllergies } = jobData;

  const result = await readPrescription(imageBase64, mimeType, lang, mode, patientAllergies);

  if (result.available) {
    logAudit({
      module: 'prescription-reader',
      action: 'read',
      userId,
      userRole,
      after: {
        provider: result.provider,
        medicinesCount: result.medicines?.length || 0,
        ocrUsed: result.ocrUsed,
        hasInteractions: result.hasInteractions,
        highestSeverity: result.highestSeverity,
        hasAllergyConflicts: result.hasAllergyConflicts,
      },
    });
  } else if (result.error) {
    console.error(`⚠️  [prescription-worker] فشل استدعاء ${result.provider}:`, result.error);
  }

  return result;
}

module.exports = { processPrescriptionReadJob };
