"""
M2 — MQTT 接入层

职责：
  1. 连接 nanoMQ broker
  2. 订阅 telemetry/# topic
  3. 收到消息后回调 pipeline.on_message()
  4. 断线自动重连
  5. 优雅停更时断开并清理

基于 paho-mqtt v2.x 异步回调模式。
注意: paho-mqtt 的回调在子线程中运行，需要确保线程安全。
"""
from __future__ import annotations

import asyncio
import threading
from typing import Callable, Awaitable

from loguru import logger
import paho.mqtt.client as mqtt

from app.core.config import settings


class MqttClient:
    """
    paho-mqtt v2 封装。

    用法:
        client = MqttClient(on_message_callback=my_handler)
        await client.start()
        ...
        await client.stop()
    """

    def __init__(
        self,
        on_message_callback: Callable[["mqtt.MQTTMessage"], Awaitable[None]] | None = None,
    ) -> None:
        self._on_message_cb = on_message_callback
        self._client: mqtt.Client | None = None
        self._loop: asyncio.AbstractEventLoop | None = None  # 主事件循环引用
        self._connected = threading.Event()
        self._lock = threading.Lock()
        self._stopped = False

    @property
    def is_connected(self) -> bool:
        return self._connected.is_set()

    async def start(self) -> None:
        """建立 MQTT 连接并订阅。阻塞直到连接成功或失败。"""
        # 保存主事件循环引用 — 回调需要用它调度协程
        self._loop = asyncio.get_running_loop()

        with self._lock:
            client_id = f"{settings.mqtt_client_id}-{threading.get_ident()}"
            client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
            client.on_connect = self._on_connect
            client.on_disconnect = self._on_disconnect
            client.on_message = self._on_message_wrapper

            if settings.mqtt_username:
                client.username_pw_set(settings.mqtt_username, settings.mqtt_password)

            self._client = client
            self._stopped = False
            self._connected.clear()

            host = settings.mqtt_host
            port = settings.mqtt_port
            logger.info("[MQTT] Connecting to {}:{} ...", host, port)
            client.connect_async(host, port, keepalive=settings.mqtt_keepalive)
            client.loop_start()

        # 等待连接确认
        connected = self._connected.wait(timeout=15.0)
        if not connected:
            raise RuntimeError(f"MQTT connect timeout to {host}:{port}")

        logger.info("[MQTT] Connected and subscribed to {}", settings.mqtt_telemetry_topic)

    async def stop(self) -> None:
        """优雅断开。"""
        with self._lock:
            self._stopped = True
            if self._client is not None:
                logger.info("[MQTT] Disconnecting ...")
                self._client.disconnect()
                self._client.loop_stop()
                self._client = None
            self._connected.clear()

    # ══════════════════════════════
    # paho-mqtt 回调
    # ══════════════════════════════

    def _on_connect(self, client: mqtt.Client, userdata, flags, reason_code, properties):
        """连接成功回调 — 订阅 topic。"""
        if reason_code == 0:
            client.subscribe(settings.mqtt_telemetry_topic, qos=settings.mqtt_qos)
            self._connected.set()
            logger.success("[MQTT] Connected ✅")
        else:
            logger.error("[MQTT] Connect failed: rc={}", reason_code)

    def _on_disconnect(self, client: mqtt.Client, userdata, reason_code, properties):
        """断开连接回调。"""
        self._connected.clear()
        if not self._stopped:
            logger.warning(
                "[MQTT] Disconnected (rc={}). Reconnect in {:.1f}s ...",
                reason_code,
                settings.mqtt_reconnect_delay,
            )

    def _on_message_wrapper(self, client: mqtt.Client, userdata, msg: mqtt.MQTTMessage):
        """
        收到消息 → 转发给异步回调。

        注意: 此方法运行在 paho 的网络线程中，
              通过 run_coroutine_threadsafe 调度到主事件循环。
        """
        if self._on_message_cb is None or self._stopped or self._loop is None:
            return

        try:
            asyncio.run_coroutine_threadsafe(self._on_message_cb(msg), self._loop)
        except RuntimeError as e:
            # 主 loop 已关闭 (应用停更中)
            logger.debug("[MQTT] Loop closed, dropping message: {}", e)
        except Exception as e:
            logger.error("[MQTT] Error dispatching message: {}", e)
