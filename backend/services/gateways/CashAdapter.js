// server/services/gateways/CashAdapter.js
// الدفع النقدي: ما يحتاج بوابة خارجية — يسجل مباشرة كمكتمل بمجرد تأكيد الموظف بالكاشير
const BaseGatewayAdapter = require('./BaseGatewayAdapter');
const crypto = require('crypto');

class CashAdapter extends BaseGatewayAdapter {
  async initPayment({ amount, currency, invoiceId, patientId, metadata }) {
    // لا يوجد اتصال خارجي؛ نولّد رقم مرجعي داخلي فقط
    const gatewayTransactionId = `CASH-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    return {
      success: true,
      gatewayTransactionId,
      raw: { note: 'دفع نقدي مباشر عبر الكاشير', cashierId: metadata?.cashierId || null },
    };
  }

  async verifyPayment(gatewayTransactionId) {
    // الدفع النقدي يعتبر مكتمل فور التسجيل (لا يحتاج تحقق خارجي)
    return { status: 'completed', raw: { gatewayTransactionId } };
  }

  async refund(gatewayTransactionId, amount) {
    // استرجاع الكاش يُسجَّل يدوياً من طرف المحاسب
    return { success: true, raw: { note: 'استرجاع نقدي يدوي', amount } };
  }
}

module.exports = CashAdapter;
