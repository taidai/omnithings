"""
Tag Alarm Engine — 基于点位 alarm_level 与 fault_map 生成告警。

逻辑：
  - 当点位的 alarm_level 为 error1/error2/error3 且当前值为"激活"状态时，
    向 t_alarms 写入一条未恢复告警；
  - 当值变为"非激活"时，将同一点位同级别的最新未恢复告警标记为已恢复；
  - 若点位绑定了 fault_map，则优先使用故障码映射生成 message。
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from loguru import logger

from app.services.telemetry_store import get_connection

ERROR_GROUP_MAP = {
    "error1": "CRITICAL",
    "error2": "MAJOR",
    "error3": "WARNING",
}

ERROR_LEVELS = {"error1", "error2", "error3"}


def _is_active(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip() != "" and value.strip().lower() not in {"0", "false", "off", "no"}
    return bool(value)


def _extract_value(record: dict) -> Any:
    """从 TelemetryRecord 字典中还原工程值。"""
    if record.get("value_str") is not None:
        return record["value_str"]
    if record.get("value_bool") is not None:
        return record["value_bool"]
    if record.get("value_int") is not None:
        return record["value_int"]
    if record.get("value_float") is not None:
        return record["value_float"]
    return None


def _code_str(value: Any) -> str:
    """将点位值标准化为故障码字符串。"""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "1" if value else "0"
    return str(value).strip()


def _resolve_message(tag_name: str, alarm_level: str, value: Any, entries: list[dict] | None) -> str:
    """生成告警消息：优先匹配故障码映射表，否则使用默认描述。"""
    code = _code_str(value)
    if entries:
        for entry in entries:
            if str(entry.get("code", "")).strip() == code:
                return f"[{alarm_level}] {tag_name}: {entry.get('message', code)}"
    return f"[{alarm_level}] {tag_name} 告警 (值: {code})"


def process_tag_alarms(records: list, tag_meta: dict[UUID, dict]) -> dict:
    """
    批量处理点位告警。

    Args:
        records: TelemetryRecord 列表（或兼容 dict）
        tag_meta: {tag_id: {"alarm_level": ..., "tag_name": ..., "fault_map_entries": [...]}}

    Returns:
        {"created": int, "resolved": int}
    """
    created = 0
    resolved = 0
    now = datetime.now(timezone.utc)

    if not records or not tag_meta:
        return {"created": 0, "resolved": 0}

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                for record in records:
                    tag_id = str(record.get("tag_id"))
                    meta = tag_meta.get(tag_id)
                    if not meta:
                        continue

                    alarm_level = meta.get("alarm_level")
                    if alarm_level not in ERROR_LEVELS:
                        continue

                    value = _extract_value(record)
                    active = _is_active(value)
                    level = ERROR_GROUP_MAP[alarm_level]
                    source_key = alarm_level
                    tag_name = meta.get("tag_name") or "unknown"
                    node_id = record.get("node_id")
                    trigger_value = None
                    if isinstance(value, (int, float)):
                        trigger_value = float(value)

                    cur.execute(
                        "SELECT id, resolved_at FROM t_alarms "
                        "WHERE tag_id = %s AND source_key = %s "
                        "ORDER BY created_at DESC LIMIT 1",
                        (tag_id, source_key),
                    )
                    row = cur.fetchone()

                    if active:
                        if row is None or row[1] is not None:
                            message = _resolve_message(
                                tag_name, alarm_level, value, meta.get("fault_map_entries")
                            )
                            cur.execute(
                                "INSERT INTO t_alarms (tag_id, node_id, source_key, external_id, "
                                "level, message, trigger_tag_name, trigger_value, created_at) "
                                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                                (
                                    tag_id,
                                    node_id,
                                    source_key,
                                    tag_name,
                                    level,
                                    message,
                                    tag_name,
                                    trigger_value,
                                    now,
                                ),
                            )
                            created += 1
                    else:
                        if row is not None and row[1] is None:
                            cur.execute(
                                "UPDATE t_alarms SET resolved_at = %s WHERE id = %s",
                                (now, row[0]),
                            )
                            resolved += 1

            conn.commit()
    except Exception as e:
        logger.error("[TagAlarmEngine] process failed: {}", e)
        return {"created": 0, "resolved": 0}

    logger.debug("[TagAlarmEngine] created={} resolved={}", created, resolved)
    return {"created": created, "resolved": resolved}
