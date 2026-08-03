-- ============================================================
-- Migration 008: t_alarms 外键级联删除
-- 修复: 删除节点时因 t_alarms 引用 t_nodes/t_tags 无外键级联导致 500
-- ============================================================

-- 删除旧约束（若存在），重新建立带 ON DELETE CASCADE 的外键
ALTER TABLE t_alarms
    DROP CONSTRAINT IF EXISTS t_alarms_node_id_fkey,
    ADD CONSTRAINT t_alarms_node_id_fkey
        FOREIGN KEY (node_id) REFERENCES t_nodes(id) ON DELETE CASCADE;

ALTER TABLE t_alarms
    DROP CONSTRAINT IF EXISTS t_alarms_tag_id_fkey,
    ADD CONSTRAINT t_alarms_tag_id_fkey
        FOREIGN KEY (tag_id) REFERENCES t_tags(id) ON DELETE CASCADE;
