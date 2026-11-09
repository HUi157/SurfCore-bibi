# -*- coding: utf-8 -*-
"""自检：__ALL__ 监听器的签名对不对（用真的 VideoUploader 分发事件，不联网）。

跑法：python tools/check-upload-events.py
"""
import asyncio
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "python"))

# 别动真实的 plugin-data：把数据目录指到临时目录再 import
TMP_DATA = tempfile.mkdtemp(prefix="studio-events-")
os.environ["STUDIO_DATA_DIR"] = TMP_DATA

import bili_studio as bs  # noqa: E402
from bilibili_api import Credential  # noqa: E402
from bilibili_api.video_uploader import (  # noqa: E402
    VideoMeta,
    VideoUploader,
    VideoUploaderEvents,
    VideoUploaderPage,
)


async def main():
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.write(b"\0" * 4096)
    tmp.close()

    # VideoMeta 的 cover 必须是 Picture/路径（None 会让 VideoUploader 直接 AttributeError）
    from PIL import Image

    cover_path = os.path.join(TMP_DATA, "cover.png")
    Image.new("RGB", (16, 9), (10, 20, 30)).save(cover_path)
    from bilibili_api.utils.picture import Picture

    page = VideoUploaderPage(path=tmp.name, title="自检", description="")
    meta = VideoMeta(tid=201, title="自检", desc="", cover=Picture.from_file(cover_path), tags=["自检"])
    uploader = VideoUploader(pages=[page], meta=meta, credential=Credential(sessdata="x", bili_jct="y"))

    completed = set()
    progress = {"chunks": 0, "failed": 0, "phase": "fresh"}
    journal = {"preupload": {"upload_id": "u1", "chunk_size": 1024}, "at": 0, "attempts": 0}

    uploader.on("__ALL__")(bs.make_progress_handler(
        completed=completed, progress=progress, journal=journal, signature="sig-1",
    ))

    uploader.dispatch(VideoUploaderEvents.AFTER_CHUNK.value, {"chunk_number": 0, "total_chunk_count": 3})
    uploader.dispatch(VideoUploaderEvents.AFTER_CHUNK.value, {"chunk_number": 1, "total_chunk_count": 3})
    uploader.dispatch(VideoUploaderEvents.CHUNK_FAILED.value, {"chunk_number": 2})
    uploader.dispatch(VideoUploaderEvents.AFTER_PAGE.value, {"page": page})
    await asyncio.sleep(0.1)

    print("completed =", sorted(completed))
    print("progress  =", progress)
    written = bs.read_json(bs.JOURNAL_FILE, {})
    print("journal   =", {"completed": written.get("completed"), "phase": written.get("phase")})
    print("journal file =", bs.JOURNAL_FILE)

    assert sorted(completed) == [0, 1], "分片号没记全"
    assert progress["failed"] == 1, "失败计数没加"
    assert progress["phase"] == "page-done", "分 P 完成没记"
    assert written.get("completed") == [0, 1], "journal 没落盘"
    assert time.time() - float(written.get("at") or 0) < 60
    print("OK: 事件监听器签名与进度落盘都正常")


asyncio.run(main())