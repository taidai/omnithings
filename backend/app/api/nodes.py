"""
OmniThings Nodes API — 节点树引擎 (M1 / F3)

只读:
  GET    /api/v1/nodes              → 节点列表 (含 tag 数量统计)
  GET    /api/v1/nodes/{id}         → 单节点详情 (含 tags)
  GET    /api/v1/nodes/{id}/tree    → 递归树 (5 层)
写:
  POST   /api/v1/nodes              → 创建节点
  PUT    /api/v1/nodes/{id}         → 更新节点 (部分)
  DELETE /api/v1/nodes/{id}         → 删除节点 (级联 t_tags, 根节点禁删)
导入导出:
  GET    /api/v1/nodes/export       → 导出整棵树为 YAML
  POST   /api/v1/nodes/import       → 从 YAML 导入节点树
"""
from __future__ import annotations

import json
from uuid import UUID

import yaml
from fastapi import APIRouter, HTTPException, Query, Response
from loguru import logger

from app.models.schemas import NodeCreate, NodeUpdate

router = APIRouter()

# 级联深度上限 (G3 审查 R2) — 防循环依赖 / 超深树
MAX_CASCADE_DEPTH = 5


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
        n.created_at,
        COUNT(t.id) AS tag_count
    FROM t_nodes n
    LEFT JOIN t_tags t ON t.node_id = n.id AND t.enabled = TRUE
    {where}
    GROUP BY n.id, n.name, n.parent_id, n.layer, n.node_type, n.sort_order, n.enabled, n.created_at
    ORDER BY n.layer, n.sort_order, n.name
    """

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                columns = [desc[0] for desc in cur.description]
                rows = [dict(zip(columns, row)) for row in cur.fetchall()]

        # UUID → str for JSON serialization
        for row in rows:
            row["id"] = str(row["id"])
            if row.get("parent_id"):
                row["parent_id"] = str(row["parent_id"])
            if row.get("created_at"):
                row["created_at"] = row["created_at"].isoformat()

        return {
            "nodes": rows,
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
                "SELECT id, name, parent_id, layer, node_type, sort_order, enabled, created_at "
                "FROM t_nodes WHERE id = %s",
                (node_id,),
            )
            row = cur.fetchone()
            if not row:
                return {"error": "Node not found"}

            node = dict(zip(
                ["id", "name", "parent_id", "layer", "node_type", "sort_order", "enabled", "created_at"],
                row,
            ))
            node["id"] = str(node["id"])
            if node["parent_id"]:
                node["parent_id"] = str(node["parent_id"])
            node["created_at"] = node["created_at"].isoformat()

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


# ---------------------------------------------------------------------------
# 树形结构 — 递归构建 5 层节点树
# ---------------------------------------------------------------------------
@router.get("/nodes/{node_id}/tree")
async def get_node_tree(node_id: UUID) -> dict:
    """
    以 node_id 为根，递归构建其下整棵子树 (最大 5 层)。

    单次查询取出候选节点全集，在内存中组装成树，避免 N+1 查询。
    MAX_CASCADE_DEPTH 防御异常深树 / 循环 parent_id。
    """
    from app.services.telemetry_store import get_connection

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                # 一次性拉取全部启用节点 + tag_count（树规模有限，全量载入内存组装）
                cur.execute(
                    """
                    SELECT n.id, n.name, n.parent_id, n.layer, n.node_type,
                           n.config, n.sort_order, n.enabled,
                           n.created_at, n.updated_at,
                           COUNT(t.id) AS tag_count
                    FROM t_nodes n
                    LEFT JOIN t_tags t ON t.node_id = n.id AND t.enabled = TRUE
                    WHERE n.enabled = TRUE
                    GROUP BY n.id
                    ORDER BY n.sort_order, n.name
                    """
                )
                cols = [desc[0] for desc in cur.description]
                all_nodes = {str(r[0]): dict(zip(cols, r)) for r in cur.fetchall()}

        if str(node_id) not in all_nodes:
            raise HTTPException(status_code=404, detail="Node not found")

        # parent_id → [children] 索引
        children_map: dict[str, list] = {}
        for nid, n in all_nodes.items():
            pid = str(n["parent_id"]) if n["parent_id"] else None
            children_map.setdefault(pid, []).append(nid)

        def _serialize(n: dict) -> dict:
            return {
                "id": str(n["id"]),
                "name": n["name"],
                "parent_id": str(n["parent_id"]) if n["parent_id"] else None,
                "layer": n["layer"],
                "node_type": n["node_type"],
                "config": n["config"] or {},
                "sort_order": n["sort_order"],
                "enabled": n["enabled"],
                "tag_count": n["tag_count"],
                "children": [],
            }

        def _build(nid: str, depth: int) -> dict:
            node = _serialize(all_nodes[nid])
            if depth >= MAX_CASCADE_DEPTH:
                logger.warning("[API/nodes] tree depth limit reached at node {}", nid)
                return node
            for child_id in children_map.get(nid, []):
                node["children"].append(_build(child_id, depth + 1))
            return node

        tree = _build(str(node_id), 1)
        return {"tree": tree}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/nodes] Build tree failed: {}", e)
        raise HTTPException(status_code=500, detail=f"Build tree failed: {e}")


# ---------------------------------------------------------------------------
# 创建 / 更新 / 删除
# ---------------------------------------------------------------------------
@router.post("/nodes", status_code=201)
async def create_node(payload: NodeCreate) -> dict:
    """
    创建节点。父节点存在性校验 + 层级关系校验 (子层级须 = 父层级 + 1)。
    """
    from app.services.telemetry_store import get_connection

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                # 校验父节点 (若指定)
                if payload.parent_id is not None:
                    cur.execute(
                        "SELECT layer FROM t_nodes WHERE id = %s", (payload.parent_id,)
                    )
                    prow = cur.fetchone()
                    if not prow:
                        raise HTTPException(status_code=400, detail="Parent node not found")
                    if payload.layer != prow[0] + 1:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Layer mismatch: child layer must be {prow[0] + 1} (parent layer {prow[0]} + 1)",
                        )
                elif payload.layer != 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Root node (no parent) must be layer 1 (Site)",
                    )

                cur.execute(
                    """
                    INSERT INTO t_nodes (name, parent_id, layer, node_type, config, sort_order, enabled)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, name, parent_id, layer, node_type, config, sort_order, enabled, created_at
                    """,
                    (
                        payload.name,
                        payload.parent_id,
                        payload.layer,
                        payload.node_type,
                        json.dumps(payload.config),
                        payload.sort_order,
                        payload.enabled,
                    ),
                )
                row = cur.fetchone()
                conn.commit()
                cols = [desc[0] for desc in cur.description]

        node = dict(zip(cols, row))
        node["id"] = str(node["id"])
        if node["parent_id"]:
            node["parent_id"] = str(node["parent_id"])
        node["created_at"] = node["created_at"].isoformat()
        logger.info("[API/nodes] Created node {} (layer {})", node["id"], node["layer"])
        return {"node": node}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/nodes] Create failed: {}", e)
        raise HTTPException(status_code=500, detail=f"Create failed: {e}")


@router.put("/nodes/{node_id}")
async def update_node(node_id: UUID, payload: NodeUpdate) -> dict:
    """部分更新节点。仅更新 payload 中显式提供 (非 None) 的字段。"""
    from app.services.telemetry_store import get_connection

    updates: list[str] = []
    params: list = []
    data = payload.model_dump(exclude_unset=True)

    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    for field, value in data.items():
        if field == "config":
            updates.append("config = %s")
            params.append(json.dumps(value))
        else:
            updates.append(f"{field} = %s")
            params.append(value)

    updates.append("updated_at = NOW()")
    params.append(node_id)

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE t_nodes SET {', '.join(updates)} WHERE id = %s "
                    "RETURNING id, name, parent_id, layer, node_type, config, sort_order, enabled, updated_at",
                    params,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Node not found")
                conn.commit()
                cols = [desc[0] for desc in cur.description]

        node = dict(zip(cols, row))
        node["id"] = str(node["id"])
        if node["parent_id"]:
            node["parent_id"] = str(node["parent_id"])
        node["updated_at"] = node["updated_at"].isoformat()
        logger.info("[API/nodes] Updated node {}", node["id"])
        return {"node": node}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/nodes] Update failed: {}", e)
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


@router.delete("/nodes/{node_id}")
async def delete_node(node_id: UUID) -> dict:
    """
    删除节点。高风险级联操作 —— t_tags 通过 ON DELETE CASCADE 一并删除，
    子节点因 parent_id 自引用亦被数据库级联删除。

    安全约束: 根节点 (layer=1, 无 parent) 禁止删除。
    """
    from app.services.telemetry_store import get_connection

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT layer, parent_id FROM t_nodes WHERE id = %s", (node_id,)
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Node not found")
                layer, parent_id = row
                if layer == 1 and parent_id is None:
                    raise HTTPException(
                        status_code=403, detail="Root node (Site) cannot be deleted"
                    )

                # 统计将被级联删除的子孙节点数 (递归 CTE)，供日志/返回
                cur.execute(
                    """
                    WITH RECURSIVE subtree AS (
                        SELECT id FROM t_nodes WHERE id = %s
                        UNION ALL
                        SELECT n.id FROM t_nodes n JOIN subtree s ON n.parent_id = s.id
                    )
                    SELECT COUNT(*) FROM subtree
                    """,
                    (node_id,),
                )
                affected = cur.fetchone()[0]

                cur.execute("DELETE FROM t_nodes WHERE id = %s", (node_id,))
                conn.commit()

        logger.warning(
            "[API/nodes] Deleted node {} (cascade removed {} node(s) + their tags)",
            node_id, affected,
        )
        return {"deleted": str(node_id), "cascade_nodes": affected}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/nodes] Delete failed: {}", e)
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")


# ---------------------------------------------------------------------------
# 导入 YAML — 递归写入节点树 (+ 内联 tags)
# ---------------------------------------------------------------------------
@router.post("/nodes/import")
async def import_nodes(payload: dict) -> dict:
    """
    从 YAML/JSON 结构导入节点树。请求体为 export 端点导出的同构结构:

        {"version": 1, "nodes": [{name, layer, node_type?, config?, tags?, children?}, ...]}

    递归创建节点 (parent_id 逐层串联) 与内联 tags。整个导入在单事务内完成，
    任一步失败则全部回滚。MAX_CASCADE_DEPTH 防御异常深树。

    注意: 导入为「新增」语义，不做去重 / upsert；重复导入会产生重名节点。
    """
    from app.services.telemetry_store import get_connection

    roots = payload.get("nodes") or []
    if not isinstance(roots, list):
        raise HTTPException(status_code=400, detail="Invalid payload: 'nodes' must be a list")

    counter = {"nodes": 0, "tags": 0}

    def _insert_node(cur, node: dict, parent_id, depth: int):
        if depth > MAX_CASCADE_DEPTH:
            raise HTTPException(
                status_code=400,
                detail=f"Tree depth exceeds limit ({MAX_CASCADE_DEPTH})",
            )
        name = node.get("name")
        layer = node.get("layer")
        if not name or layer is None:
            raise HTTPException(status_code=400, detail="Each node requires 'name' and 'layer'")

        cur.execute(
            """
            INSERT INTO t_nodes (name, parent_id, layer, node_type, config, sort_order, enabled)
            VALUES (%s, %s, %s, %s, %s, %s, TRUE)
            RETURNING id
            """,
            (
                name,
                parent_id,
                layer,
                node.get("node_type"),
                json.dumps(node.get("config") or {}),
                node.get("sort_order", 0),
            ),
        )
        new_id = cur.fetchone()[0]
        counter["nodes"] += 1

        # 内联 tags
        for tag in node.get("tags") or []:
            cur.execute(
                """
                INSERT INTO t_tags (node_id, name, display_name, data_type, tag_type, unit,
                                    source_type, source_path, scale_factor, value_offset,
                                    formula, formula_type, aggregate_fn, read_write, sort_order, enabled)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                """,
                (
                    new_id,
                    tag.get("name"),
                    tag.get("display_name"),
                    tag.get("data_type", "FLOAT"),  # 大写: t_tags CHECK 约束仅允许 FLOAT/INT/BOOL/STRING/ENUM
                    tag.get("tag_type", "PHYSICAL"),
                    tag.get("unit"),
                    tag.get("source_type"),
                    tag.get("source_path"),
                    tag.get("scale_factor"),
                    tag.get("value_offset"),
                    tag.get("formula"),
                    tag.get("formula_type"),
                    tag.get("aggregate_fn"),
                    tag.get("read_write", "R"),
                    tag.get("sort_order", 0),
                ),
            )
            counter["tags"] += 1

        # 递归子节点
        for child in node.get("children") or []:
            _insert_node(cur, child, new_id, depth + 1)

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                for root in roots:
                    _insert_node(cur, root, None, 1)
                conn.commit()
        logger.info(
            "[API/nodes] Imported {} node(s), {} tag(s)",
            counter["nodes"], counter["tags"],
        )
        return {"imported_nodes": counter["nodes"], "imported_tags": counter["tags"]}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API/nodes] Import failed: {}", e)
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")
