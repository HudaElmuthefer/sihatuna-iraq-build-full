// backend/routes/dicomWebhookRoutes.js
//
// The route Orthanc calls when a new stable radiology study arrives.
// See services/dicom/orthancIntegration.js for the full integration details.
const express = require('express');
const router = express.Router();
const { handleNewStudy } = require('../services/dicom/orthancIntegration');

// -- Important security note --------------------------------------------
// This route intentionally has NO auth middleware — Orthanc itself (not a
// browser user) calls this route, and it doesn't have a JWT token from
// our system. Protection here relies on Orthanc and the backend being on
// the same closed internal network (same assumption as the rest of the
// system currently). If you ever deploy the system in a way that's
// reachable from the public internet, you must add extra protection here
// (e.g. a fixed secret key in the header, checked on the first line).
router.post('/radiology/dicom-webhook', express.json(), async (req, res, next) => {
  try {
    const { studyId } = req.body; // Orthanc sends the study ID in the request body (see the Lua config below)
    if (!studyId) return res.status(400).json({ message: 'studyId is required' });

    const result = await handleNewStudy(studyId);
    res.json({ received: true, ...result });
  } catch (err) { next(err); }
});

module.exports = router;
