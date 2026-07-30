"""F3 聚合器单元测试 (用 fake cursor，无需真实 DB)。"""
from __future__ import annotations

from uuid import uuid4

from app.services.aggregator import _SQL_AGG, _compute_aggregate


class FakeCursor:
    """记录 execute 调用并返回预设 fetchone 结果。"""

    def __init__(self, result):
        self._result = result
        self.last_sql = None
        self.last_params = None

    def execute(self, sql, params=None):
        self.last_sql = sql
        self.last_params = params

    def fetchone(self):
        return self._result


def test_sql_agg_mapping():
    """SUM/AVG/MAX/MIN/COUNT 均映射到 v.value 表达式；LAST 不在字典中。"""
    assert _SQL_AGG["SUM"] == "SUM(v.value)"
    assert _SQL_AGG["AVG"] == "AVG(v.value)"
    assert _SQL_AGG["MAX"] == "MAX(v.value)"
    assert _SQL_AGG["MIN"] == "MIN(v.value)"
    assert _SQL_AGG["COUNT"] == "COUNT(v.value)"
    assert "LAST" not in _SQL_AGG


def test_compute_sum():
    """SUM 分支: 返回外层聚合值，SQL 含 DISTINCT ON 子查询。"""
    cur = FakeCursor((123.5,))
    val = _compute_aggregate(cur, "SUM", [uuid4(), uuid4()])
    assert val == 123.5
    assert "SUM(v.value)" in cur.last_sql
    assert "DISTINCT ON (tag_id)" in cur.last_sql


def test_compute_last():
    """LAST 分支: 取时间戳最新一行，SQL 为 ORDER BY ts DESC LIMIT 1。"""
    cur = FakeCursor((88.0,))
    val = _compute_aggregate(cur, "LAST", [uuid4()])
    assert val == 88.0
    assert "ORDER BY ts DESC" in cur.last_sql
    assert "LIMIT 1" in cur.last_sql


def test_compute_unknown_fn_returns_none():
    """未知聚合函数 → None，不执行 SQL。"""
    cur = FakeCursor((1.0,))
    assert _compute_aggregate(cur, "MEDIAN", [uuid4()]) is None


def test_compute_no_data_returns_none():
    """fetchone 返回 None (无数据) → None。"""
    cur = FakeCursor(None)
    assert _compute_aggregate(cur, "SUM", [uuid4()]) is None
