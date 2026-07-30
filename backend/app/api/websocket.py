"""
OmniThings WebSocket API — 实时遥测推送

WS /api/v1/ws/telemetry
  - 客户端连接后可发送订阅指令: {"subscribe": ["tag_id_1", "tag_id_2"]}
  - 服务端每 1.5s 轮询 t_telemetry 最新值并推送
  - 推送格式: {"tags": [{"tag_id": ..., "raw_value": ..., "eng_value": ..., "ts": ...}]}

设计决策:
  - V1 采用 DB 轮询而非 MQTT 桥接 (简单可靠，~30 tags 查询毫秒级)
  - 使用 pipeline 的 event loop 调度轮询任务
"""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from loguru import logger

router = APIRouter()

# 轮询间隔 (秒)
POLL_INTERVAL = 1.5


class TelemetryBroadcaster:
    """管理 WS 连接 + 轮询任务。"""

    def __init__(self):
        self._clients: set[WebSocket] = set()
        self._subscriptions: dict[WebSocket, set[str]] = {}  # ws → tag_id set (empty = all)
        self._poll_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)
            self._subscriptions[ws] = set()
        logger.info("[WS] Client connected, total={}", len(self._clients))
        # 首个客户端启动轮询
        if self._poll_task is None or self._poll_task.done():
            self._poll_task = asyncio.create_task(self._poll_loop())

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)
            self._subscriptions.pop(ws, None)
        logger.info("[WS] Client disconnected, total={}", len(self._clients))
        # 无客户端时停止轮询
        if not self._clients and self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()

    async def subscribe(self, ws: WebSocket, tag_ids: list[str]) -> None:
        """设置该客户端只关注指定 tags (空列表 = 全部)。"""
        async with self._lock:
            if ws in self._subscriptions:
                self._subscriptions[ws] = set(tag_ids)

    async def _poll_loop(self) -> None:
        """定时查询最新值并广播。"""
        logger.info("[WS] Telemetry poll loop started")
        try:
            while True:
                await asyncio.sleep(POLL_INTERVAL)
                async with self._lock:
                    if not self._clients:
                        continue
                    clients = list(self._clients)
                    subs = dict(self._subscriptions)

                # 收集所有被订阅的 tag_id (空集合 = 全部)
                all_tag_ids: set[str] = set()
                subscribe_all = False
                for tags in subs.values():
                    if not tags:
                        subscribe_all = True
                        break
                    all_tag_ids.update(tags)

                rows = await asyncio.to_thread(
                    self._fetch_latest,
                    None if subscribe_all else [UUID(t) for t in all_tag_ids],
                )
                if not rows:
                    continue

                # value 已是工程值，无需二次 offset/scale 转换
                configs = {}

                # 按客户端订阅过滤并推送
                for ws in clients:
                    wanted = subs.get(ws, set())
                    payload_tags = []
                    for r in rows:
                        tid = str(r["tag_id"])
                        if wanted and tid not in wanted:
                            continue
                        value = r["value"]
                        payload_tags.append({
                            "tag_id": tid,
                            "raw_value": value,
                            "eng_value": value,
                            "ts": r["ts"].isoformat() if r["ts"] else None,
                            "quality": r["quality"],
                        })
                    if payload_tags:
                        try:
                            await ws.send_text(json.dumps({"tags": payload_tags}))
                        except Exception:
                            pass  # 客户端断开由下一轮 disconnect 处理
        except asyncio.CancelledError:
            logger.info("[WS] Telemetry poll loop cancelled")
        except Exception as e:
            logger.error("[WS] Poll loop error: {}", e)

    @staticmethod
    def _fetch_latest(tag_ids: list[UUID] | None) -> list[dict]:
        """同步查询每个 tag 的最新值 (在线程池中执行)。"""
        from app.services.telemetry_store import get_connection

        base = """
        SELECT ts, tag_id,
               COALESCE(value_float, value_int::float) AS value, quality
        FROM t_telemetry_latest
        """
        params: list = []
        if tag_ids:
            base += " WHERE tag_id = ANY(%s)"
            params.append(tag_ids)

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(base, params)
                columns = [desc[0] for desc in cur.description]
                return [dict(zip(columns, row)) for row in cur.fetchall()]

    @staticmethod
    def _fetch_tag_configs(tag_ids: list) -> dict[str, dict]:
        """查询 tag 的 offset/scale 配置。"""
        from app.services.telemetry_store import get_connection

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, scale_factor, value_offset FROM t_tags WHERE id = ANY(%s)",
                    (tag_ids,),
                )
                return {
                    str(row[0]): {"scale_factor": row[1], "value_offset": row[2]}
                    for row in cur.fetchall()
                }


# 全局单例
_broadcaster = TelemetryBroadcaster()


@router.websocket("/ws/telemetry")
async def telemetry_ws(ws: WebSocket) -> None:
    """
    实时遥测 WebSocket。

    客户端消息:
      {"subscribe": ["tag-uuid", ...]}  — 只关注这些 tag
      {"subscribe": []}                 — 关注全部 (默认)

    服务端推送:
      {"tags": [{"tag_id", "raw_value", "eng_value", "ts", "quality"}, ...]}
    """
    await _broadcaster.connect(ws)
    try:
        while True:
            text = await ws.receive_text()
            try:
                msg = json.loads(text)
                if "subscribe" in msg:
                    await _broadcaster.subscribe(ws, msg["subscribe"])
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        await _broadcaster.disconnect(ws)
