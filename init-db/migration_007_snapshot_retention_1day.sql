-- migration_007_snapshot_retention_1day.sql
-- t_node_snapshot 保留策略调整为只保留最近 1 天 (原 30 天)
-- 压缩策略从 7 天调整为 6 小时, 保证在 1 天保留期内先生效

SELECT remove_retention_policy('t_node_snapshot', if_exists => TRUE);
SELECT add_retention_policy('t_node_snapshot', INTERVAL '1 day', if_not_exists => TRUE);

SELECT remove_compression_policy('t_node_snapshot', if_exists => TRUE);
SELECT add_compression_policy('t_node_snapshot', INTERVAL '6 hours', if_not_exists => TRUE);
