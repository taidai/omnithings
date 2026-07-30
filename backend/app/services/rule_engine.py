"""
F2 规则引擎 — 告警/控制/联动策略

职责：
  - 每 tick 扫描启用的 t_rules
  - 从 t_telemetry_latest 构建上下文（tag_name -> value）
  - 对每条规则求值 when 条件
  - 触发动作：
      alarm     → 写入 t_alarms（同一规则未恢复时不再重复创建）
      control   → 经 MQTT 发布控制命令 + 写入 t_audit_log
      linkage   → 更新指定虚拟点位的 sources 或触发另一规则（MVP 未实现）

条件语法：
  - 使用 tag_name 作为变量，如 `bms_current > -1000`
  - 支持 + - * / // % ** 、比较、and/or/not
  - 安全 AST 求值，禁止函数调用和未声明变量
"""
from __future__ import annotations

import ast
import json
import operator
from datetime import datetime, timezone, timedelta
from uuid import UUID

from loguru import logger

# 允许的二元/比较/一元运算符
_ALLOWED_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_ALLOWED_COMP_OPS = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
}
_ALLOWED_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
    ast.Not: operator.not_,
}


def _eval_condition(condition: str, context: dict[str, float | bool | int | str]) -> bool:
    """
    安全求值 when 条件，返回布尔结果。

    未声明的变量 / 非法节点都会抛 ValueError，视为 False 并记录日志。
    """
    tree = ast.parse(condition, mode='eval')
    return bool(_eval_node(tree.body, context))


def _eval_node(node: ast.AST, ctx: dict) -> float | bool | int | str:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body, ctx)

    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float, bool, str)):
            return node.value
        raise ValueError(f"unsupported constant type: {type(node.value)}")

    if isinstance(node, ast.Num):  # py<3.8
        return node.n

    if isinstance(node, ast.Name):
        if node.id not in ctx:
            raise ValueError(f"unknown variable: {node.id}")
        return ctx[node.id]

    if isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in _ALLOWED_BIN_OPS:
            raise ValueError(f"disallowed binary operator: {op_type.__name__}")
        left = _eval_node(node.left, ctx)
        right = _eval_node(node.right, ctx)
        return _ALLOWED_BIN_OPS[op_type](left, right)

    if isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in _ALLOWED_UNARY_OPS:
            raise ValueError(f"disallowed unary operator: {op_type.__name__}")
        operand = _eval_node(node.operand, ctx)
        return _ALLOWED_UNARY_OPS[op_type](operand)

    if isinstance(node, ast.Compare):
        left = _eval_node(node.left, ctx)
        if len(node.ops) != 1 or len(node.comparators) != 1:
            raise ValueError("chained comparisons not supported")
        op_type = type(node.ops[0])
        if op_type not in _ALLOWED_COMP_OPS:
            raise ValueError(f"disallowed comparison operator: {op_type.__name__}")
        right = _eval_node(node.comparators[0], ctx)
        return _ALLOWED_COMP_OPS[op_type](left, right)

    if isinstance(node, ast.BoolOp):
        op_type = type(node.op)
        if op_type is ast.And:
            return all(_eval_node(v, ctx) for v in node.values)
        if op_type is ast.Or:
            return any(_eval_node(v, ctx) for v in node.values)
        raise ValueError(f"disallowed bool operator: {op_type.__name__}")

    raise ValueError(f"unsupported AST node: {type(node).__name__}")


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
            # 尝试将文本转为 bool/数字；失败保持原字符串
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
    """检查指定规则是否存在未恢复（resolved_at IS NULL）且未全部确认的活动告警。"""
    cur.execute(
        "SELECT 1 FROM t_alarms WHERE rule_id = %s AND resolved_at IS NULL LIMIT 1",
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
                    when = content.get("when")
                    actions = content.get("actions", [])
                    if not when or not actions:
                        continue

                    triggered = _eval_condition(when, context)
                    if not triggered:
                        continue

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
