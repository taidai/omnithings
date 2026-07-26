-- F0 本地验证: 测试节点 + 点位 (对应 e606 现网 en9 设备拓扑)
-- 在 001-schema.sql 之后执行

-- 清旧测试数据 (幂等)
DELETE FROM t_telemetry WHERE true;
DELETE FROM t_tags WHERE true;
DELETE FROM t_nodes WHERE true;

-- ═══ 节点树: Site → Station → EnergyNode → Device ═══
INSERT INTO t_nodes (id, name, parent_id, layer, node_type) VALUES
('11111111-1111-1111-1111-111111111111', '测试场站', NULL, 1, 'SITE'),
('22222222-2222-2222-2222-222222222222', '1号并网点', '11111111-1111-1111-1111-111111111111', 2, 'STATION'),
('33333333-3333-3333-3333-333333333333', '储能系统', '22222222-2222-2222-2222-222222222222', 3, 'ESS'),
('44444444-4444-4444-4444-444444444444', 'en9_meter', '22222222-2222-2222-2222-222222222222', 4, 'METER'),
('55555555-5555-5555-5555-555555555555', 'en9_bms', '33333333-3333-3333-3333-333333333333', 4, 'BMS');

-- ═══ 物理点位 (与 parser 输出字段名对应) ═══
INSERT INTO t_tags (id, node_id, tag_type, data_type, name, display_name, unit, scale_factor, value_offset) VALUES
-- en9_meter 电表
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'PHYSICAL', 'FLOAT', 'meter_p_act', '有功功率', 'kW', 1.0, 0.0),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab', '44444444-4444-4444-4444-444444444444', 'PHYSICAL', 'FLOAT', 'meter_voltage', '电压', 'V', 1.0, 0.0),
-- en9_bms (含现网校准公式: scale=0.1, offset=-1600)
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'PHYSICAL', 'FLOAT', 'bms_current', 'BMS电流', 'A', 0.1, -1600.0),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbc', '55555555-5555-5555-5555-555555555555', 'PHYSICAL', 'FLOAT', 'bms_soc', 'SOC', '%', 1.0, 0.0);

-- 验证
SELECT n.name AS node, t.name AS tag, t.scale_factor, t.value_offset
FROM t_tags t JOIN t_nodes n ON t.node_id = n.id ORDER BY n.name, t.name;
