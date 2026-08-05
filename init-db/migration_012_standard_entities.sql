-- ============================================================
-- F5 国家标准 / 国际标准内置全局实体
-- 目的：开箱即用提供光伏、储能、充电桩统一业务语义层，
--       减少多品牌设备接入时的重复建模。
-- 参考：GB/T 19964、GB/T 36558、GB/T 18487.1、IEC 61850-7-420、IEC 61851
-- ============================================================

-- ═════════════════════════════════════════════════════════════
-- 1. 扩展 t_entities：增加系统实体标记
-- ═════════════════════════════════════════════════════════════
ALTER TABLE t_entities ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN t_entities.is_system IS '系统内置实体，不允许删除/修改核心元数据';

-- ═════════════════════════════════════════════════════════════
-- 2. 内置标准实体（幂等插入，已存在同名实体则跳过）
-- ═════════════════════════════════════════════════════════════
INSERT INTO t_entities (id, name, display_name, entity_type, data_type, unit, category, description, enabled, is_system)
VALUES
  -- 光伏 (PV)
  (gen_random_uuid(), 'pv.activePower',       '光伏有功功率',    'R',  'FLOAT',  'kW',   'pv',      'GB/T 19964 / IEC 61850-7-420 光伏发电有功功率',                    TRUE, TRUE),
  (gen_random_uuid(), 'pv.reactivePower',     '光伏无功功率',    'R',  'FLOAT',  'kVar', 'pv',      'GB/T 19964 光伏发电无功功率',                                      TRUE, TRUE),
  (gen_random_uuid(), 'pv.powerFactor',       '光伏功率因数',    'R',  'FLOAT',  NULL,   'pv',      'GB/T 19964 光伏功率因数',                                          TRUE, TRUE),
  (gen_random_uuid(), 'pv.voltage',           '光伏并网电压',    'R',  'FLOAT',  'V',    'pv',      'GB/T 19964 光伏并网电压',                                          TRUE, TRUE),
  (gen_random_uuid(), 'pv.current',           '光伏并网电流',    'R',  'FLOAT',  'A',    'pv',      'GB/T 19964 光伏并网电流',                                          TRUE, TRUE),
  (gen_random_uuid(), 'pv.frequency',         '光伏并网频率',    'R',  'FLOAT',  'Hz',   'pv',      'GB/T 19964 光伏并网频率',                                          TRUE, TRUE),
  (gen_random_uuid(), 'pv.irradiance',        '光伏辐照度',      'R',  'FLOAT',  'W/m²', 'pv',      'IEC 61850-7-420 水平面辐照度',                                     TRUE, TRUE),
  (gen_random_uuid(), 'pv.moduleTemp',        '组件温度',        'R',  'FLOAT',  '°C',   'pv',      'IEC 61850-7-420 光伏组件温度',                                     TRUE, TRUE),
  (gen_random_uuid(), 'pv.ambientTemp',       '环境温度',        'R',  'FLOAT',  '°C',   'pv',      'IEC 61850-7-420 光伏环境温度',                                     TRUE, TRUE),
  (gen_random_uuid(), 'pv.dailyEnergy',       '光伏日发电量',    'R',  'FLOAT',  'kWh',  'pv',      'GB/T 19964 光伏日发电量',                                          TRUE, TRUE),
  (gen_random_uuid(), 'pv.totalEnergy',       '光伏累计发电量',  'R',  'FLOAT',  'kWh',  'pv',      'GB/T 19964 光伏累计发电量',                                        TRUE, TRUE),
  (gen_random_uuid(), 'pv.status',            '逆变器状态',      'R',  'INT',    NULL,   'pv',      'GB/T 19964 / IEC 61850-7-420 逆变器运行状态',                      TRUE, TRUE),
  (gen_random_uuid(), 'pv.faultCode',         '光伏故障代码',    'R',  'STRING', NULL,   'pv',      'GB/T 19964 光伏故障代码',                                          TRUE, TRUE),

  -- 储能 (ESS)
  (gen_random_uuid(), 'ess.activePower',      '储能有功功率',    'R',  'FLOAT',  'kW',   'ess',     'GB/T 36558 电化学储能系统有功功率（充电为负，放电为正）',         TRUE, TRUE),
  (gen_random_uuid(), 'ess.reactivePower',    '储能无功功率',    'R',  'FLOAT',  'kVar', 'ess',     'GB/T 36558 电化学储能系统无功功率',                                TRUE, TRUE),
  (gen_random_uuid(), 'ess.soc',              '电池 SOC',        'R',  'FLOAT',  '%',    'ess',     'GB/T 36558 电池荷电状态 SOC',                                       TRUE, TRUE),
  (gen_random_uuid(), 'ess.soh',              '电池 SOH',        'R',  'FLOAT',  '%',    'ess',     'GB/T 36558 电池健康状态 SOH',                                       TRUE, TRUE),
  (gen_random_uuid(), 'ess.voltage',          '电池总电压',      'R',  'FLOAT',  'V',    'ess',     'GB/T 36558 电池堆/簇总电压',                                        TRUE, TRUE),
  (gen_random_uuid(), 'ess.current',          '电池总电流',      'R',  'FLOAT',  'A',    'ess',     'GB/T 36558 电池堆/簇总电流',                                        TRUE, TRUE),
  (gen_random_uuid(), 'ess.maxCellTemp',      '最高单体温度',    'R',  'FLOAT',  '°C',   'ess',     'GB/T 36558 电池最高单体温度',                                       TRUE, TRUE),
  (gen_random_uuid(), 'ess.minCellTemp',      '最低单体温度',    'R',  'FLOAT',  '°C',   'ess',     'GB/T 36558 电池最低单体温度',                                       TRUE, TRUE),
  (gen_random_uuid(), 'ess.maxCellVoltage',   '最高单体电压',    'R',  'FLOAT',  'V',    'ess',     'GB/T 36558 电池最高单体电压',                                       TRUE, TRUE),
  (gen_random_uuid(), 'ess.minCellVoltage',   '最低单体电压',    'R',  'FLOAT',  'V',    'ess',     'GB/T 36558 电池最低单体电压',                                       TRUE, TRUE),
  (gen_random_uuid(), 'ess.chargeEnergy',     '累计充电电量',    'R',  'FLOAT',  'kWh',  'ess',     'GB/T 36558 电化学储能累计充电电量',                                 TRUE, TRUE),
  (gen_random_uuid(), 'ess.dischargeEnergy',  '累计放电电量',    'R',  'FLOAT',  'kWh',  'ess',     'GB/T 36558 电化学储能累计放电电量',                                 TRUE, TRUE),
  (gen_random_uuid(), 'ess.status',           '储能系统状态',    'R',  'INT',    NULL,   'ess',     'GB/T 36558 电化学储能系统运行状态',                                 TRUE, TRUE),
  (gen_random_uuid(), 'ess.mode',             '储能运行模式',    'RW', 'STRING', NULL,   'ess',     'GB/T 36558 电化学储能系统运行模式（调度/削峰填谷/需量控制等）',     TRUE, TRUE),
  (gen_random_uuid(), 'ess.faultCode',        '储能故障代码',    'R',  'STRING', NULL,   'ess',     'GB/T 36558 电化学储能系统故障代码',                                 TRUE, TRUE),

  -- 充电桩 (Charger)
  (gen_random_uuid(), 'charger.connectorStatus', '充电枪连接状态', 'R', 'INT',    NULL,   'charger', 'GB/T 18487.1 / IEC 61851 充电枪连接状态',                          TRUE, TRUE),
  (gen_random_uuid(), 'charger.chargingPower',   '充电功率',       'R', 'FLOAT',  'kW',   'charger', 'GB/T 18487.1 充电桩实时充电功率',                                   TRUE, TRUE),
  (gen_random_uuid(), 'charger.chargingCurrent', '充电电流',       'R', 'FLOAT',  'A',    'charger', 'GB/T 18487.1 充电桩实时充电电流',                                   TRUE, TRUE),
  (gen_random_uuid(), 'charger.chargingVoltage', '充电电压',       'R', 'FLOAT',  'V',    'charger', 'GB/T 18487.1 充电桩实时充电电压',                                   TRUE, TRUE),
  (gen_random_uuid(), 'charger.soc',             '车辆 SOC',       'R', 'FLOAT',  '%',    'charger', 'GB/T 18487.1 车辆电池 SOC',                                          TRUE, TRUE),
  (gen_random_uuid(), 'charger.chargedEnergy',   '已充电量',       'R', 'FLOAT',  'kWh',  'charger', 'GB/T 18487.1 本次已充电量',                                          TRUE, TRUE),
  (gen_random_uuid(), 'charger.connectorTemp',   '充电枪温度',     'R', 'FLOAT',  '°C',   'charger', 'GB/T 18487.1 充电枪温度',                                            TRUE, TRUE),
  (gen_random_uuid(), 'charger.faultCode',       '充电桩故障代码', 'R', 'STRING', NULL,   'charger', 'GB/T 18487.1 充电桩故障代码',                                        TRUE, TRUE),
  (gen_random_uuid(), 'charger.startCharging',   '启动充电',       'W', 'BOOL',   NULL,   'charger', 'GB/T 18487.1 / IEC 61851 启动充电控制指令',                         TRUE, TRUE),
  (gen_random_uuid(), 'charger.stopCharging',    '停止充电',       'W', 'BOOL',   NULL,   'charger', 'GB/T 18487.1 / IEC 61851 停止充电控制指令',                         TRUE, TRUE)
ON CONFLICT (name) DO NOTHING;

-- 为系统实体建立索引以加速按分类过滤
CREATE INDEX IF NOT EXISTS idx_entities_is_system ON t_entities(is_system);
