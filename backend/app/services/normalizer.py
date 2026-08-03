"""
F0 Hook 2 — 数据归一化器 (M3)

职责：将原始采集值转换为工程值。
  - scale * value + offset
  - pint 单位转换 (W→kW, mV→V, Wh→kWh)
  - 字段名映射 (activePower → activePower_kW)
  - 值域校验 (range_min / range_max)
  - **纯函数，无副作用** — 最容易单测

设计原则:
  - 不做 I/O (不查数据库, 不写日志)
  - 输入 ParsedMessage → 输出 NormalizedMessage
  - 归一化规则从 t_tags 配置加载 (由 Pipeline 在调用前注入)
"""
from __future__ import annotations

from typing import Any

from loguru import logger

from app.models.schemas import (
    DataType,
    NormalizedMessage,
    NormalizedPoint,
    ParsedMessage,
    Quality,
)


# ══════════════════════════════════════
# 归一化规则配置
# ══════════════════════════════════════


class TagNormalizationRule:
    """单个点位的归一化规则 (来自 t_tags 表)。"""

    __slots__ = ("tag_name", "data_type", "scale_factor", "offset",
                 "unit_from", "unit_to", "range_min", "range_max")

    def __init__(
        self,
        tag_name: str,
        data_type: DataType = DataType.FLOAT,
        scale_factor: float = 1.0,
        offset: float = 0.0,
        unit_from: str | None = None,
        unit_to: str | None = None,
        range_min: float | None = None,
        range_max: float | None = None,
    ) -> None:
        self.tag_name = tag_name
        self.data_type = data_type
        self.scale_factor = scale_factor
        self.offset = offset
        self.unit_from = unit_from
        self.unit_to = unit_to
        self.range_min = range_min
        self.range_max = range_max


# ══════════════════════════════════════
# 核心归一化函数
# ══════════════════════════════════════


def normalize(
    parsed: ParsedMessage,
    rules: dict[str, TagNormalizationRule] | None = None,
) -> NormalizedMessage:
    """
    归一化一条消息的所有 tags。

    Args:
        parsed: 解析后的消息
        rules: {raw_tag_name: TagNormalizationRule} 映射。
               如果为 None 或某个 tag 无规则，使用默认行为 (scale=1, offset=0)

    Returns:
        NormalizedMessage 包含归一化后的点位列表
    """
    points: list[NormalizedPoint] = []
    rule_map = rules or {}

    for raw_name, raw_value in parsed.tags.items():
        # 跳过非原子类型 (list/dict) — 通常是 Neuron 寄存器读取失败的垃圾数据
        if isinstance(raw_value, (list, dict)):
            logger.debug("[Normalize] Skip non-scalar tag {}={}", raw_name, raw_value)
            continue

        rule = rule_map.get(raw_name)

        if rule is not None:
            point = _apply_rule(raw_name, raw_value, rule, parsed.timestamp)
        else:
            # 无配置 → 自动推断类型, 保持原值
            point = _auto_normalize(raw_name, raw_value, parsed.timestamp)

        if point is not None:
            point.group = parsed.group
            points.append(point)

    return NormalizedMessage(
        source_node=parsed.node_name,
        ts=parsed.timestamp,
        points=points,
    )


def _apply_rule(
    raw_name: str,
    raw_value: Any,
    rule: TagNormalizationRule,
    ts,
) -> NormalizedPoint | None:
    """应用完整归一化规则。"""
    try:
        # Step 1: 类型转换
        value = _coerce_numeric(raw_value)
        if value is None:
            # 非数值类型 (bool/str), 跳过 scale/offset
            return NormalizedPoint(
                node_name="",  # 由 pipeline 后填
                tag_name=rule.tag_name or raw_name,
                value=_coerce_bool_or_str(raw_value),
                data_type=_infer_data_type(raw_value),
                quality=Quality.GOOD,
                ts=ts,
                unit=rule.unit_to or rule.unit_from,
            )

        # Step 2: scale * value + offset
        eng_value = value * rule.scale_factor + rule.offset

        # Step 3: pint 单位转换
        final_unit = rule.unit_to or rule.unit_from
        if rule.unit_from and rule.unit_to and rule.unit_from != rule.unit_to:
            eng_value, final_unit = _unit_convert(eng_value, rule.unit_from, rule.unit_to)

        # Step 4: 值域校验
        quality = Quality.GOOD
        if rule.range_min is not None and eng_value < rule.range_min:
            quality = Quality.UNCERTAIN
        if rule.range_max is not None and eng_value > rule.range_max:
            quality = Quality.UNCERTAIN

        return NormalizedPoint(
            node_name="",
            tag_name=rule.tag_name or raw_name,
            value=round(eng_value, 6),
            data_type=rule.data_type,
            quality=quality,
            ts=ts,
            unit=final_unit,
        )

    except Exception as e:
        logger.warning("[Normalize] Failed for tag={}: {}", raw_name, e)
        return None


def _auto_normalize(
    raw_name: str,
    raw_value: Any,
    ts,
) -> NormalizedPoint:
    """无规则时的自动归一化。"""
    return NormalizedPoint(
        node_name="",
        tag_name=raw_name,
        value=_coerce_bool_or_str(raw_value) if _coerce_numeric(raw_value) is None else raw_value,
        data_type=_infer_data_type(raw_value),
        quality=Quality.GOOD,
        ts=ts,
    )


# ══════════════════════════════════════
# 辅助函数
# ══════════════════════════════════════


def _coerce_numeric(value: Any) -> float | int | None:
    """尝试转为数值, 失败返回 None。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        try:
            if "." in value:
                return float(value)
            return int(value)
        except ValueError:
            return None
    return None


def _coerce_bool_or_str(value: Any) -> bool | str:
    """非数值类型的标准化。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lower = value.lower()
        if lower in ("true", "1", "on"):
            return True
        if lower in ("false", "0", "off"):
            return False
    return str(value)


def _infer_data_type(value: Any) -> DataType:
    """自动推断数据类型。"""
    if isinstance(value, bool):
        return DataType.BOOL
    if isinstance(value, int):
        return DataType.INT
    if isinstance(value, float):
        return DataType.FLOAT
    if isinstance(value, str):
        return DataType.STRING
    return DataType.STRING


# pint UnitRegistry 单例 (创建开销大, 复用是标准做法)
_ureg = None


def _get_ureg():
    """惰性初始化 pint UnitRegistry 单例。"""
    global _ureg
    if _ureg is None:
        import pint

        _ureg = pint.UnitRegistry()
    return _ureg


def _unit_convert(value: float, unit_from: str, unit_to: str) -> tuple[float, str]:
    """
    pint 单位转换。

    仅在 pint 可用时执行; 若不可用则记录 warning 并原样返回。
    """
    try:
        ureg = _get_ureg()
        result = (value * ureg(unit_from)).to(unit_to)
        return result.magnitude, str(result.units)
    except ImportError:
        logger.warning("[Normalize] pint unavailable, skipping conversion {}→{}", unit_from, unit_to)
        return value, unit_to
    except Exception as e:
        logger.warning("[Normalize] Unit conversion failed {}→{}: {}", unit_from, unit_to, e)
        return value, unit_to
