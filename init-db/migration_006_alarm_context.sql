-- migration_006_alarm_context.sql
-- 为 t_alarms 增加触发上下文字段（节点/点位/触发值）

ALTER TABLE t_alarms
    ADD COLUMN IF NOT EXISTS tag_id UUID REFERENCES t_tags(id),
    ADD COLUMN IF NOT EXISTS trigger_tag_name TEXT,
    ADD COLUMN IF NOT EXISTS trigger_value DOUBLE PRECISION;

COMMENT ON COLUMN t_alarms.tag_id IS '触发告警的点位 ID';
COMMENT ON COLUMN t_alarms.trigger_tag_name IS '触发告警的点位名';
COMMENT ON COLUMN t_alarms.trigger_value IS '触发告警时的点位值';
