# STUDIO-API —— 给 SurfCore（以及任何本机进程）看的接口

`dsh-bili-studio` 在自己进程里起一个**只监听回环**的小 HTTP 服务：

```
端口：随机（每次启动不同）
地址：http://127.0.0.1:<port>
token：%USERPROFILE%\.dsh\plugin-data\dsh-bili-studio\studio-api.json
```

`studio-api.json`（权限已收紧到当前用户）长这样：

```json
{
  "port": 51588,
  "token": "5ac70cba…",
  "url": "http://127.0.0.1:51588",
  "endpoints": {
    "state": "GET /studio/state",
    "call": "POST /studio/call  body: {\"tool\": \"...\", \"args\": {...}}",
    "qr": "GET /studio/qr.png",
    "tools": "GET /studio/tools"
  },
  "pid": 29068,
  "startedAt": "2026-11-09T14:27:04.545Z"
}
```

## 1. 鉴权

- 只接受 `127.0.0.1` / `::1`（其它来源直接 403）。
- 三种带 token 的方式，任一即可：
  - `x-studio-token: <token>`
  - `Authorization: Bearer <token>`
  - `?token=<token>`
- 没有 token / token 不对 → `401 {"ok":false,"error":"缺少或错误的 studio token（见 studio-api.json）"}`

## 2. 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/studio/state` | 队列与状态总览（等价 `studio_status`） |
| POST | `/studio/call` | `{"tool": "<动作>", "args": {...}}`，见第 3 节 |
| GET | `/studio/qr.png` | 当前登录二维码 PNG（没生成过就是 404） |
| GET | `/studio/tools` | 列出可用动作名 |

`/studio/state` 返回（节选）：

```json
{
  "ok": true,
  "settings": { "perWeek": 3, "windows": [{"start":"19:00","end":"23:30"}], "timezone": "Asia/Shanghai", "text": "每周 3 条，时段 19:00–23:30（Asia/Shanghai）" },
  "login": { "loggedIn": false, "expired": false, "reason": "no-credentials" },
  "counts": { "planned": 0, "pendingReview": 1, "published": 0, "failed": 0, "cancelled": 3, "building": 0 },
  "planned": [], "pendingReview": [ { "id": "Q-20261109-006", "title": "…", "video": {"path":"…","duration":10.03}, "cover": {"path":"…","width":1920,"height":1080} } ],
  "published": [], "failed": [],
  "history": [],
  "missed": [],
  "nextWindow": "明天 19:00–23:30",
  "quota": { "week": "2026-W46", "built": 1, "perWeek": 3, "remaining": 2 }
}
```

## 3. 动作（`studio_*` 工具与 HTTP 共用同一张表）

| 动作 | args | 返回要点 |
| --- | --- | --- |
| `topic` | `{keyword?}` | `candidates[3]`：`{id,title,pitch,formatLabel,estimatedSeconds,tags,outline}` |
| `script` | `{topic?, keyword?, targetSeconds?}` | `{itemId, projectPath, dir, title, shots[], estimatedSeconds}`，状态 `planned` |
| `build` | `{itemId, voice?=true}` | `{video:{path,duration,sizeBytes}, cover:{path,width,height}, srt, durationSeconds, sizeMB, voiceNote}`，状态转 `pending_review` |
| `review` | `{itemId}` | 审批材料：`title/desc/tags/tid/cover/video/timeline/checks/ready/advice` |
| `approve` | `{itemId, quote, source?}` | `{confirmToken, expiresAt, ttlMinutes:30}`；`quote` 必须含明确同意 |
| `publish` | `{itemId, confirmToken, dryRun?, cleanup?}` | 成功 `{bvid, aid, url}`；没令牌 `{ok:false, rejected:true, error, required}` |
| `status` | `{withLogin?}` | 同 `/studio/state` |
| `cancel` | `{itemId, reason?}` | `{ok:true, status:"cancelled"}` |
| `skip` | `{itemId}` | 同 cancel |
| `retitle` | `{itemId, title}` | `{ok:true, title}` |
| `settings.get` | `{}` | `{settings, coverStyles, tids}` |
| `settings.set` | `{settings:{schedule?,content?}}` | `{ok, settings, errors[]}` |
| `login.status` | `{force?}` | `{loggedIn, uname, mid, expired, reason}` |
| `login.qr` | `{}` | `{qrFile, url, expiresIn:180}` |
| `login.poll` | `{}` | `{state:"waiting"|"scanned"|"done"|"timeout", message}` |
| `login.logout` | `{}` | `{ok:true}` |
| `tick` | `{}` | 跑一次调度判断：`{ran, reason?, itemId?}` |

### 错误形状

```json
{ "ok": false, "error": "人话原因", "required": "confirmToken", "hint": "怎么补救" }
```

- `401/403` 是鉴权与来源问题，不是业务问题。
- `publish` 的拒绝带 `rejected: true`，**不要**重试 —— 需要重新审批。

## 4. 审批契约（SurfCore 必须遵守）

1. SurfCore **可以**调 `topic` / `script` / `build` / `review` / `status` / `cancel`。
2. SurfCore **不能**替用户同意：`approve` 的 `quote` 必须是用户原话；没有原话就不要调。
3. 拿不到 `confirmToken` 就发不出去 —— 这是插件的红线，不是 SurfCore 的义务。

## 5. 接法 A：SurfCore 扩展（推荐，零改源码）

SurfCore 自带扩展挂载点：`api.registerRoute(method, path, handler)` → 对外
`/dsh-surfcore/ext/<id>/<path>`（只接受本机回环，需要用户在「扩展」页打开）。

把本包里的 `integrations/surfcore-extension/` 整个目录拷到：

```
C:\Users\schui\.dsh\plugins\surfcore\extensions\dsh-bili-studio\
```

然后在 SurfCore 设置 →「扩展」页把 `dsh-bili-studio` 打开（`manifest.enabled` 默认 false，这是 SurfCore 的规矩）。

挂上之后：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/dsh-surfcore/ext/dsh-bili-studio/state` | 转发 `/studio/state` |
| GET | `/dsh-surfcore/ext/dsh-bili-studio/pending` | 待审清单（B 站侧「现在有哪些待审」） |
| POST | `/dsh-surfcore/ext/dsh-bili-studio/call` | 通用转发 `{tool,args}` |
| POST | `/dsh-surfcore/ext/dsh-bili-studio/make-one` | `{keyword?, targetSeconds?}` → 选题+脚本+出片（停在待审） |

## 6. 接法 B：10 行胶水（不装扩展）

SurfCore 里任何能拿到 `fetch` 的地方：

```js
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const API = join(homedir(), '.dsh', 'plugin-data', 'dsh-bili-studio', 'studio-api.json')
export async function studio(tool, args = {}) {
  const { url, token } = JSON.parse(await readFile(API, 'utf8'))
  const resp = await fetch(url + '/studio/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-studio-token': token },
    body: JSON.stringify({ tool, args }),
    signal: AbortSignal.timeout(120000),
  })
  return await resp.json()
}
```

用法：

```js
await studio('topic', { keyword: '大模型' })                  // 3 个候选
await studio('script', { topic: candidates[0] })               // 排进队列
await studio('build', { itemId })                              // 出片 → 待审
await studio('review', { itemId })                             // 打包审批材料
await studio('status', {})                                     // 待审清单
```

## 7. 稳定性约定

- 端口会变：**每次读 `studio-api.json`**，不要缓存 URL。
- 插件没起来时该文件可能是旧的：先 `GET /studio/tools` 探活，失败就当作「工作室没开」。
- 所有外部调用都有超时：`build` 15 分钟、`publish` 10 分钟、`login` 40 秒、`status` 30 秒。
- 返回里不会出现 cookie / sessdata；日志里也不会（`lib/log.js` 打码）。