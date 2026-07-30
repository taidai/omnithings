"""
F3 聚合器 (M5 / M8) — LogicalTag 汇总聚合调度

职责：
  - 每 tick (默认 10s) 扫描所有 formula_type='aggregate' 的启用 LogicalTag
  - 按 aggregate_fn (SUM/AVG/MAX/MIN/COUNT/LAST) 汇总其 sources 点位的最新值
  - 计算结果作为虚拟点位 (is_virtual=True) 写回 t_telemetry
  - 供节点树逐层汇总 (子层 → 父层) 使用

设计要点：
  - 纯 SQL 直算，零 Python 循环压力 (一次查询取全部 sources 最新值)
  - 单向依赖：LogicalTag 只引用其它 tag 的历史落库值，不做递归实时展开，
    因此天然避免循环；多层汇总靠 tick 间隔逐层收敛 (10s 内传播一层)
  - MAX_CASCADE_DEPTH 由节点树引擎 (nodes.py) 保证，本聚合器不再重复校验
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from loguru import logger

# SQL 侧聚合函数映射 (COUNT/LAST 特殊处理)
_SQL_AGG = {
    "SUM": "SUM(v.value)",
    "AVG": "AVG(v.value)",
    "MAX": "MAX(v.value)",
    "MIN": "MIN(v.value)",
    "COUNT": "COUNT(v.value)",
}


def run_aggregation_tick() -> int:
    """
    执行一次聚合 tick。返回本次写入的虚拟点位行数。

    同步函数 (psycopg2)，由调度器在线程池 / executor 中调用。
    """
    from app.services.telemetry_store import get_connection

    written = 0
    now = datetime.now(timezone.utc)

    with get_connection() as conn:
        with conn.cursor() as cur:
            # 1) 取出所有需要聚合的 LogicalTag
            cur.execute(
                """
                SELECT id, node_id, name, aggregate_fn, sources
                FROM t_tags
                WHERE tag_type = 'LOGICAL'
                  AND formula_type = 'aggregate'
                  AND enabled = TRUE
                  AND aggregate_fn IS NOT NULL
                  AND sources IS NOT NULL
                  AND array_length(sources, 1) > 0
                """
            )
            logical_tags = cur.fetchall()

            if not logical_tags:
                return 0

            rows_to_write: list[tuple] = []

            for tag_id, node_id, name, agg_fn, sources in logical_tags:
                value = _compute_aggregate(cur, agg_fn, sources)
                if value is None:
                    continue
                # (ts, node_id, tag_id, value_float, value_int, value_bool,
                #  value_str, is_virtual, quality)
                rows_to_write.append(
                    (now, node_id, tag_id, float(value), None, None, None, True, 192)
                )

            if rows_to_write:
                from psycopg2.extras import execute_values

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
                conn.commit()

    if written:
        logger.debug("[Aggregator] tick wrote {} virtual points", written)
    return written


def _compute_aggregate(cur, agg_fn: str, sources: list[UUID]) -> float | None:
    """
    对 sources 点位的最新值执行聚合。

    先用 DISTINCT ON 取每个 source tag 的最新一行，再在外层做聚合。
    LAST = 所有 source 中时间戳最新的那个值。
    """
    if agg_fn == "LAST":
        cur.execute(
            """
            SELECT COALESCE(value_float, value_int::float) AS value
            FROM t_telemetry
            WHERE tag_id = ANY(%s)
            ORDER BY ts DESC
            LIMIT 1
            """,
            (sources,),
        )
        row = cur.fetchone()
        return row[0] if row and row[0] is not None else None

    sql_fn = _SQL_AGG.get(agg_fn)
    if sql_fn is None:
        return None

    cur.execute(
        f"""
        SELECT {sql_fn}
        FROM (
            SELECT DISTINCT ON (tag_id)
                   COALESCE(value_float, value_int::float) AS value
            FROM t_telemetry
            WHERE tag_id = ANY(%s)
            ORDER BY tag_id, ts DESC
        ) v
        """,
        (sources,),
    )
    row = cur.fetchone()
    return row[0] if row and row[0] is not None else None
