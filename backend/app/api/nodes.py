"""
OmniThings Nodes API - 节点管理

GET /api/v1/nodes -> 节点列表（含 tag 数量统计）
PUT /api/v1/nodes/{id} -> 更新节点配置（用于规则绑定等）
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from pydantic import BaseModel, Field

from app.models.schemas import NodeCreate, NodeUpdate

router = APIRouter()

# 级联深度上限 (G3 审查 R2) — 防循环依赖 / 超深树
MAX_CASCADE_DEPTH = 5


class NodeUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    node_type: str | None = Field(None, min_length=1, max_length=100)
    sort_order: int | None = None
    enabled: bool | None = None
    config: dict | None = None


def _serialize_node(row: dict) -> dict:
    row = dict(row)
    row["id"] = str(row["id"])
    if row.get("parent_id"):
        row["parent_id"] = str(row["parent_id"])
    if row.get("created_at"):
        row["created_at"] = row["created_at"].isoformat()
    return row


@router.get("/nodes")
async def list_nodes(
    layer: int | None = Query(None, description="按层级过滤 1=Site 2=Station 3=EnergyNode 4=Device 5=Tag"),
    enabled: bool = Query(True, description="只看启用节点"),
) -> dict:
    """
    返回所有节点列表，含每个节点下的 tag 数量。

    用于前端树形结构展示 + 点位管理页的节点下拉选择。
    """
    from app.services.telemetry_store import get_connection

    conditions = []
    params: list = []

    if layer is not None:
        conditions.append("n.layer = %s")
        params.append(layer)
    if enabled:
        conditions.append("n.enabled = TRUE")

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    query = f"""
    SELECT
        n.id,
        n.name,
        n.parent_id,
        n.layer,
        n.node_type,
        n.sort_order,
        n.enabled,
        n.config,
        n.created_at,
        COUNT(t.id) AS tag_count
    FROM t_nodes n
    LEFT JOIN t_tags t ON t.node_id = n.id AND t.enabled = TRUE
    {where}
    GROUP BY n.id, n.name, n.parent_id, n.layer, n.node_type, n.sort_order, n.enabled, n.config, n.created_at
    ORDER BY n.layer, n.sort_order, n.name
    """

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                columns = [desc[0] for desc in cur.description]
                rows = [dict(zip(columns, row)) for row in cur.fetchall()]

        return {
            "nodes": [_serialize_node(r) for r in rows],
            "total": len(rows),
        }
    except Exception as e:
        logger.error("[API/nodes] Query failed: {}", e)
        return {"nodes": [], "total": 0, "error": str(e)}


# ---------------------------------------------------------------------------
# 导入 / 导出 YAML — 注意: 静态路径须先于 /nodes/{node_id} 注册，
# 否则 "export"/"import" 会被当作 UUID 路径参数解析
# ---------------------------------------------------------------------------
@router.get("/nodes/export")
async def export_nodes() -> Response:
    """
    导出整棵节点树为 YAML。每个节点含其挂载的 tags（点位）。

    结构: 顶层为 Site 列表，children 递归嵌套；tags 内联在各节点下。
    可用于备份 / 迁移 / 版本管理。
    """
    from app.services.telemetry_store import get_connection

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, parent_id, layer, node_type, config, sort_order, enabled
                    FROM t_nodes WHERE enabled = TRUE
                    ORDER BY layer, sort_order, name
                    """
                )
                ncols = [desc[0] for desc in cur.description]
                nodes = {str(r[0]): dict(zip(ncols, r)) for r in cur.fetchall()}

                cur.execute(
                    """
                    SELECT node_id, name, display_name, data_type, tag_type, unit,
                           source_type, source_path, scale_factor, value_offset,
                           formula, formula_type, aggregate_fn, read_write, sort_order
                    FROM t_tags WHERE enabled = TRUE
                    ORDER BY sort_order, name
                    """
                )
                tcols = [desc[0] for desc in cur.description]
                tags_by_node: dict[str, list] = {}
                for r in cur.fetchall():
                    tag = dict(zip(tcols, r))
                    nid = str(tag.pop("node_id"))
                    tag = {k: v for k, v in tag.items() if v is not None}
                    tags_by_node.setdefault(nid, []).append(tag)

        children_map: dict[str | None, list] = {}
        for nid, n in nodes.items():
            pid = str(n["parent_id"]) if n["parent_id"] else None
            children_map.setdefault(pid, []).append(nid)

        def _node_yaml(nid: str) -> dict:
            n = nodes[nid]
            out: dict = {"name": n["name"], "layer": n["layer"]}
            if n["node_type"]:
                out["node_type"] = n["node_type"]
            if n["config"]:
                out["config"] = n["config"]
            if tags_by_node.get(nid):
                out["tags"] = tags_by_node[nid]
            kids = [_node_yaml(c) for c in children_map.get(nid, [])]
            if kids:
                out["children"] = kids
            return out

        roots = [_node_yaml(nid) for nid in children_map.get(None, [])]
        doc = {"version": 1, "nodes": roots}
        text = yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, default_flow_style=False)
        return Response(
            content=text,
            media_type="application/x-yaml",
            headers={"Content-Disposition": "attachment; filename=node_tree.yaml"},
        )
    except Exception as e:
        logger.error("[API/nodes] Export failed: {}", e)
        raise HTTPException(status_code=500, detail=f"Export failed: {e}")


@router.get("/nodes/{node_id}")
async def get_node(node_id: UUID) -> dict:
    """获取单个节点详情（含其 tags 列表）。"""
    from app.services.telemetry_store import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Node info
            cur.execute(
                "SELECT id, name, parent_id, layer, node_type, sort_order, enabled, config, created_at "
                "FROM t_nodes WHERE id = %s",
                (node_id,),
            )
            row = cur.fetchone()
            if not row:
                return {"error": "Node not found"}

            node = _serialize_node(dict(zip(
                ["id", "name", "parent_id", "layer", "node_type", "sort_order", "enabled", "config", "created_at"],
                row,
            )))

            # Tags under this node
            cur.execute(
                "SELECT id, name, display_name, data_type, tag_type, unit, "
                "scale_factor, value_offset, source_path, read_write, enabled "
                "FROM t_tags WHERE node_id = %s AND enabled = TRUE "
                "ORDER BY sort_order, name",
                (node_id,),
            )
            tag_columns = [desc[0] for desc in cur.description]
            tags = []
            for r in cur.fetchall():
                tag = dict(zip(tag_columns, r))
                tag["id"] = str(tag["id"])
                tags.append(tag)

    return {"node": node, "tags": tags}


@router.put("/nodes/{node_id}")
async def update_node(node_id: UUID, req: NodeUpdateRequest) -> dict:
    """更新节点配置（部分更新），用于规则绑定等场景。"""
    from app.services.telemetry_store import get_connection

    updates = []
    params: list = []
    data = req.model_dump(exclude_none=True)
    for field, value in data.items():
        if field == "config":
            updates.append("config = %s")
            params.append(value)
        else:
            updates.append(f"{field} = %s")
            params.append(value)

    if not updates:
        return await get_node(node_id)

    updates.append("updated_at = %s")
    params.append(datetime.now(timezone.utc))
    params.append(node_id)

    query = f"UPDATE t_nodes SET {', '.join(updates)} WHERE id = %s RETURNING id, name, parent_id, layer, node_type, sort_order, enabled, config, created_at"
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Node not found")
                conn.commit()
                columns = [desc[0] for desc in cur.description]
                return {"node": _serialize_node(dict(zip(columns, row)))}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/nodes] update failed: {}", e)
        raise HTTPException(status_code=500, detail=str(e))
