const CryptoJS = require("crypto-js");
const QRCode = require("qrcode");
const { cookieObject, createId, fetchText } = require("../utils");

const iv = "0102030405060708";
const eapiKey = "e82ckenh8dichen8";
const API_DOMAIN = "https://interface.music.163.com";
const DOMAIN = "https://music.163.com";

function aesEncrypt(text, mode, key, format = "base64") {
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(text),
    CryptoJS.enc.Utf8.parse(key),
    {
      iv: CryptoJS.enc.Utf8.parse(iv),
      mode: CryptoJS.mode[mode.toUpperCase()],
      padding: CryptoJS.pad.Pkcs7,
    }
  );
  if (format === "base64") return encrypted.toString();
  return encrypted.ciphertext.toString().toUpperCase();
}

function eapi(uri, object) {
  const text = JSON.stringify(object);
  const message = `nobody${uri}use${text}md5forencrypt`;
  const digest = CryptoJS.MD5(message).toString();
  const data = `${uri}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return { params: aesEncrypt(data, "ecb", eapiKey, "hex") };
}

function cookieHeader(cookie) {
  const parsed = typeof cookie === "string" ? cookieObject(cookie) : cookie || {};
  const now = Math.floor(Date.now() / 1000).toString();
  const nuid = CryptoJS.lib.WordArray.random(32).toString();
  const header = {
    __remember_me: "true",
    ntes_kaola_ad: "1",
    _ntes_nuid: parsed._ntes_nuid || nuid,
    _ntes_nnid: parsed._ntes_nnid || `${nuid},${Date.now()}`,
    WNMCID: parsed.WNMCID || `music.${Date.now()}.01.0`,
    WEVNSM: parsed.WEVNSM || "1.0.0",
    osver: parsed.osver || "16.2",
    deviceId: parsed.deviceId || CryptoJS.lib.WordArray.random(16).toString(),
    os: parsed.os || "iPhone OS",
    channel: parsed.channel || "distribution",
    appver: parsed.appver || "9.0.90",
    versioncode: parsed.versioncode || "140",
    mobilename: parsed.mobilename || "",
    buildver: parsed.buildver || now,
    resolution: parsed.resolution || "1920x1080",
    __csrf: parsed.__csrf || "",
    requestId: `${Date.now()}_${Math.floor(Math.random() * 1000).toString().padStart(4, "0")}`,
    MUSIC_U: parsed.MUSIC_U,
    MUSIC_A: parsed.MUSIC_A,
  };
  return Object.entries(header)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("; ");
}

async function ncmRequest(uri, data, cookie = "") {
  data.e_r = false;
  data.header = cookieObject(cookieHeader(cookie).replace(/; /g, ";"));
  const encrypted = eapi(uri, data);
  const body = new URLSearchParams(encrypted).toString();
  const url = `${API_DOMAIN}/eapi/${uri.slice(5)}`;
  const { response, text } = await fetchText(url, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(cookie),
      "User-Agent": "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)",
    },
  });
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { response, data: parsed };
}

function normalizeSong(song, index) {
  const artists = Array.isArray(song.ar || song.artists)
    ? (song.ar || song.artists).map((item) => item.name).filter(Boolean).join("/")
    : "";
  const album = song.al || song.album || {};
  return {
    index,
    provider: "netease",
    id: String(song.id),
    songid: song.id,
    name: song.name,
    singer: artists,
    album: album.name || "",
    duration: song.dt ? Math.round(song.dt / 1000) : song.duration ? Math.round(song.duration / 1000) : 0,
    raw: song,
  };
}

async function createLogin(sessionId) {
  const { data } = await ncmRequest("/api/login/qrcode/unikey", { type: 3 });
  const key = data?.unikey || data?.data?.unikey;
  if (!key) throw new Error("Failed to get NetEase QR key");
  const qrurl = `${DOMAIN}/login?codekey=${key}`;
  return {
    session: { provider: "netease", sessionId, key, createdAt: Date.now() },
    response: {
      provider: "netease",
      sessionId,
      key,
      qrurl,
      image: await QRCode.toDataURL(qrurl),
    },
  };
}

async function pollLogin(session) {
  const { response, data } = await ncmRequest("/api/login/qrcode/client/login", {
    key: session.key,
    type: 3,
  });
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const cookie = setCookie.map((item) => item.split(";")[0]).join(";");
  const code = Number(data.code);
  if (code !== 803 && code !== 200) {
    return {
      session,
      response: {
        provider: "netease",
        sessionId: session.sessionId,
        loggedIn: false,
        status: code === 801 ? "waiting" : code === 802 ? "scanned" : "pending",
        code,
        message: data.message,
      },
    };
  }
  let accountInfo = {};
  try {
    const result = await ncmRequest("/api/nuser/account/get", {}, cookie);
    if (Number(result.data?.code) === 200) {
      const account = result.data?.account || {};
      const profile = result.data?.profile || {};
      accountInfo = {
        userId: profile.userId || account.id,
        accountId: account.id,
        nickname: profile.nickname,
        profile,
      };
    }
  } catch {
    accountInfo = {};
  }
  const nextSession = { ...session, cookie, loggedInAt: Date.now() };
  return {
    session: { ...nextSession, ...accountInfo },
    response: {
      provider: "netease",
      sessionId: session.sessionId,
      loggedIn: true,
      code,
      ...accountInfo,
      cookie,
    },
  };
}

async function search({ key, page, limit, session }) {
  const offset = (page - 1) * limit;
  const { data } = await ncmRequest(
    "/api/cloudsearch/pc",
    {
      s: key,
      type: 1,
      limit,
      offset,
      total: true,
    },
    session?.cookie || ""
  );
  const songs = Array.isArray(data?.result?.songs) ? data.result.songs.map(normalizeSong) : [];
  return { songs, raw: data };
}

function normalizeQuality(value) {
  const quality = String(value || "exhigh").toLowerCase();
  const allowed = new Set(["standard", "higher", "exhigh", "lossless", "hires", "jyeffect", "sky", "jymaster"]);
  return allowed.has(quality) ? quality : "exhigh";
}

async function play({ song, quality, session }) {
  const level = normalizeQuality(quality);
  const data = {
    ids: `[${song.id || song.songid}]`,
    level,
    encodeType: "flac",
  };
  if (level === "sky") data.immerseType = "c51";
  const result = await ncmRequest("/api/song/enhance/player/url/v1", data, session?.cookie || "");
  const item = Array.isArray(result.data?.data) ? result.data.data[0] : null;
  return {
    provider: "netease",
    song,
    quality: level,
    url: item?.url || "",
    error: item?.url ? undefined : "No playable NetEase URL returned.",
    raw: result.data,
  };
}

module.exports = {
  name: "netease",
  createLogin,
  pollLogin,
  search,
  play,
  createSearchId: () => createId("ne_"),
};
