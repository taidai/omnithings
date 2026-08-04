"""M2.5 - MQTT 分级告警处理器"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from loguru import logger

from app.services.telemetry_store import get_connection

ERROR_GROUP_MAP = {
    "error1": "CRITICAL",
    "error2": "MAJOR",
    "error3": "WARNING",
}

ERROR_LEVELS = {"error1", "error2", "error3"}

# 可能嵌套出现 error1/2/3 的容器字段（兼容标准 Neuron payload 与自定义 payload）
_NESTED_CONTAINER_KEYS = {"values", "tags", "data", "metrics", "payload"}


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


def _build_message(external_id: str, value: Any, source_key: str) -> str:
    if isinstance(value, str) and value.strip():
        return f"[{source_key}] {value}"
    if external_id:
        return f"[{source_key}] {external_id} 告警"
    return f"[{source_key}] 告警触发"


def _iter_error_groups(data: dict[str, Any], _depth: int = 0) -> dict[str, dict[str, Any]]:
    """
    在 payload 中递归收集 error1/error2/error3 分组。
    返回: {source_key: {external_id: value}}
    """
    groups: dict[str, dict[str, Any]] = {k: {} for k in ERROR_LEVELS}
    if not isinstance(data, dict) or _depth > 2:
        return groups

    for key, value in data.items():
        if key in ERROR_LEVELS:
            if isinstance(value, dict):
                for external_id, val in value.items():
                    groups[key][str(external_id)] = val
            elif isinstance(value, list):
                for item in value:
                    if item is None or item == "":
                        continue
                    groups[key][str(item)] = 1
            else:
                # 标量 0/1 或字符串：用空 external_id 作为稳定标识，保证同一信号可恢复
                groups[key][""] = value
        elif key in _NESTED_CONTAINER_KEYS and isinstance(value, dict):
            nested = _iter_error_groups(value, _depth + 1)
            for level in ERROR_LEVELS:
                groups[level].update(nested[level])

    return groups


def _alarms_from_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """把 error groups 展开为告警记录列表。"""
    groups = _iter_error_groups(payload)
    alarms: list[dict[str, Any]] = []
    for source_key, items in groups.items():
        level = ERROR_GROUP_MAP[source_key]
        for external_id, value in items.items():
            alarms.append({
                "source_key": source_key,
                "external_id": external_id,
                "level": level,
                "value": value,
            })
    return alarms


def process_alarm_message(topic: str, payload_bytes: bytes) -> dict:
    try:
        payload = json.loads(payload_bytes.decode("utf-8", errors="replace"))
    except Exception as e:
        logger.warning("[Alarm] Invalid JSON on topic {}: {}", topic, e)
        return {"created": 0, "resolved": 0, "skipped": 1}

    if not isinstance(payload, dict):
        logger.debug("[Alarm] Non-dict payload on topic {}", topic)
        return {"created": 0, "resolved": 0, "skipped": 1}

    alarms = _alarms_from_payload(payload)
    if not alarms:
        return {"created": 0, "resolved": 0, "skipped": 0}

    created = 0
    resolved = 0
    now = datetime.now(timezone.utc)

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                for alarm in alarms:
                    source_key = alarm["source_key"]
                    external_id = alarm["external_id"]
                    level = alarm["level"]
                    active = _is_active(alarm["value"])

                    cur.execute(
                        "SELECT id, resolved_at FROM t_alarms " +
                        "WHERE source_topic = %s AND source_key = %s AND external_id = %s " +
                        "ORDER BY created_at DESC LIMIT 1",
                        (topic, source_key, external_id),
                    )
                    row = cur.fetchone()

                    if active:
                        if row is None or row[1] is not None:
                            message = _build_message(external_id, alarm["value"], source_key)
                            cur.execute(
                                "INSERT INTO t_alarms (source_topic, source_key, external_id, level, message, created_at) " +
                                "VALUES (%s, %s, %s, %s, %s, %s)",
                                (topic, source_key, external_id, level, message, now),
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
        logger.error("[Alarm] DB processing failed: {}", e)
        return {"created": 0, "resolved": 0, "skipped": len(alarms)}

    logger.debug("[Alarm] topic={} created={} resolved={}", topic, created, resolved)
    return {"created": created, "resolved": resolved, "skipped": 0}
