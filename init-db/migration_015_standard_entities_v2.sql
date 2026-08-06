-- ============================================================
-- F5 标准实体 v2：按《光储充管理平台标准字段清单》扩展内置实体目录
-- 新增 std_field / std_ref 列，回溯文档字段名与标准号。
-- 实体数据由 app/core/standard_entities.py 在启动时幂等播种（单一数据源），
-- 本迁移仅负责 schema 列与索引，避免 SQL/Python 数据漂移。
-- ============================================================

ALTER TABLE t_entities ADD COLUMN IF NOT EXISTS std_field TEXT;
ALTER TABLE t_entities ADD COLUMN IF NOT EXISTS std_ref TEXT;

COMMENT ON COLUMN t_entities.std_field IS '回溯标准文档字段名，如 ess_soc';
COMMENT ON COLUMN t_entities.std_ref  IS '回溯标准号，如 GB/T 36558';

CREATE INDEX IF NOT EXISTS idx_entities_std_field ON t_entities(std_field);
