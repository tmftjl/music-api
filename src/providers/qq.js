const {
  USER_AGENT,
  addSetCookies,
  cookieObject,
  cookieString,
  createId,
  fetchJson,
  fetchText,
  getSetCookies,
} = require("../utils");

const QUALITY_MAP = {
  m4a: { prefix: "C400", suffix: ".m4a" },
  128: { prefix: "M500", suffix: ".mp3" },
  320: { prefix: "M800", suffix: ".mp3" },
  flac: { prefix: "F000", suffix: ".flac" },
  ape: { prefix: "A000", suffix: ".ape" },
};

function hash33(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash += (hash << 5) + value.charCodeAt(i);
  return hash & 0x7fffffff;
}

function getGtk(pSkey) {
  let hash = 5381;
  for (let i = 0; i < pSkey.length; i += 1) hash += (hash << 5) + pSkey.charCodeAt(i);
  return hash & 0x7fffffff;
}

function getGuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    .replace(/[xy]/g, (char) => {
      const random = (Math.random() * 16) | 0;
      const value = char === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    })
    .toUpperCase();
}

function randomHex(length) {
  let value = "";
  while (value.length < length) value += Math.floor(Math.random() * 16).toString(16);
  return value.slice(0, length);
}

function cookieMapFromString(cookie) {
  const map = new Map();
  String(cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [name, value = ""] = pair.split("=");
      if (name && value) map.set(name, pair);
    });
  return map;
}

function parsePtuiCallback(text) {
  const match = text.match(/ptuiCB\((.*)\)/);
  if (!match) return null;
  const values = [];
  const regexp = /'([^']*)'/g;
  let item;
  while ((item = regexp.exec(match[1])) !== null) values.push(item[1]);
  return {
    code: values[0],
    subCode: values[1],
    redirectUrl: values[2],
    message: values[4],
    nickname: values[5],
    raw: text,
  };
}

function normalizeQuality(value) {
  const quality = String(value || "128").toLowerCase();
  return QUALITY_MAP[quality] ? quality : "128";
}

function extractUin(cookie) {
  return cookieObject(cookie).uin || "0";
}

function normalizeSong(song, index) {
  const singers = Array.isArray(song.singer)
    ? song.singer.map((item) => item.name).filter(Boolean).join("/")
    : song.singername || song.singer_name || "";
  return {
    index,
    provider: "qq",
    id: String(song.mid || ""),
    songmid: song.mid,
    mediaId: song.file?.media_mid || song.mid,
    songid: song.id,
    name: song.name,
    singer: singers,
    album: song.albumname || song.album_name || song.album?.name || "",
    duration: song.interval || song.song_play_time || 0,
    raw: song,
  };
}

function normalizeSearchData(data) {
  const list = data?.req?.data?.body?.song?.list || [];
  return Array.isArray(list) ? list.map(normalizeSong) : [];
}

function pickDomain(sip) {
  if (!Array.isArray(sip)) return "";
  return (
    sip.find((item) => typeof item === "string" && item.startsWith("https://")) ||
    sip.find((item) => typeof item === "string" && !item.startsWith("http://ws")) ||
    sip.find((item) => typeof item === "string") ||
    ""
  );
}

function joinUrl(domain, path) {
  if (!domain || !path) return "";
  if (domain.endsWith("/") && path.startsWith("/")) return domain + path.slice(1);
  if (!domain.endsWith("/") && !path.startsWith("/")) return `${domain}/${path}`;
  return `${domain}${path}`;
}

async function createLogin(sessionId) {
  const cookieMap = new Map();
  const xloginUrl =
    "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609&daid=383&style=33" +
    "&login_text=%E7%99%BB%E5%BD%95&hide_title_bar=1&hide_border=1&target=self" +
    "&s_url=https%3A%2F%2Fgraph.qq.com%2Foauth2.0%2Flogin_jump&pt_3rd_aid=100497308";
  const xlogin = await fetch(xloginUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://graph.qq.com/",
    },
  });
  addSetCookies(cookieMap, xlogin);

  const loginSig = cookieString(cookieMap).match(/pt_login_sig=([^;]+)/)?.[1] || "";
  const url =
    "https://ssl.ptlogin2.qq.com/ptqrshow?" +
    new URLSearchParams({
      appid: "716027609",
      e: "2",
      l: "M",
      s: "3",
      d: "72",
      v: "4",
      t: String(Math.random()),
      daid: "383",
      pt_3rd_aid: "100497308",
      u1: "https://graph.qq.com/oauth2.0/login_jump",
    }).toString();
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://xui.ptlogin2.qq.com/",
      Cookie: cookieString(cookieMap),
    },
  });
  addSetCookies(cookieMap, response);
  const buffer = Buffer.from(await response.arrayBuffer());
  const setCookie = cookieString(cookieMap);
  const qrsig = setCookie.match(/qrsig=([^;]+)/)?.[1];
  if (!qrsig) throw new Error("Failed to get QQ qrsig");

  const ptqrtoken = hash33(qrsig);
  return {
    session: {
      provider: "qq",
      sessionId,
      qrsig,
      ptqrtoken,
      loginSig,
      ptCookie: setCookie,
      o1vId: randomHex(32),
      createdAt: Date.now(),
    },
    response: {
      provider: "qq",
      sessionId,
      qrsig,
      ptqrtoken,
      image: `data:image/png;base64,${buffer.toString("base64")}`,
    },
  };
}

async function pollLogin(session) {
  const elapsed = Math.max(Date.now() - Number(session.createdAt || Date.now()), 0);
  const pollUrl =
    `https://ssl.ptlogin2.qq.com/ptqrlogin?u1=https%3A%2F%2Fgraph.qq.com%2Foauth2.0%2Flogin_jump` +
    `&ptqrtoken=${session.ptqrtoken}&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052` +
    `&action=0-0-${elapsed}&js_ver=23111510&js_type=1` +
    `&login_sig=${encodeURIComponent(session.loginSig || "")}` +
    `&pt_uistyle=40&aid=716027609&daid=383&pt_3rd_aid=100497308&o1vId=${session.o1vId || randomHex(32)}&pt_js_version=v1.48.1`;

  const cookieMap = cookieMapFromString(session.ptCookie || `qrsig=${session.qrsig}`);
  const { response, text } = await fetchText(pollUrl, {
    headers: {
      Cookie: cookieString(cookieMap),
      Referer: "https://xui.ptlogin2.qq.com/",
    },
  });
  addSetCookies(cookieMap, response);

  const callback = parsePtuiCallback(text);
  if (!callback) throw new Error("Unexpected QQ login response");
  if (callback.code !== "0") {
    return {
      session,
      response: {
        provider: "qq",
        sessionId: session.sessionId,
        loggedIn: false,
        status: callback.code === "65" ? "expired" : callback.code === "67" ? "scanned" : "pending",
        message: callback.message,
        refresh: callback.code === "65",
      },
    };
  }

  const checkSigRes = await fetch(callback.redirectUrl, {
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT, Cookie: cookieString(cookieMap) },
  });
  addSetCookies(cookieMap, checkSigRes);

  const pSkey = cookieString(cookieMap).match(/p_skey=([^;]+)/)?.[1];
  if (!pSkey) throw new Error("Failed to get QQ p_skey");

  const gtk = getGtk(pSkey);
  const form = new FormData();
  form.append("response_type", "code");
  form.append("client_id", "100497308");
  form.append("redirect_uri", "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/");
  form.append("scope", "get_user_info,get_app_friends");
  form.append("state", "state");
  form.append("switch", "");
  form.append("from_ptlogin", "1");
  form.append("src", "1");
  form.append("update_auth", "1");
  form.append("openapi", "1010_1030");
  form.append("g_tk", String(gtk));
  form.append("auth_time", new Date().toString());
  form.append("ui", getGuid());

  const authorizeRes = await fetch("https://graph.qq.com/oauth2.0/authorize", {
    method: "POST",
    redirect: "manual",
    body: form,
    headers: { "User-Agent": USER_AGENT, Cookie: cookieString(cookieMap) },
  });
  addSetCookies(cookieMap, authorizeRes);

  const code = authorizeRes.headers.get("location")?.match(/[?&]code=([^&]+)/)?.[1];
  if (!code) throw new Error("Failed to get QQ OAuth code");

  const loginPayload = {
    comm: { g_tk: gtk, platform: "yqq", ct: 24, cv: 0 },
    req: { module: "QQConnectLogin.LoginServer", method: "QQLogin", param: { code } },
  };
  const loginRes = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    method: "POST",
    body: JSON.stringify(loginPayload),
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieString(cookieMap),
    },
  });
  addSetCookies(cookieMap, loginRes);

  const cookie = cookieString(cookieMap);
  const cookies = cookieObject(cookie);
  const nextSession = {
    ...session,
    provider: "qq",
    cookie,
    cookieObject: cookies,
    uin: cookies.uin || cookies.qqmusic_key || "0",
    nickname: callback.nickname,
    loggedInAt: Date.now(),
  };
  return {
    session: nextSession,
    response: {
      provider: "qq",
      sessionId: session.sessionId,
      loggedIn: true,
      uin: nextSession.uin,
      nickname: callback.nickname,
    },
  };
}

async function search({ key, page, limit, session }) {
  const uin = session?.cookie ? extractUin(session.cookie) : "0";
  const payload = {
    comm: { ct: "19", cv: "1859", uin },
    req: {
      module: "music.search.SearchCgiService",
      method: "DoSearchForQQMusicDesktop",
      param: {
        grp: 1,
        num_per_page: limit,
        page_num: page,
        query: key,
        search_type: 0,
      },
    },
  };
  const current = await fetchJson("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=utf-8",
      Referer: "https://y.qq.com/",
      Origin: "https://y.qq.com",
      Cookie: session?.cookie || "",
    },
  });
  return { songs: normalizeSearchData(current.data), raw: current.data };
}

async function play({ song, quality, session }) {
  if (!session?.cookie) {
    const err = new Error("QQ playback requires login. Call /api/login/qr?provider=qq first.");
    err.status = 401;
    throw err;
  }
  const songmid = song.songmid || song.id;
  const q = normalizeQuality(quality);
  const fileType = QUALITY_MAP[q];
  const uin = extractUin(session.cookie);
  const filename = `${fileType.prefix}${songmid}${songmid}${fileType.suffix}`;
  const payload = {
    req_1: {
      module: "vkey.GetVkeyServer",
      method: "CgiGetVkey",
      param: {
        filename: [filename],
        guid: "10000",
        songmid: [songmid],
        songtype: [0],
        uin,
        loginflag: 1,
        platform: "20",
      },
    },
    loginUin: uin,
    comm: { uin, format: "json", ct: 24, cv: 0 },
  };
  const { data } = await fetchJson("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      Referer: "https://y.qq.com/",
      Origin: "https://y.qq.com",
      Cookie: session.cookie,
    },
  });
  const domain = data?.req_1?.data?.sip?.[0] || "";
  const info = data?.req_1?.data?.midurlinfo?.[0] || {};
  const url = info?.purl ? joinUrl(domain, info.purl) : "";
  const message = info?.msg || data?.req_1?.data?.msg || data?.req_1?.msg || data?.msg;
  return {
    provider: "qq",
    song,
    quality: q,
    url,
    error: url ? undefined : `No playable QQ URL returned.${message ? ` ${message}` : ""}`,
    raw: data,
  };
}

module.exports = {
  name: "qq",
  createLogin,
  pollLogin,
  search,
  play,
  createSearchId: () => createId("qq_"),
};
