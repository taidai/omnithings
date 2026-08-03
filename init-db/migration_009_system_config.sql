-- Migration 009: system configuration table
-- Used for runtime-editable settings (e.g. MQTT telemetry topics) without restarting containers.

CREATE TABLE IF NOT EXISTS t_system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO t_system_config (key, value)
VALUES ('mqtt_telemetry_topic', '/neuron/#')
ON CONFLICT (key) DO NOTHING;
