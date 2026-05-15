const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const SESSION_FILE = process.env.SESSION_FILE || path.join(DATA_DIR, "sessions.json");

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSessions() {
  ensureDataDir();
  if (!fs.existsSync(SESSION_FILE)) return new Map();

  try {
    const raw = fs.readFileSync(SESSION_FILE, "utf8");
    const data = JSON.parse(raw);
    return new Map(Object.entries(data.sessions || {}));
  } catch (err) {
    console.warn(`Failed to load sessions from ${SESSION_FILE}: ${err.message}`);
    return new Map();
  }
}

function saveSessions(sessions) {
  ensureDataDir();
  const payload = {
    updatedAt: new Date().toISOString(),
    sessions: Object.fromEntries(sessions),
  };
  const tmpFile = `${SESSION_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpFile, SESSION_FILE);
}

module.exports = {
  SESSION_FILE,
  loadSessions,
  saveSessions,
};
