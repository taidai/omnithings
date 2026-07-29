-- ============================================================
-- OmniThings - t_node_snapshot 节点快照表 (数据黑板)
-- 创建时间: 2026-07-29
-- 说明: 按时间戳对齐的节点全量数据快照, 支持黑板模式查询
-- ============================================================

-- 节点快照表: 每个节点每个时间戳一条记录, 包含全量点位值
CREATE TABLE IF NOT EXISTS t_node_snapshot (
    ts           TIMESTAMPTZ NOT NULL,
    node_id      UUID NOT NULL REFERENCES t_nodes(id) ON DELETE CASCADE,
    node_name    TEXT,
    data         JSONB,           -- 全量工程值 {tag_name: eng_value, ...}
    raw_data     JSONB,           -- 全量原始值 {tag_name: raw_value, ...}
    raw_message  JSONB,           -- 全量原始报文 (Neuron MQTT payload)
    quality      SMALLINT DEFAULT 192,
    created_at   TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ts, node_id)
);

-- 转换为 TimescaleDB Hypertable
SELECT create_hypertable('t_node_snapshot', 'ts', if_not_exists => TRUE);

-- 索引: 按节点查询最新快照
CREATE INDEX IF NOT EXISTS idx_snapshot_node_ts ON t_node_snapshot(node_id, ts DESC);

-- 索引: JSONB 数据查询 (GIN)
CREATE INDEX IF NOT EXISTS idx_snapshot_data ON t_node_snapshot USING GIN(data);
CREATE INDEX IF NOT EXISTS idx_snapshot_raw_data ON t_node_snapshot USING GIN(raw_data);

COMMENT ON TABLE t_node_snapshot IS 'OmniThings 节点快照表 - 数据黑板: 每个时间戳记录节点全量点位值(JSONB)+原始报文(JSONB)';
COMMENT ON COLUMN t_node_snapshot.data IS '全量工程值快照 {tag_name: eng_value, ...}';
COMMENT ON COLUMN t_node_snapshot.raw_data IS '全量原始值快照 {tag_name: raw_value, ...}';
COMMENT ON COLUMN t_node_snapshot.raw_message IS '原始 MQTT 报文 (Neuron 推送的完整 payload)';
COMMENT ON COLUMN t_node_snapshot.quality IS 'OPC UA Quality: 192=GOOD, 64=UNCERTAIN, 0=BAD';

-- 压缩策略: 7 天后压缩
ALTER TABLE t_node_snapshot SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'node_id',
    timescaledb.compress_orderby = 'ts DESC'
);

SELECT add_compression_policy('t_node_snapshot', INTERVAL '7 days');

-- 保留策略: 30 天
SELECT add_retention_policy('t_node_snapshot', INTERVAL '30 days');
