const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
require("dotenv").config();

const { createId, numberParam } = require("./utils");
const { decodeToken, encodeToken, tokenHash } = require("./token");
const qq = require("./providers/qq");
const netease = require("./providers/netease");

const app = express();

app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
morgan.token("safe-url", (req) => {
  const url = new URL(req.originalUrl || req.url || "/", "http://localhost");
  for (const key of ["auth", "loginToken"]) {
    if (url.searchParams.has(key)) url.searchParams.set(key, "[redacted]");
  }
  return `${url.pathname}${url.search}`;
});
app.use(morgan(":method :safe-url :status :response-time ms - :res[content-length]"));

const PORT = Number(process.env.PORT || 3000);
const providers = { qq, netease };
const searches = new Map();

function getProvider(name) {
  const providerName = String(name || "qq").toLowerCase();
  const provider = providers[providerName];
  if (!provider) {
    const err = new Error(`Unsupported provider: ${providerName}`);
    err.status = 400;
    throw err;
  }
  return provider;
}

function publicLoginResponse(result) {
  const { sessionId, cookie, ...response } = result.response;
  return response;
}

function compactAuthSession(session) {
  return {
    version: 1,
    provider: session.provider,
    cookie: session.cookie,
    uin: session.uin,
    userId: session.userId,
    accountId: session.accountId,
    nickname: session.nickname,
    profile: session.profile,
    loggedInAt: session.loggedInAt,
  };
}

function getLoginSession(req, providerName) {
  const loginToken = String(req.query.loginToken || req.header("x-login-token") || "").trim();
  if (!loginToken) {
    const err = new Error("Missing loginToken. Call /api/login/qr first.");
    err.status = 400;
    throw err;
  }

  const session = decodeToken(loginToken, "login");
  if (providerName && session.provider !== providerName) {
    const err = new Error("loginToken does not belong to this provider.");
    err.status = 403;
    throw err;
  }
  return session;
}

function getAuthSession(req, providerName) {
  const auth = String(req.query.auth || req.header("x-music-auth") || "").trim();
  if (!auth) {
    const err = new Error("Missing auth. Login first and pass auth query parameter or x-music-auth header.");
    err.status = 401;
    throw err;
  }

  const session = decodeToken(auth, "auth");
  if (session.version !== 1 || !session.provider || !session.cookie) {
    const err = new Error("Unsupported auth. Please login again.");
    err.status = 401;
    throw err;
  }
  if (providerName && session.provider !== providerName) {
    const err = new Error("auth does not belong to this provider.");
    err.status = 403;
    throw err;
  }
  return { auth, session, authHash: tokenHash(auth) };
}

function normalizePlaySong(req, provider, search) {
  if (req.query.searchId) {
    if (!search) {
      const err = new Error("searchId not found or expired. Call /api/search again.");
      err.status = 404;
      throw err;
    }
    const index = numberParam(req.query.index ?? 0, 0, 0, 999);
    const song = search.songs[index];
    if (!song) {
      const err = new Error(`No song at index ${index}`);
      err.status = 400;
      throw err;
    }
    return song;
  }

  if (provider.name === "qq") {
    const songmid = String(req.query.songmid || req.query.id || "").trim();
    if (!songmid) {
      const err = new Error("Missing songmid/id or searchId");
      err.status = 400;
      throw err;
    }
    return {
      provider: "qq",
      id: songmid,
      songmid,
      mediaId: req.query.mediaId ? String(req.query.mediaId) : songmid,
      name: req.query.name || "",
      singer: req.query.singer || "",
    };
  }

  const id = String(req.query.id || req.query.songid || "").trim();
  if (!id) {
    const err = new Error("Missing id/songid or searchId");
    err.status = 400;
    throw err;
  }
  return {
    provider: "netease",
    id,
    songid: id,
    name: req.query.name || "",
    singer: req.query.singer || "",
  };
}

app.get("/health", (req, res) => {
  res.json({ ok: true, providers: Object.keys(providers) });
});

app.get(["/api/login/qr", "/login/qr"], async (req, res, next) => {
  try {
    const provider = getProvider(req.query.provider);
    const sessionId = createId(`${provider.name}_`);
    const result = await provider.createLogin(sessionId);
    res.json({
      ...publicLoginResponse(result),
      loginToken: encodeToken("login", result.session),
    });
  } catch (err) {
    next(err);
  }
});

app.get(["/api/login/poll", "/login/poll"], async (req, res, next) => {
  try {
    const session = getLoginSession(req, req.query.provider ? String(req.query.provider).toLowerCase() : null);
    const provider = getProvider(req.query.provider || session.provider);
    const result = await provider.pollLogin(session);
    const response = publicLoginResponse(result);
    if (result.response.loggedIn) {
      res.json({
        ...response,
        auth: encodeToken("auth", compactAuthSession(result.session)),
      });
      return;
    }

    res.json({
      ...response,
      loginToken: encodeToken("login", result.session),
    });
  } catch (err) {
    next(err);
  }
});

app.get(["/api/search", "/search"], async (req, res, next) => {
  try {
    const authSession = getAuthSession(req, req.query.provider ? String(req.query.provider).toLowerCase() : null);
    const provider = getProvider(req.query.provider || authSession.session.provider);
    const key = String(req.query.key || req.query.q || "").trim();
    if (!key) {
      res.status(400).json({ error: "Missing search key" });
      return;
    }

    const page = numberParam(req.query.page, 1, 1, 100);
    const limit = numberParam(req.query.limit || req.query.count, 10, 1, 50);
    const { session, authHash } = authSession;
    const result = await provider.search({ key, page, limit, session });
    const searchId = provider.createSearchId();
    const songs = result.songs.map((song, index) => ({ ...song, index }));
    searches.set(searchId, {
      searchId,
      provider: provider.name,
      key,
      page,
      limit,
      authHash,
      songs,
      createdAt: Date.now(),
    });

    res.json({
      provider: provider.name,
      searchId,
      key,
      page,
      limit,
      songs,
      raw: result.raw,
    });
  } catch (err) {
    next(err);
  }
});

app.get(["/api/play", "/play"], async (req, res, next) => {
  try {
    const authSession = getAuthSession(req, req.query.provider ? String(req.query.provider).toLowerCase() : null);
    let provider = req.query.provider ? getProvider(req.query.provider) : null;
    const search = req.query.searchId ? searches.get(String(req.query.searchId)) : null;
    if (!provider && search) provider = getProvider(search.provider);
    if (!provider) provider = getProvider(authSession.session.provider);

    const { session, authHash } = authSession;

    if (search && (search.provider !== provider.name || search.authHash !== authHash)) {
      const err = new Error("searchId does not belong to this provider/auth.");
      err.status = 403;
      throw err;
    }

    const song = normalizePlaySong(req, provider, search);
    const result = await provider.play({
      song,
      quality: req.query.quality || req.query.level,
      session,
    });

    res.json({
      provider: provider.name,
      searchId: search?.searchId,
      index: song.index,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, _next) => {
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
  });
});

app.listen(PORT, () => {
  console.log(`music-api listening on http://localhost:${PORT}`);
});
