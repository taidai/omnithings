-- Migration: add t_telemetry_latest cache table and backfill from existing t_telemetry
-- Run once on existing deployments; new deployments get this from 001-schema.sql.

CREATE TABLE IF NOT EXISTS t_telemetry_latest (
    node_id     UUID NOT NULL REFERENCES t_nodes(id) ON DELETE CASCADE,
    tag_id      UUID NOT NULL REFERENCES t_tags(id) ON DELETE CASCADE,
    ts          TIMESTAMPTZ NOT NULL,
    value_float FLOAT,
    value_int   BIGINT,
    value_bool  BOOLEAN,
    value_str   TEXT,
    is_virtual  BOOLEAN DEFAULT FALSE,
    quality     SMALLINT DEFAULT 192,
    updated_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (node_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_latest_tag ON t_telemetry_latest(tag_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_latest_node ON t_telemetry_latest(node_id);

-- Backfill latest value per tag from existing history
INSERT INTO t_telemetry_latest (node_id, tag_id, ts, value_float, value_int, value_bool, value_str, is_virtual, quality)
SELECT DISTINCT ON (node_id, tag_id)
    node_id, tag_id, ts, value_float, value_int, value_bool, value_str, is_virtual, quality
FROM t_telemetry
ORDER BY node_id, tag_id, ts DESC
ON CONFLICT (node_id, tag_id) DO UPDATE SET
    ts = EXCLUDED.ts,
    value_float = EXCLUDED.value_float,
    value_int = EXCLUDED.value_int,
    value_bool = EXCLUDED.value_bool,
    value_str = EXCLUDED.value_str,
    is_virtual = EXCLUDED.is_virtual,
    quality = EXCLUDED.quality,
    updated_at = now();
