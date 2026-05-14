const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
require("dotenv").config();

const { createId, numberParam } = require("./utils");
const qq = require("./providers/qq");
const netease = require("./providers/netease");

const app = express();

app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

const PORT = Number(process.env.PORT || 3000);
const providers = { qq, netease };
const sessions = new Map();
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

function getSession(req, providerName) {
  const sessionId = String(req.query.sessionId || req.header("x-session-id") || "default");
  return {
    sessionId,
    session: sessions.get(`${providerName}:${sessionId}`),
  };
}

function setSession(providerName, sessionId, session) {
  sessions.set(`${providerName}:${sessionId}`, session);
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
    const sessionId = String(req.query.sessionId || createId(`${provider.name}_`));
    const result = await provider.createLogin(sessionId);
    setSession(provider.name, sessionId, result.session);
    res.json(result.response);
  } catch (err) {
    next(err);
  }
});

app.get(["/api/login/poll", "/login/poll"], async (req, res, next) => {
  try {
    const provider = getProvider(req.query.provider);
    const { sessionId, session } = getSession(req, provider.name);
    if (!session) {
      res.status(400).json({ error: "Missing login session. Call /api/login/qr first." });
      return;
    }
    const result = await provider.pollLogin(session);
    setSession(provider.name, sessionId, result.session);
    res.json(result.response);
  } catch (err) {
    next(err);
  }
});

app.get(["/api/search", "/search"], async (req, res, next) => {
  try {
    const provider = getProvider(req.query.provider);
    const key = String(req.query.key || req.query.q || "").trim();
    if (!key) {
      res.status(400).json({ error: "Missing search key" });
      return;
    }

    const page = numberParam(req.query.page, 1, 1, 100);
    const limit = numberParam(req.query.limit || req.query.count, 10, 1, 50);
    const { sessionId, session } = getSession(req, provider.name);
    const result = await provider.search({ key, page, limit, session });
    const searchId = provider.createSearchId();
    const songs = result.songs.map((song, index) => ({ ...song, index }));
    searches.set(searchId, {
      searchId,
      provider: provider.name,
      key,
      page,
      limit,
      sessionId,
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
    let provider = req.query.provider ? getProvider(req.query.provider) : null;
    const search = req.query.searchId ? searches.get(String(req.query.searchId)) : null;
    if (!provider && search) provider = getProvider(search.provider);
    if (!provider) provider = getProvider("qq");

    const { sessionId, session } = getSession(req, provider.name);
    const song = normalizePlaySong(req, provider, search);
    const result = await provider.play({
      song,
      quality: req.query.quality || req.query.level,
      session,
    });

    res.json({
      provider: provider.name,
      sessionId,
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
