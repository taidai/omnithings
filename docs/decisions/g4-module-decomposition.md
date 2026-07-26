# Claw IoT Platform — 子模块拆分书

**状态**: ~~2026-07-13 23:13 输出~~ → **已 superseded by g11-feature-domains.md (v2.1)**
**目的**: 将 v1.0 架构拆为 12 个独立子模块，每个可单独开发、测试、交付
**⚠️ 重要**: 本文档定义的 M0-M12 模块职责仍然有效，但以下内容已被 g11 取代：
- CE 实现方式: ~~StreamEngine(方案A)~~ → **方案B(CAGG+事件驱动)**, 见 g11 第5节
- 数据模型: ~~单表 Node(含Tag字段)~~ → **统一节点模型(t_nodes + t_tags 分表)**, 见 g11 第6节
- 功能域划分: ~~F1/F2/F3 原始定义~~ → **F0(管道)→F1(点位)→F3(节点树)→F2(控制)**, 见 g11 第2节
- 开发顺序: 已按功能域重排, 见 g11 第8节

---

## 拆分原则

1. **单一职责**：每个模块只做一件事，做好一件事
2. **接口清晰**：每个模块有明确的输入/输出（函数签名或消息格式）
3. **可独立测试**：不依赖外部服务的模块必须能纯单元测试
4. **依赖单向**：模块间形成 DAG（有向无环图），无循环依赖
5. **代码量可控**：单个模块不超过 300 行核心代码（不含测试）

---

## 模块总览

| ID | 模块名 | Phase | 核心库 | 代码量 | 可测性 |
|----|--------|-------|--------|--------|--------|
| M0 | 项目骨架 | P1 | Docker/SQLModel | ~50行 | 集成测试 |
| M1 | 节点树引擎 | P1 | SQLModel | ~250行 | **单元测试** |
| M2 | MQTT 接入层 | P1 | paho-mqtt | ~120行 | 集成(MQTT) |
| M3 | 数据归一化器 | P1 | pint, loguru | ~100行 | **单元测试** |
| M4 | 时序存储引擎 | P2 | psycopg2, pandas | ~180行 | **单元测试** |
| M5 | 虚拟点位引擎 | P2 | SymPy | ~200行 | **单元测试** |
| M6 | GoRules 规则引擎 | P4 | zen-engine | ~180行 | **单元测试** |
| M7 | RPC 控制通道 | P3 | tenacity, httpx | ~180行 | Mock 测试 |
| M8 | 定时任务调度器 | P3 | APScheduler | ~120行 | **单元测试** |
| M9 | 实时通信层 | P2/P4 | WebSocket | ~150行 | 集成(WS) |
| M10 | 前端 Dashboard | P1-P5 | react-query, ECharts | ~1500行 | E2E |
| M11 | 报表服务 | P5 | pandas, openpyxl | ~200行 | **单元测试** |
| M12 | 配置体验优化 | P5 | JDM Editor(React) | ~800行 | E2E |

**总计后端核心代码: ~1680 行 + 前端 ~2300 行 = ~4000 行**

---

## M0: 项目骨架 (Infrastructure)

### 职责
Docker Compose 编排、数据库 Schema 初始化、项目目录结构、环境变量配置。

### 交付物
```
claw-platform/
├── docker-compose.yml          # 五容器编排
├── .env                        # 环境变量模板
├── .env.example                # 开发默认值
├── backend/
│   ├── Dockerfile              # FastAPI 多阶段构建
│   ├── pyproject.toml          # uv 项目配置 + 依赖声明
│   └── alembic.ini             # DB 迁移工具
├── frontend/
│   ├── Dockerfile              # Vite/Nginx 构建
│   └── package.json
└── init-db/
    └── 001-schema.sql          # TimescaleDB 建表脚本
        (t_telemetry Hypertable + t_alarms + t_audit_log)
```

### 外部组件（不由我们编码）
| 组件 | 版本 | 端口 | 角色 |
|------|------|------|------|
| Neuron | latest | 7000 | 南向采集 + REST API |
| nanoMQ | latest | 1883/8883 | MQTT Broker |
| TimescaleDB | pg16-latest | 5432 | 时序 + 关系存储 |

### 完成定义 (DoD)
- [ ] `docker compose up` 启动后 `docker ps` 显示 5 个容器全部 healthy
- [ ] Neuron Web UI 可通过 localhost:7000 访问
- [ ] TimescaleDB 可通过 `psql -h localhost -U claw -d claw_iot` 连接
- [ ] nanoMQ 可通过 `mqtt pub -h localhost -t test` 发送测试消息

### 无代码产出（纯配置文件）

---

## M1: 节点树引擎 (NodeTree Engine)

### 职责
五层节点树的数据模型 + CRUD API。整个平台的"元数据中枢"——所有其他模块都依赖它来理解设备层级和点位定义。

### 核心文件
```
backend/app/
├── models/
│   ├── node.py          # Node + NodeType + EnergyNodeType + TagType (~120行)
│   ├── rule.py          # Rule + RuleType (~60行)
│   └── user.py          # User + Role (~40行, 复用 fastapi-template)
├── api/
│   ├── nodes.py         # GET/POST/PUT/DELETE /nodes + tree + import/export (~80行)
│   └── tags.py          # GET/POST/PUT /tags + import-neuron (~50行)
└── services/
    └── node_tree_service.py  # 树构建辅助方法 (递归查询/扁平转树) (~30行)
```

### 输入接口（API）
```
POST   /api/v1/nodes                    # 创建任意层级节点
GET    /api/v1/nodes/{id}/tree          # 获取子树（递归展开）
POST   /api/v1/nodes/import            # 从 YAML 导入节点树模板
GET    /api/v1/nodes/export?root={id}   # 导出为 YAML
POST   /api/v1/tags/import-neuron       # 从 Neuron 同步物理点位
```

### 输出数据
```python
# 其他模块消费的接口:
Node.get(node_id) → Node 对象
Node.get_by_neuron_name(name) → Device 节点
Node.get_tags(device_id) → List[Tag] (PhysicalTag + LogicalTag)
Node.get_tree(site_id) → 嵌套字典 (前端直接用)
```

### 依赖
- **入**: M0（DB 必须就绪）
- **出**: 被 M2/M3/M4/M5/M6/M7 全部消费

### 单元测试要点
```python
# tests/test_node_model.py
def test_create_five_level_tree():
    """建一棵完整 5 层树，验证 parent_id 和 node_type"""
    site = Node(name="测试站", node_type=NodeType.SITE)
    station = Node(name="1号站", node_type=NodeType.STATION, parent_id=site.id)
    ess = Node(name="储能", node_type=NodeType.ENERGY_NODE, energy_node_type=EnergyNodeType.ESS, parent_id=station.id)
    pcs = Node(name="PCS#1", node_type=NodeType.DEVICE, neuron_node_name="test_pcs", parent_id=ess.id)
    tag = Node(name="功率", node_type=NodeType.TAG, tag_type=TagType.PHYSICAL, unit="kW", parent_id=pcs.id)
    # 断言层级关系正确

def test_physical_tag_mapping():
    """PhysicalTag 的 Neuron 映射字段完整"""
    tag = Node(
        name="activePower_kW",
        node_type=NodeType.TAG,
        tag_type=TagType.PHYSICAL,
        neuron_group="data",
        neutron_tag="activePower",
        scale_factor=0.001,
        unit_from="W",
        unit_to="kW"
    )
    assert tag.scale_factor == 0.001
```

### DoD
- [ ] POST /nodes 能创建 Site→Station→EnergyNode→Device→Tag 五层结构
- [ ] GET /nodes/{id}/tree 返回正确的嵌套 JSON（递归深度不限）
- [ ] POST /tags/import-neuron 接收 Neuron 节点名，返回模拟的 tag 列表
- [ ] 单元测试覆盖：创建/更新/删除/级联删除/导入/导出（≥8 个 case）

---

## M2: MQTT 接入层 (MQTT Bridge)

### 职责
订阅 nanoMQ 的 telemetry topic，解析 MQTT payload，路由到下游处理器（M3 归一化）。平台的消息入口。

### 核心文件
```
backend/app/core/
└── mqtt_client.py      # paho-mqtt 连接管理 + on_message 回调 (~120行)
```

### 输入
```python
# 来自 nanoMQ 的 MQTT 消息:
topic: "telemetry/{neuron_node_name}"     # 如 "telemetry/en9_pcs_01"
payload: {
    "ts": 1720876800000,                   # 毫秒时间戳
    "values": {
        "activePower": 45000,
        "soc": 852,
        "dcVoltage": 7200
    }
}
```

### 输出
```python
# 解析后的内部消息格式，传给 M3 Normalizer:
MqttMessage = TypedDict('MqttMessage', {
    'node_name': str,           # "en9_pcs_01"
    'timestamp': datetime,      # 解析后的时间戳
    'raw_values': dict[str, Any]  # 原始键值对
})
```

### 关键设计
```python
class MqttBridge:
    """
    单例模式，app 启动时连接，app 关闭时断开。
    订阅 topic pattern: "telemetry/#"
    收到消息后:
      1. 提取 node_name (从 topic)
      2. 解析 payload JSON
      3. 调用 normalizer.normalize() (M3)
      4. 将结果交给 telemetry_store.write() (M4)
      5. 触发 virtual_engine.on_update() (M5)
    """

    def __init__(self, broker_host: str, broker_port: int,
                 normalizer: 'DataNormalizer',
                 store: 'TelemetryStore',
                 vpe: 'VirtualPointEngine'):
        self.client = mqtt.Client()
        # 注入下游依赖（构造时注入，方便 mock 测试）

    async def on_message(self, client, userdata, msg):
        topic = msg.topic                          # "telemetry/en9_pcs_01"
        node_name = topic.split("/")[-1]
        payload = json.loads(msg.payload)
        # ↓ 传递给 M3
        normalized = await self.normalizer.normalize(
            device_path=self._resolve_path(node_name),
            raw_values=payload.get("values", {}),
            tag_configs=self._get_tag_configs(node_name)
        )
        # ↓ 传递给 M4
        await self.store.write_telemetry(normalized)
        # ↓ 触发 M5
        await self.vpe.on_physical_update(normalized['_device_path'], normalized)
```

### 依赖
- **入**: M0（nanoMQ）、M1（查节点路径）、M3（归一化）
- **出**: 推送到 M4（存储）+ M5（虚拟点位）

### 测试策略
- 单元测试：on_message 函数逻辑（mock 掉 paho-mqtt client）
- 集成测试：需要运行中的 nanoMQ（或用 testcontainers-mqtt）

### DoD
- [ ] 订阅 `telemetry/#` topic，收到消息打印日志
- [ ] 正确解析 JSON payload，提取 node_name + timestamp + values
- [ ] 自动调用注入的 normalizer + store + vpe
- [ ] 断线重连机制正常（paho-mqtt 内置）

---

## M3: 数据归一化器 (Data Normalizer)

### 职责
Neuron 原始值 → 标准 SI 工程值转换。处理 scale/offset、pint 单位换算、字段名映射。

### 核心文件
```
backend/app/core/
└── normalizer.py       # DataNormalizer 类 (~100行)
```

### 输入/输出
```python
# IN:
device_path: str               # "/site/1/station/10/ess/100/device/1001"
raw_values: dict               # {"activePower": 45000, "soc": 852}
tag_configs: dict              # 从 M1 查询得到的点位配置

# OUT:
{
    "_device_path": "...",
    "_timestamp": "2026-07-13T22:00:00Z",
    "activePower_kW": 45.0,     # 45000 * 0.001 或 pint W→kW
    "soc_pct": 85.2,            # 852 * 0.1
    "dcVoltage_v": 7.200        # 7200 * 0.001
}
```

### 外部库
- **pint** — 单位换算（`ureg.Quantity(raw, 'W').to('kW')`）
- **loguru** — 结构化日志

### 为什么是独立模块
- **纯函数**：输入 dict → 输出 dict，无副作用，最容易测试
- **品牌适配点**：不同品牌设备的归一化规则不同，未来可能按 DeviceProfile 分支
- **被多地方调用**：M2 上行用它，未来可能有手动补数 API 也用它

### 单元测试示例
```python
def test_scale_offset_conversion():
    result = normalizer.normalize("path", {"activePower": 45000}, {
        "activePower": {"scale_factor": 0.001, "field_alias": "activePower_kW"}
    })
    assert result["activePower_kW"] == 45.0

def test_pint_unit_conversion():
    result = normalizer.normalize("path", {"energy": 12345678}, {
        "energy": {"unit_from": "Wh", "unit_to": "kWh", "field_alias": "total_energy_kWh"}
    })
    assert abs(result["total_energy_kWh"] - 12345.678) < 0.001

def test_missing_tag_skipped():
    result = normalizer.normalize("path", {"unknown_field": 999}, {})
    assert "unknown_field" not in result
```

### DoD
- [ ] scale_factor * value + offset 转换正确
- [ ] pint 单位换算正确（W→kW, mV→V, Wh→kWh）
- [ ] 未在 configs 中注册的字段自动跳过（不打错日志）
- [ ] 原始值超出 min_value/max_value 范围时标记为 None 并打 WARNING 日志
- [ ] ≥5 个单元测试覆盖正常/边界/异常路径

---

## M4: 时序存储引擎 (Telemetry Store)

### 职责
将归一化后的遥测数据批量写入 TimescaleDB Hypertable，以及提供查询接口。

### 核心文件
```
backend/app/core/
└── telemetry_store.py   # TelemetryWriter 类 (~130行)

backend/app/api/
└── telemetry.py         # 查询 API (~50行)
```

### 写入接口
```python
class TelemetryWriter:
    def __init__(self, db_url: str):
        self.conn = psycopg2.connect(db_url)

    def batch_insert(self, rows: list[tuple]) -> int:
        """
        批量写入 t_telemetry Hypertable
        :param rows: [(time, node_path, tag_name, value, is_virtual), ...]
        :return: 插入行数
        使用 psycopg2.extras.execute_values (二进制协议，~250x 性能提升)
        """
```

### 查询接口
```python
# GET /api/v1/telemetry?paths={p1,p2}&fields=f1,f2&from=T&to=T&agg=raw|1m|1h|1d
async def query_telemetry(paths, fields, from_t, to_t, agg='raw') -> dict:
    """
    1. SQL 取原始数据 (TimescaleDB)
    2. pandas DataFrame 后处理 (时间窗口聚合)
    3. 返回 JSON
    """
```

### 外部库
- **psycopg2** (`execute_values`) — 高性能批量写入
- **pandas** — 时间窗口聚合（1min/1hour/1day pivot table）

### 单元测试要点
- Mock psycopg2 连接，验证 execute_values 被调用了正确的参数
- 验证 batch_insert 返回正确的插入行数
- 验证查询 API 在空数据集时不报错返回空列表

### DoD
- [ ] `batch_insert()` 一次写入 200 条 < 100ms
- [ ] 查询 API 支持 raw / 1m / 1h / 1d 四种聚合模式
- [ ] pandas 聚合结果与纯 SQL GROUP BY 结果一致（交叉验证）
- [ ] is_virtual=True 的点位和物理点位存同一张表，可通过字段区分

---

## M5: 虚拟点位引擎 (Virtual Point Engine)

### 职责
物理点位更新后自动计算所有依赖它的 LogicalTag（公式/聚合/条件），支持链式级联 A→B→C。

### 核心文件
```
backend/app/core/
└── virtual_engine.py    # VirtualPointEngine 类 (~200行)
```

### 公式类型及对应外部库
| formula_type | 计算方式 | 库 |
|-------------|---------|-----|
| expression | 数学表达式 | **SymPy** (`sympify().evalf()`) |
| aggregate | SUM/AVG/MAX/MIN/COUNT | Python 内建 |
| condition | 条件判断输出布尔 | Python 内建 |

### 输入/输出
```python
# IN (由 M2/MqttBridge 调用):
device_path: str            # 设备路径
normalized_values: dict     # M3 归一化后的 {field: value}

# OUT:
updated_virtual_points: dict   # {vp_path: computed_value, ...}
# 同时副作用: 写入 M4 (is_virtual=True)
```

### 关键约束（来自 G3 审查 R2）
```python
MAX_CASCADE_DEPTH = 5  # 级联深度硬限制

async def _cascade_compute(self, trigger_path, visited, results, depth=0):
    if depth > MAX_CASCADE_DEPTH:
        logger.warning("[VP] 级联深度超限 ({depth})")
        return  # 截断，不再向下传播
```

### SymPy 集成
```python
from sympy import sympify, SympifyError

def _eval_expression(self, formula: str, variables: dict) -> float:
    expr = sympify(formula)          # 字符串 → 符号表达式
    result = expr.evalf(subs=variables)  # 代入数值
    return float(result)
```

### 单元测试要点
```python
def test_sympy_expression():
    vpe.register_logical_tags([{
        "path": "vp_efficiency",
        "formula": "(dc_power / ac_power) * 100",
        "sources": ["...dc_power", "...ac_power"],
        "formula_type": "expression"
    }])
    result = vpe.on_physical_update("pcs_01", "dc_power", 15.0, now())
    result = vpe.on_physical_update("pcs_01", "ac_power", 20.0, now())
    assert abs(result["vp_efficiency"] - 75.0) < 0.01  # (15/20)*100

def test_aggregate_sum():
    # 两台 PCS 都上报后，ess_total = SUM(pcs1.power, pcs2.power)
    ...

def test_cascade_depth_limit():
    # 配一个 6 层级联链 A→B→C→D→E→F→G
    # 触发 A 更新后，F 应该被计算但 G 不应该（超限）
    ...
```

### DoD
- [ ] expression 类型公式正确求值（含 sqrt/max/min/sin/cos 等数学函数）
- [ ] aggregate 类型跨设备 SUM/AVG/MAX/MIN 正确
- [ ] condition 类型输出布尔值正确
- [ ] 链式级联 A→B→C 正确传播
- [ ] 级联深度 > 5 时截断并打警告日志
- [ ] 循环依赖 A→B→A 被 visited Set 检测并阻止
- [ ] ≥10 个单元测试

---

## M6: GoRules 规则引擎 (Rules Engine)

### 职责
加载 JDM 决策表/决策图，接收上下文数据，返回评估结果。微秒级延迟。

### 核心文件
```
backend/app/core/
└── rules_service.py     # RulesService 类 (~180行)

backend/app/api/
└── rules.py             # CRUD + simulate API (~80行)
```

### 支持的规则类型
| type | 用途 | JDM 格式 | hitPolicy |
|------|------|----------|-----------|
| alarm | 告警检测 | Decision Table | collect (多条匹配) |
| control | 控制策略 | Decision Graph | first (首条命中) |
| fault_map | 故障码翻译 | Decision Table | first |
| linkage | 联动规则 | Decision Graph | collect |

### 输入/输出
```python
# IN:
rule_name: str           # 如 "ems-alarm-rules"
context: dict            # {soc_pct: 96, max_temp_c: 58, power_kW: -20, ...}

# OUT:
# alarm: list[dict]     # [{level:"CRITICAL", action:"stop_discharge", message:"..."}, ...]
# control: dict | None   # {pcs_command: 3, charge_limit_kw: 0, reason:"..."} or None
# fault: dict | None     # {fault_name:"Comms Lost", severity:"CRITICAL", suggestion:"..."}
```

### 外部库
- **zen-engine** (`pip install zen-engine`) — Rust 核心 + PyO3 绑定

### 热更新流程
```
前端 JDM Editor 保存
  → PUT /api/v1/rules/{id}/jdm  {jdm_content: {...}}
  → rules_service.hot_reload(rule_name, new_jdm, new_version)
  → 内存缓存更新（下次 evaluate 自动使用新版本）
  → 审计日志记录操作人+时间+版本号
```

### 单元测试要点
```python
# 可以用真实的 GoRules 引擎（它是嵌入式的，不需要启动服务）
def test_alarm_evaluation():
    rules_service.load_test_rule("ems-alarm-rules", ALARM_JDM_TEMPLATE)
    result = await rules_service.evaluate_alarm({"soc_pct": 96, "max_temp_c": 58})
    assert len(result) >= 1  # 至少触发一条 CRITICAL 或 MAJOR
    assert any(r["level"] == "CRITICAL" for r in result)

def test_control_policy():
    rules_service.load_test_rule("ess-control-policy", CONTROL_JDM_TEMPLATE)
    result = await rules_service.evaluate_control({"soc_pct": 97, "max_temp_c": 63})
    assert result is not None
    assert result["pcs_command"] == 3  # emergency_stop
```

### DoD
- [ ] `pip install zen-engine` 成功，evaluate() 返回正确结果
- [ ] 加载内置 EMS 告警模板（7 条规则），传入测试数据命中预期行
- [ ] 加载控制策略图，SOC>95 返回 limit_charge 动作
- [ ] hot_reload 后新版本立即生效（无需重启）
- [ ] simulate API 传入自定义 context，返回命中详情
- [ ] ≥6 个单元测试

---

## M7: RPC 控制通道 (RPC Control Channel)

### 职责
前端控制指令 → 权限校验 → GoRules 策略校验 → Neuron REST API write → Modbus 写寄存器。

### 核心文件
```
backend/app/core/
└── rpc_controller.py    # NeuronClient + RpcController (~180行)

backend/app/api/
└── rpc.py               # POST /rpc + history API (~40行)
```

### 外部库
- **tenacity** — JWT 过期自动重试 + 网络抖动指数退避
- **httpx** — 异步 HTTP 客户端（替代 requests）

### 控制流
```
POST /api/v1/devices/{id}/rpc
  {method: "remote_control", params: "3"}
    │
    ├─ 1. 权限校验 (当前用户是否有此设备控制权限)
    ├─ 2. 参数验证 (method 是否在白名单, params 类型是否合法)
    ├─ 3. GoRules 策略评估 (可选: 当前状态是否允许此操作?)
    │
    ├─ 4. paho-mqtt publish → command/{node_name}  (异步, 不等响应)
    │
    ├─ 5. (同步) Neuron REST API: POST /api/v2/write
    │      {node, group, tag, value}
    │      ↑ @retry(3次, 指数退避, 仅重试网络错误)
    │
    └─ 6. 写审计日志 + WS 推送结果
```

### tenacity 配置
```python
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPError, httpx.StatusError)),
    reraise=True,
    before_sleep=before_sleep_log(logger, logging.WARNING)
)
async def write_tag(self, node, group, tag, value):
    ...
```

### 测试策略
- **Mock Neuron**：用 `httpx_mock` 或 `responses` 库拦截 HTTP 调用
- **JWT 重试场景**：模拟 401 → 自动重新 login → 重试成功

### DoD
- [ ] POST /rpc 发送命令到 Neuron，返回 success
- [ ] 无权限用户返回 403
- [ ] Neuron 返回错误码时正确向上抛出
- [ ] JWT 过期时 tenacity 自动重试成功
- [ ] 审计日志记录每次控制操作
- [ ] ≥4 个测试（正常/无权/JDT过期/网络超时）

---

## M8: 定时任务调度器 (Scheduler)

### 职责
统一管理所有定时任务，替代散落在各处的 asyncio 循环。

### 核心文件
```
backend/app/core/
└── scheduler.py         # PlatformScheduler 类 (~120行)
```

### 注册的任务
| ID | 名称 | 频率 | 依赖模块 |
|----|------|------|---------|
| J1 | Neuron JWT 刷新 | 每 30 分钟 | M7 (NeuronClient) |
| J2 | 规则热重载检查 | 每 5 分钟 | M6 (RulesService) |
| TSDB 冷数据清理 | 每天 02:00 | M4 (TelemetryStore) |
| J4 | 设备在线巡检 | 每 30 秒 | M1 (Node) + M9 (WS) |
| J5 | 告警恢复检测 | 每 1 分钟 | M6 + M9 |

### 外部库
- **APScheduler** (`AsyncIOScheduler`) — cron / interval / date 三种触发器

### 关键特性
```python
PlatformScheduler:
  ├── coalesce=True          # 错过的执行合并为一次
  ├── max_instances=1        # 同一 job 不并发
  └── misfire_grace_time=300 # 误执行宽容 5 分钟
```

### DoD
- [ ] 应用启动后 scheduler 自动开始运行
- [ ] 日志显示 `[Scheduler] 已启动 N 个定时任务`
- [1 ] J1 每 30 分钟执行一次（日志验证）
- [ ] J4 每 30 秒标记超时无数据的设备为离线
- [ ] 单个 job 异常不影响其他 job

---

## M9: 实时通信层 (WebSocket Realtime)

### 职责
服务端推送实时数据给浏览器客户端：遥测变更 + 告警事件 + RPC 结果。

### 核心文件
```
backend/app/api/
└── websocket.py          # WebSocket 端点 + ConnectionManager (~150行)
```

### 协议
```
WS /ws/telemetry:
  Client → Server: {"action":"subscribe","paths":["path1","path2"]}
  Server → Client: {"type":"telemetry","path":"...","values":{...},"ts":"..."}

WS /ws/alarms:
  Server → Client: {"type":"alarm","level":"MAJOR","message":"...","path":"..."}

WS /ws/rpc-response:
  Server → Client: {"type":"rpc_result","request_id":"...","success":true,"value":...}
```

### 设计注意
- 合并消息批推：100ms 内的变更合并为 1 条 JSON（防淹没）
- 心跳保活：30 秒 ping/pong
- 背压保护：客户端未确认时暂缓发送

### DoD
- [ ] 浏览器连接 WS 后订阅设备路径
- [ ] M2 收到新遥测后 100ms 内推送给订阅者
- [ ] GoRules 触发告警后立即推送给相关节点订阅者
- [ ] 客户端断连后自动清理订阅关系

---

## M10: 前端 Dashboard (UI Layer)

### 职责
用户交互界面：节点树管理、点位配置、实时数据展示、RPC 控制、规则编辑。

### 目录结构
```
frontend/src/
├── main.tsx                  # QueryClientProvider 注入
├── lib/
│   ├── api-client.ts         # OpenAPI/fetch 封装
│   └── ws-client.ts          # WebSocket 封装 (reconnect)
├── pages/
│   ├── Dashboard.tsx         # 总览面板 (react-query 1s 刷新)
│   ├── NodeTree.tsx          # 节点树 CRUD 页
│   ├── TagConfig.tsx         # 物理点位 + 逻辑点位配置
│   ├── TelemetryView.tsx     # 实时数据监视 (ECharts 图表)
│   ├── AlarmPanel.tsx        # 告警列表 + 确认
│   └── RuleDesigner.tsx      # JDM Editor 嵌入页
└── components/
    ├── ui/                   # shadcn/ui 组件 (Button/Card/Input/Dialog...)
    ├── charts/               # ECharts 封装 (LineChart/Gauge/Table)
    ├── tree/                 # 树形控件 (递归渲染 Node[])
    └── jdm-editor/           # @gorules/jdm-editor React 组件封装
```

### 外部库
- **@tanstack/react-query** — 遥测数据 1s 轮询 + 缓存 + mutation
- **ECharts** — 趋势图 / 仪表盘 / 柱状图
- **@gorules/jdm-editor** — 可视化决策表/图编辑器
- **shadcn/ui** — UI 组件库（来自 fastapi-template）

### react-query 核心用法
```tsx
// 每个实时卡片只需 12 行（vs v1.0 的 50 行样板）
function PowerCard({ devicePath }: Props) {
  const { data } = useQuery({
    queryKey: ['telemetry', devicePath, 'activePower_kW'],
    queryFn: () => api.get('/telemetry/latest', { params: { paths: devicePath, fields: 'activePower_kW' } }),
    refetchInterval: 1000,  // 1秒刷新
  })
  return <MetricCard label="Active Power" value={data} unit="kW" />
}
```

### DoD（Phase 1 最小可用）
- [ ] Dashboard 显示设备在线/离线状态绿点
- [ ] NodeTree 页面支持创建/编辑/删除节点（5 层树）
- [ ] TelemetryView 页面显示至少 1 个跳动数字
- [ ] （后续 Phase 逐项增加 TagConfig / AlarmPanel / RuleDesigner）

---

## M11: 报表服务 (Report Service)

### 职责
生成日/月/年能源统计报表，导出 Excel 格式。

### 核心文件
```
backend/app/services/
└── report_service.py     # 报表生成 (~200行)

backend/app/api/
└── reports.py            # 下载 API (~30行)
```

### 外部库
- **pandas** — 数据聚合分析（pivot_table/groupby/统计指标）
- **openpyxl** — Excel 文件生成（带样式：表头着色/列宽自适应/数字格式）

### 报表类型
| 报表 | 内容 | pandas 操作 |
|------|------|------------|
| 日发电量 | 光伏各逆变器当日 kWh 汇总 | groupby.sum |
| 储能效率 | 充放电能量比 round-trip 效率 | pivot_table |
| 电费估算 | 峰/谷/平段用电 x 单价 | 条件过滤 + sum |
| 设备利用率 | 运行时长 / 统计时长 | 自定义聚合 |

### DoD
- [ ] GET /reports/daily?station_id=1&date=2026-07-13 返回 Excel 文件
- [ ] Excel 包含绿色表头样式、自动列宽
- [ ] 数据与 TimescaleDB 中存储的一致

---

## M12: 配置体验优化 (Configuration UX)

### 职责
让非技术用户通过可视化界面完成全部配置工作——零代码。

### 子功能
| 功能 | 说明 | 复杂度 |
|------|------|--------|
| 节点树向导 | 引导式建站（Step 1: 站名 → Step 2: 选能源类型 → Step 3: 加设备） | 中 |
| 物理点位一键导入 | 选 Neuron node → 自动扫描 group/tag → 一键入库 | 低 |
| 逻辑点位公式编辑器 | 从节点树选择源点位 → 写公式 → 实时预览 | 中 |
| Dashboard Builder | 拖拽卡片布局 + 选择数据源 | 高 |
| JDM Editor 嵌入 | 可视化决策表编辑（@gorules/jdm-editor 已提供） | 低（集成工作） |

### DoD
- [ ] 向导 3 步完成站点搭建 ≤ 2 分钟
- [ ] 50 个点位从 Neuron 导入 ≤ 10 秒
- [ ] 新增逻辑点位后 1 秒内在 Dashboard 出现

---

## 模块依赖 DAG

```
                    ┌─────────────────────┐
                    │      M0: 骨架        │  ← 无依赖，一切之始
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │    M1: 节点树引擎     │  ← 元数据中枢
                    └──┬──────────┬────────┘
                       │          │
              ┌────────▼──┐  ┌───▼─────────┐
              │ M2: MQTT  │  │ M3: 归一化器  │
              └─────┬─────┘  └──────┬───────┘
                    │               │
        ┌───────────┼───────────────┤
        ▼           ▼               ▼
  ┌──────────┐ ┌──────────┐ ┌──────────────┐
  │ M4: 存储 │ │ M5: VPE  │ │ M7: RPC控制  │
  └────┬─────┘ └────┬─────┘ └──────┬───────┘
       │            │              │
       │      ┌─────▼─────┐        │
       │      │ M6: GoRules│◄───────┘ (策略校验)
       │      └─────┬─────┘
       │            │
       ▼            ▼
  ┌──────────────────────┐
  │  M8: 调度器           │  ← 定时驱动 M4/M5/M6/M7
  └──────────┬───────────┘
             │
  ┌──────────▼───────────┐
  │  M9: WebSocket 推送   │  ← 把所有结果推向浏览器
  └──────────┬───────────┘
             │
  ┌──────────▼───────────┐
  │  M10: 前端 Dashboard  │  ← 用户看到的一切
  └──────────────────────┘

  M11(报表) 和 M12(配置体验) 是独立的附加模块，
  通过 API 与后端通信，不影响核心数据流。
```

---

## 实施顺序（按依赖拓扑排序）

### 第一批（Day 1-5，Phase 1）：M0 → M1 → M2 → M3
```
先搭骨架，再建模型，再通消息，最后做转换。
这四个完成后：MQTT 消息能从头走到尾（虽然还没入库）。
```

### 第二批（Day 6-12，Phase 2）：M4 → M5 → M9(基础版)
```
有了数据就存，存了就算虚。
这批完成后：上行闭环跑通（设备→消息→归一化→入库→算虚位→展示）。
```

### 第三批（Day 13-17，Phase 3）：M7 → M8
```
能读就能写，写了就要守。
这批完成后：下行闭环跑通（按钮点击→API→Neuron→设备）。
```

### 第四批（Day 18-27，Phase 4）：M6
``规则是大脑，放后面因为最复杂（GoRules 集成 + JDM Editor）。
这批完成后：系统具备自治能力（越限告警→自动控
```

### 第五批（Day 28-37，Phase 5）：M10(全功能) → M11 → M12
``体验决定产品力。前面是能用，这批是好
```

---

## 每个模块的"完成即交付"标准

| 模块 | 交付物 | 代码行数 | 测试数量 |
|------|--------|---------|---------|
| M0 | docker-compose.yml + .env + init-db/*.sql | ~50 行配置 | 1 个集成脚本 |
| M1 | models/*.py + api/nodes.py + api/tags.py | ~250 行 | ≥8 个单测 |
| M2 | core/mqtt_client.py | ~120 行 | ≥3 个（1 集成 + 2 单元 mock）|
| M3 | core/normalizer.py | ~100 行 | ≥5 个单测 |
| M4 | core/telemetry_store.py + api/telemetry.py | ~180 行 | ≥5 个单测 |
| M5 | core/virtual_engine.py | ~200 行 | ≥10 个单测 |
| M6 | core/rules_service.py + api/rules.py | ~260 行 | ≥6 个单测 |
| M7 | core/rpc_controller.py + api/rpc.py | ~220 行 | ≥4 个 mock 测 |
| M8 | core/scheduler.py | ~120 行 | ≥3 个单测 |
| M9 | api/websocket.py | ~150 行 | ≥2 个集成测 |
| M10 | frontend/src/ 全目录 | ~1500 行 | ≥3 个 E2E |
| M11 | services/report_service.py + api/reports.py | ~230 行 | ≥3 个单测 |
| M12 | frontend/src/pages/* 配置页 | ~800 行 | ≥3 个 E2E |

---

*文档版本: MDECO-v1.0*
*最后更新: 2026-07-13*
