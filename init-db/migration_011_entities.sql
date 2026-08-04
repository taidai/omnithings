-- ============================================================
-- F4 全局实体 (Global Entity) 支持
-- 目的：把业务语义（如 pcs.activePower）与具体物理/虚拟点位解耦，
--       适应多品牌设备工况，实体全局可用于实时数据、历史数据、规则引擎。
-- ============================================================

-- ═════════════════════════════════════════════════════════════
-- 1. t_entities: 全局实体表
-- ═════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS t_entities (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL UNIQUE,          -- 实体全局名，如 pcs.activePower
    display_name  TEXT,                          -- 显示名，如 "PCS 有功功率"
    entity_type   TEXT NOT NULL CHECK (entity_type IN ('R', 'W', 'RW')),  -- 读写权限
    data_type     TEXT NOT NULL CHECK (data_type IN ('FLOAT', 'INT', 'BOOL', 'STRING', 'ENUM')),
    unit          TEXT,
    category      TEXT,                          -- 分类，如 pcs / bms / meter / env
    description   TEXT,
    enabled       BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entities_name ON t_entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_category ON t_entities(category);
CREATE INDEX IF NOT EXISTS idx_entities_enabled ON t_entities(enabled);

COMMENT ON TABLE t_entities IS '全局实体表 - 业务语义层，解耦多品牌设备点位差异';

-- ═════════════════════════════════════════════════════════════
-- 2. t_entity_bindings: 实体 ↔ 点位绑定表
-- ═════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS t_entity_bindings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id     UUID NOT NULL REFERENCES t_entities(id) ON DELETE CASCADE,
    tag_id        UUID NOT NULL REFERENCES t_tags(id) ON DELETE CASCADE,
    node_id       UUID NOT NULL REFERENCES t_nodes(id) ON DELETE CASCADE,
    binding_type  TEXT NOT NULL CHECK (binding_type IN ('PHYSICAL', 'VIRTUAL')),
    brand         TEXT,                          -- 品牌/设备型号，用于多品牌切换
    priority      INT DEFAULT 1,                 -- 同一实体多绑定时优先级，数字小优先
    enabled       BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE(entity_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_bindings_entity ON t_entity_bindings(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_bindings_tag ON t_entity_bindings(tag_id);
CREATE INDEX IF NOT EXISTS idx_entity_bindings_node ON t_entity_bindings(node_id);
CREATE INDEX IF NOT EXISTS idx_entity_bindings_priority ON t_entity_bindings(entity_id, priority);

COMMENT ON TABLE t_entity_bindings IS '实体与点位绑定表 - 支持 R/W/RW 实体绑定物理或虚拟点位';

-- ═════════════════════════════════════════════════════════════
-- 3. t_entity_telemetry_latest: 实体最新值缓存表（可选加速）
-- 由 pipeline 在写入 t_telemetry_latest 后同步 upsert，避免实时查询时 JOIN。
-- ═════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS t_entity_telemetry_latest (
    entity_id     UUID PRIMARY KEY REFERENCES t_entities(id) ON DELETE CASCADE,
    binding_id    UUID REFERENCES t_entity_bindings(id) ON DELETE SET NULL,
    tag_id        UUID REFERENCES t_tags(id) ON DELETE CASCADE,
    node_id       UUID REFERENCES t_nodes(id) ON DELETE CASCADE,
    ts            TIMESTAMPTZ NOT NULL,
    value_float   FLOAT,
    value_int     BIGINT,
    value_bool    BOOLEAN,
    value_str     TEXT,
    quality       SMALLINT DEFAULT 192,
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_telemetry_latest_entity ON t_entity_telemetry_latest(entity_id);

COMMENT ON TABLE t_entity_telemetry_latest IS '实体最新值缓存表 - 加速实时数据/规则引擎输入';
