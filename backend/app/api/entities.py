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
    is_system: bool = False


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
        "is_system": bool(row.get("is_system", False)),
    }


# ========================================
# Endpoints
# ========================================


def _standard_entities_rows() -> list[tuple]:
    """内置国家标准/国际标准实体定义，与 migration_012_standard_entities.sql 保持一致。"""
    return [
        # 光伏
        ("pv.activePower", "光伏有功功率", "R", "FLOAT", "kW", "pv", "GB/T 19964 / IEC 61850-7-420 光伏发电有功功率"),
        ("pv.reactivePower", "光伏无功功率", "R", "FLOAT", "kVar", "pv", "GB/T 19964 光伏发电无功功率"),
        ("pv.powerFactor", "光伏功率因数", "R", "FLOAT", None, "pv", "GB/T 19964 光伏功率因数"),
        ("pv.voltage", "光伏并网电压", "R", "FLOAT", "V", "pv", "GB/T 19964 光伏并网电压"),
        ("pv.current", "光伏并网电流", "R", "FLOAT", "A", "pv", "GB/T 19964 光伏并网电流"),
        ("pv.frequency", "光伏并网频率", "R", "FLOAT", "Hz", "pv", "GB/T 19964 光伏并网频率"),
        ("pv.irradiance", "光伏辐照度", "R", "FLOAT", "W/m²", "pv", "IEC 61850-7-420 水平面辐照度"),
        ("pv.moduleTemp", "组件温度", "R", "FLOAT", "°C", "pv", "IEC 61850-7-420 光伏组件温度"),
        ("pv.ambientTemp", "环境温度", "R", "FLOAT", "°C", "pv", "IEC 61850-7-420 光伏环境温度"),
        ("pv.dailyEnergy", "光伏日发电量", "R", "FLOAT", "kWh", "pv", "GB/T 19964 光伏日发电量"),
        ("pv.totalEnergy", "光伏累计发电量", "R", "FLOAT", "kWh", "pv", "GB/T 19964 光伏累计发电量"),
        ("pv.status", "逆变器状态", "R", "INT", None, "pv", "GB/T 19964 / IEC 61850-7-420 逆变器运行状态"),
        ("pv.faultCode", "光伏故障代码", "R", "STRING", None, "pv", "GB/T 19964 光伏故障代码"),
        # 储能
        ("ess.activePower", "储能有功功率", "R", "FLOAT", "kW", "ess", "GB/T 36558 电化学储能系统有功功率（充电为负，放电为正）"),
        ("ess.reactivePower", "储能无功功率", "R", "FLOAT", "kVar", "ess", "GB/T 36558 电化学储能系统无功功率"),
        ("ess.soc", "电池 SOC", "R", "FLOAT", "%", "ess", "GB/T 36558 电池荷电状态 SOC"),
        ("ess.soh", "电池 SOH", "R", "FLOAT", "%", "ess", "GB/T 36558 电池健康状态 SOH"),
        ("ess.voltage", "电池总电压", "R", "FLOAT", "V", "ess", "GB/T 36558 电池堆/簇总电压"),
        ("ess.current", "电池总电流", "R", "FLOAT", "A", "ess", "GB/T 36558 电池堆/簇总电流"),
        ("ess.maxCellTemp", "最高单体温度", "R", "FLOAT", "°C", "ess", "GB/T 36558 电池最高单体温度"),
        ("ess.minCellTemp", "最低单体温度", "R", "FLOAT", "°C", "ess", "GB/T 36558 电池最低单体温度"),
        ("ess.maxCellVoltage", "最高单体电压", "R", "FLOAT", "V", "ess", "GB/T 36558 电池最高单体电压"),
        ("ess.minCellVoltage", "最低单体电压", "R", "FLOAT", "V", "ess", "GB/T 36558 电池最低单体电压"),
        ("ess.chargeEnergy", "累计充电电量", "R", "FLOAT", "kWh", "ess", "GB/T 36558 电化学储能累计充电电量"),
        ("ess.dischargeEnergy", "累计放电电量", "R", "FLOAT", "kWh", "ess", "GB/T 36558 电化学储能累计放电电量"),
        ("ess.status", "储能系统状态", "R", "INT", None, "ess", "GB/T 36558 电化学储能系统运行状态"),
        ("ess.mode", "储能运行模式", "RW", "STRING", None, "ess", "GB/T 36558 电化学储能系统运行模式（调度/削峰填谷/需量控制等）"),
        ("ess.faultCode", "储能故障代码", "R", "STRING", None, "ess", "GB/T 36558 电化学储能系统故障代码"),
        # 充电桩
        ("charger.connectorStatus", "充电枪连接状态", "R", "INT", None, "charger", "GB/T 18487.1 / IEC 61851 充电枪连接状态"),
        ("charger.chargingPower", "充电功率", "R", "FLOAT", "kW", "charger", "GB/T 18487.1 充电桩实时充电功率"),
        ("charger.chargingCurrent", "充电电流", "R", "FLOAT", "A", "charger", "GB/T 18487.1 充电桩实时充电电流"),
        ("charger.chargingVoltage", "充电电压", "R", "FLOAT", "V", "charger", "GB/T 18487.1 充电桩实时充电电压"),
        ("charger.soc", "车辆 SOC", "R", "FLOAT", "%", "charger", "GB/T 18487.1 车辆电池 SOC"),
        ("charger.chargedEnergy", "已充电量", "R", "FLOAT", "kWh", "charger", "GB/T 18487.1 本次已充电量"),
        ("charger.connectorTemp", "充电枪温度", "R", "FLOAT", "°C", "charger", "GB/T 18487.1 充电枪温度"),
        ("charger.faultCode", "充电桩故障代码", "R", "STRING", None, "charger", "GB/T 18487.1 充电桩故障代码"),
        ("charger.startCharging", "启动充电", "W", "BOOL", None, "charger", "GB/T 18487.1 / IEC 61851 启动充电控制指令"),
        ("charger.stopCharging", "停止充电", "W", "BOOL", None, "charger", "GB/T 18487.1 / IEC 61851 停止充电控制指令"),
    ]


@router.post("/entities/seed")
async def seed_entities() -> dict:
    """重新初始化系统内置实体（幂等）。"""
    rows = _standard_entities_rows()
    insert_sql = """
    INSERT INTO t_entities (name, display_name, entity_type, data_type, unit, category, description, enabled, is_system)
    VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, TRUE)
    ON CONFLICT (name) DO NOTHING
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.executemany(insert_sql, rows)
                conn.commit()
                return {"seeded": len(rows), "ok": True}
    except Exception as e:
        logger.error("[API/entities] seed failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))


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


class BatchBindingItem(BaseModel):
    entity_id: str = Field(..., description="实体 UUID")
    tag_id: str = Field(..., description="点位 UUID")
    node_id: str = Field(..., description="节点 UUID")
    binding_type: str = Field(..., pattern="^(PHYSICAL|VIRTUAL)$")
    brand: str | None = None
    priority: int = Field(1, ge=1, description="绑定优先级，数字越小越优先")
    enabled: bool = True

class BatchBindRequest(BaseModel):
    bindings: list[BatchBindingItem] = Field(..., min_length=1, max_length=200)

class BatchUnbindRequest(BaseModel):
    binding_ids: list[str] = Field(..., min_length=1, max_length=200)

@router.get("/entities/bindings")
async def list_bindings(
    node_id: str | None = Query(None, description="按节点过滤"),
    entity_id: str | None = Query(None, description="按实体过滤"),
) -> dict:
    """查询实体-点位绑定列表，支持按节点或实体过滤。"""
    conditions = ["1=1"]
    params: list = []

    if node_id:
        try:
            params.append(UUID(node_id))
            conditions.append("b.node_id = %s")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid node_id")
    if entity_id:
        try:
            params.append(UUID(entity_id))
            conditions.append("b.entity_id = %s")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid entity_id")

    where = " AND ".join(conditions)
    query = f"""
    SELECT
        b.id,
        b.entity_id,
        b.tag_id,
        b.node_id,
        b.binding_type,
        b.brand,
        b.priority,
        b.enabled,
        b.created_at,
        t.name AS tag_name,
        t.display_name AS tag_display_name,
        n.name AS node_name,
        e.name AS entity_name,
        e.display_name AS entity_display_name,
        e.entity_type,
        e.data_type,
        e.unit AS entity_unit,
        e.is_system AS entity_is_system
    FROM t_entity_bindings b
    JOIN t_tags t ON t.id = b.tag_id
    JOIN t_nodes n ON n.id = b.node_id
    JOIN t_entities e ON e.id = b.entity_id
    WHERE {where}
    ORDER BY b.priority ASC, e.name ASC, t.name ASC
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                columns = [desc[0] for desc in cur.description]
                rows = [dict(zip(columns, row)) for row in cur.fetchall()]
        return {
            "bindings": [
                {
                    "id": str(r["id"]),
                    "entity_id": str(r["entity_id"]),
                    "tag_id": str(r["tag_id"]),
                    "node_id": str(r["node_id"]),
                    "binding_type": r["binding_type"],
                    "brand": r.get("brand"),
                    "priority": r["priority"],
                    "enabled": r["enabled"],
                    "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
                    "tag_name": r.get("tag_name"),
                    "tag_display_name": r.get("tag_display_name"),
                    "node_name": r.get("node_name"),
                    "entity_name": r.get("entity_name"),
                    "entity_display_name": r.get("entity_display_name"),
                    "entity_type": r.get("entity_type"),
                    "data_type": r.get("data_type"),
                    "unit": r.get("entity_unit"),
                    "entity_is_system": bool(r.get("entity_is_system", False)),
                }
                for r in rows
            ],
            "total": len(rows),
        }
    except Exception as e:
        logger.error("[API/entities] list bindings failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/entities/bindings/batch")
async def batch_create_bindings(req: BatchBindRequest) -> dict:
    """批量创建实体-点位绑定。重复绑定（同一 entity+tag）会自动跳过。"""
    validated = []
    for item in req.bindings:
        try:
            validated.append({
                "entity_id": UUID(item.entity_id),
                "tag_id": UUID(item.tag_id),
                "node_id": UUID(item.node_id),
                "binding_type": item.binding_type.upper(),
                "brand": item.brand,
                "priority": item.priority,
                "enabled": item.enabled,
            })
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid UUID in binding: {item}")

    eids = list({v["entity_id"] for v in validated})
    tids = list({v["tag_id"] for v in validated})
    nids = list({v["node_id"] for v in validated})

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM t_entities WHERE id = ANY(%s)", (eids,))
                existing_eids = {r[0] for r in cur.fetchall()}
                cur.execute("SELECT id FROM t_tags WHERE id = ANY(%s)", (tids,))
                existing_tids = {r[0] for r in cur.fetchall()}
                cur.execute("SELECT id FROM t_nodes WHERE id = ANY(%s)", (nids,))
                existing_nids = {r[0] for r in cur.fetchall()}

        missing = [
            i for i, v in enumerate(validated)
            if v["entity_id"] not in existing_eids
            or v["tag_id"] not in existing_tids
            or v["node_id"] not in existing_nids
        ]
        if missing:
            raise HTTPException(status_code=400, detail=f"Binding item {missing[0]} references non-existing entity/tag/node")

        insert_sql = """
        INSERT INTO t_entity_bindings
          (entity_id, tag_id, node_id, binding_type, brand, priority, enabled)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (entity_id, tag_id) DO NOTHING
        RETURNING id
        """
        created = 0
        skipped = 0
        with get_connection() as conn:
            with conn.cursor() as cur:
                for v in validated:
                    cur.execute(insert_sql, (
                        v["entity_id"], v["tag_id"], v["node_id"],
                        v["binding_type"], v["brand"], v["priority"], v["enabled"],
                    ))
                    if cur.fetchone():
                        created += 1
                    else:
                        skipped += 1
                conn.commit()

        return {"created": created, "skipped": skipped, "total": len(validated)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/entities] batch bind failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/entities/bindings/batch")
async def batch_delete_bindings(req: BatchUnbindRequest) -> dict:
    """批量删除实体-点位绑定。"""
    try:
        bids = [UUID(bid) for bid in req.binding_ids]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid binding_id")
    if not bids:
        return {"deleted": 0}

    placeholders = ",".join(["%s"] * len(bids))
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM t_entity_bindings WHERE id IN ({placeholders})",
                    bids,
                )
                deleted = cur.rowcount
                conn.commit()
        return {"deleted": deleted}
    except Exception as e:
        logger.error("[API/entities] batch unbind failed: {}", e)
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


def _check_system_protected(eid: UUID, req: EntityUpdateRequest) -> None:
    """系统实体不允许修改核心元数据（名称、分类、类型、数据类型）。"""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT is_system FROM t_entities WHERE id = %s", (eid,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Entity not found")
                is_system = bool(row[0]) if row[0] is not None else False
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/entities] check system failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))

    if not is_system:
        return

    forbidden = []
    if req.entity_type is not None:
        forbidden.append("entity_type")
    if req.data_type is not None:
        forbidden.append("data_type")
    if req.category is not None:
        forbidden.append("category")
    if forbidden:
        raise HTTPException(
            status_code=403,
            detail=f"System entity cannot modify: {', '.join(forbidden)}",
        )


@router.put("/entities/{entity_id}")
async def update_entity(entity_id: str, req: EntityUpdateRequest) -> dict:
    """更新实体元数据。"""
    try:
        eid = UUID(entity_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid entity_id")

    _check_system_protected(eid, req)

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
                cur.execute("SELECT is_system FROM t_entities WHERE id = %s", (eid,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Entity not found")
                if row[0]:
                    raise HTTPException(status_code=403, detail="System entity cannot be deleted")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/entities] delete check failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))

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

