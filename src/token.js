const crypto = require("crypto");

const TOKEN_SECRET = process.env.TOKEN_SECRET || "music-api-local-token-secret";

function base64urlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64urlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload) {
  return crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
}

function encodeToken(type, data) {
  const payload = base64urlEncode(JSON.stringify({ type, data }));
  return `${payload}.${sign(payload)}`;
}

function decodeToken(token, expectedType) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || sign(payload) !== signature) {
    const err = new Error("Invalid token.");
    err.status = 401;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(base64urlDecode(payload));
  } catch {
    const err = new Error("Invalid token payload.");
    err.status = 401;
    throw err;
  }

  if (expectedType && parsed.type !== expectedType) {
    const err = new Error(`Expected ${expectedType} token.`);
    err.status = 401;
    throw err;
  }

  return parsed.data;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

module.exports = {
  encodeToken,
  decodeToken,
  tokenHash,
};
