"""
ZiZu Entities API - 全局实体管理

实体是业务语义层（如 pcs.activePower），与具体品牌物理/虚拟点位解耦。
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from loguru import logger
from pydantic import BaseModel, Field

from app.services.telemetry_store import get_connection
from app.services.entity_resolver import (
    get_entity_history,
    get_entity_realtime,
    resolve_entity_binding,
    write_entity_value,
)

router = APIRouter()


# ========================================
# Request / Response Models
# ========================================

class EntityCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, description="实体全局名，如 pcs.activePower")
    display_name: str | None = None
    entity_type: str = Field(..., pattern="^(R|W|RW)$", description="R/W/RW")
    data_type: str = Field(..., pattern="^(FLOAT|INT|BOOL|STRING|ENUM)$")
    unit: str | None = None
    category: str | None = None
    description: str | None = None
    enabled: bool = True


class EntityUpdateRequest(BaseModel):
    display_name: str | None = None
    entity_type: str | None = Field(None, pattern="^(R|W|RW)$")
    data_type: str | None = Field(None, pattern="^(FLOAT|INT|BOOL|STRING|ENUM)$")
    unit: str | None = None
    category: str | None = None
    description: str | None = None
    enabled: bool | None = None


class EntityBindingRequest(BaseModel):
    tag_id: str = Field(..., description="点位 UUID")
    node_id: str = Field(..., description="节点 UUID")
    binding_type: str = Field(..., pattern="^(PHYSICAL|VIRTUAL)$")
    brand: str | None = None
    priority: int = Field(1, ge=1, description="绑定优先级，数字越小越优先")
    enabled: bool = True


class EntityResponse(BaseModel):
    id: str
    name: str
    display_name: str | None = None
    entity_type: str
    data_type: str
    unit: str | None = None
    category: str | None = None
    description: str | None = None
    enabled: bool
    binding_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None


class BindingResponse(BaseModel):
    id: str
    entity_id: str
    tag_id: str
    node_id: str
    binding_type: str
    brand: str | None = None
    priority: int
    enabled: bool
    tag_name: str | None = None
    tag_display_name: str | None = None
    node_name: str | None = None
    created_at: str | None = None


# ========================================
# Helpers
# ========================================

def _row_to_entity(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "display_name": row.get("display_name"),
        "entity_type": row["entity_type"],
        "data_type": row["data_type"],
        "unit": row.get("unit"),
        "category": row.get("category"),
        "description": row.get("description"),
        "enabled": row["enabled"],
        "binding_count": row.get("binding_count", 0),
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
    }


# ========================================
# Endpoints
# ========================================

@router.get("/entities")
async def list_entities(
    category: str | None = Query(None, description="按分类过滤"),
    entity_type: str | None = Query(None, description="按 R/W/RW 过滤"),
    search: str | None = Query(None, description="按名称/显示名搜索"),
    enabled: bool | None = Query(None, description="按启用状态过滤"),
    node_id: str | None = Query(None, description="按节点绑定关系过滤"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict:
    """分页查询全局实体列表。"""
    conditions = ["1=1"]
    params: list = []

    if category:
        conditions.append("e.category = %s")
        params.append(category)
    if entity_type:
        conditions.append("e.entity_type = %s")
        params.append(entity_type.upper())
    if enabled is not None:
        conditions.append("e.enabled = %s")
        params.append(enabled)
    if search:
        conditions.append("(e.name ILIKE %s OR e.display_name ILIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])

    try:
        nid = UUID(str(node_id)) if node_id else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid node_id")

    if nid:
        conditions.append("EXISTS (SELECT 1 FROM t_entity_bindings b WHERE b.entity_id = e.id AND b.node_id = %s AND b.enabled = TRUE)")
        params.append(nid)

    where = " AND ".join(conditions)
    offset = (page - 1) * page_size

    query = f"""
    SELECT e.*, COUNT(b.id) AS binding_count
    FROM t_entities e
    LEFT JOIN t_entity_bindings b ON b.entity_id = e.id
    WHERE {where}
    GROUP BY e.id
    ORDER BY e.category NULLS LAST, e.name
    LIMIT %s OFFSET %s
    """
    count_query = f"""
    SELECT COUNT(*) FROM t_entities e WHERE {where}
    """

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params + [page_size, offset])
                columns = [desc[0] for desc in cur.description]
                rows = [dict(zip(columns, row)) for row in cur.fetchall()]

                cur.execute(count_query, params)
                total = cur.fetchone()[0]

        return {
            "items": [_row_to_entity(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size,
        }
    except Exception as e:
        logger.error("[API/entities] list failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/entities", status_code=status.HTTP_201_CREATED)
async def create_entity(req: EntityCreateRequest) -> dict:
    """创建全局实体。"""
    query = """
    INSERT INTO t_entities (name, display_name, entity_type, data_type, unit, category, description, enabled)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    RETURNING id, created_at
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (
                    req.name, req.display_name, req.entity_type.upper(),
                    req.data_type.upper(), req.unit, req.category,
                    req.description, req.enabled,
                ))
                row = cur.fetchone()
                conn.commit()
        return {"id": str(row[0]), "created_at": row[1].isoformat()}
    except Exception as e:
        logger.error("[API/entities] create failed: {}", e)
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail=f"Entity name '{req.name}' already exists")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/entities/{entity_id}")
async def get_entity(entity_id: str) -> dict:
    """获取实体详情及绑定。"""
    try:
        eid = UUID(entity_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid entity_id")

    entity_query = """
    SELECT e.*, COUNT(b.id) AS binding_count
    FROM t_entities e
    LEFT JOIN t_entity_bindings b ON b.entity_id = e.id
    WHERE e.id = %s
    GROUP BY e.id
    """
    bindings_query = """
    SELECT b.*, t.name AS tag_name, t.display_name AS tag_display_name, n.name AS node_name
    FROM t_entity_bindings b
    JOIN t_tags t ON t.id = b.tag_id
    JOIN t_nodes n ON n.id = b.node_id
    WHERE b.entity_id = %s
    ORDER BY b.priority ASC, b.created_at ASC
    """

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(entity_query, (eid,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Entity not found")
                columns = [desc[0] for desc in cur.description]
                entity = _row_to_entity(dict(zip(columns, row)))

                cur.execute(bindings_query, (eid,))
                b_columns = [desc[0] for desc in cur.description]
                bindings = []
                for b_row in cur.fetchall():
                    b = dict(zip(b_columns, b_row))
                    bindings.append({
                        "id": str(b["id"]),
                        "entity_id": str(b["entity_id"]),
                        "tag_id": str(b["tag_id"]),
                        "node_id": str(b["node_id"]),
                        "binding_type": b["binding_type"],
                        "brand": b.get("brand"),
                        "priority": b["priority"],
                        "enabled": b["enabled"],
                        "tag_name": b.get("tag_name"),
                        "tag_display_name": b.get("tag_display_name"),
                        "node_name": b.get("node_name"),
                        "created_at": b["created_at"].isoformat() if b.get("created_at") else None,
                    })

        entity["bindings"] = bindings
        return entity
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/entities] get failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/entities/{entity_id}")
async def update_entity(entity_id: str, req: EntityUpdateRequest) -> dict:
    """更新实体元数据。"""
    try:
        eid = UUID(entity_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid entity_id")

    fields = []
    params: list = []
    if req.display_name is not None:
        fields.append("display_name = %s")
        params.append(req.display_name)
    if req.entity_type is not None:
        fields.append("entity_type = %s")
        params.append(req.entity_type.upper())
    if req.data_type is not None:
        fields.append("data_type = %s")
        params.append(req.data_type.upper())
    if req.unit is not None:
        fields.append("unit = %s")
        params.append(req.unit)
    if req.category is not None:
        fields.append("category = %s")
        params.append(req.category)
    if req.description is not None:
        fields.append("description = %s")
        params.append(req.description)
    if req.enabled is not None:
        fields.append("enabled = %s")
        params.append(req.enabled)

    if not fields:
        return {"updated": False}

    params.append(eid)
    query = f"""
    UPDATE t_entities SET {', '.join(fields)}, updated_at = now()
    WHERE id = %s
    RETURNING updated_at
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Entity not found")
                conn.commit()
        return {"updated": True, "updated_at": row[0].isoformat()}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/entities] update failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/entities/{entity_id}")
async def delete_entity(entity_id: str) -> dict:
    """删除实体（级联删除绑定）。"""
    try:
        eid = UUID(entity_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid entity_id")

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM t_entities WHERE id = %s RETURNING id", (eid,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Entity not found")
                conn.commit()
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/entities] delete failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/entities/{entity_id}/bindings")
async def create_binding(entity_id: str, req: EntityBindingRequest) -> dict:
    """为实体绑定一个点位。"""
    try:
        eid = UUID(entity_id)
        tid = UUID(req.tag_id)
        nid = UUID(req.node_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID")

    # 校验 entity 与 tag/node 存在
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM t_entities WHERE id = %s", (eid,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Entity not found")
            cur.execute("SELECT id FROM t_tags WHERE id = %s", (tid,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Tag not found")
            cur.execute("SELECT id FROM t_nodes WHERE id = %s", (nid,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Node not found")

    query = """
    INSERT INTO t_entity_bindings (entity_id, tag_id, node_id, binding_type, brand, priority, enabled)
    VALUES (%s, %s, %s, %s, %s, %s, %s)
    RETURNING id, created_at
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (
                    eid, tid, nid, req.binding_type.upper(),
                    req.brand, req.priority, req.enabled,
                ))
                row = cur.fetchone()
                conn.commit()
        return {"id": str(row[0]), "created_at": row[1].isoformat()}
    except Exception as e:
        logger.error("[API/entities] binding failed: {}", e)
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="Entity already bound to this tag")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/entities/{entity_id}/bindings/{binding_id}")
async def delete_binding(entity_id: str, binding_id: str) -> dict:
    """删除绑定。"""
    try:
        bid = UUID(binding_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid binding_id")

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM t_entity_bindings WHERE id = %s AND entity_id = %s RETURNING id",
                    (bid, UUID(entity_id)),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Binding not found")
                conn.commit()
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/entities] delete binding failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/entities/{entity_id}/realtime")
async def entity_realtime(entity_id: str) -> dict:
    """获取实体实时值。"""
    data = get_entity_realtime(entity_id)
    if not data:
        raise HTTPException(status_code=404, detail="Entity has no active binding or no data")
    return data


@router.get("/entities/{entity_id}/history")
async def entity_history(
    entity_id: str,
    range: str = Query("1h", pattern="^(1h|24h|7d|all)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(500, ge=1, le=2000),
) -> dict:
    """获取实体历史数据。"""
    data = get_entity_history(entity_id, range, page, page_size)
    if not data:
        raise HTTPException(status_code=404, detail="Entity has no active binding or no data")
    return data


@router.post("/entities/{entity_id}/write")
async def entity_write(entity_id: str, req: dict) -> dict:
    """向实体写入控制值。"""
    value = req.get("value")
    if value is None:
        raise HTTPException(status_code=400, detail="value is required")
    try:
        result = write_entity_value(entity_id, value)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("[API/entities] write failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))

