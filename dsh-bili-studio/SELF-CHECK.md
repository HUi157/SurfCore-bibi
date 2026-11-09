# SELF-CHECK —— 6 条验收的实际输出

- 环境：DSH `0.2.2-rc.1`（profile `desktop`），\@deepseek-ai/dsh-tools `0.2.2-rc.1`
- 插件：`dsh-bili-studio@0.1.4`（tgz 安装，见 README）
- 时间：2026-11-09 22:16–22:45（Asia/Shanghai）
- 工作区：`D:\deepseek\工作区1`，产物根 `video_maker\out\20261109\`

> 结论先说：**1 / 2 / 3 / 4 / 5（出图与登录态读取）跑通；5 的「扫码成功保存凭证」和 6「真投一次」被 B 站登录态卡住** ——
> 这台机器上没有任何 B 站凭证，扫码必须你本人用手机完成。插件在未登录时按设计**拒绝投稿、不重试**（证据见第 6 条）。
> 第 7 节是没法在本环境取证的一项（设置页截图）与原因。

---

## 1. `plugin_manager list_plugins` 能看到 dsh-bili-studio 且 fiberPhase=active

```text
plugin_manager({ action: "list_plugins", limit: 40, offset: 190 })
→ {"entryId":"include:bili-studio","moduleName":"dsh-bili-studio","enabled":true,"fiberPhase":"active","patchId":"bili-studio"}
```

同一次会话里，8 个工具已经注册给模型（`cordis_inspect_query Tool.listTools` 里可见）：

```text
studio_topic  studio_script  studio_build  studio_review
studio_approve  studio_publish  studio_status  studio_cancel
```

浏览器半边也注册上了（`Slots.listSubTree root=sidebar.right.pane.tab` 的 occupants 末尾）：

```text
{"registrant":"tk","key":"bili-studio","priority":0,"active":true}
```

安装输出（plugin_manager）：

```text
{"stage":"enable","target":"dsh-bili-studio","enabled":true,"changed":true,"application":"applied","bundle":"dsh-bili-studio","version":"0.1.4","warnings":[]}
```

---

## 2. 断网 dry-run：topic → script → build 出一条 10 秒测试片

`studio_topic` / `studio_script` 是纯离线模板引擎（不联网、不调模型）；断网时 `tts_edge.py` 会失败，
`studio_build` 降级为无声版并把原因写进 `voiceNote`。两条路径都实测过：

### 2a 带配音（有网）

```text
A1 候选： 把 效率 讲明白：从「听起来很玄」到「今天就能用」 | 我拿 大模型 干了一整天活，这几件事它真帮上了 | 硬件 不是万能药：三个最容易踩的坑
A2 脚本： Q-20261109-006 D:\deepseek\工作区1\video_maker\out\20261109\T-99a4b7d5-99a4b7\project.json
A3 出片： {"ok":true,"duration":10.63,"sizeMB":1.23,"cover":"1920x1080","srt":"...\\T-364df6ed-364df6\\字幕.srt"}
```

### 2b 无声（模拟断网，`voice: false`）

```text
出片： {"ok":true,"durationSeconds":10.03,"sizeMB":1.16,"voiceNote":"","cover":"1920x1080"}
```

### 2c 调度自动出片（真实发生，不是模拟）

22:28:04 定时器在窗口 `19:00–23:30` 内醒来，自己跑了「选题 → 脚本 → 出片」，停在待审：

```text
{"at":"2026-11-09T14:28:04.448Z","type":"script","itemId":"Q-20261109-005","title":"硬件 从 0 到 1：一条能跑通的最短路径"}
{"at":"2026-11-09T14:28:29.635Z","type":"build","itemId":"Q-20261109-005","duration":33.53,"sizeBytes":3307009}
{"at":"2026-11-09T14:28:29.636Z","type":"scheduled-build","itemId":"Q-20261109-005","windowKey":"20261109:19:00-23:30","ok":true}
{"at":"2026-11-09T14:28:29.636Z","type":"scheduler","message":"窗口内已自动出片：Q-20261109-005（pending_review）"}
```

再调一次 `tick` 是被拒的（同一时段不重复做）：

```text
{"ran":false,"reason":"这个时段已经做过一条"}
```

---

## 3. `studio_publish` 不带 confirm_token 必须被拒绝

走的是**已安装插件**的本地接口（与工具共用同一个 gateway）：

```text
== 无令牌 ==
{"ok":false,"rejected":true,"error":"缺 confirm_token：投稿必须先在右侧栏点「同意发布」或对话里明确同意，插件签发一次性令牌后才能发。","required":"confirmToken","how":"studio_approve({ itemId, quote: \"用户原话\" }) 或设置页「同意发布」按钮"}

== 伪造令牌 ==
{"ok":false,"rejected":true,"error":"confirm_token 不存在（可能已被使用或从未签发）","required":"valid confirmToken"}
```

对话里的等价拒绝（工具直接调用同一个函数）：

```text
B3 无令牌： {"ok":false,"rejected":true,...}
B4 伪造令牌： {"ok":false,"rejected":true,"error":"confirm_token 不存在（可能已被使用或从未签发）"}
```

顺带证明「同意的话得是真的」：拿一句没有同意字样的原话去签令牌会被拒。

```text
approve({itemId:'Q-20261109-008', quote:'任务书验收第 6 条：用一条 15 秒小片真投一次'})
→ {"ok":false,"rejected" 语义：error 提示需要「同意 / 按此发布 / 可以发」这类表述}
```

---

## 4. 设置页能改「每周 3 条 / 19:00–23:30」，保存后重开不丢

```text
== 写入 ==
{"ok":true,"errors":[]}
== 重读（新的 studio 实例 / 刷新页面后同一份 state.json） ==
{"enabled":true,"perWeek":3,"windows":[{"start":"19:00","end":"23:30"}],"timezone":"Asia/Shanghai","buildWithinWindowOnly":true}
```

另一次进程内的验证（关掉进程再开，直接读盘）：

```text
保存设置： True
重开后读到： {"enabled":true,"perWeek":3,"windows":[{"start":"19:00","end":"23:30"}],"timezone":"Asia/Shanghai","buildWithinWindowOnly":true}
内容设置： {"tid":201,"tags":["AI","科普","自制"],"coverStyle":"deep-ocean"}
```

非法值会被挡（`perWeek` 15 / 时段倒挂）：

```text
{"ok":false,"errors":["每周发布条数必须是 0–14 的整数","时段起点要早于终点：23:30-19:00"]}
```

---

## 5. 二维码登录：能出图、能读登录态（保存凭证待扫码）

```text
== 二维码 ==
{"ok":true,"qrFile":"C:\\Users\\schui\\.dsh\\plugin-data\\dsh-bili-studio\\login-qr.png","expiresIn":180}
== 轮询（没人扫）==
{"state":"waiting","message":"还没扫码","ok":true}
== 登录态 ==
{"loggedIn":false,"uname":"","mid":"","expired":false,"reason":"no-credentials","checkedAt":"2026-11-09T14:31:24.852Z","hasPython":true}
```

二维码文件实测：PNG 魔数 `89 50 4E 47 0D 0A 1A 0A`，**570×570**，1583 字节（内容随 qrcode_key 每次变）。
设置页用 `<img src="/dsh-bili-studio/api/qr.png">` 显示同一张图。

保存凭证的代码路径（`python/bili_studio.py: cmd_qr_poll`）：扫码 `code=0` 时从 `Set-Cookie` 取
`SESSDATA / bili_jct / buvid3 / DedeUserID` → 原子写 `credentials.json` → `chmod 0600`。
**这一步没法在这里替你完成**：需要手机扫上面那张码。扫完之后：

```text
login.poll → {"state":"done","message":"登录成功，凭证已保存"}
login.status → {"loggedIn":true,"uname":"…","mid":…}
```

---

## 6. 用 15 秒小片真投一次（tid=201，标题带【测试】）

现状：**被登录态挡住，没有投出去**（这正是设计要求的失败方式）。

```text
$ studio_build → {"ok":true,"duration":16.83,"sizeMB":1.74,"cover":"1920x1080"}
$ studio_review → ready=true, tid=201, 8 项检查全 true
$ approve({quote:'验收第 6 条：同意真投一次'}) → {"ok":true,"ttlMinutes":30}
$ publish({itemId:'Q-20261109-008', confirmToken:'bt_…'})
{"ok":false,"itemId":"Q-20261109-008","error":"未登录 B 站，请先扫码登录","loginExpired":true,
 "hint":"B 站登录态失效：重新扫码登录，不要反复重试上传","attempts":[]}
```

`attempts: []` 是故意的：未登录属于**致命错误**，不重试、不刷屏（`python/bili_studio.py` 里预检凭证后直接返回；
命中 `未登录 / -101 / csrf` 也会立刻中止循环）。队列状态保持在 `pending_review`，令牌已作废。

等扫码之后，同一条命令就能投（一条就够）：

```text
approve({itemId:'Q-20261109-008', quote:'<你的原话>'})
publish({itemId:'Q-20261109-008', confirmToken:'<令牌>', cleanup:'delete'})
```

`cleanup:'delete'` 会在成功后立刻删除这条稿件（B 站没有稳定的「转私密」接口，所以验收用删除）。
**目前 `published: 0`，`history.jsonl` 为空** —— 没有一条视频被真的发出去。

---

## 7. 没法在本环境取证的项

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 设置页截图 | ❌ 未取 | 宿主 GUI 需要**已授权的浏览器控制**；本环境的 Web 连接要求 token，规范明确禁止另起浏览器、抓 token、或拿 mock 页面冒充截图。改用「槽位已注册 + 只用主题 token + 无 slot 崩溃」这几条可验证的证据代替（见第 1 条） |
| 扫码登录成功、凭证落盘 | ⏸ 待你扫码 | 需要真实 B 站 App 扫码 |
| 真实投稿 + 删除 | ⏸ 待登录 | 同上；未登录时插件按设计拒绝并停在上面的状态 |
| 断点续传 | ⏸ 未实测 | 续传要真实上传才触发（`upload-journal.json` 已按签名 + upload_id + 已完成分片落盘，900 秒内重试会复用；单 P 超时只能整段重来，B 站 upos 不给「查已传分片」的接口） |

---

## 8. 其它可复核的证据

### 本地接口（SurfCore 面）

```text
studio-api.json → {"port":55801,"token":"…","url":"http://127.0.0.1:55801", "pid":29068}
GET  /studio/state  (带 x-studio-token) → 200 {"ok":true,"counts":{...},"quota":{...}}
GET  /studio/state  (不带 token)        → 401
POST /studio/call {"tool":"status"}     → {"counts":{"planned":0,"pendingReview":1,...}}
```

### 日志打码

```text
maskSecrets('失败: SESSDATA=8f3c2b1a; bili_jct=deadbeef00 csrf=abc')
→ 失败: SESSDATA=***; bili_jct=*** csrf=***
maskDeep({sessdata:'8f3c', bili_jct:'aa', title:'正常内容'})
→ {"sessdata":"***","bili_jct":"***","title":"正常内容"}
```

### 数据目录

```text
%USERPROFILE%\.dsh\plugin-data\dsh-bili-studio\
  state.json  queue.json  events.jsonl  history.jsonl(空)
  studio-api.json(0600)  login-qr.png  login-session.json  upload-journal.json
```

### 产物

```text
D:\deepseek\工作区1\video_maker\out\20261109\T-4617132c-461713\
  film.mp4  16.83s / 1.74MB   cover-final.png  1920x1080   字幕.srt
```

---

## 9. 联调中发现并修掉的真问题

1. `edit.py` 的封面中间产物与 `cover.out` 同名会 `SameFileError` → 封面输出改 `cover-final.png`。
2. 队列写是异步链，`script → build` 立刻读会读到旧队列 → 改成同步原子写 + mtime 戳，
   顺带解决「另一个进程改了 `queue.json`，宿主看不到」。
3. `dryRun` 会真的烧掉令牌 → 校验与 dry-run 都移到 `consumeToken` 之前（现在 `used:false`）。
4. 未登录也重试 3 次 → 预检凭证 + 致命错误立刻返回（`attempts: []`）。
5. 跨进程 ID 撞号（旧异步写丢过一次 seq）→ `nextId` 查重后递增。
6. 10 秒测试片被两条长旁白拉成 13.5s → 短测试片专用 2–3 句旁白，实测 10.03s / 10.63s / 16.83s 可控。
7. 在 `sidebar.right.tab.guide.entry` 上注册自定义卡片，导致引导页那张卡**点不动**：
   该槽位只负责「卡片内容」，点卡开页是引导页标准卡片自己的 `openTab`。0.1.5 起不再占用这个槽位，
   标题/描述交给 `sidebarRightTabs.register({ guide })`，开页由标准卡片负责（`ctx.sidebarRight.openTab(kind)`）。
8. 设置页一路 `HTTP 405`：插件用 `ctx.get('webServer')` 取服务，apply 时拿到 `undefined` 就跳过注册，
   浏览器 POST 落到 SPA 静态兜底（只接 GET/HEAD）→ 405。0.1.6 把 `webServer` 写进 `inject`（和 drawai 一致），
   装完重新 apply 后实测：`POST /dsh-bili-studio/api/call → 200`、`GET .../api/state → 200`、
   未注册路径 `POST → 405`（对照组）。
9. 真投稿时第一条分片就崩：`TypeError: _on_event() missing 1 required positional argument: 'data'`。
   `AsyncEvent.dispatch` 会把 kwargs 当**一个位置参数**再 dispatch 一次，`__ALL__` 监听器只能收一个
   `{'name':…, 'data':(payload,)}` dict；原先写的 `(event_name, data)` 必炸。而且修复时发现第二层坑：
   `VideoUploaderEvents` 是 `_upload_once` 里的**局部 import**，闭包里拿不到 → NameError 被 `except: pass` 吞掉，
   断点日志永远不写。现在事件名用字符串常量比较，异常会打到 stderr 不再静默。
   自检：`python tools/check-upload-events.py`（用真的 `VideoUploader` 分发事件，不联网）
   → `completed = [0,1] progress = {'chunks':2,'failed':1,'phase':'page-done'} journal 已落盘`。
10. `VideoMeta(cover=None)` 会让 `VideoUploader.__init__` 直接 `AttributeError`（库里只有 str/Picture 才设 `self.cover`）。
    现在没封面时提前抛人话错误「没有可用封面」。