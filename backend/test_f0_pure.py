"""
F0 纯函数单元验证 — 不需要 DB / MQTT

验证 parser + normalizer 的核心逻辑是否正确。
这是 P2-12 (零测试) 的第一个补丁。

运行: python test_f0_pure.py
"""
import sys
sys.path.insert(0, ".")

from datetime import datetime, timezone

from app.models.schemas import DataType, ParsedMessage, Quality, RawMessage
from app.services.parser import parse_neuron_json
from app.services.normalizer import TagNormalizationRule, normalize

PASS = 0
FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name}  {detail}")


print("=" * 60)
print("F0 Pure-Function Validation")
print("=" * 60)

# ══════════════════════════════════════
# 1. Parser 测试
# ══════════════════════════════════════
print("\n--- 1. Parser (Hook 1) ---")

# 1.1 标准 Neuron 格式 (与 e606 现网一致: neuron/{node}/telemetry + values)
raw = RawMessage(
    topic="neuron/en9_meter/telemetry",
    payload=b'{"node":"en9_meter","group":"default","timestamp":1721234567890,'
            b'"values":{"meter_p_act":12.5,"meter_voltage":220.1,"running":true}}',
)
parsed = parse_neuron_json(raw)
check("标准格式解析成功", parsed is not None)
check("node_name 提取", parsed.node_name == "en9_meter", f"got {parsed.node_name}")
check("timestamp 提取(ms)", parsed.timestamp_ms == 1721234567890)
check("tags 数量=3", parsed.tag_count == 3, f"got {parsed.tag_count}")
check("tags 内容", parsed.tags.get("meter_p_act") == 12.5)
check("bool 保留", parsed.tags.get("running") is True)

# 1.2 node_name 字段变体
raw2 = RawMessage(
    topic="telemetry/dev01",
    payload=b'{"node_name":"dev01","timestamp":1721234567890,"tags":{"a":1}}',
)
p2 = parse_neuron_json(raw2)
check("node_name 变体", p2 is not None and p2.node_name == "dev01")

# 1.3 秒级时间戳自动转毫秒
raw3 = RawMessage(
    topic="t/x",
    payload=b'{"node":"x","timestamp":1721234567.5,"values":{"a":1}}',
)
p3 = parse_neuron_json(raw3)
check("秒级ts转ms", p3 is not None and p3.timestamp_ms == 1721234567500,
      f"got {p3.timestamp_ms if p3 else None}")

# 1.4 非法 JSON 容错
raw_bad = RawMessage(topic="t/x", payload=b'not-json{{{')
check("非法JSON返回None", parse_neuron_json(raw_bad) is None)

# 1.5 空 tags 容错
raw_empty = RawMessage(topic="t/x", payload=b'{"node":"x","timestamp":1,"values":{}}')
check("空tags返回None", parse_neuron_json(raw_empty) is None)

# 1.6 topic fallback node_name
raw_fb = RawMessage(
    topic="telemetry/HuaweiInverter_01",
    payload=b'{"timestamp":1721234567890,"activePower":45200}',
)
p_fb = parse_neuron_json(raw_fb)
check("topic fallback node_name", p_fb is not None and p_fb.node_name == "HuaweiInverter_01",
      f"got {p_fb.node_name if p_fb else None}")
check("body整体当tags", p_fb is not None and p_fb.tags.get("activePower") == 45200)

# ══════════════════════════════════════
# 2. Normalizer 测试
# ══════════════════════════════════════
print("\n--- 2. Normalizer (Hook 2) ---")

sample_parsed = ParsedMessage(
    node_name="en9_meter",
    timestamp_ms=1721234567890,
    tags={
        "meter_p_act": 12.5,        # 有规则: scale=10, offset=0
        "raw_voltage": 2201,        # 有规则: scale=0.1, offset=0, unit V
        "running": True,            # bool 无规则
        "unknown_tag": 99,          # 无规则 → 自动推断
        "bms_current": 16500,       # BMS校准: scale=0.1, offset=-1600
    },
)

rules = {
    "meter_p_act": TagNormalizationRule(
        tag_name="meter_p_act", scale_factor=10.0, offset=0.0,
        unit_to="kW",
    ),
    "raw_voltage": TagNormalizationRule(
        tag_name="voltage_v", scale_factor=0.1, offset=0.0, unit_to="V",
    ),
    "bms_current": TagNormalizationRule(
        tag_name="bms_current_a", scale_factor=0.1, offset=-1600.0,
        unit_to="A", range_min=-500.0, range_max=500.0,
    ),
}

nm = normalize(sample_parsed, rules=rules)
check("归一化输出非空", nm.point_count == 5, f"got {nm.point_count}")
check("source_node 保留", nm.source_node == "en9_meter")

by_name = {p.tag_name: p for p in nm.points}

# 2.1 scale+offset
p = by_name.get("meter_p_act")
check("scale*value+offset", p is not None and abs(p.value - 125.0) < 1e-6,
      f"got {p.value if p else None}")

# 2.2 tag rename
check("tag rename生效", "voltage_v" in by_name and "raw_voltage" not in by_name)
p = by_name.get("voltage_v")
check("voltage 0.1x", p is not None and abs(p.value - 220.1) < 1e-6,
      f"got {p.value if p else None}")

# 2.3 BMS 校准公式 (16500-16000)/10 = 50A —— 与现网高特BMS一致
p = by_name.get("bms_current_a")
check("BMS校准 (raw-16000)/10", p is not None and abs(p.value - 50.0) < 1e-6,
      f"got {p.value if p else None}")
check("BMS quality GOOD", p is not None and p.quality == Quality.GOOD)

# 2.4 值域校验
rules_out = dict(rules)
rules_out["meter_p_act"] = TagNormalizationRule(
    tag_name="meter_p_act", scale_factor=10.0, range_max=100.0,
)
nm2 = normalize(sample_parsed, rules=rules_out)
p2_out = {p.tag_name: p for p in nm2.points}.get("meter_p_act")
check("超range_max→UNCERTAIN", p2_out is not None and p2_out.quality == Quality.UNCERTAIN)

# 2.5 bool 保持 bool
p = by_name.get("running")
check("bool不经过scale", p is not None and p.value is True and p.data_type == DataType.BOOL)

# 2.6 无规则自动推断
p = by_name.get("unknown_tag")
check("无规则tag保留原名", p is not None and p.value == 99 and p.data_type == DataType.INT)

# 2.7 无规则(rules=None)整体自动模式
nm3 = normalize(sample_parsed, rules=None)
check("rules=None 全部自动", nm3.point_count == 5)
auto = {p.tag_name: p for p in nm3.points}
check("自动模式值不变", auto["meter_p_act"].value == 12.5)

# ══════════════════════════════════════
# 3. TelemetryRecord 类型分派
# ══════════════════════════════════════
print("\n--- 3. TelemetryRecord 分派 ---")
from uuid import uuid4
from app.models.schemas import NormalizedPoint, TelemetryRecord

nid, tid = uuid4(), uuid4()

pt_float = NormalizedPoint(node_name="n", tag_name="f", value=12.5,
                           data_type=DataType.FLOAT, ts=datetime.now(timezone.utc))
rec = TelemetryRecord.from_point(pt_float, nid, tid)
check("float→value_float", rec.value_float == 12.5 and rec.value_int is None)

pt_int = NormalizedPoint(node_name="n", tag_name="i", value=42,
                         data_type=DataType.INT, ts=datetime.now(timezone.utc))
rec = TelemetryRecord.from_point(pt_int, nid, tid)
check("int→value_int", rec.value_int == 42 and rec.value_float is None)

pt_bool = NormalizedPoint(node_name="n", tag_name="b", value=True,
                          data_type=DataType.BOOL, ts=datetime.now(timezone.utc))
rec = TelemetryRecord.from_point(pt_bool, nid, tid)
check("bool→value_bool", rec.value_bool is True)

pt_str = NormalizedPoint(node_name="n", tag_name="s", value="normal",
                         data_type=DataType.STRING, ts=datetime.now(timezone.utc))
rec = TelemetryRecord.from_point(pt_str, nid, tid)
check("str→value_str", rec.value_str == "normal")

# bool 是 int 子类陷阱: isinstance(True, int) == True
pt_trap = NormalizedPoint(node_name="n", tag_name="t", value=True,
                          data_type=DataType.INT, ts=datetime.now(timezone.utc))
rec = TelemetryRecord.from_point(pt_trap, nid, tid)
check("bool不进value_int(Python陷阱)", rec.value_bool is True and rec.value_int is None,
      f"value_int={rec.value_int} value_bool={rec.value_bool}")

# ══════════════════════════════════════
# Summary
# ══════════════════════════════════════
print("\n" + "=" * 60)
print(f"RESULT: {PASS} passed, {FAIL} failed")
print("=" * 60)
sys.exit(0 if FAIL == 0 else 1)
