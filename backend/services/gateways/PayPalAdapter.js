// server/services/gateways/PayPalAdapter.js
// تكامل PayPal Checkout — بحاجة: client_id, client_secret من PayPal Developer Dashboard
// التوثيق الرسمي: https://developer.paypal.com/docs/api/orders/v2/
const BaseGatewayAdapter = require('./BaseGatewayAdapter');
const axios = require('axios');

class PayPalAdapter extends BaseGatewayAdapter {
  constructor(credentials, config) {
    super(credentials, config);
    this.baseUrl = config?.isSandbox
      ? 'https://api-m.sandbox.paypal.com'
      : 'https://api-m.paypal.com';
  }

  async _getAccessToken() {
    const auth = Buffer.from(
      `${this.credentials.client_id}:${this.credentials.client_secret}`
    ).toString('base64');
    const response = await axios.post(
      `${this.baseUrl}/v1/oauth2/token`,
      'grant_type=client_credentials',
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return response.data.access_token;
  }

  async initPayment({ amount, currency, invoiceId }) {
    try {
      const token = await this._getAccessToken();
      // PayPal يتطلب عملة دولية (USD غالباً) — تحويل IQD إلى USD يتم قبل الاستدعاء إذا لزم
      const response = await axios.post(
        `${this.baseUrl}/v2/checkout/orders`,
        {
          intent: 'CAPTURE',
          purchase_units: [
            { reference_id: invoiceId, amount: { currency_code: currency || 'USD', value: amount.toFixed(2) } },
          ],
        },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      const approveLink = response.data.links.find((l) => l.rel === 'approve');
      return {
        success: true,
        gatewayTransactionId: response.data.id,
        redirectUrl: approveLink?.href,
        raw: response.data,
      };
    } catch (err) {
      return { success: false, error: err.response?.data || err.message };
    }
  }

  async verifyPayment(gatewayTransactionId) {
    try {
      const token = await this._getAccessToken();
      const response = await axios.get(
        `${this.baseUrl}/v2/checkout/orders/${gatewayTransactionId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const status = response.data.status === 'COMPLETED' ? 'completed' : 'pending';
      return { status, raw: response.data };
    } catch (err) {
      return { status: 'failed', raw: { error: err.message } };
    }
  }
}

module.exports = PayPalAdapter;
