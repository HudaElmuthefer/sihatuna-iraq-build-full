// backend/utils/logger.js
//
// Lightweight logger for diagnostic/informational messages (server
// startup, manual migrations, backups...) — only prints when NODE_ENV is
// not "production" (i.e. during local development, or when manually
// running a migration script without NODE_ENV set). In production (PM2
// with NODE_ENV=production), it's automatically silenced — this also
// hides the default password list from production logs, an extra
// security improvement on top of reducing noise.
//
// Do not use this for real error messages (use console.error directly,
// or the sendAlert system in utils/alerts.js for critical errors) — this
// is only for "informational, not a problem" messages.
const isProd = process.env.NODE_ENV === 'production';

const devLog = (...args) => {
  if (!isProd) console.log(...args);
};

module.exports = { devLog };
