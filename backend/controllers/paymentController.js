// server/controllers/paymentController.js
const paymentGatewayService = require('../services/paymentGatewayService');
const { getDefaultHospitalId } = require('../config/defaultHospital');

// GET /api/payment-methods -> البوابات المتاحة بشاشة الدفع
async function getAvailableMethods(req, res) {
  const hospitalId = await getDefaultHospitalId();
  const gateways = await paymentGatewayService.getActiveGatewaysForHospital(hospitalId);
  res.json(gateways);
}

// POST /api/payments  body: { invoiceId, patientId, providerCode, amount, currency, metadata }
async function createPayment(req, res) {
  try {
    const hospitalId = await getDefaultHospitalId();
    const userId = req.user?.id || null;
    const result = await paymentGatewayService.initiatePayment({ ...req.body, hospitalId, userId });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}

// POST /api/payments/:paymentId/verify -> يستدعى بعد رجوع المستخدم من بوابة الدفع أو عبر webhook
async function verifyPayment(req, res) {
  try {
    const payment = await paymentGatewayService.verifyAndUpdatePayment(req.params.paymentId);
    res.json(payment);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}

// POST /api/payments/:paymentId/manual-confirm  body: { referenceNote }
// تُستخدم لبوابات مثل Western Union أو الحوالات البنكية
async function manualConfirm(req, res) {
  try {
    const userId = req.user?.id || null;
    const payment = await paymentGatewayService.manuallyConfirmPayment(
      req.params.paymentId,
      req.body.referenceNote,
      userId
    );
    res.json(payment);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}

module.exports = { getAvailableMethods, createPayment, verifyPayment, manualConfirm };
