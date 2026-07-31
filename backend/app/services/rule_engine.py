"""
F2 规则引擎 — 告警/控制/联动策略

职责：
  - 每 tick 扫描启用的 t_rules
  - 从 t_telemetry_latest 构建上下文（tag_name -> value）
  - 对每条规则通过 GoRules zen-engine 求值
  - 触发动作：
      alarm     -> 写入 t_alarms（同一规则未恢复时不再重复创建）
      control   -> 经 MQTT 发布控制命令 + 写入 t_audit_log
      linkage   -> 更新指定虚拟点位的 sources 或触发另一规则（MVP 未实现）

求值层：
  - 优先使用 GoRules zen-engine（import zen）
  - zen-engine 不可用时自动 fallback 到安全 AST 求值器
  - 兼容简化格式 {when, actions} 和标准 JDM {nodes, edges, actions}
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import UUID

from loguru import logger

from app.services.gorules_adapter import evaluate_rule


def _build_context(cur) -> dict[str, float | bool | int | str]:
    """从 t_telemetry_latest 构建 tag_name -> value 上下文。"""
    cur.execute(
        """
        SELECT t.name, l.value_float, l.value_int, l.value_bool, l.value_str
        FROM t_telemetry_latest l
        JOIN t_tags t ON t.id = l.tag_id
        """
    )
    ctx: dict[str, float | bool | int | str] = {}
    for name, value_float, value_int, value_bool, value_str in cur.fetchall():
        if value_bool is not None:
            ctx[name] = value_bool
        elif value_str is not None:
            if value_str.lower() in ("true", "false"):
                ctx[name] = value_str.lower() == "true"
            else:
                try:
                    if "." in value_str:
                        ctx[name] = float(value_str)
                    else:
                        ctx[name] = int(value_str)
                except ValueError:
                    ctx[name] = value_str
        elif value_float is not None:
            ctx[name] = value_float
        elif value_int is not None:
            ctx[name] = value_int
    return ctx


def _has_active_alarm(cur, rule_id: UUID) -> bool:
    cur.execute(
        """
        SELECT 1 FROM t_alarms
        WHERE rule_id = %s AND resolved_at IS NULL
        LIMIT 1
        """,
        (rule_id,),
    )
    return cur.fetchone() is not None


def _create_alarm(cur, rule_id: UUID, node_id: UUID | None, level: str, message: str) -> None:
    cur.execute(
        """
        INSERT INTO t_alarms (rule_id, node_id, level, message, created_at)
        VALUES (%s, %s, %s, %s, now())
        """,
        (rule_id, node_id, level, message),
    )


def _log_audit(cur, action: str, target_type: str, target_id: str | UUID | None, details: dict) -> None:
    cur.execute(
        """
        INSERT INTO t_audit_log (user_id, action, target_type, target_id, details, created_at)
        VALUES (%s, %s, %s, %s, %s, now())
        """,
        ("system", action, target_type, target_id, json.dumps(details)),
    )


# 内存级控制冷却，避免同一规则每秒都发命令
_last_control_ts: dict[UUID, datetime] = {}


def _control_cooldown_ok(rule_id: UUID, cooldown: int = 60) -> bool:
    last = _last_control_ts.get(rule_id)
    now = datetime.now(timezone.utc)
    if last is None or (now - last).total_seconds() >= cooldown:
        _last_control_ts[rule_id] = now
        return True
    return False


def _execute_control(cur, rule_id: UUID, action: dict, context: dict) -> bool:
    """执行控制动作：发布 MQTT 命令并记录审计日志。"""
    from app.services.mqtt_client import get_mqtt_client

    command = action.get("command", {})
    topic = command.get("topic")
    payload = command.get("payload")
    if not topic or payload is None:
        logger.warning("[RuleEngine] control action missing topic/payload: {}", action)
        return False

    mqtt_client = get_mqtt_client()
    if mqtt_client is None:
        logger.warning("[RuleEngine] MQTT client not available, control skipped")
        return False

    try:
        payload_str = json.dumps(payload, ensure_ascii=False)
        mqtt_client.publish(topic, payload_str)
    except Exception as e:
        logger.error("[RuleEngine] MQTT publish failed for control action: {}", e)
        return False

    _log_audit(cur, "RPC", "device", action.get("target_id"), {
        "rule_id": str(rule_id),
        "topic": topic,
        "payload": payload,
        "context": {k: v for k, v in context.items() if isinstance(v, (int, float, bool, str))},
    })
    return True


def run_rule_tick() -> dict[str, int]:
    """
    执行一次 F2 规则 tick。

    Returns:
        {"evaluated": N, "alarms": N, "controls": N, "errors": N}
    """
    from app.services.telemetry_store import get_connection

    result = {"evaluated": 0, "alarms": 0, "controls": 0, "errors": 0}

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, rule_type, jdm_content, enabled
                FROM t_rules
                WHERE enabled = TRUE
                """
            )
            rules = cur.fetchall()
            if not rules:
                return result

            context = _build_context(cur)

            for rule_id, rule_type, jdm_content, enabled in rules:
                result["evaluated"] += 1
                try:
                    content = jdm_content if isinstance(jdm_content, dict) else json.loads(jdm_content)
                    eval_result = evaluate_rule(content, context)

                    if eval_result.get("error"):
                        logger.warning(
                            "[RuleEngine] rule {} evaluation error ({}): {}",
                            rule_id,
                            eval_result.get("engine"),
                            eval_result["error"],
                        )

                    if not eval_result.get("triggered"):
                        continue

                    actions = eval_result.get("actions", [])
                    for action in actions:
                        a_type = action.get("type")
                        if a_type == "alarm":
                            level = action.get("level", "WARNING")
                            message = action.get("message", f"rule {rule_id} triggered")
                            target_node_id = action.get("node_id")
                            if not _has_active_alarm(cur, rule_id):
                                _create_alarm(cur, rule_id, target_node_id, level, message)
                                result["alarms"] += 1
                        elif a_type == "control":
                            if _control_cooldown_ok(rule_id, action.get("cooldown", 60)):
                                if _execute_control(cur, rule_id, action, context):
                                    result["controls"] += 1
                        else:
                            logger.debug("[RuleEngine] unsupported action type: {}", a_type)
                except Exception as e:
                    result["errors"] += 1
                    logger.warning("[RuleEngine] rule {} evaluation failed: {}", rule_id, e)

            conn.commit()

    if any(v for k, v in result.items() if k != "evaluated"):
        logger.debug("[RuleEngine] tick result: {}", result)
    return result
