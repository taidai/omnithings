-- ============================================================
-- F6 删除节点快照功能
-- 说明：移除 t_node_snapshot 表、相关 TimescaleDB 策略，
--       并清理 t_node_categories 中与快照相关的字段。
-- ============================================================

-- 1) 移除 t_node_snapshot 的 retention/compression 策略
SELECT remove_retention_policy('t_node_snapshot', if_exists => TRUE);
SELECT remove_compression_policy('t_node_snapshot', if_exists => TRUE);

-- 2) 删除节点快照表
DROP TABLE IF EXISTS t_node_snapshot;

-- 3) 清理 t_node_categories 中的快照相关字段
ALTER TABLE t_node_categories DROP COLUMN IF EXISTS snapshot_enabled;
ALTER TABLE t_node_categories DROP COLUMN IF EXISTS retention_days;
