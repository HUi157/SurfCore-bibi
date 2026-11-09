# -*- coding: utf-8 -*-
"""dsh-bili-studio 的 B 站通道（子进程命令行，stdout 只输出一行 JSON）。

子命令：
  status                     读登录态
  qr-start                   生成登录二维码 PNG
  qr-poll                    轮询扫码结果，成功即保存凭证
  logout                     删除本地凭证
  upload --payload <file>    投稿（带分片/分P 断点续传日志）
  delete --bvid <BV...>      删除自己刚投的稿件（验收用）

约定：
  * 凭证只落在 DATA_DIR/credentials.json，写时 0600，任何输出都不回显；
  * 所有异常压成 {ok:false, error, code}，不打印栈、不打印 cookie；
  * DATA_DIR 由环境变量 STUDIO_DATA_DIR 指定（插件侧传入），默认 ~/.dsh/plugin-data/dsh-bili-studio。
"""
import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

DATA_DIR = Path(os.environ.get("STUDIO_DATA_DIR") or (Path.home() / ".dsh" / "plugin-data" / "dsh-bili-studio"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
CRED_FILE = DATA_DIR / "credentials.json"
SESSION_FILE = DATA_DIR / "login-session.json"
JOURNAL_FILE = DATA_DIR / "upload-journal.json"
QR_FILE = DATA_DIR / "login-qr.png"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
QR_GENERATE = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate"
QR_POLL = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll"
MEMBER_DELETE = "https://member.bilibili.com/x/vu/web/delete"

RISK_CODES = (-101, -352, -412, -799, -509)


def emit(payload, code=0):
    """输出一行 JSON。绝不把凭证写进 payload。"""
    payload = dict(payload)
    payload.setdefault("ok", code == 0)
    print(json.dumps(payload, ensure_ascii=False))
    return code


def read_json(path, fallback=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return fallback


def write_json(path, value):
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(value, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def load_credential():
    """返回 bilibili_api Credential，或 None。"""
    data = read_json(CRED_FILE)
    if not isinstance(data, dict) or not data.get("sessdata"):
        return None
    from bilibili_api import Credential

    return Credential(
        sessdata=data.get("sessdata", ""),
        bili_jct=data.get("bili_jct", ""),
        buvid3=data.get("buvid3") or "",
        dedeuserid=data.get("dedeuserid", ""),
    )


def brief(exc):
    code = getattr(exc, "code", None)
    msg = getattr(exc, "msg", "") or str(exc)
    text = f"{type(exc).__name__}: {msg}"
    if code is not None:
        text = f"code={code} {msg}"
    return text[:600]


# ------------------------------------------------------------------ 登录
async def cmd_status(_args):
    cred = load_credential()
    if cred is None:
        return emit({"ok": True, "loggedIn": False, "reason": "no-credentials"})
    from bilibili_api import user

    try:
        info = await user.get_self_info(cred)
        return emit({
            "ok": True,
            "loggedIn": True,
            "uname": info.get("name"),
            "mid": info.get("mid"),
            "level": info.get("level"),
        })
    except Exception as exc:  # noqa: BLE001
        code = getattr(exc, "code", None)
        expired = code in RISK_CODES or "风控" in str(exc)
        return emit({
            "ok": True,
            "loggedIn": False,
            "expired": bool(expired),
            "reason": brief(exc),
            "hint": "登录态失效，请重新扫码" if expired else "读取登录态失败，可重试",
        })


async def fetch_cookies_from_poll(resp):
    """从 poll 响应的 Set-Cookie 里取四个凭证字段。"""
    items = {}
    raw = resp.headers.getall("set-cookie", []) if hasattr(resp.headers, "getall") else []
    for line in raw:
        first = line.split(";", 1)[0]
        if "=" not in first:
            continue
        key, value = first.split("=", 1)
        items[key.strip()] = value.strip()
    for morsel in resp.cookies.values():
        items.setdefault(morsel.key, morsel.value)
    return items


async def cmd_qr_start(_args):
    import aiohttp

    timeout = aiohttp.ClientTimeout(total=25)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(QR_GENERATE, headers={"User-Agent": UA, "Referer": "https://www.bilibili.com"}) as resp:
            data = await resp.json(content_type=None)
    body = data.get("data") or {}
    url = body.get("url")
    key = body.get("qrcode_key")
    if not url or not key:
        return emit({"ok": False, "error": "生成二维码失败", "detail": data}, 1)

    import qrcode

    img = qrcode.make(url)
    img.save(QR_FILE)
    try:
        os.chmod(QR_FILE, 0o600)
    except OSError:
        pass
    write_json(SESSION_FILE, {"qrcode_key": key, "url": url, "createdAt": int(time.time())})
    return emit({
        "ok": True,
        "qrFile": str(QR_FILE),
        "url": url,
        "expiresIn": 180,
        "hint": "用 B 站 App 扫码，然后在手机上确认",
    })


async def cmd_qr_poll(_args):
    import aiohttp

    sess = read_json(SESSION_FILE)
    if not sess or not sess.get("qrcode_key"):
        return emit({"ok": False, "error": "没有进行中的扫码，请点「扫码登录」重新生成"}, 1)
    if time.time() - int(sess.get("createdAt") or 0) > 180:
        SESSION_FILE.unlink(missing_ok=True)
        return emit({"ok": True, "state": "timeout", "message": "二维码已过期，请重新生成"})

    timeout = aiohttp.ClientTimeout(total=25)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(
            QR_POLL,
            params={"qrcode_key": sess["qrcode_key"]},
            headers={"User-Agent": UA, "Referer": "https://www.bilibili.com"},
        ) as resp:
            data = await resp.json(content_type=None)
            cookies = await fetch_cookies_from_poll(resp)

    body = data.get("data") or {}
    code = body.get("code")
    if code == 86101:
        return emit({"ok": True, "state": "waiting", "message": "还没扫码"})
    if code == 86090:
        return emit({"ok": True, "state": "scanned", "message": "已扫码，请在手机上确认"})
    if code == 86038:
        SESSION_FILE.unlink(missing_ok=True)
        return emit({"ok": True, "state": "timeout", "message": "二维码已过期，请重新生成"})
    if code != 0:
        return emit({"ok": True, "state": "unknown", "message": f"扫码状态码 {code}"})

    creds = {
        "sessdata": cookies.get("SESSDATA", ""),
        "bili_jct": cookies.get("bili_jct", ""),
        "buvid3": cookies.get("buvid3", ""),
        "dedeuserid": cookies.get("DedeUserID", ""),
        "savedAt": int(time.time()),
    }
    if not creds["sessdata"] or not creds["bili_jct"]:
        return emit({"ok": False, "error": "扫码成功但没拿到完整凭证，请重试"}, 1)
    write_json(CRED_FILE, creds)
    SESSION_FILE.unlink(missing_ok=True)
    QR_FILE.unlink(missing_ok=True)
    return emit({"ok": True, "state": "done", "message": "登录成功，凭证已保存"})


async def cmd_logout(_args):
    CRED_FILE.unlink(missing_ok=True)
    SESSION_FILE.unlink(missing_ok=True)
    QR_FILE.unlink(missing_ok=True)
    return emit({"ok": True, "message": "已退出本地登录态"})


# ------------------------------------------------------------------ 上传
def _journal_write(payload):
    try:
        write_json(JOURNAL_FILE, payload)
    except OSError:
        pass


def make_progress_handler(*, completed, progress, journal, signature):
    """构造 __ALL__ 监听器（单独抽出来，好让自检脚本用真的 VideoUploader 验证事件签名）。

    坑：AsyncEvent.dispatch 把 kwargs 当**一个位置参数**再 dispatch 一次，
    所以 __ALL__ 的监听器只能收一个 dict：{'name': 事件名, 'data': (payload,)}。
    写成 (event_name, data) 会在第一次分片时 TypeError。
    """

    async def handler(event=None, **_ignored):  # noqa: ANN001
        try:
            info = event if isinstance(event, dict) else {}
            name = info.get("name")
            payload = info.get("data")
            if isinstance(payload, (list, tuple)):
                payload = payload[0] if payload else None
            # 直接用事件名字符串：VideoUploaderEvents 是在 _upload_once 里局部 import 的，
            # 闭包里拿不到它（之前就是这个 NameError 被 except 吞掉，导致断点日志永远不写）。
            if name == "AFTER_CHUNK" and isinstance(payload, dict):
                number = payload.get("chunk_number")
                if isinstance(number, int):
                    completed.add(number)
                    progress["chunks"] = len(completed)
                    _journal_write({
                        "signature": signature,
                        "at": time.time(),
                        "preupload": journal.get("preupload"),
                        "completed": sorted(completed),
                        "phase": "chunk",
                        "attempts": journal.get("attempts", 0),
                    })
            elif name == "CHUNK_FAILED":
                progress["failed"] += 1
            elif name == "AFTER_PAGE":
                progress["phase"] = "page-done"
        except Exception as exc:  # noqa: BLE001
            # 进度日志永远不该把上传搞挂；但别再默默吞掉，打到 stderr 便于排查
            print(f"[progress] {type(exc).__name__}: {exc}", file=sys.stderr)

    return handler


async def _upload_once(payload):
    """一次上传尝试；能续就续，不能就整段来。返回 dict。"""
    from bilibili_api.utils.picture import Picture
    from bilibili_api.video_uploader import (
        VideoMeta, VideoUploader, VideoUploaderPage, VideoUploaderEvents, _choose_line, upload_cover,
    )

    cred = load_credential()
    if cred is None:
        raise RuntimeError("未登录 B 站，请先扫码登录")

    video = payload["video"]
    if not os.path.isfile(video):
        raise RuntimeError(f"视频文件不存在：{video}")
    size = os.path.getsize(video)
    mtime = int(os.path.getmtime(video))
    signature = f"{video}|{size}|{mtime}"

    title = (payload.get("title") or "")[:80]
    desc = (payload.get("desc") or "")[:2000]
    tags = [t for t in (payload.get("tags") or []) if t][:10] or ["视频"]
    tid = int(payload.get("tid") or 201)

    cover_pic = None
    cover_path = payload.get("cover") or ""
    if cover_path and os.path.isfile(cover_path):
        cover_pic = Picture.from_file(cover_path)
    # VideoMeta 只在 cover 是 str/Picture 时才设 self.cover；None 会让 VideoUploader 直接 AttributeError
    if cover_pic is None:
        raise RuntimeError("没有可用封面（B 站投稿要求 16:9 封面，插件侧会校验 1920x1080）")

    page = VideoUploaderPage(path=video, title=title, description=desc[:250])
    meta = VideoMeta(tid=tid, title=title, desc=desc, cover=cover_pic, tags=tags, original=True)

    uploader = VideoUploader(pages=[page], meta=meta, credential=cred)
    uploader.line = await _choose_line(None)

    journal = read_json(JOURNAL_FILE, {}) or {}
    resume = (
        journal.get("signature") == signature
        and isinstance(journal.get("preupload"), dict)
        and isinstance(journal.get("completed"), list)
        and time.time() - float(journal.get("at") or 0) < 900
    )

    completed = set(journal.get("completed") or []) if resume else set()
    progress = {"chunks": len(completed), "failed": 0, "phase": "resume" if resume else "fresh"}

    # __ALL__ 监听器：只收一个 dict，签名细节见 make_progress_handler 的注释
    uploader.on("__ALL__")(make_progress_handler(
        completed=completed,
        progress=progress,
        journal=journal,
        signature=signature,
    ))

    if resume:
        preupload = journal["preupload"]
        upload_id = preupload.get("upload_id")
        page_size = size
        chunk_size = int(preupload.get("chunk_size") or 1)
        total = (page_size + chunk_size - 1) // chunk_size
        for number in range(total):
            if number in completed:
                continue
            result = await uploader._upload_chunk(page, number * chunk_size, number, total, preupload)  # noqa: SLF001
            if not result.get("ok"):
                raise RuntimeError(f"分片 {number} 续传失败")
            completed.add(number)
        data = await uploader._complete_page(page, total, preupload, upload_id)  # noqa: SLF001
        videos = [{"title": page.title, "desc": page.description, "filename": data["filename"], "cid": data["cid"]}]
        cover_url = await upload_cover(cover=uploader.cover, credential=cred) if uploader.cover else ""
        result = await uploader._submit(videos, cover_url)  # noqa: SLF001
    else:
        # 正常路径：由库自己预检、并发分片、提交（库内对失败分片自动重排）
        preupload = await uploader._preupload(page)  # noqa: SLF001
        _journal_write({
            "signature": signature,
            "at": time.time(),
            "preupload": {
                k: preupload.get(k)
                for k in ("upload_id", "biz_id", "chunk_size", "auth", "endpoint", "upos_uri", "threads", "ok")
                if preupload.get(k) is not None
            },
            "completed": [],
            "phase": "preupload",
            "attempts": journal.get("attempts", 0),
        })
        result = await uploader.start()

    JOURNAL_FILE.unlink(missing_ok=True)
    return {"result": result, "progress": progress}


async def cmd_upload(args):
    payload = read_json(Path(args.payload))
    if not isinstance(payload, dict):
        return emit({"ok": False, "error": "payload 读不了"}, 1)

    # 没登录就不要重试：这种错重试三次也只是刷屏
    if load_credential() is None:
        return emit({
            "ok": False,
            "error": "未登录 B 站，请先扫码登录",
            "loginRequired": True,
            "attempts": [],
        }, 1)

    attempts = []
    last_error = ""
    for attempt in range(1, 4):
        try:
            outcome = await _upload_once(payload)
            result = outcome["result"] if isinstance(outcome["result"], dict) else {"raw": str(outcome["result"])}
            return emit({
                "ok": True,
                "attempts": attempts + [{"attempt": attempt, "ok": True}],
                "bvid": result.get("bvid"),
                "aid": result.get("aid"),
                "progress": outcome.get("progress"),
            })
        except Exception as exc:  # noqa: BLE001
            last_error = brief(exc)
            attempts.append({"attempt": attempt, "ok": False, "error": last_error})
            fatal = any(marker in last_error for marker in ("未登录", "code=-101", "登录态", "csrf"))
            journal = read_json(JOURNAL_FILE, {}) or {}
            journal["attempts"] = attempt
            journal["lastError"] = last_error
            journal["at"] = journal.get("at") or time.time()
            _journal_write(journal)
            if fatal:
                return emit({
                    "ok": False,
                    "error": last_error,
                    "loginRequired": True,
                    "attempts": attempts,
                }, 1)
            await asyncio.sleep(min(2 * attempt, 6))

    return emit({"ok": False, "error": last_error, "attempts": attempts}, 1)


# ------------------------------------------------------------------ 删除
async def cmd_delete(args):
    import aiohttp
    from bilibili_api.utils.aid_bvid_transformer import bvid2aid

    cred = load_credential()
    if cred is None:
        return emit({"ok": False, "error": "未登录 B 站"}, 1)
    try:
        aid = bvid2aid(args.bvid)
    except Exception as exc:  # noqa: BLE001
        return emit({"ok": False, "error": f"BV 号解析失败：{brief(exc)}"}, 1)

    cookie = f"SESSDATA={cred.sessdata}; bili_jct={cred.bili_jct}; buvid3={cred.buvid3}; DedeUserID={cred.dedeuserid}"
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(
            MEMBER_DELETE,
            params={"csrf": cred.bili_jct},
            data={"aid": aid},
            headers={"User-Agent": UA, "Referer": "https://member.bilibili.com/", "Cookie": cookie},
        ) as resp:
            text = await resp.text()
    try:
        data = json.loads(text)
    except ValueError:
        return emit({"ok": False, "error": f"删除接口返回非 JSON（HTTP {resp.status}）"}, 1)
    if data.get("code") not in (0, None):
        return emit({"ok": False, "error": f"code={data.get('code')} {data.get('message')}", "aid": aid}, 1)
    return emit({"ok": True, "message": "稿件已删除", "aid": aid, "bvid": args.bvid})


def main(argv):
    parser = argparse.ArgumentParser(prog="bili_studio")
    parser.add_argument("command")
    parser.add_argument("--payload")
    parser.add_argument("--bvid")
    parser.add_argument("--mode")
    args = parser.parse_args(argv)

    handlers = {
        "status": cmd_status,
        "qr-start": cmd_qr_start,
        "qr-poll": cmd_qr_poll,
        "logout": cmd_logout,
        "upload": cmd_upload,
        "delete": cmd_delete,
    }
    handler = handlers.get(args.command)
    if handler is None:
        return emit({"ok": False, "error": f"未知子命令 {args.command}"}, 2)
    try:
        return asyncio.run(handler(args))
    except Exception as exc:  # noqa: BLE001
        return emit({"ok": False, "error": brief(exc)}, 1)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))