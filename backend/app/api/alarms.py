"""
F2 Alarms API — 告警中心

GET    /api/v1/alarms              → 告警列表（支持过滤）
PUT    /api/v1/alarms/{id}/acknowledge → 确认告警
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from pydantic import BaseModel, Field

router = APIRouter()


class AckAlarmRequest(BaseModel):
    ack_user: str = Field(..., min_length=1, description="确认人")


@router.get("/alarms")
async def list_alarms(
    level: str | None = Query(None, description="级别过滤 INFO/WARNING/MAJOR/CRITICAL"),
    acknowledged: bool | None = Query(None, description="是否已确认"),
    active: bool | None = Query(None, description="是否未恢复"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    """查询告警列表。"""
    from app.services.telemetry_store import get_connection

    conditions = []
    params: list = []
    if level:
        conditions.append("level = %s")
        params.append(level.upper())
    if acknowledged is not None:
        conditions.append("acknowledged = %s")
        params.append(acknowledged)
    if active is not None:
        if active:
            conditions.append("resolved_at IS NULL")
        else:
            conditions.append("resolved_at IS NOT NULL")

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT a.id, a.rule_id, a.node_id, a.level, a.message,
                       a.acknowledged, a.ack_user, a.ack_at, a.created_at, a.resolved_at,
                       r.name AS rule_name
                FROM t_alarms a
                LEFT JOIN t_rules r ON r.id = a.rule_id
                {where}
                ORDER BY a.created_at DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [limit, offset]),
            )
            rows = cur.fetchall()

            cur.execute(f"SELECT COUNT(*) FROM t_alarms a {where}", tuple(params))
            total = cur.fetchone()[0]

    alarms = []
    for row in rows:
        (aid, rule_id, node_id, level, message, acknowledged, ack_user, ack_at,
         created_at, resolved_at, rule_name) = row
        alarms.append({
            "id": str(aid),
            "rule_id": str(rule_id) if rule_id else None,
            "rule_name": rule_name,
            "node_id": str(node_id) if node_id else None,
            "level": level,
            "message": message,
            "acknowledged": acknowledged,
            "ack_user": ack_user,
            "ack_at": ack_at.isoformat() if ack_at else None,
            "created_at": created_at.isoformat() if created_at else None,
            "resolved_at": resolved_at.isoformat() if resolved_at else None,
        })

    return {"alarms": alarms, "total": total, "limit": limit, "offset": offset}


@router.put("/alarms/{alarm_id}/acknowledge")
async def acknowledge_alarm(alarm_id: UUID, req: AckAlarmRequest) -> dict:
    """确认告警。"""
    from app.services.telemetry_store import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM t_alarms WHERE id = %s", (alarm_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Alarm not found")

            cur.execute(
                """
                UPDATE t_alarms
                SET acknowledged = TRUE, ack_user = %s, ack_at = %s
                WHERE id = %s
                """,
                (req.ack_user, datetime.now(timezone.utc), alarm_id),
            )
            conn.commit()

    logger.info("[API/alarms] acknowledged alarm id={} by {}", alarm_id, req.ack_user)
    return {"status": "ok", "id": str(alarm_id)}
