# Music API

一个可扩展的多音乐源 API。当前支持：

- `qq`：QQ 音乐，扫码登录、搜索、点歌
- `netease`：网易云音乐，扫码登录、搜索、点歌

默认地址：`http://localhost:3000`

登录状态会持久化到 `data/sessions.json`。Docker Compose 默认把宿主机 `./data` 挂载到容器 `/app/data`，所以容器重启后登录态还在。

## 本地启动

```bash
npm install
npm run dev
```

## Docker 构建与启动

```bash
docker build -t music-api .
docker run -d --name music-api -p 3000:3000 music-api
```

如果用 `docker run` 且需要保留登录状态，挂载 data 目录：

```bash
docker run -d --name music-api -p 3000:3000 -v ${PWD}/data:/app/data music-api
```

或使用 Docker Compose：

```bash
docker compose up -d --build
```

健康检查：

```bash
curl "http://localhost:3000/health"
```

## 通用参数

- `provider`：音乐源，支持 `qq`、`netease`，默认 `qq`
- `sessionId`：登录会话 ID，登录后点歌可带上
- `limit` / `count`：搜索数量，最大 50
- `searchId` + `index`：用搜索结果里的第几首来点歌

## 登录 API

获取二维码：

```bash
curl "http://localhost:3000/api/login/qr?provider=qq"
curl "http://localhost:3000/api/login/qr?provider=netease"
```

返回 `sessionId` 和 `image`，`image` 是 base64 二维码。

轮询登录：

```bash
curl "http://localhost:3000/api/login/poll?provider=qq&sessionId=xxx"
curl "http://localhost:3000/api/login/poll?provider=netease&sessionId=xxx"
```

## 搜索 API

```bash
curl "http://localhost:3000/api/search?provider=qq&key=周杰伦&limit=10"
curl "http://localhost:3000/api/search?provider=netease&key=周杰伦&limit=10"
```

返回：

- `searchId`：本次搜索 ID
- `songs[].index`：结果序号
- `songs[].id`：歌曲 ID
- `songs[].name` / `singer` / `album`

## 点歌 API

点歌需要当前 `provider + sessionId` 已经登录。未登录用户会返回 `401`，不会共用其他用户的登录态。

推荐用搜索结果选择第几首：

```bash
curl "http://localhost:3000/api/play?searchId=搜索ID&index=0&quality=standard"
```

也可以直接传 ID：

```bash
curl "http://localhost:3000/api/play?provider=qq&songmid=QQ歌曲songmid&mediaId=mediaId&sessionId=xxx&quality=128"
curl "http://localhost:3000/api/play?provider=netease&id=网易云歌曲id&quality=exhigh"
```

音质参数：

- QQ：`m4a`、`128`、`320`、`flac`、`ape`
- 网易云：`standard`、`higher`、`exhigh`、`lossless`、`hires`、`jyeffect`、`sky`、`jymaster`

返回里的 `url` 可以给前端 `<audio>` 播放。

## 扩展新音乐源

新增文件 `src/providers/<name>.js`，实现：

```js
module.exports = {
  name: "<name>",
  createLogin,
  pollLogin,
  search,
  play,
  createSearchId,
};
```

再在 `src/server.js` 的 `providers` 里注册即可。

## 注意

- 登录态和搜索结果现在保存在内存里，服务重启会丢。
- 播放链接可能因版权、会员、地区或接口变化为空。
- 这些接口是模拟网页/客户端请求，适合学习和自用，不建议公开商业服务。
