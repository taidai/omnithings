"""
System configuration store.

Runtime-editable key/value settings persisted in t_system_config.
Used for MQTT telemetry topic(s) and other settings that should not require
a container restart or .env edit.
"""
from __future__ import annotations

from app.services.telemetry_store import get_connection


_INIT_SQL = """
CREATE TABLE IF NOT EXISTS t_system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO t_system_config (key, value)
VALUES ('mqtt_telemetry_topic', '/neuron/#')
ON CONFLICT (key) DO NOTHING;
"""


def init_config_table() -> None:
    """Ensure t_system_config exists (idempotent)."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(_INIT_SQL)
                conn.commit()
    except Exception:
        # May be called before DB is ready; callers should handle gracefully
        pass


def get_config(key: str, default: str | None = None) -> str | None:
    """Read a config value by key."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM t_system_config WHERE key = %s", (key,))
                row = cur.fetchone()
                return row[0] if row else default
    except Exception:
        return default


def set_config(key: str, value: str) -> None:
    """Upsert a config value."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO t_system_config (key, value, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                """,
                (key, value),
            )
            conn.commit()


def load_mqtt_topics() -> str | None:
    """Return the persisted MQTT telemetry topic string (comma separated) or None."""
    return get_config("mqtt_telemetry_topic")


def save_mqtt_topics(topic_string: str) -> None:
    """Persist the MQTT telemetry topic string."""
    set_config("mqtt_telemetry_topic", topic_string)
