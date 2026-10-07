// server/services/gateways/BankCardAdapter.js
// أدابتر عام لأي بوابة بطاقات مصرفية محلية أخرى غير المدرجة (بنك الرشيد، الرافدين، إلخ)
// نفس نمط الـ Adapters السابقة — عدّل الـ endpoints حسب البنك المطلوب فعلياً
const BaseGatewayAdapter = require('./BaseGatewayAdapter');
const axios = require('axios');

class BankCardAdapter extends BaseGatewayAdapter {
  constructor(credentials, config) {
    super(credentials, config);
    this.baseUrl = credentials.gateway_url; // يُدخله الإدمن حسب البنك المتعاقد معه
  }

  async initPayment({ amount, currency, invoiceId, metadata }) {
    if (!this.baseUrl) {
      return { success: false, error: 'رابط بوابة البنك (gateway_url) غير مُعرّف بإعدادات الإدمن' };
    }
    try {
      const response = await axios.post(
        `${this.baseUrl}/pay`,
        { amount, currency, order_id: invoiceId, merchant_id: this.credentials.merchant_id },
        { headers: { Authorization: `Bearer ${this.credentials.api_key}` } }
      );
      return {
        success: true,
        gatewayTransactionId: response.data.id,
        redirectUrl: response.data.redirect_url,
        raw: response.data,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async verifyPayment(gatewayTransactionId) {
    try {
      const response = await axios.get(`${this.baseUrl}/pay/${gatewayTransactionId}`, {
        headers: { Authorization: `Bearer ${this.credentials.api_key}` },
      });
      return { status: response.data.paid ? 'completed' : 'pending', raw: response.data };
    } catch (err) {
      return { status: 'failed', raw: { error: err.message } };
    }
  }
}

module.exports = BankCardAdapter;
