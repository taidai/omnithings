"""
F1 公式引擎 — LogicalTag 表达式/条件求值

职责：
  - 每 tick 扫描所有 formula_type='expression' / 'condition' 的启用 LogicalTag
  - 从 t_telemetry_latest 读取其 sources 最新值
  - 用安全 AST 求值公式，结果作为虚拟点位写回 t_telemetry + t_telemetry_latest
  - 与 F3 聚合器解耦：F1 产出虚拟点，F3 在下一轮 tick 将其作为上层聚合来源

公式约定：
  - 用 s0, s1, s2 ... 依次引用 sources[0], sources[1], sources[2] ...
  - 例：sources=[tag_a, tag_b], formula='s0 * 2 + s1'
  - condition 公式结果为布尔值，应挂载到 data_type='BOOL' 的 LogicalTag

安全限制：
  - 仅允许 + - * / // % ** 、比较运算、一元正负、逻辑 and/or/not
  - 禁用函数调用、属性访问、lambda、name 加载（只允许 sN 和常量）
"""
from __future__ import annotations

import ast
import operator
from datetime import datetime, timezone
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


def _safe_eval(formula: str, ctx: dict[str, float]) -> float | bool:
    """
    对公式做安全 AST 求值。

    Args:
        formula: 表达式字符串，如 's0 * 2 + s1' 或 's0 > 100 and s1 < 50'
        ctx: 变量映射，如 {'s0': 12.5, 's1': -1435.0}

    Returns:
        数值或布尔结果
    """
    tree = ast.parse(formula, mode='eval')
    return _eval_node(tree.body, ctx)


def _eval_node(node: ast.AST, ctx: dict[str, float]) -> float | bool:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body, ctx)

    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float, bool)):
            return node.value
        raise ValueError(f"unsupported constant type: {type(node.value)}")

    if isinstance(node, ast.Num):  # py<3.8
        return node.n

    if isinstance(node, ast.Name):
        if not node.id.startswith("s"):
            raise ValueError(f"disallowed name: {node.id}")
        try:
            idx = int(node.id[1:])
        except ValueError:
            raise ValueError(f"invalid source variable: {node.id}")
        key = f"s{idx}"
        if key not in ctx:
            raise ValueError(f"missing source variable: {key}")
        return ctx[key]

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


def run_formula_tick() -> int:
    """
    执行一次 F1 公式 tick。返回本次写入的虚拟点位行数。

    同步函数 (psycopg2)，由调度器在线程池 / executor 中调用。
    """
    from app.services.telemetry_store import get_connection
    from psycopg2.extras import execute_values

    written = 0
    now = datetime.now(timezone.utc)

    with get_connection() as conn:
        with conn.cursor() as cur:
            # 1) 取出所有需要求值的 LogicalTag
            cur.execute(
                """
                SELECT id, node_id, name, data_type, formula_type, formula, sources
                FROM t_tags
                WHERE tag_type = 'LOGICAL'
                  AND formula_type IN ('expression', 'condition')
                  AND enabled = TRUE
                  AND formula IS NOT NULL
                  AND sources IS NOT NULL
                  AND array_length(sources, 1) > 0
                """
            )
            formula_tags = cur.fetchall()

            if not formula_tags:
                return 0

            # 2) 一次性读取所有 source 最新值
            all_source_ids = set()
            for tag_id, node_id, name, data_type, formula_type, formula, sources in formula_tags:
                all_source_ids.update(sources or [])

            source_values: dict[UUID, float] = {}
            if all_source_ids:
                cur.execute(
                    """
                    SELECT tag_id, COALESCE(value_float, value_int::float) AS value
                    FROM t_telemetry_latest
                    WHERE tag_id = ANY(%s)
                    """,
                    (list(all_source_ids),),
                )
                source_values = {row[0]: row[1] for row in cur.fetchall()}

            # 3) 逐条求值并构造写入行
            rows_to_write: list[tuple] = []
            for tag_id, node_id, name, data_type, formula_type, formula, sources in formula_tags:
                ctx: dict[str, float] = {}
                missing = False
                for i, src_id in enumerate(sources or []):
                    val = source_values.get(src_id)
                    if val is None:
                        missing = True
                        break
                    ctx[f"s{i}"] = val

                if missing:
                    continue

                try:
                    result = _safe_eval(formula, ctx)
                except Exception as e:
                    logger.warning("[FormulaEngine] Failed to evaluate formula for tag {} ({}): {}", tag_id, formula, e)
                    continue

                # 4) 按目标 data_type / formula_type 落库
                value_float = value_int = value_bool = value_str = None
                if formula_type == "condition":
                    value_bool = bool(result)
                elif data_type == "INT":
                    value_int = int(result)
                elif data_type == "BOOL":
                    value_bool = bool(result)
                elif data_type == "STRING":
                    value_str = str(result)
                else:  # FLOAT / 默认
                    value_float = float(result)

                rows_to_write.append(
                    (now, node_id, tag_id, value_float, value_int, value_bool, value_str, True, 192)
                )

            # 5) 写入历史 hypertable + 最新值缓存表
            if rows_to_write:
                execute_values(
                    cur,
                    """
                    INSERT INTO t_telemetry (ts, node_id, tag_id, value_float, value_int,
                                             value_bool, value_str, is_virtual, quality)
                    VALUES %s
                    ON CONFLICT DO NOTHING
                    """,
                    rows_to_write,
                )
                written = cur.rowcount

                latest_rows = [
                    (node_id, tag_id, ts, vf, vi, vb, vs, True, 192)
                    for (ts, node_id, tag_id, vf, vi, vb, vs, _, _) in rows_to_write
                ]
                execute_values(
                    cur,
                    """
                    INSERT INTO t_telemetry_latest (node_id, tag_id, ts, value_float, value_int,
                                                    value_bool, value_str, is_virtual, quality)
                    VALUES %s
                    ON CONFLICT (node_id, tag_id) DO UPDATE SET
                        ts = EXCLUDED.ts,
                        value_float = EXCLUDED.value_float,
                        value_int = EXCLUDED.value_int,
                        value_bool = EXCLUDED.value_bool,
                        value_str = EXCLUDED.value_str,
                        is_virtual = EXCLUDED.is_virtual,
                        quality = EXCLUDED.quality,
                        updated_at = now();
                    """,
                    latest_rows,
                )
                conn.commit()

    if written:
        logger.debug("[FormulaEngine] tick wrote {} virtual points", written)
    return written
