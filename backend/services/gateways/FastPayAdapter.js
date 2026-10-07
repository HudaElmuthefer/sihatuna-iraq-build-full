// server/services/gateways/FastPayAdapter.js
// تكامل FastPay — بحاجة: api_key, merchant_id من لوحة تحكم فاست باي
const BaseGatewayAdapter = require('./BaseGatewayAdapter');
const axios = require('axios');

class FastPayAdapter extends BaseGatewayAdapter {
  constructor(credentials, config) {
    super(credentials, config);
    this.baseUrl = config?.isSandbox
      ? 'https://sandbox.fastpay.iq/api/v1'
      : 'https://api.fastpay.iq/api/v1';
  }

  async initPayment({ amount, currency, invoiceId, metadata }) {
    try {
      // TODO: استبدل بالـ endpoint الفعلي حسب توثيق FastPay
      const response = await axios.post(
        `${this.baseUrl}/payments`,
        { amount, currency, order_id: invoiceId, merchant_id: this.credentials.merchant_id },
        { headers: { Authorization: `Bearer ${this.credentials.api_key}` } }
      );
      return {
        success: true,
        gatewayTransactionId: response.data.payment_id,
        redirectUrl: response.data.checkout_url,
        raw: response.data,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async verifyPayment(gatewayTransactionId) {
    try {
      const response = await axios.get(`${this.baseUrl}/payments/${gatewayTransactionId}`, {
        headers: { Authorization: `Bearer ${this.credentials.api_key}` },
      });
      const status = response.data.status === 'paid' ? 'completed' : 'pending';
      return { status, raw: response.data };
    } catch (err) {
      return { status: 'failed', raw: { error: err.message } };
    }
  }
}

module.exports = FastPayAdapter;
