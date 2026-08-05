-- ============================================================
-- F7 告警分级与故障码转义
-- 目的：
--   1. 支持批量将点位标记为 error1 / error2 / error3 三级告警源；
--   2. 支持通过故障码映射表将点位值转义为可读故障描述。
-- ============================================================

-- 1) 故障码映射表
CREATE TABLE IF NOT EXISTS t_fault_maps (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL UNIQUE,
    description   TEXT,
    entries       JSONB NOT NULL DEFAULT '[]',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE t_fault_maps IS '故障码映射表 - 用于点位值转义为故障描述';

-- 2) 点位扩展：告警级别 + 故障码映射
ALTER TABLE t_tags
    ADD COLUMN IF NOT EXISTS alarm_level TEXT CHECK (alarm_level IN ('error1', 'error2', 'error3')),
    ADD COLUMN IF NOT EXISTS fault_map_id UUID REFERENCES t_fault_maps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tags_alarm_level ON t_tags(alarm_level);
CREATE INDEX IF NOT EXISTS idx_tags_fault_map  ON t_tags(fault_map_id);
