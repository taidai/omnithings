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
    return f"[{source_key}] {external_id} 告警"


def _iter_alarms(payload: dict[str, Any]) -> list[dict[str, Any]]:
    alarms: list[dict[str, Any]] = []
    for key, value in payload.items():
        if key not in ERROR_LEVELS:
            continue
        level = ERROR_GROUP_MAP[key]
        if isinstance(value, dict):
            for external_id, val in value.items():
                alarms.append({
                    "source_key": key,
                    "external_id": str(external_id),
                    "level": level,
                    "value": val,
                })
        elif isinstance(value, list):
            for item in value:
                if item is None or item == "":
                    continue
                alarms.append({
                    "source_key": key,
                    "external_id": str(item),
                    "level": level,
                    "value": 1,
                })
        else:
            alarms.append({
                "source_key": key,
                "external_id": str(value),
                "level": level,
                "value": 1,
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

    alarms = _iter_alarms(payload)
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

