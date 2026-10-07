// backend/services/hl7/hl7Listener.js
//
// HL7 v2 server (MLLP protocol) — automatically receives lab result
// messages from any analyzer device that supports HL7 (almost every
// modern lab analyzer supports it — this is an old, widely-used global
// standard for medical lab equipment).
//
// -- Why no external npm package? --
// HL7 v2 format is relatively simple plain text (fields separated by |
// and ^), and MLLP is just a simple framing wrapper around the text
// (start byte 0x0B, end bytes 0x1C 0x0D). Writing it by hand with
// Node.js core (net module) avoids relying on an external library whose
// exact compatibility may vary by device manufacturer, and gives full
// control to adjust later for any real device you connect (each device
// has small quirks even though the standard is nominally unified).
//
// -- Expected workflow (full flow) --
//   1) Staff creates a lab test request in the Laboratory page (status
//      "pending") — a request number (reqNo) is generated automatically
//   2) Staff writes/enters that reqNo into the analyzer device (each
//      device has its own method: manual entry screen, or a barcode
//      scanner if the request is printed with a barcode)
//   3) The device analyzes the sample and automatically sends an HL7
//      message (ORU^R01) carrying the same reqNo with the result, over
//      the network, to this server
//   4) This server finds the matching record by reqNo, fills in the
//      result, and automatically changes its status to "completed" —
//      no manual entry needed from staff
//   5) If no matching reqNo is found (e.g. the device sent a result
//      without a prior request in the system), a new record is created
//      instead of losing the result, flagged for manual review
//
// -- Setup needed later (once a real device is available) --
// Every device has an "Interface/Connectivity Guide" from the
// manufacturer that specifies exactly: which HL7 field it uses for each
// piece of data (sometimes it differs from the standard position), and
// the network settings required (IP/Port). Check it and adjust the
// parseORU function below for any differences you find.
const net = require('net');
const { pool } = require('../../config/database');
const { logAudit } = require('../../utils/auditLog');
const { devLog } = require('../../utils/logger');

const VT = 0x0b; // MLLP message start byte (Vertical Tab)
const FS = 0x1c; // MLLP message end byte (File Separator)
const CR = 0x0d; // Carriage return, always follows FS per the MLLP standard

// -- Parse a raw HL7 message into a structured object --------------------
// We only extract the fields we actually need (patientName, reqNo,
// testType, result, notes) — a real HL7 message is much richer than
// this, but this is everything your lab_tests table currently uses.
function parseORU(rawMessage) {
  const segments = rawMessage.split('\r').filter(Boolean);
  const result = { patientName: null, reqNo: null, testType: null, value: null, notes: null };

  segments.forEach((seg) => {
    const fields = seg.split('|');
    const segType = fields[0];

    if (segType === 'PID') {
      // PID-5: patient name in "LastName^FirstName" format — join with a space
      const nameField = fields[5] || '';
      result.patientName = nameField.split('^').filter(Boolean).join(' ').trim() || null;
    }

    if (segType === 'OBR') {
      // OBR-2 (Placer Order Number) or OBR-3 (Filler Order Number) — the
      // request number we use to match an existing lab_tests record
      result.reqNo = (fields[2] || fields[3] || '').split('^')[0] || null;
      // OBR-4: test type (may be formatted as "CODE^Description^CodingSystem")
      const obr4 = (fields[4] || '').split('^');
      result.testType = obr4[1] || obr4[0] || null;
    }

    if (segType === 'OBX') {
      // OBX-5: result value, OBX-8: optional interpretive flag/note
      const value = fields[5] || '';
      if (value) {
        result.value = result.value ? `${result.value}, ${value}` : value; // support multiple OBX segments in one message
      }
      if (fields[8]) result.notes = fields[8];
    }
  });

  return result;
}

// -- Apply the result to an existing lab_tests record, or create one -----
async function applyResultToDatabase(parsed) {
  if (!parsed.reqNo) {
    devLog('⚠️  [HL7] Message has no request number (reqNo) — rejected, cannot be matched');
    return { matched: false, reason: 'no_reqno' };
  }

  const existing = await pool.query(
    `SELECT id FROM lab_tests WHERE data->>'reqNo' = $1 LIMIT 1`,
    [parsed.reqNo]
  );

  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    // Update the JSONB data column (result + status) — status is already
    // a real indexed column (promoted earlier in this session), so we
    // update it separately too, to keep the index consistent.
    await pool.query(
      `UPDATE lab_tests
       SET data = data || $1::jsonb, status = 'completed', updated_at = now()
       WHERE id = $2`,
      [
        JSON.stringify({
          status: 'completed',
          results: { value: parsed.value, notes: parsed.notes || '' },
          resultSource: 'HL7_AUTO',
          resultReceivedAt: new Date().toISOString(),
        }),
        id,
      ]
    );
    logAudit({ action: 'HL7_RESULT_RECEIVED', table: 'lab_tests', recordId: id, note: `reqNo=${parsed.reqNo}` });
    devLog(`✅ [HL7] Result received and applied to request ${parsed.reqNo} (record #${id})`);
    return { matched: true, recordId: id };
  }

  // No matching prior request found — create a new record instead of
  // losing the result, clearly flagged as needing manual review (e.g. to
  // link it to the correct patient if the name doesn't match exactly)
  const insertResult = await pool.query(
    `INSERT INTO lab_tests (status, data) VALUES ($1, $2::jsonb) RETURNING id`,
    [
      'completed',
      JSON.stringify({
        patientName: parsed.patientName || 'Unknown — needs review',
        testType: parsed.testType || 'Unspecified',
        reqNo: parsed.reqNo,
        status: 'completed',
        results: { value: parsed.value, notes: parsed.notes || '' },
        resultSource: 'HL7_AUTO_UNMATCHED',
        resultReceivedAt: new Date().toISOString(),
        needsReview: true,
      }),
    ]
  );
  const newId = insertResult.rows[0].id;
  logAudit({ action: 'HL7_RESULT_UNMATCHED', table: 'lab_tests', recordId: newId, note: `reqNo=${parsed.reqNo} — new record, no prior request` });
  devLog(`⚠️  [HL7] No prior request found for ${parsed.reqNo} — created new record #${newId}, needs review`);
  return { matched: false, recordId: newId, reason: 'created_new' };
}

// -- Build an acknowledgment (ACK) message — HL7 always requires one, or
// the device will keep resending the same message thinking it never
// arrived ------------------------------------------------------------
function buildACK(originalMessage) {
  const now = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const msh = originalMessage.split('\r')[0] || '';
  const msgControlId = (msh.split('|')[9] || '1');
  const ack = [
    `MSH|^~\\&|SIHATUNA|HOSPITAL|LAB|LAB|${now}||ACK^R01|${msgControlId}-ACK|P|2.3`,
    `MSA|AA|${msgControlId}`,
  ].join('\r') + '\r';
  return ack;
}

// -- Start the server ------------------------------------------------------
function startHL7Listener(port = process.env.HL7_PORT || 2575) {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    devLog(`🔌 [HL7] New connection from ${socket.remoteAddress}:${socket.remotePort}`);

    socket.on('data', async (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Look for a complete MLLP frame (VT ... FS CR) inside the received
      // data — devices sometimes split one message across multiple TCP packets
      const startIdx = buffer.indexOf(VT);
      const endIdx = buffer.indexOf(Buffer.from([FS, CR]));
      if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return; // message not complete yet

      const rawMessage = buffer.slice(startIdx + 1, endIdx).toString('utf8');
      buffer = buffer.slice(endIdx + 2); // keep any extra data after this message for the next one

      try {
        const parsed = parseORU(rawMessage);
        await applyResultToDatabase(parsed);
      } catch (err) {
        console.error('❌ [HL7] Failed to process message:', err.message);
      }

      // Always send an ACK, even if internal processing failed — otherwise
      // the device will keep resending the same message indefinitely
      const ack = buildACK(rawMessage);
      const framed = Buffer.concat([Buffer.from([VT]), Buffer.from(ack, 'utf8'), Buffer.from([FS, CR])]);
      socket.write(framed);
    });

    socket.on('error', (err) => console.error('❌ [HL7] Connection error:', err.message));
  });

  server.listen(port, () => {
    devLog(`🧪 [HL7] Server listening on port ${port} — ready to receive lab results`);
  });

  // -- Critical fix: without this, any error on the HL7 server itself
  // (most commonly: port 2575 already in use by another program on your
  // machine — EADDRINUSE) used to crash the ENTIRE main server, not just
  // the lab feature. Now the error is logged clearly and the main
  // backend keeps running normally without the lab integration.
  server.on('error', (err) => {
    console.error(`❌ [HL7] Failed to start HL7 server on port ${port}: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.error(`   Port ${port} is already in use by another program — change HL7_PORT in .env to a different port (e.g. 2576) and restart.`);
    }
  });

  return server;
}

module.exports = { startHL7Listener, parseORU, applyResultToDatabase, buildACK };
