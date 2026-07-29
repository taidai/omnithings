"""
OmniThings Tags API — 点位管理（含偏移校准）

GET    /api/v1/tags              → 分页查询点位列表（含原始值/工程值实时对照）
GET    /api/v1/tags/{tag_id}     → 单个点位详情
PUT    /api/v1/tags/{tag_id}     → 修改 scale_factor / value_offset / unit 等
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field

router = APIRouter()


# ══════════════════════════════════════
# Request / Response Models
# ══════════════════════════════════════

class TagUpdateRequest(BaseModel):
    """允许修改的点位字段。"""
    scale_factor: float | None = Field(None, description="缩放系数")
    value_offset: float | None = Field(None, description="偏移量（原始值 + offset）× scale = 工程值")
    unit: str | None = Field(None, description="单位")
    display_name: str | None = Field(None, description="显示名称")
    read_write: str | None = Field(None, pattern="^[RrWw]+$", description="读写权限")
    enabled: bool | None = Field(None, description="是否启用")
    description: str | None = Field(None, description="描述")


class TagResponse(BaseModel):
    id: str
    node_id: str
    node_name: str | None = None
    name: str
    display_name: str | None = None
    data_type: str
    tag_type: str
    unit: str | None = None
    scale_factor: float = 1.0
    value_offset: float = 0.0
    source_path: str | None = None
    source_type: str | None = None
    read_write: str = "R"
    enabled: bool = True
    description: str | None = None
    # 实时值 (由 /tags/{id} 附加)
    raw_value: float | int | bool | str | None = None
    eng_value: float | None = None
    latest_ts: str | None = None
    quality: int | None = None


class HistoryPoint(BaseModel):
    ts: str
    raw_value: float | None
    eng_value: float | None


class HistoryResponse(BaseModel):
    tag_id: str
    tag_name: str
    range: str
    bucket: str
    points: list[HistoryPoint]


# ══════════════════════════════════════
# Endpoints
# ══════════════════════════════════════

@router.get("/tags")
async def list_tags(
    node_id: str | None = Query(None, description="按节点过滤"),
    data_type: str | None = Query(None, description="按数据类型过滤"),
    search: str | None = Query(None, description="按名称/显示名模糊搜索"),
    enabled: bool = Query(True, description="只看启用点位"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=200, description="每页条数"),
    sort_by: str = Query("sort_order", description="排序字段"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$", description="排序方向"),
) -> dict:
    """
    分页查询点位列表，附带每个点位的最新值。

    用于前端 TagsTable 主页面。
    """
    from app.services.telemetry_store import get_connection

    conditions = ["t.enabled = TRUE"] if enabled else []
    params: list = []

    if node_id:
        conditions.append("t.node_id = %s")
        params.append(UUID(node_id))
    if data_type:
        conditions.append("t.data_type = %s")
        params.append(data_type.upper())
    if search:
        conditions.append("(t.name ILIKE %s OR t.display_name ILIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    # 排序白名单
    sort_map = {
        "name": "t.name",
        "display_name": "t.display_name",
        "node_name": "n.name",
        "data_type": "t.data_type",
        "unit": "t.unit",
        "raw_value": "latest.value",
        "eng_value": "eng_value",
        "scale_factor": "t.scale_factor",
        "value_offset": "t.value_offset",
        "sort_order": "t.sort_order",
    }
    order_by = sort_map.get(sort_by, "t.sort_order")
    order_dir = "DESC" if sort_order.lower() == "desc" else "ASC"

    # 分页 offset
    offset = (page - 1) * page_size

    query = f"""
    SELECT
        t.id, t.node_id, t.name, t.display_name, t.data_type, t.tag_type,
        t.unit, t.scale_factor, t.value_offset, t.source_path, t.source_type,
        t.read_write, t.enabled, t.description,
        n.name AS node_name,
        -- 最新值子查询 (raw + computed eng)
        latest.ts AS latest_ts,
        latest.value AS raw_value,
        CASE
            WHEN latest.value IS NULL THEN NULL
            WHEN t.scale_factor = 1.0 AND t.value_offset = 0.0
                THEN latest.value::float
            ELSE (latest.value + t.value_offset) * t.scale_factor
        END AS eng_value,
        latest.quality
    FROM t_tags t
    JOIN t_nodes n ON n.id = t.node_id
    LEFT JOIN LATERAL (
        SELECT ts, COALESCE(value_float, value_int::float) AS value, quality
        FROM t_telemetry
        WHERE tag_id = t.id
        ORDER BY ts DESC
        LIMIT 1
    ) latest ON TRUE
    {where}
    ORDER BY {order_by} {order_dir}, t.sort_order, t.name
    LIMIT %s OFFSET %s
    """

    count_query = f"SELECT COUNT(*) FROM t_tags t {where}"

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params + [page_size, offset])
                columns = [desc[0] for desc in cur.description]
                rows = [dict(zip(columns, row)) for row in cur.fetchall()]

                # Get total count
                cur.execute(count_query, params)
                total = cur.fetchone()[0]

        # Serialize
        for row in rows:
            row["id"] = str(row["id"])
            row["node_id"] = str(row["node_id"])
            if row.get("latest_ts"):
                row["latest_ts"] = row["latest_ts"].isoformat()
            if row.get("raw_value") is not None:
                row["raw_value"] = float(row["raw_value"]) if row["raw_value"] is not None else None
            if row.get("eng_value") is not None:
                row["eng_value"] = round(float(row["eng_value"]), 4)

        return {
            "tags": rows,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size,
        }
    except Exception as e:
        logger.error("[API/tags] Query failed: {}", e)
        return {"tags": [], "total": 0, "page": page, "page_size": page_size, "error": str(e)}


@router.get("/tags/export")
async def export_tags_csv(
    node_id: str | None = Query(None, description="按节点过滤"),
    data_type: str | None = Query(None, description="按数据类型过滤"),
    search: str | None = Query(None, description="按名称/显示名模糊搜索"),
) -> StreamingResponse:
    """
    导出点位列表为 CSV（含最新值）。
    支持当前筛选条件，最多导出 5000 条。
    """
    import csv
    import io

    from app.services.telemetry_store import get_connection

    conditions = ["t.enabled = TRUE"]
    params: list = []

    if node_id:
        conditions.append("t.node_id = %s")
        params.append(UUID(node_id))
    if data_type:
        conditions.append("t.data_type = %s")
        params.append(data_type.upper())
    if search:
        conditions.append("(t.name ILIKE %s OR t.display_name ILIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])

    where = " WHERE " + " AND ".join(conditions)

    query = f"""
    SELECT
        n.name AS node_name,
        t.name,
        t.display_name,
        t.data_type,
        t.unit,
        t.scale_factor,
        t.value_offset,
        latest.value AS raw_value,
        CASE
            WHEN latest.value IS NULL THEN NULL
            WHEN t.scale_factor = 1.0 AND t.value_offset = 0.0
                THEN latest.value::float
            ELSE (latest.value + t.value_offset) * t.scale_factor
        END AS eng_value,
        latest.ts AS latest_ts
    FROM t_tags t
    JOIN t_nodes n ON n.id = t.node_id
    LEFT JOIN LATERAL (
        SELECT ts, COALESCE(value_float, value_int::float) AS value
        FROM t_telemetry
        WHERE tag_id = t.id
        ORDER BY ts DESC
        LIMIT 1
    ) latest ON TRUE
    {where}
    ORDER BY n.sort_order, t.sort_order, t.name
    LIMIT 5000
    """

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

    # 生成 CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "节点", "点位名", "显示名", "数据类型", "单位",
        "原始值", "工程值", "Scale", "Offset", "最新时间"
    ])
    for row in rows:
        node_name, name, display_name, data_type, unit, scale, offset, raw, eng, ts = row
        writer.writerow([
            node_name,
            name,
            display_name or "",
            data_type,
            unit or "",
            f"{raw:.4f}" if raw is not None else "",
            f"{eng:.4f}" if eng is not None else "",
            f"{scale:.6f}",
            f"{offset:.6f}",
            ts.isoformat() if ts else "",
        ])

    output.seek(0)
    filename = f"omnithings_tags_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/tags/{tag_id}")
async def get_tag(tag_id: UUID) -> dict:
    """获取单个点位详情 + 最新值。"""
    from app.services.telemetry_store import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT t.id, t.node_id, t.name, t.display_name, t.data_type, t.tag_type,
                       t.unit, t.scale_factor, t.value_offset, t.source_path, t.source_type,
                       t.read_write, t.enabled, t.description,
                       n.name AS node_name,
                       latest.ts, latest.value AS raw_value, latest.quality
                FROM t_tags t
                JOIN t_nodes n ON n.id = t.node_id
                LEFT JOIN LATERAL (
                    SELECT ts, COALESCE(value_float, value_int::float) AS value, quality
                    FROM t_telemetry
                    WHERE tag_id = t.id
                    ORDER BY ts DESC
                    LIMIT 1
                ) latest ON TRUE
                WHERE t.id = %s
                """,
                (tag_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Tag not found")

            columns = [desc[0] for desc in cur.description]
            tag = dict(zip(columns, row))
            tag["id"] = str(tag["id"])
            tag["node_id"] = str(tag["node_id"])
            if tag.get("ts"):
                tag["latest_ts"] = tag["ts"].isoformat()
            if tag.get("raw_value") is not None:
                tag["raw_value"] = float(tag["raw_value"])
                tag["eng_value"] = round(
                    (tag["raw_value"] + (tag["value_offset"] or 0)) * (tag["scale_factor"] or 1), 4
                )

    return tag


@router.get("/tags/{tag_id}/history")
async def get_tag_history(
    tag_id: UUID,
    range: str = Query("1h", pattern="^(1h|24h|7d)$", description="时间范围"),
) -> dict:
    """
    查询点位历史趋势数据。

    - 1h: 原始数据 (约 1-2s/条)
    - 24h: 5 分钟聚合
    - 7d: 30 分钟聚合
    """
    from app.services.telemetry_store import get_connection

    # 确定 bucket 间隔
    bucket_map = {
        "1h": None,           # 原始数据
        "24h": "5 minutes",
        "7d": "30 minutes",
    }
    interval_map = {
        "1h": "1 hour",
        "24h": "24 hours",
        "7d": "7 days",
    }
    bucket = bucket_map[range]
    interval = interval_map[range]

    with get_connection() as conn:
        with conn.cursor() as cur:
            # 获取 tag 信息
            cur.execute(
                "SELECT name, display_name, scale_factor, value_offset FROM t_tags WHERE id = %s",
                (tag_id,),
            )
            tag_row = cur.fetchone()
            if not tag_row:
                raise HTTPException(status_code=404, detail="Tag not found")
            tag_name, display_name, scale_factor, value_offset = tag_row

            if bucket:
                # 聚合查询
                query = """
                SELECT
                    time_bucket(%s::interval, ts) AS bucket_ts,
                    AVG(COALESCE(value_float, value_int::float)) AS raw_value
                FROM t_telemetry
                WHERE tag_id = %s AND ts > NOW() - %s::interval
                GROUP BY bucket_ts
                ORDER BY bucket_ts ASC
                """
                cur.execute(query, (bucket, tag_id, interval))
            else:
                # 原始数据，但限制最多 2000 条防止爆内存
                query = """
                SELECT ts AS bucket_ts, COALESCE(value_float, value_int::float) AS raw_value
                FROM t_telemetry
                WHERE tag_id = %s AND ts > NOW() - %s::interval
                ORDER BY ts ASC
                LIMIT 2000
                """
                cur.execute(query, (tag_id, interval))

            points = []
            for row in cur.fetchall():
                ts, raw = row
                eng = None
                if raw is not None:
                    eng = round((float(raw) + (value_offset or 0)) * (scale_factor or 1), 4)
                points.append({
                    "ts": ts.isoformat(),
                    "raw_value": round(float(raw), 4) if raw is not None else None,
                    "eng_value": eng,
                })

    return {
        "tag_id": str(tag_id),
        "tag_name": display_name or tag_name,
        "range": range,
        "bucket": bucket or "raw",
        "points": points,
    }


class BatchUpdateRequest(BaseModel):
    """批量更新请求。"""
    tag_ids: list[str] = Field(..., description="点位 ID 列表")
    scale_factor: float | None = Field(None, description="统一缩放系数")
    value_offset: float | None = Field(None, description="统一偏移量")


@router.put("/tags/batch")
async def batch_update_tags(req: BatchUpdateRequest) -> dict:
    """
    批量更新点位的 scale_factor / value_offset。
    """
    from app.services.telemetry_store import get_connection

    if not req.tag_ids:
        return {"status": "no_change", "updated": 0}

    updates = []
    params: list = []
    if req.scale_factor is not None:
        updates.append("scale_factor = %s")
        params.append(req.scale_factor)
    if req.value_offset is not None:
        updates.append("value_offset = %s")
        params.append(req.value_offset)

    if not updates:
        return {"status": "no_change", "updated": 0}

    updates.append("updated_at = %s")
    params.append(datetime.now(timezone.utc))

    # 构建 IN 子句
    uuid_params = [UUID(tid) for tid in req.tag_ids]
    placeholders = ",".join(["%s"] * len(uuid_params))
    params.extend(uuid_params)

    query = f"""
    UPDATE t_tags
    SET {", ".join(updates)}
    WHERE id IN ({placeholders})
    """

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                conn.commit()
                updated = cur.rowcount

        return {"status": "ok", "updated": updated}
    except Exception as e:
        logger.error("[API/tags/batch] Update failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/tags/{tag_id}")
async def update_tag(tag_id: UUID, req: TagUpdateRequest) -> dict:
    """
    更新点位配置（offset/scale/unit 等）。

    只更新 req 中非 None 的字段（部分更新）。
    """
    from app.services.telemetry_store import get_connection

    # 构建动态 UPDATE
    updates = []
    params: list = []
    for field, value in req.model_dump(exclude_none=True).items():
        if value is not None:
            updates.append(f"{field} = %s")
            params.append(value)

    if not updates:
        return {"status": "no_change", "message": "No fields to update"}

    updates.append("updated_at = %s")
    params.append(datetime.now(timezone.utc))
    params.append(tag_id)

    query = f"""
    UPDATE t_tags
    SET {", ".join(updates)}
    WHERE id = %s
    RETURNING id, name, scale_factor, value_offset, unit
    """

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                conn.commit()
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Tag not found")

        return {
            "status": "ok",
            "tag": {
                "id": str(row[0]),
                "name": row[1],
                "scale_factor": float(row[2]),
                "value_offset": float(row[3]),
                "unit": row[4],
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/tags/{tag_id}] Update failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))
