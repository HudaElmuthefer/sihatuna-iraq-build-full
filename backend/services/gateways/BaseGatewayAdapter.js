// server/services/gateways/BaseGatewayAdapter.js
// كل بوابة دفع (Zain Cash, FastPay, Qi Card, PayPal...) يجب أن تطبّق نفس الواجهة
// هذا يجعل إضافة بوابة جديدة مستقبلاً = ملف جديد فقط، بدون تعديل الكود الأساسي

class BaseGatewayAdapter {
  constructor(credentials = {}, config = {}) {
    this.credentials = credentials; // {api_key, api_secret, merchant_id, ...} مفكوكة التشفير
    this.config = config;           // إعدادات غير حساسة (sandbox mode, webhook url...)
  }

  /**
   * يبدأ عملية دفع جديدة
   * @returns {Promise<{success: boolean, gatewayTransactionId: string, redirectUrl?: string, raw?: object}>}
   */
  async initPayment({ amount, currency, invoiceId, patientId, metadata }) {
    throw new Error('initPayment() يجب تطبيقه بكل Adapter');
  }

  /**
   * يتحقق من حالة عملية دفع (بعد رجوع المستخدم من البوابة أو webhook)
   * @returns {Promise<{status: 'completed'|'pending'|'failed', raw?: object}>}
   */
  async verifyPayment(gatewayTransactionId) {
    throw new Error('verifyPayment() يجب تطبيقه بكل Adapter');
  }

  /**
   * استرجاع مبلغ (اختياري، ليست كل البوابات تدعمه)
   */
  async refund(gatewayTransactionId, amount) {
    throw new Error(`refund() غير مدعوم بهذه البوابة`);
  }
}

module.exports = BaseGatewayAdapter;
