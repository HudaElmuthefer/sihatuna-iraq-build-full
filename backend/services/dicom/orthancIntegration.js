// backend/services/dicom/orthancIntegration.js
//
// DICOM integration (radiology images) — via Orthanc, a free open-source
// DICOM/PACS server (https://www.orthanc-server.com/), used in thousands
// of hospitals worldwide.
//
// -- Why through Orthanc, not raw DICOM directly? --
// The DICOM protocol itself (receiving images from radiology machines)
// is extremely complex technically — tens of thousands of pages of
// standard, requiring a full implementation of a special network
// protocol (C-STORE, C-FIND...). Building this from scratch would be a
// massive separate project on its own, and any bug in it could lose
// real medical images. The standard industry solution: use a ready-made,
// battle-tested PACS program (Orthanc) that actually receives the images
// from the radiology machines (it speaks real DICOM), and our system
// talks to it over a simple REST API (plain HTTP) — much easier and safer.
//
// -- Setup needed later (once a real radiology device is available) --
//   1) Install Orthanc on the same hospital server (free, download from
//      the official site)
//   2) Configure the radiology device to send its images to Orthanc's
//      IP/port (same as any standard PACS setup — the radiology
//      department/maintenance technician usually knows this configuration)
//   3) Enable a "Lua callback" or "Webhook plugin" in Orthanc to call our
//      /api/radiology/dicom-webhook route (see Orthanc's documentation:
//      OnStableStudy Lua script) whenever a new study is completed
//   4) This file handles the rest automatically (fetching study data,
//      matching it, updating the record)
const { pool } = require('../../config/database');
const { logAudit } = require('../../utils/auditLog');
const { devLog } = require('../../utils/logger');

const ORTHANC_URL = process.env.ORTHANC_URL || 'http://localhost:8042';
const ORTHANC_USER = process.env.ORTHANC_USER || '';
const ORTHANC_PASS = process.env.ORTHANC_PASS || '';

// -- Simple request to Orthanc's REST API (no extra axios dependency —
// fetch is built into Node.js, same version already used in the project, v24) --
async function orthancGet(path) {
  const headers = {};
  if (ORTHANC_USER) {
    headers.Authorization = 'Basic ' + Buffer.from(`${ORTHANC_USER}:${ORTHANC_PASS}`).toString('base64');
  }
  const res = await fetch(`${ORTHANC_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`Orthanc REST API returned ${res.status} for ${path}`);
  return res.json();
}

// -- Called when Orthanc sends a webhook for a new stable study --------
// studyOrthancId: Orthanc's internal identifier (not the same as the DICOM UID, this is Orthanc-specific)
async function handleNewStudy(studyOrthancId) {
  const study = await orthancGet(`/studies/${studyOrthancId}`);
  const patientTags = study.PatientMainDicomTags || {};
  const studyTags = study.MainDicomTags || {};

  const patientName = (patientTags.PatientName || '').replace(/\^/g, ' ').trim();
  const accessionNumber = studyTags.AccessionNumber || null; // ← used to match reqNo in the radiology table
  const modality = (study.Series?.[0] && (await orthancGet(`/series/${study.Series[0]}`)).MainDicomTags?.Modality) || null;

  const viewerUrl = `${ORTHANC_URL}/app/explorer.html#study?uuid=${studyOrthancId}`; // Orthanc's built-in viewer

  devLog(`📷 [DICOM] New stable study: patient="${patientName}" | accession number=${accessionNumber || 'unspecified'}`);

  let recordId = null;
  if (accessionNumber) {
    const existing = await pool.query(
      `SELECT id FROM radiology WHERE data->>'reqNo' = $1 LIMIT 1`,
      [accessionNumber]
    );
    if (existing.rows.length > 0) {
      recordId = existing.rows[0].id;
      await pool.query(
        `UPDATE radiology
         SET data = data || $1::jsonb, status = 'examined', updated_at = now()
         WHERE id = $2`,
        [
          JSON.stringify({
            status: 'examined',
            dicomStudyId: studyOrthancId,
            orthancViewerUrl: viewerUrl,
            imagesReceivedAt: new Date().toISOString(),
          }),
          recordId,
        ]
      );
    }
  }

  if (!recordId) {
    // No matching prior request found — create a new record instead of
    // losing the study, flagged as needing manual review
    const insertResult = await pool.query(
      `INSERT INTO radiology (status, modality, data) VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [
        'examined',
        modality || 'other',
        JSON.stringify({
          patientName: patientName || 'Unknown — needs review',
          modality: modality || 'other',
          reqNo: accessionNumber,
          status: 'examined',
          dicomStudyId: studyOrthancId,
          orthancViewerUrl: viewerUrl,
          imagesReceivedAt: new Date().toISOString(),
          needsReview: true,
        }),
      ]
    );
    recordId = insertResult.rows[0].id;
    logAudit({ action: 'DICOM_STUDY_UNMATCHED', table: 'radiology', recordId, note: `accessionNumber=${accessionNumber || 'none'} — new record, no prior request` });
    devLog(`⚠️  [DICOM] No matching prior request — created new record #${recordId}, needs review`);
    return { matched: false, recordId };
  }

  logAudit({ action: 'DICOM_STUDY_RECEIVED', table: 'radiology', recordId, note: `accessionNumber=${accessionNumber}` });
  devLog(`✅ [DICOM] Images received and linked to radiology request #${recordId}`);
  return { matched: true, recordId };
}

module.exports = { handleNewStudy, orthancGet };
