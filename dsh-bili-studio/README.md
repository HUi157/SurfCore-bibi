# dsh-bili-studio —— B 站自主创作工作室（DSH 插件）

一条链把「选题 → 脚本 → 出片 → 审批 → 投稿」跑完，并且**发布前必须有人点头**：
插件自己永远拿不到投稿权限，除非它手里有一枚用户刚刚签发的一次性 `confirm_token`。

- 宿主工具：`studio_topic` / `studio_script` / `studio_build` / `studio_review` / `studio_approve` / `studio_publish` / `studio_status` / `studio_cancel`
- 设置页：右侧栏「指南」里的 **B 站工作室** 卡片（节奏 / 内容 / 账号 / 队列 四个页签）
- 本地接口：`127.0.0.1:随机端口` + 一次性 token（`studio-api.json`），给 SurfCore 用
- 剪辑不重写：`video_maker\edit.py` + `video_maker\tts_edge.py` 原样调用
- 投稿不拼协议：`bilibili-api-python`（>=17.4.1,<18）的 `VideoUploader`

> 验收的实际输出（含没跑成的两项与原因）在 [`SELF-CHECK.md`](./SELF-CHECK.md)；
> 给 SurfCore 的接口在 [`STUDIO-API.md`](./STUDIO-API.md)。

---

## 1. 安装

插件已经打成 tarball，**不要手改 profile 的 `node_modules`**，走 `plugin_manager`：

```text
plugin_manager(
  action: "install_bundle",
  target: "file:D:/deepseek/工作区1/dsh-bili-studio/dist/dsh-bili-studio-0.1.4.tgz"
)
```

返回里 `application: "applied"` 才算装好；`incompatible` 说明 peer 版本对不上，见第 9 节。

装完确认：

```text
plugin_manager(action: "list_plugins", limit: 30, offset: 196)
→ {"entryId":"include:bili-studio","moduleName":"dsh-bili-studio","enabled":true,"fiberPhase":"active","patchId":"bili-studio"}
```

**替换已装版本需要重启 DSH**（宿主半边没有热重载；浏览器半边刷新页面即可）。

### 卸载 / 回滚

```text
plugin_manager(action: "remove_bundle", target: "dsh-bili-studio")
```

回滚到旧版本：把旧 tgz 再 `install_bundle` 一次（同版本号会被拒绝，改 `package.json` 的 version 后重新 `npm pack`）。
插件数据不会被卸载删除；要彻底清掉就删 `%USERPROFILE%\.dsh\plugin-data\dsh-bili-studio\`。

---

## 2. 依赖（本机已具备，换机器时照这个装）

| 项 | 路径 / 版本 |
| --- | --- |
| Python | `C:\Users\schui\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`（3.12） |
| FFmpeg | `C:\Users\schui\AppData\Local\Programs\ffmpeg\bin`（n8.1.3，libx264/aac/ass/xfade） |
| 剪辑器 | `D:\deepseek\工作区1\video_maker\edit.py`、`tts_edge.py` |
| B 站库 | `bilibili-api-python==17.4.2`、`qrcode==8.2` |

```powershell
& "C:\Users\schui\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" `
  -m pip install "bilibili-api-python>=17.4.1,<18" "qrcode>=8"
```

路径集中在 `lib/paths.js`（`PYTHON_DEFAULT` / `FFMPEG_DIR_DEFAULT` / `DEFAULT_WORKSPACE`），换机器只改这一个文件。
`edit.py` 用 `shutil.which('ffmpeg')`，插件调用时已经把 FFmpeg 目录塞进 `PATH`，不需要改系统环境变量。

---

## 3. 数据、产物、凭证

| 内容 | 位置 |
| --- | --- |
| 状态 / 队列 / 历史 | `%USERPROFILE%\.dsh\plugin-data\dsh-bili-studio\{state.json, queue.json, history.jsonl, events.jsonl}` |
| 凭证 | 同目录 `credentials.json`（`0600` + Windows `icacls` 只留当前用户） |
| 本地面 | 同目录 `studio-api.json`（端口 + token，同样收紧） |
| 二维码 / 上传断点日志 | `login-qr.png`、`login-session.json`、`upload-journal.json` |
| 成片 / 封面 / 字幕 | `D:\deepseek\工作区1\video_maker\out\<YYYYMMDD>\<topic-id>\{film.mp4, cover-final.png, 字幕.srt}` |

凭证三条铁律：**不写进源码、不写进日志、不回显给模型**。
`lib/log.js` 统一打码（`SESSDATA=` / `bili_jct=` 之类只留键名），工具返回值、事件流、错误文案都过这一层；
Python 侧任何输出都不带 cookie，出错只输出 `code + message`。

---

## 4. 设置页

右侧栏 → 指南 → **B 站工作室**（点那张卡就会在右栏开一页，标题栏显示 `🎬 B 站工作室`）。
卡片本身用宿主的标准卡片渲染：插件只提供标题/描述，**点卡开页的动作归引导页**，
所以不要在 `sidebar.right.tab.guide.entry` 上塞自定义内容（塞了会变成点不动的死块，0.1.5 已修）。

- **队列**：待制作 / 待审 / 已发布 / 失败 四栏。每条卡片带封面缩略图、时长、分区、BV 号。
  - 待制作：`现在做`（出片，跑完变待审）、`跳过`
  - 待审：`同意发布` → 签一次性令牌 → 出现 `确认上传`（两步，故意不合并）
  - 任何状态：`改标题`（失焦即保存）
- **节奏**：每周发布几条（0–14）、允许制作时段（可多个，`19:00–23:30` 这样写）、时区、是否自动制作
- **内容**：默认分区（201 科学科普 / 208 科技 / 188 科技资讯 / 124 社科 / 122 野生技术协会）、默认标签、封面配色（`deep-ocean` / `violet-dusk` / `pine` / `kraft` / `solar` / `mono`）、默认关键词、简介模板
- **账号**：登录状态、`扫码登录`（出 570×570 二维码 PNG，每 2.5 秒轮询）、`退出登录`

设置存在 `state.json`，保存后重开页面/重启宿主都不丢（验收第 4 条）。

---

## 5. 节奏调度（这个插件的主心骨）

- **一个定时器**：每次只挂一个 `setTimeout`，醒来的时刻是「下一个窗口边界」，最长兜底 30 分钟。不轮询、不建 cron 表。
- **窗口内才动手**：`state.json.settings.schedule.windows` 里任意时段内、且本周额度没满，就跑一次
  「选题 → 脚本 → 出片」，跑完停在 `pending_review`，**绝不自动发**。
- **一周一条都不多给**：`perWeek`（0–14）按 ISO 周统计本周非取消条目数，额度满了就不再排。
- **漏掉不补**：窗口结束时没做成就往 `state.json.missed` 记一条（`{windowKey, window, reason}`），不补跑；
  设置页会在队列底部提示「漏掉的窗口 N 个」。
- 同一时段最多自动做一条（`autoBuilds.windowKey` 去重），避免重启后连做。

手动触发一次（验收/调试用）：`POST /studio/call {"tool":"tick"}`。

---

## 6. 审批闸门（红线，设置里没有关掉它的开关）

```
考核点：没 token 的 studio_publish 一定被拒
```

- 令牌只在两个地方签发：
  1. 设置页点 `同意发布`（`source: "ui"`，本人物理点击）
  2. 工具 `studio_approve({itemId, quote})`（`quote` 必须是用户原话，且含「同意 / 按此发布 / 可以发」这类表述）
- 有效期 **30 分钟**，**用后即作废**（`used: true`），一条令牌只对一条 `itemId` 有效。
- 投稿失败（网络/超时）令牌同样作废 —— 想重试要重新审批。这是故意的：一次同意 ≠ 无限重试。
- 设了 `dryRun: true` 时只校验、不消耗令牌、不上传。

---

## 7. 投稿校验与失败处理

投稿前逐条校验（`studio_review` 也会把同一张清单给你看）：

| 校验 | 失败文案 |
| --- | --- |
| 视频文件存在 | `视频文件存在（路径）` |
| 时长可读 | `时长可读（Ns）` |
| 封面存在 | `封面存在（路径）` |
| 封面 1920×1080 | `封面 1920x1080（宽x高）` |
| 标题 ≤80 字 | `标题 ≤80 字（N 字）` |
| 简介 ≤2000 字 | `简介 ≤2000 字（N 字）` |
| 标签 ≥1 个 | `标签 ≥1 个（N 个）` |
| 分区 tid 正整数 | `分区 tid（201）` |

- 上传超时 **10 分钟**（`UPLOAD_TIMEOUT_MS`），重试上限 **3 次**（`lib/runner.js` 的 `RETRY_LIMIT`）。
- 登录态失效（`-101` / `未登录`）：**不重试**，把登录态标成 `expired`，提示重新扫码，避免刷屏。
- 失败一律写清原因（`item.publish.lastError` + `events.jsonl`）。

### 断点续传（说清楚边界）

- 分片级：`bilibili-api` 内部会把失败分片重新排队，插件再在外层重试 3 次。
- 跨进程续传：`upload-journal.json` 记 `signature`（路径+大小+mtime）、`preupload`（含 `upload_id`/`biz_id`）、已完成分片号。
  900 秒内重试且文件没变时，插件**复用同一个 upload_id 跳过已完成分片**，只补剩下的，然后 `_complete_page` + `_submit`。
- 单 P 超过 900 秒或 `upload_id` 已失效：B 站 upos 不给「查询已上传分片」的接口，只能整段重来（已在代码注释与这里写明，不假装能续）。
- 多 P：按 P 续传（已 `AFTER_PAGE` 的 P 不再重传）。

---

## 8. 工具与本地接口

工具面见 `STUDIO-API.md`（同一份动作表供模型、设置页、SurfCore 共用）。

对话里最短流程：

```text
studio_topic            → 3 个候选
studio_script({topic: candidates[0], targetSeconds: 10})
studio_build({itemId})
studio_review({itemId})                  ← 打包审批材料，不发令牌
studio_approve({itemId, quote: "同意，按此发布"})   ← 只有用户真的说了这句才调
studio_publish({itemId, confirmToken})   ← 没令牌必被拒
```

---

## 9. 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| `install_bundle` 报 `incompatible-version` | 插件 `peerDependencies.@deepseek-ai/dsh-tools` 与宿主版本不符。当前宿主是 `0.2.2-rc.1`，插件写的是 `>=0.1.5-rc.1`，改完重新 `npm pack` |
| 装上了但工具没有 | 宿主半边要重启；`list_plugins` 里 `fiberPhase` 不是 `active` 就是没起来 |
| 设置页看不到卡片 | 刷新页面（client 半边热重载只在 `pnpm run dev:web` 时可免刷新） |
| 设置页显示 `HTTP 405` | 后端路由没注册：浏览器 POST 落到了 SPA 静态兜底（它只接 GET/HEAD）。根因是插件用 `ctx.get('webServer')` 取服务，取到 `undefined` 就静默跳过注册。0.1.6 起把 `webServer` 写进 `inject`，装完重新 apply 即恢复；换机器/换 profile 时别再改回 `ctx.get` |
| `找不到 Python` | `lib/paths.js` 的 `PYTHON_DEFAULT` |
| `出片失败：找不到 ffmpeg` | `FFMPEG_DIR_DEFAULT` 指向的目录里要有 `ffmpeg.exe` + `ffprobe.exe` |
| 配音失败但出了无声片 | `edge-tts` 需要网络；失败会降级为无声版，`voiceNote` 里写明原因 |
| `登录态失效` | 设置页重新扫码；不要反复点发布 |
| 本周额度已满 | `perWeek` 调大，或 `studio_cancel` 掉不做的条目（取消不计入额度） |
| 点「确认上传」后报 `_on_event() missing ... 'data'` | `AsyncEvent` 的 `__ALL__` 监听器只收一个 dict（0.1.8 已修）；升级到这个版本即可 |

---

## 10. 已知限制（不藏）

- **B 站没有稳定的「转私密」公开接口**：所以「验收投稿后处理」用的是**删除**（`cleanup: "delete"`），不是改私密。
- 本机没登录 B 站时，`studio_publish` 会在网关处就被 401/未登录挡住；验收 6 的「真投一次」必须你扫码后才能完成。
- 选题/脚本是**离线模板引擎**（不调模型）：断网也能跑，代价是文案没到「人写」的水平；想更好就在 `studio_script` 里传你自己写好的 `topic`。
- 设置页截图没法在这个环境里自动取证（宿主 GUI 需要已授权的浏览器控制，规范也不允许另起浏览器/抓 token），验证记录见 `SELF-CHECK.md`。