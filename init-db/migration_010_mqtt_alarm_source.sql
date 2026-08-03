-- migration_010_mqtt_alarm_source.sql
-- 为 MQTT 分级告警增加来源追踪字段，支持 error1/error2/error3 分组去重

ALTER TABLE t_alarms
    ADD COLUMN IF NOT EXISTS source_topic TEXT,
    ADD COLUMN IF NOT EXISTS source_key TEXT,
    ADD COLUMN IF NOT EXISTS external_id TEXT;

COMMENT ON COLUMN t_alarms.source_topic IS 'MQTT 来源主题';
COMMENT ON COLUMN t_alarms.source_key IS '告警分组键，如 error1/error2/error3';
COMMENT ON COLUMN t_alarms.external_id IS '告警唯一标识，如点位名或设备编码';

CREATE INDEX IF NOT EXISTS idx_alarms_source ON t_alarms(source_topic, source_key, external_id) WHERE resolved_at IS NULL;
