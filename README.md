# Music API

一个可扩展的多音乐源 API。当前支持：

- `qq`：QQ 音乐，扫码登录、搜索、点歌
- `netease`：网易云音乐，扫码登录、搜索、点歌

默认地址：`http://localhost:3000`

music-api 不保存调用方用户关系和登录态。登录成功后会返回 `auth`，由调用方自己保存，后续搜索和点歌都带上这个 `auth`。

`loginToken` 和 `auth` 使用 `TOKEN_SECRET` 签名；修改 `TOKEN_SECRET` 后旧 token 会失效。

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
- `loginToken`：登录二维码临时 token。获取二维码后由调用方保存，轮询登录时传回
- `auth`：登录成功后的 token。由调用方保存，搜索、点歌必传；也可以通过 `x-music-auth` 请求头传入
- `limit` / `count`：搜索数量，最大 50
- `searchId` + `index`：用搜索结果里的第几首来点歌

## 登录 API

获取二维码：

```bash
curl "http://localhost:3000/api/login/qr?provider=qq"
curl "http://localhost:3000/api/login/qr?provider=netease"
```

返回 `loginToken` 和 `image`，`image` 是 base64 二维码。

轮询登录：

```bash
curl "http://localhost:3000/api/login/poll?provider=qq&loginToken=xxx"
curl "http://localhost:3000/api/login/poll?provider=netease&loginToken=xxx"
```

扫码成功后返回 `auth`。调用方保存这个 `auth`，后续搜索和点歌使用它。

## 搜索 API

```bash
curl "http://localhost:3000/api/search?provider=qq&key=周杰伦&limit=10&auth=xxx"
curl "http://localhost:3000/api/search?provider=netease&key=周杰伦&limit=10&auth=xxx"
```

返回：

- `searchId`：本次搜索 ID
- `songs[].index`：结果序号
- `songs[].id`：歌曲 ID
- `songs[].name` / `singer` / `album`

## 点歌 API

点歌需要传入当前音乐源登录后返回的 `auth`。未登录会返回 `401`。

推荐用搜索结果选择第几首：

```bash
curl "http://localhost:3000/api/play?searchId=搜索ID&index=0&quality=standard&auth=xxx"
```

也可以直接传 ID：

```bash
curl "http://localhost:3000/api/play?provider=qq&songmid=QQ歌曲songmid&mediaId=mediaId&auth=xxx&quality=128"
curl "http://localhost:3000/api/play?provider=netease&id=网易云歌曲id&auth=xxx&quality=exhigh"
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

- music-api 不保存登录态；调用方需要保存 `loginToken` 和登录成功后的 `auth`。
- 搜索结果只保存在内存里，服务重启后 `searchId` 会丢；可以重新搜索，或者直接用歌曲 ID 点歌。
- 播放链接可能因版权、会员、地区或接口变化为空。
- 这些接口是模拟网页/客户端请求，适合学习和自用，不建议公开商业服务。
