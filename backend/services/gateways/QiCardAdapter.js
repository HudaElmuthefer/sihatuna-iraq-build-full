// server/services/gateways/QiCardAdapter.js
// تكامل Qi Card — بحاجة: api_key, terminal_id من بنك بغداد الدولي (مزود Qi Card)
const BaseGatewayAdapter = require('./BaseGatewayAdapter');
const axios = require('axios');

class QiCardAdapter extends BaseGatewayAdapter {
  constructor(credentials, config) {
    super(credentials, config);
    this.baseUrl = config?.isSandbox
      ? 'https://sandbox.qi.iq/pay/api'
      : 'https://pay.qi.iq/api';
  }

  async initPayment({ amount, currency, invoiceId, metadata }) {
    try {
      // TODO: استبدل بالـ endpoint الفعلي حسب توثيق Qi Card / بنك بغداد
      const response = await axios.post(
        `${this.baseUrl}/transactions`,
        { amount, currency, reference: invoiceId, terminal_id: this.credentials.terminal_id },
        { headers: { 'X-API-Key': this.credentials.api_key } }
      );
      return {
        success: true,
        gatewayTransactionId: response.data.transaction_id,
        redirectUrl: response.data.payment_url,
        raw: response.data,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async verifyPayment(gatewayTransactionId) {
    try {
      const response = await axios.get(`${this.baseUrl}/transactions/${gatewayTransactionId}`, {
        headers: { 'X-API-Key': this.credentials.api_key },
      });
      const status = response.data.state === 'settled' ? 'completed' : 'pending';
      return { status, raw: response.data };
    } catch (err) {
      return { status: 'failed', raw: { error: err.message } };
    }
  }
}

module.exports = QiCardAdapter;
