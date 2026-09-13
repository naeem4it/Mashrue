const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (e) {
    console.warn('Could not create logs directory:', e.message);
  }
}

const appLogPath = path.join(logsDir, 'app.log');
const errorLogPath = path.join(logsDir, 'error.log');

function writeLog(filePath, level, message, details = null) {
  const timestamp = new Date().toISOString();
  let logLine = `[${timestamp}] [${level}] ${message}`;
  if (details) {
    if (details instanceof Error) {
      logLine += `\nStack: ${details.stack || details.message}`;
    } else if (typeof details === 'object') {
      try {
        logLine += ` | Data: ${JSON.stringify(details)}`;
      } catch (_) {
        logLine += ` | Data: [Unserializable Object]`;
      }
    } else {
      logLine += ` | Details: ${details}`;
    }
  }
  logLine += '\n';

  try {
    fs.appendFileSync(filePath, logLine);
  } catch (err) {
    console.error('Failed to write to log file:', err.message);
  }
}

const logger = {
  info(message, details = null) {
    console.log(`[INFO] ${message}`, details || '');
    writeLog(appLogPath, 'INFO', message, details);
  },

  warn(message, details = null) {
    console.warn(`[WARN] ${message}`, details || '');
    writeLog(appLogPath, 'WARN', message, details);
  },

  error(message, details = null) {
    console.error(`[ERROR] ${message}`, details || '');
    writeLog(appLogPath, 'ERROR', message, details);
    writeLog(errorLogPath, 'ERROR', message, details);
  }
};

module.exports = logger;
