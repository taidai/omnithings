# g9: Home Assistant → OmniPower / Claw 可借鉴方案分析

> 生成日期: 2026-07-16
> 基于: HA Core Architecture (2026) + Claw arch-v1 + g4/g7/g8 决策文档
> 目的: 系统性提取 HA 百万级部署验证过的架构模式，指导 OmniPower 开发

---

## 一、HA 核心架构概览

### 1.1 四大核心组件

Home Assistant 的全部能力建立在四个基础组件之上：

```
┌─────────────────────────────────────────────────────┐
│                  HA Core (asyncio 单进程)             │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │   Event Bus   │  │ State Machine│                 │
│  │  (事件发布/订阅)│  │ (实体状态存储) │                 │
│  └──────┬───────┘  └──────┬───────┘                 │
│         │ state_changed   │                          │
│         ▼                 ▼                          │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │Service Reg.  │  │    Timer     │                 │
│  │ (服务注册/调用)│  │ (每秒time_changed)│              │
│  └──────────────┘  └──────────────┘                 │
└─────────────────────────────────────────────────────┘
         │                    │
    ┌────┴────┐         ┌────┴────┐
    │Integrations│      │Automation│
    │(设备接入)  │      │(规则引擎) │
    └─────────┘         └─────────┘
```

| 组件 | 职责 | 关键 API | Claw 对应 |
|------|------|---------|----------|
| **Event Bus** | 所有组件间通信的中枢，事件发布/订阅 | `hass.bus.async_fire()`, `hass.bus.async_listen()` | MQTT on_message 回调 + FastAPI 内部事件 |
| **State Machine** | 维护所有实体的当前状态（不可变快照） | `hass.states.get()`, `hass.states.async_set()` | TimescaleDB Hypertable + Redis 缓存层 |
| **Service Registry** | 注册可调用的服务操作 | `hass.services.async_register()`, `async_call()` | RPC Controller (`/api/rpc/*`) |
| **Timer** | 每秒触发 time_changed 事件 | 内置, 1s 精度 | APScheduler (5 job) |

### 1.2 数据流主线

```
上行数据流:
  设备状态变化 → Integration 捕获 → Entity 写入 State Machine
    → 触发 state_changed 事件 → Event Bus 广播
      → Automation Engine 监听匹配 → 条件判断 → 调用 Service
        → Recorder 异步写入 DB (独立线程)

下行控制流:
  用户操作 / Automation 触发 → Service Call → Integration 执行
    → 设备收到指令 → 状态变化 → 回到上行数据流
```

---

## 二、可直接借鉴的架构模式（12 项）

### A 类：设计哲学（4 项）—— 无需改造，直接吸收

#### A1. 本地优先 (Local First)

> HA 核心定位："Local control and privacy first"

| 要素 | HA 做法 | OmniPower 适配 |
|------|--------|----------------|
| 数据存储 | 默认本地 SQLite，远程访问需显式配置 | TimescaleDB 本地部署，不依赖云服务 |
| 控制逻辑 | 自动化全在本地执行，无需云端 | GoRules ZEN Engine 本地决策 |
| 断网可用 | 云服务宕机不影响本地控制 | 工业场景必须：断网 = 继续运行 |

**Claw 行动项**: Docker Compose 编排的所有组件都在内网，无外部 SaaS 依赖。

#### A2. 模块化集成 (Integration Model)

> "Each integration is responsible for a specific domain"

HA 的集成模型是它支持 2500+ 设备的关键：

```python
# HA 集成标准生命周期
class MyIntegration:
    async def async_setup(hass, config):
        """初始化：加载配置、建立连接"""
        
    async def async_setup_entry(hass, entry):
        """配置入口：发现设备、创建实体"""
        # 通过 async_add_entities 注册实体
        await async_add_entities([MyEntity(...)])
        
    async def async_unload_entry(hass, entry):
        """卸载清理：断开连接、移除监听"""
```

**OmniPower 对应**: Neuron 就是我们的"南向 Integration"，但不需要写 Python 集成代码——Neuron 自身已完成协议适配。Claw 只需要：
- 通过 Neuron REST API 读取已配置的 node/group/tag
- 通过 MQTT 接收 Neuron 推送的遥测数据

#### A3. 实体不可变快照 (Immutable State Snapshots)

> "States are immutable snapshots — reading gives you point-in-time value"

```python
# HA State 对象结构
@dataclass(frozen=True)
class State:
    entity_id: str       # "sensor.temperature"
    state: str           # 值，永远是字符串 ("22.5", "on")
    attributes: dict     # {"unit_of_measurement": "°C"}
    last_changed: datetime  # 上次值变化时间
    last_updated: datetime  # 上次更新时间（即使值没变）
```

**关键洞察**: HA 用 `frozen=True` 强制不可变，防止并发 bug。

**OmniPower 对应**: SQLModel Model 天然适合这个模式——每次数据库写入就是新的快照，历史记录自动保留在 TimescaleDB 中。

```python
# Claw TagValue 快照模型（对标 HA State）
class TagValue(SQLModel, table=True):
    __tablename__ = "tag_values"
    
    tag_id: str                     # 对标 entity_id
    value: float                    # 对标 state（但我们用 float，不是 string）
    quality: str = "good"           # good | uncertain | bad (工业质量码)
    attributes: dict = {}           # 扩展属性
    timestamp: datetime             # 对标 last_changed (TimescaleDB time col)
    
    class Config:
        # TimescaleDB Hypertable —— 自动分区
        timescaledb_hypertable = {
            "time_column_name": "timestamp",
            "partition_interval": "1 day",
            "compress_interval": "7 days",
            "compress_segmentby": "tag_id",
        }
```

#### A4. 全局单入口对象 (The `hass` Pattern)

> "Every integration receives a HomeAssistant instance (hass). Never store global state outside it."

HA 最核心的设计纪律：所有组件通过 `hass` 对象交互，禁止全局变量。

```python
# HA hass 对象暴露的全部子系统
hass.bus          # Event Bus — 事件发布/监听
hass.states       # State Machine — 读/写实体状态
hass.services     # Service Registry — 注册/调用服务
hass.data         # 共享数据存储 (dict)
hass.config       # 系统配置 (位置、单位、时区)
```

**OmniPower 对等设计**: 我们用 FastAPI `app.state` + 依赖注入系统实现同样的效果：

```python
# backend/app/core/app_state.py — 对标 hass
from dataclasses import dataclass, field

@dataclass
class AppState:
    """全局应用状态（对标 HA hass 对象）"""
    # 事件总线（对标 hass.bus）
    event_listeners: Dict[str, List[Callable]] = field(default_factory=dict)
    
    # MQTT 客户端（对标 hass.states 的数据源）
    mqtt_client: Optional[Client] = None
    
    # 数据库会话工厂
    session_factory: Optional[sessionmaker] = None
    
    # 服务注册表（对标 hass.services）
    service_registry: Dict[str, Callable] = field(default_factory=dict)
    
    # 定时任务调度器（对标 Timer）
    scheduler: Optional[AsyncIOScheduler] = None


# 使用方式：通过 FastAPI Depends 注入，不用全局变量
def get_app_state(request: Request) -> AppState:
    return request.app.state.app_state

@router.get("/api/nodes")
async def list_nodes(app: AppState = Depends(get_app_state)):
    nodes = await app.session_factory.get(Node)
    return nodes
```

---

### B 类：技术模式（6 项）—— 需要适配改造

#### B1. Entity Registry（实体注册表）— 改造为五层节点树

**HA 原始设计**:

```python
# HA Entity Registry: 扁平的实体元数据表
entity_id: str          # "sensor.temperature_livingroom"
unique_id: str         # 设备厂商提供的唯一ID（用于重连恢复）
domain: str            # "sensor" / "light" / "switch" / "binary_sensor"
device_id: str         # 所属设备 ID
area_id: str           # 所属区域 (房间)
original_name: str     # 原始名称
name: str | None       # 用户自定义名称
disabled_by: str | None  # 用户是否禁用
```

**为什么 HA 用扁平结构**: 家庭场景设备数量少（平均 50-150 个），扁平列表足够。
**为什么 OmniPower 不能用**: 工业场景一个站点就有 500-5000 个点位，层级语义至关重要。

**Claw 改造方案**: 将 Entity Registry 升级为五层节点树 + Tag 注册表：

```python
# Claw 对标 Entity Registry — 层级化版本

# 第一层: Site（场站） — 对标 HA Area 的超集
class Site(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    unique_id: str  # 对标 HA unique_id
    location: Optional[str] = None  # 经纬度/地址
    
# 第二层: Station（电站/区域）
class Station(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    site_id: int = Field(foreign_key="site.id")
    name: str
    station_type: str  # "PV" | "ESS" | "EVSE" | "GRID"

# 第三层: EnergyNode（能源节点）— ESS/PV/Grid/EVSE
class EnergyNode(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    station_id: int = Field(foreign_key="station.id")
    name: str
    node_type: str  # "ESS" | "PV_INVERTER" | "METER" | "EVSE"
    # 对标 HA Device
    neuron_node_name: str  # Neuron 南向节点名
    unique_id: str        # 对标 HA unique_id（用于设备重连恢复）

# 第四层: Device（设备）
class Device(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    energy_node_id: int = Field(foreign_key="energy_node.id")
    name: str
    device_type: str  # "PCS" | "BMS" | "COMBINER_BOX"
    
# 第五层: Tag（点位）— 对标 HA Entity
class Tag(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    device_id: int = Field(foreign_key="device.id")
    name: str                           # 点位名
    tag_type: str                       # "physical" | "logical"
    # --- PhysicalTag 字段 ---
    neuron_group: Optional[str] = None  # Neuron 分组名
    neuron_tag_name: Optional[str] = None  # Neuron 内部点名
    data_type: Optional[int] = None     # Neuron 数据类型 (0-36)
    attribute: int = 1                 # READ/WRITE/SUBSCRIBE 位掩码
    # --- LogicalTag 字段 ---
    formula: Optional[str] = None       # SymPy 表达式
    source_tags: Optional[str] = None   # JSON 数组，引用的 source tag IDs
    # --- 通用 ---
    unit: Optional[str] = None          # pint 单位
    scale: float = 1.0                  # 归一化系数
    offset: float = 0.0                 # 归一化偏移
    unique_id: str                      # 对标 HA entity_id 但带层级前缀
    # 示例: "site1.sta1.ess1.pcs1.dc_voltage"
```

**从 HA 学到的关键点**: `unique_id` 是设备重连后自动恢复状态的唯一依据——我们给每个 EnergyNode 和 Tag 都加上。

#### B2. CoordinatorEntity（协调器实体）— 改造为 MqttService

**HA Coordinator 设计**: 统一管理数据轮询、失败退避、批量更新：

```python
# HA DataUpdateCoordinator
class DataUpdateCoordinator(Generic[DataT]):
    def __init__(
        self,
        hass: HomeAssistant,
        logger: logging.Logger,
        name: str,
        update_method: Callable[...],
        update_interval: timedelta | None = None,
    ):
        self.hass = hass
        self.logger = logger
        self.name = name
        self.update_method = update_method
        self.update_interval = update_interval
        
    async def _async_refresh(self) -> None:
        """执行一次数据刷新，含退避逻辑"""
        try:
            self.data = await self.update_method()
            self.last_update_success = True
            self._backoff = ...  # 成功则重置退避
        except Exception as err:
            self.last_update_success = False
            self._backoff *= 2    # 失败则指数退避
```

**Claw 对应实现**: MqttService 作为 MQTT 数据接入的 Coordinator：

```python
# backend/app/services/mqtt_service.py — 对标 HA DataUpdateCoordinator
import paho.mqtt.client as mqtt
from tenacity import (
    retry, stop_after_attempt, wait_exponential,
    retry_if_exception_type, before_sleep_log
)
from loguru import logger

class MqttService:
    """MQTT 数据接入协调器 — 对标 HA DataUpdateCoordinator"""
    
    def __init__(self, app_state: AppState):
        self.app_state = app_state
        self.client = None
        self._connected = False
        self._message_count = 0
        self._consecutive_errors = 0
        
    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type(ConnectionError),
        before_sleep=before_sleep_log(logger, logging.WARNING),
    )
    async def connect(self, host: str, port: int = 1883) -> None:
        """连接 MQTT Broker（含 tenacity 退避）"""
        self.client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.connect(host, port, keepalive=60)
        self.client.loop_start()
        
    def _on_connect(self, client, userdata, flags, rc, properties=None):
        """连接成功回调 — 订阅所有 Neuron 遥测 topic"""
        client.subscribe("neuron/+/telemetry")  # 通配符订阅
        logger.info(f"MQTT connected, subscribed to telemetry topics")
        
    def _on_message(self, client, userdata, msg):
        """消息接收回调 — 对标 HA Integration 的数据更新方法"""
        try:
            payload = json.loads(msg.payload)
            parsed = self._parse_telemetry(payload)   # 解析
            normalized = self._normalize(parsed)        # 归一化 (M3)
            self._persist(normalized)                   # 入库 (TSDB)
            
            # 触发内部事件 — 对标 HA state_changed 事件
            self._fire_event("telemetry_received", normalized)
            
            self._consecutive_errors = 0  # 成功，重置错误计数
            
        except Exception as e:
            self._consecutive_errors += 1
            logger.error(f"Message processing error ({self._consecutive_errors}): {e}")
            if self._consecutive_errors > 10:
                logger.critical("Too many consecutive errors, reconnecting...")
                self.reconnect()
                
    def _fire_event(self, event_type: str, data: dict):
        """内部事件广播 — 对标 hass.bus.async_fire()"""
        listeners = self.app_state.event_listeners.get(event_type, [])
        for callback in listeners:
            try:
                callback(data)
            except Exception as e:
                logger.error(f"Event listener error: {e}")
```

**从 HA 学到的**: 
1. 连续错误计数器 → 超过阈值主动重连
2. 退避策略 → tenacity 库完美替代手写逻辑
3. 事件解耦 → `_fire_event` 让数据处理和业务逻辑分离

#### B3. Lovelace Cards（声明式 UI 卡片）→ shadcn/ui 组件

**HA Lovelace 设计哲学**: 用户通过组合预定义卡片来构建 Dashboard，每张卡片是一个自包含的 Web Component。

**HA 内置卡片类型**:
- `sensor` — 显示传感器数值（带单位、图标、趋势箭头）
- `history-graph` — 时间序列折线图
- `gauge` — 仪表盘/速度计
- `entities` — 实体状态列表（开关、滑块、文本）
- `markdown` — 富文本卡片
- `picture-elements` — 可在图片上叠加控件

**Claw 对应映射**:

| HA Lovelace Card | Claw (shadcn/ui) | 用途 |
|-----------------|------------------|------|
| `sensor` + `entity` | `<Card>` + `<Metric>` 实时数值 | KPI 卡片 |
| `history-graph` | ECharts `line` 图 | 功率趋势图 |
| `gauge` | ECharts `gauge` 或自定义 SVG | SOC 电量环 |
| `entities` | `<Table>` + `<Switch>` / `<Slider>` | 设备控制面板 |
| `stack` | CSS Grid / Flexbox 布局容器 | Dashboard 分区 |
| `conditional` | React 条件渲染 | 告警高亮 |
| `button` | `<Button>` variant | RPC 控制按钮 |

**关键差异**: HA 用 YAML 声明式配置卡片，Claw 用 React 组件 + JSON 配置（更程序化、更灵活）。

#### B4. WebSocket 实时推送 → FastAPI WebSocket

**HA WebSocket API**:

```javascript
// HA 前端 WebSocket 订阅实时状态更新
const ws = new WebSocket(`ws://${ha_url}/api/websocket`);
ws.send(JSON.stringify({
    type: "subscribe_events",
    event_type: "state_changed",
}));
// 收到: {"event_type":"state_changed","data":{"entity_id":"sensor.temp","new_state":{"state":"22.5",...}}}
```

**Claw 实现**:

```python
# backend/app/api/ws.py — 对标 HA WebSocket API
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websocket"])
active_connections: list[WebSocket] = []

@router.websocket("/ws/telemetry/{tag_id}")
async def telemetry_ws(websocket: WebSocket, tag_id: str):
    """订阅单个点位的实时数据推送 — 对标 HA subscribe_events('state_changed')"""
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            # 保持连接活跃（心跳）
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        active_connections.remove(websocket)


# 在 MqttService._persist() 之后调用:
async def broadcast_telemetry(tag_value: TagValue):
    """向所有订阅者广播遥测数据 — 对标 HA state_changed 事件推送"""
    payload = {
        "type": "telemetry_update",
        "tag_id": tag_value.tag_id,
        "value": tag_value.value,
        "quality": tag_value.quality,
        "timestamp": tag_value.timestamp.isoformat(),
    }
    for ws in active_connections[:]:
        await ws.send_json(payload)
```

**前端消费** (react-query + WebSocket):

```typescript
// frontend/lib/useTelemetryWS.ts — 对标 HA Lovelace 实时更新机制
export function useTelemetryWebSocket(tagIds: string[]) {
  const [values, setValues] = useState<Record<string, number>>({});
  
  useEffect(() => {
    const ws = new WebSocket(`ws://${API_URL}/ws/batch`);
    
    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'telemetry_update') {
        setValues(prev => ({
          ...prev,
          [payload.tag_id]: payload.value,
        }));
      }
    };
    
    // 订阅指定 tags
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', tag_ids: tagIds }));
    };
    
    return () => ws.close();
  }, [tagIds]);
  
  return values;
}

// Dashboard 组件中使用
function TelemetryCard({ tagId }: { tagId: string }) {
  const values = useTelemetryWebSocket([tagId]);
  const value = values[tagId];
  
  return <Metric label={tagId} value={value ?? '--'} />;  // 实时更新
}
```

#### B5. Blueprint（蓝图）— 自动化模板复用

**HA Blueprint 允许用户创建自动化模板，然后通过填写参数快速复用**：

```yaml
# HA Blueprint 示例: 温度告警自动化
blue:
  name: Temperature Alert
  input:
    sensor_entity:
      name: Temperature Sensor
      selector:
        entity:
          domain: sensor
          device_class: temperature
    threshold:
      name: Alert Threshold (°C)
      default: 40
      selector:
        number:
          min: 0
          max: 100
trigger:
  - platform: numeric_state
    entity_id: !input sensor_entity
    above: !input threshold
action:
  - service: notify.notify
    data:
      message: "Temperature {{ states(input.sensor_entity) }}°C exceeds threshold!"
```

**OmniPower 对应**: GoRules JDM Rule Template

```json
{
  "rule_template_id": "rt_temp_alert",
  "name": "温度越限告警模板",
  "params": [
    {"key": "tag_id", "label": "监控点位", "type": "tag_selector"},
    {"key": "threshold", "label": "上限阈值", "type": "number", "default": 40},
    {"key": "severity", "label": "严重度", "type": "enum", "options": ["warning", "critical"]}
  ],
  "jdm": {
    "type": "decision-table",
    "rules": [
      { "condition": "{{value}} > {{threshold}}", "action": "create_alarm({{tag_id}}, '{{severity}}')" },
      { "condition": "{{value}} <= {{threshold}}", "action": "clear_alarm({{tag_id}})" }
    ]
  }
}
```

**价值**: 一个光储充项目通常有 10-50 个类似的告警规则，Blueprint/Template 可以将配置时间从数小时降到分钟级。

#### B6. Recorder（独立线程异步入库）

**HA Recorder 设计**: 状态变更不直接写 DB，而是由 Recorder 子系统在独立线程中异步批量写入，保证主 asyncio 循环不被 I/O 阻塞。

```python
# HA Recorder 核心逻辑（简化）
class Recorder(threading.Thread):
    def run(self):
        while not self.stop_event.is_set():
            events = self.event_queue.get_batch(timeout=1.0)
            if events:
                with self.get_session() as session:
                    for event in events:
                        session.add(StateChange(event))
                    session.commit()  # 批量提交
```

**Claw 对应**: psycopg2 `execute_values` 批量入库 + asyncio.to_thread

```python
# backend/app/services/recorder.py — 对标 HA Recorder
import psycopg2
from psycopg2.extras import execute_values

class TimescaleRecorder:
    """异步批量入库器 — 对标 HA Recorder（独立线程）"""
    
    BATCH_SIZE = 100       # 每 100 条一批
    FLUSH_INTERVAL = 5.0   # 或者每 5 秒刷新一次
    
    def __init__(self, db_url: str):
        self.buffer: list[TagValue] = []
        self._last_flush = time.time()
        
    async def add(self, tag_value: TagValue):
        """添加一条记录到缓冲区"""
        self.buffer.append(tag_value)
        
        if len(self.buffer) >= self.BATCH_SIZE:
            await self.flush()
        elif time.time() - self._last_flush >= self.FLUSH_INTERVAL:
            await self.flush()
            
    async def flush(self):
        """批量写入 TimescaleDB（在独立线程执行，不阻塞 asyncio 主循环）"""
        if not self.buffer:
            return
            
        batch = self.buffer[:]
        self.buffer.clear()
        self._last_flush = time.time()
        
        # 在线程池执行 DB 写入，不阻塞事件循环
        await asyncio.to_thread(self._do_insert, batch)
        
    def _do_insert(self, batch: list[TagValue]):
        """实际 SQL INSERT（在独立线程运行）"""
        conn = psycopg2.connect(self.db_url)
        rows = [(v.tag_id, v.value, v.quality, v.timestamp) for v in batch]
        
        execute_values(
            conn.cursor(),
            """
            INSERT INTO tag_values (tag_id, value, quality, timestamp)
            VALUES %s
            ON CONFLICT DO NOTHING
            """,
            rows
        )
        conn.commit()
        conn.close()
```

---

## 三、必须差异化的设计（4 项）

以下 HA 设计不适合工业 IoT 场景，我们需要走不同的路：

| # | HA 设计 | HA 适用原因 | OmniPower 替代 | 差异原因 |
|---|---------|------------|---------------|---------|
| D1 | **扁平 Entity** (`sensor.temp_livingroom`) | 家庭 50-150 设备，层级不重要 | **五层节点树** Site→Station→Node→Device→Tag | 工业 500-5000 点位，层级语义是核心需求 |
| D2 | **SQLite 默认存储** | &lt;50 设备够用，零运维 | **TimescaleDB Hypertable** | 万级点位高频写入，TSDB 压缩比 90%+，查询加速 160x |
| D3 | **YAML 手写配置** | 极客用户群体，灵活至上 | **Web UI 零代码配置** | 工程师/运维不是极客，要的是图形界面拖拽配置 |
| D4 | **单进程 asyncio** | 140 entities 仅占 CPU 3%，树莓派能跑 | **Docker Compose 多容器** | 工业可靠性要求：一个容器崩溃不影响其他，独立升级回滚 |

### D1 深度对比：扁平 vs 层级

```
HA 扁平模型（智能家居）:
  sensor.temperature_livingroom
  sensor.humidity_livingroom
  light.ceiling_main
  switch.ac_plug_1
  binary_sensor.door_front
  
  问题: 无法表达 "客厅里的空调插座属于客厅区域"
  解决: 靠 area_id 外键关联（弱语义）

Claw 层级模型（工业 IoT）:
  site: 华南光储充示范站
    station: A区储能电站
      energy_node: ESS-01 (储能柜)
        device: PCS-01 (变流器)
          tag: dc_bus_voltage (直流母线电压)
          tag: ac_output_power (交流输出功率)
        device: BMS-01 (电池管理)
          tag: soc (荷电状态)
          tag: cell_max_temp (电芯最高温度)
      energy_node: PV-01 (光伏阵列)
        device: INVERTER-01 (逆变器)
          
  优势: 层级即权限域、层级即查询范围、层级即拓扑结构
```

### D2 深度对比：SQLite vs TimescaleDB

| 维度 | HA (SQLite) | Claw (TimescaleDB) |
|------|------------|--------------------|
| 数据规模 | &lt;50 设备, 10 天历史 ≈ 100MB | 5000 点位, 1 年历史 ≈ 50GB (压缩后 5GB) |
| 写入性能 | ~1000 writes/s (足够家庭场景) | ~100,000 writes/s (工业高频) |
| 时间查询 | 全表扫描 O(n) | Hypertable 自动分区 O(log n) |
| 压缩 | 无 | Columnstore 90%+ 压缩率 |
| 聚合查询 | Python 端计算 | Continuous Aggregates 预聚合 |
| 保留策略 | 手动清理 | 自动 DROP old partitions |

---

## 四、HA 未提供但 OmniPower 必须有的能力

这些能力 HA 不需要（因为家庭场景没有），但对工业 IoT 平台至关重要：

| 能力 | 说明 | Claw 实现方案 |
|------|------|-------------|
| **虚拟点位公式引擎** | SymPy 计算 a*b+c, 聚合, 级联 | M5 VirtualEngine (纯函数) |
| **物理单位转换** | pint 库: kW↔MW, °C↉F | M3 Normalizer (pint) |
| **RPC 控制审计日志** | 谁、何时、写了什么值、设备返回什么 | M4 RpcController + audit_log 表 |
| **多租户/多站点** | 一个平台管 N 个场站 | Site 隔离 + RBAC 权限 |
| **工业级质量码** | good/uncertain/bad/initial | TagValue.quality 字段 |
| **控制链路安全** | 写入前校验权限/互锁/范围 | Rule Engine 先决条件检查 |
| **报表/导出** | 运维报告、账单、合规导出 | M6 pandas 报表服务 |

---

## 五、融入计划：哪些改现有文档，哪些是新工作

| HA 发现 | 影响 | 行动 |
|---------|------|------|
| `hass` 单入口模式 | g4 M0 脚手架设计 | 更新 `backend/app/core/app_state.py` 设计 |
| Entity Registry → 五层树 | 已在 arch-v1 定义 | 确认一致，无需改动 |
| CoordinatorEntity 退避模式 | g4 M2 MQTT 设计 | 补充连续错误计数器和主动重连逻辑 |
| Immutable State Snapshot | arch-v1 TagValue 模型 | 加 `frozen=True` 或等效约束 |
| WebSocket 推送模式 | g8 UI 规格 M12 | 已有，确认与 HA API 对齐 |
| Recorder 异步批量入库 | g4 M2 性能设计 | 新增 `recorder.py` 模块定义 |
| Blueprint → Rule Template | g4 M7 规则引擎 | 新增 Rule Template 概念 |

---

## 六、总结

```
HA 对 OmniPower 的借鉴价值评估:

  直接吸收（不改就搬）:     ████████████████████ 12 项 (A1-A4 架构原则 + 8 个设计细节)
  适配改造（换壳留核）:     ██████████████ 6 项 (B1-B6 技术组件)
  必须差异化（完全不同）:   ████ 4 项 (D1-D4)
  HA 没有 but 我们必须有:   ██████████ 7 项 (虚拟点位/单位转换/RPC审计...)

结论: HA 提供了经过百万级部署验证的事件驱动架构骨架，
     我们在这个骨架上长出工业 IoT 所需的层级模型和时序能力。
     大约 70% 的架构思路可以复用, 30% 需要针对工业场景创新。
```
