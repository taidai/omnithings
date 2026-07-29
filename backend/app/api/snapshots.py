"""
OmniThings Snapshot API — 节点快照查询（数据黑板）

GET    /api/v1/snapshots              → 分页查询节点快照
GET    /api/v1/snapshots/{node_id}/latest → 获取节点最新快照
GET    /api/v1/snapshots/export       → 导出 CSV
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

router = APIRouter()


class SnapshotPoint(BaseModel):
    ts: str
    node_id: str
    node_name: str
    data: dict
    raw_data: dict
    quality: int | None


@router.get("/snapshots")
async def list_snapshots(
    node_id: str | None = Query(None, description="按节点过滤"),
    range: str = Query("1h", pattern="^(1h|24h|7d|all)$", description="时间范围"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=500, description="每页条数"),
) -> dict:
    """
    分页查询节点快照（数据黑板）。
    """
    from app.services.telemetry_store import get_connection

    conditions = []
    params: list = []

    if node_id:
        conditions.append("s.node_id = %s")
        params.append(UUID(node_id))

    interval_map = {
        "1h": "1 hour",
        "24h": "24 hours",
        "7d": "7 days",
    }
    if range != "all":
        conditions.append("s.ts > NOW() - %s::interval")
        params.append(interval_map[range])

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * page_size

    query = f"""
    SELECT
        s.ts,
        s.node_id,
        s.node_name,
        s.data,
        s.raw_data,
        s.quality
    FROM t_node_snapshot s
    {where}
    ORDER BY s.ts DESC
    LIMIT %s OFFSET %s
    """

    count_query = f"SELECT COUNT(*) FROM t_node_snapshot s {where}"

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params + [page_size, offset])
                columns = [desc[0] for desc in cur.description]
                rows = [dict(zip(columns, row)) for row in cur.fetchall()]

                cur.execute(count_query, params)
                total = cur.fetchone()[0]

        for row in rows:
            row["node_id"] = str(row["node_id"])
            row["ts"] = row["ts"].isoformat()

        return {
            "snapshots": rows,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size,
        }
    except Exception as e:
        logger.error("[API/snapshots] Query failed: {}", e)
        return {"snapshots": [], "total": 0, "page": page, "page_size": page_size, "error": str(e)}


@router.get("/snapshots/{node_id}/latest")
async def get_latest_snapshot(node_id: UUID) -> dict:
    """获取节点最新快照。"""
    from app.services.telemetry_store import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.ts, s.node_id, s.node_name, s.data, s.raw_data, s.raw_message, s.quality
                FROM t_node_snapshot s
                WHERE s.node_id = %s
                ORDER BY s.ts DESC
                LIMIT 1
                """,
                (node_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="No snapshot found")

            columns = [desc[0] for desc in cur.description]
            snapshot = dict(zip(columns, row))
            snapshot["node_id"] = str(snapshot["node_id"])
            snapshot["ts"] = snapshot["ts"].isoformat()

    return snapshot


@router.get("/snapshots/export")
async def export_snapshots_csv(
    node_id: str | None = Query(None, description="按节点过滤"),
    range: str = Query("1h", pattern="^(1h|24h|7d|all)$", description="时间范围"),
) -> StreamingResponse:
    """
    导出节点快照为 CSV。
    """
    import csv
    import io
    import json

    from app.services.telemetry_store import get_connection

    conditions = []
    params: list = []

    if node_id:
        conditions.append("s.node_id = %s")
        params.append(UUID(node_id))

    interval_map = {
        "1h": "1 hour",
        "24h": "24 hours",
        "7d": "7 days",
    }
    if range != "all":
        conditions.append("s.ts > NOW() - %s::interval")
        params.append(interval_map[range])

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    query = f"""
    SELECT s.ts, s.node_name, s.data, s.raw_data, s.quality
    FROM t_node_snapshot s
    {where}
    ORDER BY s.ts DESC
    LIMIT 5000
    """

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["时间", "节点", "工程值(JSON)", "原始值(JSON)", "Quality"])
    for row in rows:
        ts, node_name, data, raw_data, quality = row
        writer.writerow([
            ts.isoformat() if ts else "",
            node_name,
            json.dumps(data, ensure_ascii=False) if data else "",
            json.dumps(raw_data, ensure_ascii=False) if raw_data else "",
            quality or "",
        ])

    output.seek(0)
    filename = f"omnithings_snapshots_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
