const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function createId(prefix = "") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,]+=)/).map((item) => item.trim()).filter(Boolean);
}

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  return splitSetCookie(response.headers.get("set-cookie"));
}

function addSetCookies(cookieMap, response) {
  for (const cookie of getSetCookies(response)) {
    const pair = cookie.split(";")[0].trim();
    const [name, value = ""] = pair.split("=");
    if (name && value) cookieMap.set(name, pair);
  }
}

function cookieString(cookieMap) {
  return Array.from(cookieMap.values()).join("; ");
}

function cookieObject(cookie) {
  const obj = {};
  String(cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const index = pair.indexOf("=");
      if (index > 0) obj[pair.slice(0, index)] = pair.slice(index + 1);
    });
  return obj;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": USER_AGENT,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return { response, text };
}

async function fetchJson(url, options = {}) {
  const { response, text } = await fetchText(url, options);
  try {
    return { response, data: JSON.parse(text) };
  } catch {
    return { response, data: { raw: text } };
  }
}

function numberParam(value, fallback, min, max) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(safe, min), max);
}

module.exports = {
  USER_AGENT,
  createId,
  getSetCookies,
  addSetCookies,
  cookieString,
  cookieObject,
  fetchText,
  fetchJson,
  numberParam,
};
