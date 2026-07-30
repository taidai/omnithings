"""
F2 RPC API — 设备控制回写

POST /api/v1/devices/{node_id}/rpc
  向指定设备节点发送控制命令，通过 MQTT 发布到 Neuron 写 topic。
  同时写入 t_audit_log 审计日志。
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from loguru import logger
from pydantic import BaseModel, Field

router = APIRouter()


class RpcRequest(BaseModel):
    command: str = Field(..., min_length=1, description="命令名/动作")
    payload: dict = Field(default_factory=dict, description="命令 payload")
    topic: str | None = Field(None, description="自定义 MQTT topic；为空则按节点推导")
    qos: int = Field(1, ge=0, le=2, description="MQTT QoS")


@router.post("/devices/{node_id}/rpc")
async def send_rpc(
    node_id: UUID,
    req: RpcRequest,
    request: Request,
) -> dict:
    """向设备发送 RPC 控制命令。"""
    from app.services.telemetry_store import get_connection
    from app.services.mqtt_client import get_mqtt_client

    mqtt_client = get_mqtt_client()
    if mqtt_client is None:
        raise HTTPException(status_code=503, detail="MQTT client not available")

    topic = req.topic
    if topic is None:
        # 默认按 node_name 推导 topic
        from app.services.telemetry_store import get_connection
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT name FROM t_nodes WHERE id = %s", (node_id,))
                row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Target node not found")
        node_name = row[0]
        topic = f"neuron/{node_name}/write"

    payload_str = json.dumps(req.payload, ensure_ascii=False)

    try:
        await asyncio.to_thread(mqtt_client.publish, topic, payload_str, qos=req.qos)
    except Exception as e:
        logger.error("[API/rpc] MQTT publish failed: {}", e)
        raise HTTPException(status_code=500, detail=f"MQTT publish failed: {e}")

    # 审计日志
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO t_audit_log (user_id, action, target_type, target_id, details, ip_address, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    "api_user",
                    "RPC",
                    "device",
                    node_id,
                    json.dumps({"command": req.command, "topic": topic, "payload": req.payload, "qos": req.qos}),
                    request.client.host if request.client else None,
                    datetime.now(timezone.utc),
                ),
            )
            conn.commit()

    logger.info("[API/rpc] node={} command={} topic={}", node_id, req.command, topic)
    return {"status": "ok", "node_id": str(node_id), "topic": topic, "command": req.command}
