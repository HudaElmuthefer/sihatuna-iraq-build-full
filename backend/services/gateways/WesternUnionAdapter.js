// server/services/gateways/WesternUnionAdapter.js
//
// ملاحظة مهمة: لا يوفر ويسترن يونيون واجهة برمجية مباشرة لبوابة "دفع فوري" بالطريقة
// التي تعمل بها PayPal أو زين كاش. آلية WU الفعلية: يرسل المريض حوالة باسم المستشفى
// أو المستلم المعتمد من مكتب WU، ويحصل على رقم مرجعي (MTCN - Money Transfer Control Number)،
// ثم يتحقق موظف الاستقبال أو المحاسب من الحوالة (يدوياً عبر منصة WU الخاصة
// بالتاجر إن وجدت، أو بمراجعة مكتب الصرافة) ويسجلها في النظام.
//
// لذلك يُعد هذا الأدابتر "شبه يدوي": تسجل initPayment طلب دفع بحالة pending
// وتنتظر إدخال رقم MTCN من طرف المحاسب، وتتحول verifyPayment إلى completed
// فقط بعد تأكيد يدوي صريح من المستخدم المخوّل (وليس تلقائياً).

const BaseGatewayAdapter = require('./BaseGatewayAdapter');
const crypto = require('crypto');

class WesternUnionAdapter extends BaseGatewayAdapter {
  async initPayment({ amount, currency, invoiceId, metadata }) {
    const gatewayTransactionId = `WU-PENDING-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    return {
      success: true,
      gatewayTransactionId,
      raw: {
        note: 'بانتظار تسجيل رقم MTCN من طرف المحاسب بعد استلام الحوالة',
        requiresManualConfirmation: true,
      },
    };
  }

  // يُستدعى فقط عند إدخال المحاسب لرقم MTCN يدوياً بواجهة الإدمن
  async confirmManually(gatewayTransactionId, mtcnReference, confirmedByUserId) {
    return {
      status: 'completed',
      raw: { mtcnReference, confirmedByUserId, confirmedAt: new Date().toISOString() },
    };
  }

  async verifyPayment(gatewayTransactionId) {
    // بدون تأكيد يدوي، تبقى الحالة pending دائماً
    return { status: 'pending', raw: { note: 'بحاجة تأكيد يدوي عبر confirmManually()' } };
  }
}

module.exports = WesternUnionAdapter;
