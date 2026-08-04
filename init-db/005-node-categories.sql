-- ============================================================
-- ZiZu - t_node_categories 节点大类表
-- 创建时间: 2026-07-30
-- 说明: 按节点大类配置快照/保留策略
-- ============================================================

-- 节点大类配置表
CREATE TABLE IF NOT EXISTS t_node_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,        -- "电表", "PCS", "BMS", "环境"
    node_type       TEXT NOT NULL,               -- 对应 t_nodes.node_type
    snapshot_enabled BOOLEAN DEFAULT TRUE,       -- 是否启用快照
    retention_days  INT DEFAULT 30,              -- 快照保留天数
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE t_node_categories IS '节点大类配置表 - 按节点类型配置快照/保留策略';

-- t_nodes 增加 category_id 关联
ALTER TABLE t_nodes ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES t_node_categories(id);
ALTER TABLE t_nodes ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

COMMENT ON COLUMN t_nodes.category_id IS '关联的节点大类，NULL 表示未分类';
COMMENT ON COLUMN t_nodes.config IS '节点级配置，覆盖大类默认配置';

-- 插入默认大类
INSERT INTO t_node_categories (name, node_type, snapshot_enabled, retention_days, description) VALUES
('电表', 'Meter', TRUE, 90, '电力监测电表，数据保留90天'),
('PCS', 'PCS', TRUE, 30, '储能变流器，数据保留30天'),
('BMS', 'BMS', TRUE, 30, '电池管理系统，数据保留30天'),
('环境', 'Environment', FALSE, 7, '环境传感器，不启用快照')
ON CONFLICT (name) DO NOTHING;
