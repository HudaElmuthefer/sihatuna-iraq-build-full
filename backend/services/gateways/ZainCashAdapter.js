// server/services/gateways/ZainCashAdapter.js
// تكامل زين كاش — بحاجة: merchant_id, secret_key, msisdn (رقم التاجر) من لوحة تحكم زين كاش
// التوثيق الرسمي: يوفره زين كاش عند فتح حساب تاجر (Merchant Account)
// هذا Scaffold جاهز للربط الفعلي؛ استبدل الروابط والحقول حسب التوثيق المستلم من زين كاش
const BaseGatewayAdapter = require('./BaseGatewayAdapter');
const axios = require('axios'); // npm install axios

class ZainCashAdapter extends BaseGatewayAdapter {
  constructor(credentials, config) {
    super(credentials, config);
    this.baseUrl = config?.isSandbox
      ? 'https://test.zaincash.iq'
      : 'https://api.zaincash.iq';
  }

  async initPayment({ amount, currency, invoiceId, metadata }) {
    if (currency !== 'IQD') {
      throw new Error('زين كاش يدعم الدينار العراقي فقط');
    }
    try {
      // TODO: استبدل هذا بالـ endpoint الفعلي حسب توثيق زين كاش (JWT token creation)
      const response = await axios.post(`${this.baseUrl}/transaction/init`, {
        amount,
        merchantId: this.credentials.merchant_id,
        orderId: invoiceId,
        redirectUrl: this.config.redirectUrl,
        secret: this.credentials.secret_key,
      });
      return {
        success: true,
        gatewayTransactionId: response.data.id || response.data.transactionId,
        redirectUrl: response.data.redirectUrl,
        raw: response.data,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async verifyPayment(gatewayTransactionId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/transaction/${gatewayTransactionId}/status`,
        { headers: { Authorization: `Bearer ${this.credentials.secret_key}` } }
      );
      const status = response.data.status === 'success' ? 'completed' : 'pending';
      return { status, raw: response.data };
    } catch (err) {
      return { status: 'failed', raw: { error: err.message } };
    }
  }
}

module.exports = ZainCashAdapter;
