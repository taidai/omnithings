"""
F2 Rules API — 规则管理

POST   /api/v1/rules              → 创建规则
GET    /api/v1/rules              → 规则列表
GET    /api/v1/rules/{id}/jdm      → 获取 JDM 内容
PUT    /api/v1/rules/{id}/jdm      → 更新 JDM 内容（热更新）
DELETE /api/v1/rules/{id}           → 删除规则
POST   /api/v1/rules/{id}/simulate → 模拟规则（给定上下文，看是否触发/动作）
"""
from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field

from app.services.rule_engine import _eval_condition

router = APIRouter()


class RuleCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, description="规则名（唯一）")
    rule_type: str = Field(..., pattern="^(alarm|control|linkage)$", description="规则类型")
    jdm_content: dict = Field(..., description="规则 JDM 内容 {when: str, actions: list}")
    enabled: bool = Field(True, description="是否启用")


class RuleUpdateRequest(BaseModel):
    jdm_content: dict = Field(..., description="规则 JDM 内容")
    enabled: bool | None = Field(None, description="是否启用")


class RuleSimulateRequest(BaseModel):
    context: dict = Field(default_factory=dict, description="模拟上下文 {tag_name: value}")


@router.post("/rules")
async def create_rule(req: RuleCreateRequest) -> dict:
    """创建规则。"""
    from app.services.telemetry_store import get_connection

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO t_rules (name, rule_type, jdm_content, enabled)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id
                    """,
                    (req.name, req.rule_type, json.dumps(req.jdm_content), req.enabled),
                )
                new_id = cur.fetchone()[0]
                conn.commit()

        logger.info("[API/rules] created rule id={} name={} type={}", new_id, req.name, req.rule_type)
        return {"status": "ok", "id": str(new_id)}
    except Exception as e:
        logger.error("[API/rules] Create failed: {}", e)
        raise HTTPException(status_code=500, detail=f"Create failed: {e}")


@router.get("/rules")
async def list_rules() -> dict:
    """列出所有规则。"""
    from app.services.telemetry_store import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, rule_type, jdm_content, enabled, created_at
                FROM t_rules
                ORDER BY created_at DESC
                """
            )
            rows = cur.fetchall()

    rules = []
    for row in rows:
        rid, name, rule_type, jdm, enabled, created_at = row
        rules.append({
            "id": str(rid),
            "name": name,
            "rule_type": rule_type,
            "jdm_content": jdm if isinstance(jdm, dict) else json.loads(jdm),
            "enabled": enabled,
            "created_at": created_at.isoformat() if created_at else None,
        })

    return {"rules": rules, "total": len(rules)}


@router.get("/rules/{rule_id}/jdm")
async def get_rule_jdm(rule_id: UUID) -> dict:
    """获取规则 JDM 内容。"""
    from app.services.telemetry_store import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, rule_type, jdm_content, enabled FROM t_rules WHERE id = %s",
                (rule_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Rule not found")

    rid, name, rule_type, jdm, enabled = row
    return {
        "id": str(rid),
        "name": name,
        "rule_type": rule_type,
        "jdm_content": jdm if isinstance(jdm, dict) else json.loads(jdm),
        "enabled": enabled,
    }


@router.put("/rules/{rule_id}/jdm")
async def update_rule_jdm(rule_id: UUID, req: RuleUpdateRequest) -> dict:
    """热更新规则 JDM 与启用状态。"""
    from app.services.telemetry_store import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM t_rules WHERE id = %s", (rule_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Rule not found")

            updates = []
            params = []
            if req.jdm_content is not None:
                updates.append("jdm_content = %s")
                params.append(json.dumps(req.jdm_content))
            if req.enabled is not None:
                updates.append("enabled = %s")
                params.append(req.enabled)
            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update")

            params.append(rule_id)
            cur.execute(
                f"UPDATE t_rules SET {', '.join(updates)} WHERE id = %s",
                tuple(params),
            )
            conn.commit()

    logger.info("[API/rules] updated rule id={}", rule_id)
    return {"status": "ok", "id": str(rule_id)}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: UUID) -> dict:
    """删除规则。"""
    from app.services.telemetry_store import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM t_rules WHERE id = %s", (rule_id,))
            conn.commit()

    logger.info("[API/rules] deleted rule id={}", rule_id)
    return {"status": "ok", "id": str(rule_id)}


@router.post("/rules/{rule_id}/simulate")
async def simulate_rule(rule_id: UUID, req: RuleSimulateRequest) -> dict:
    """给定上下文模拟规则是否触发。"""
    from app.services.telemetry_store import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT rule_type, jdm_content FROM t_rules WHERE id = %s",
                (rule_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Rule not found")

    rule_type, jdm = row
    content = jdm if isinstance(jdm, dict) else json.loads(jdm)
    when = content.get("when", "")

    try:
        triggered = _eval_condition(when, req.context)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Evaluation failed: {e}")

    return {
        "rule_id": str(rule_id),
        "rule_type": rule_type,
        "when": when,
        "context": req.context,
        "triggered": triggered,
        "actions": content.get("actions", []),
    }
