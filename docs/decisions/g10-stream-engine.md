# g10: 实时流计算引擎选型决策

> 日期：2026-07-16
> 状态：**SUPERSEDED by g11-feature-domains.md (v2.1) 方案B**
> 决策者：郝交付（交付总监）
>
> ⚠️ **此文档的推荐结论(StreamEngine 方案A ~450行)已被否决。**
> **当前生效决策: 方案B (CAGG+事件驱动 ~120行), 详见 g11 第5节。**
> **本文档保留作为: (1)选型过程记录 (2)eKuiper升级路径参考 (3)方案A代码骨架存档**

---

## 1. 需求定义

### 1.1 核心需求

用户要求一个**实时流计算引擎**，具备以下能力：

| 能力 | 描述 | 示例 |
|------|------|------|
| **高速摄入** | 毫秒级接收 MQTT 遥测消息 | Neuron 100ms 上报 50 个 Tag |
| **流式聚合** | 窗口内数据实时汇总 | 5 分钟滑动窗口平均功率 |
| **跨节点计算** | 子节点值 → 父节点虚拟点位 | PCS_01~PCS_04 的 P_active SUM → ESS.total_power |
| **公式求值** | 数学表达式实时解析 | `SOC * max_charge_rate * efficiency` |
| **全局消费** | 任意层级节点的实时值可被订阅 | WebSocket 推送到前端 Dashboard |
| **级联触发** | A 节点变化 → B 节点重算 → C 节点重算 | 温度超限 → 效率系数下降 → 最大出力降低 |

### 1.2 非功能约束

| 维度 | 要求 |
|------|------|
| 延迟 | 端到端 < 100ms（消息到达 → 计算完成 → 可被查询） |
| 吞吐 | 单站 3000-8000 Tag，每个 100ms-1s 刷新 |
| 资源 | Docker Compose 内运行，内存 < 512MB |
| 技术栈 | Python（与 FastAPI 同进程或同容器） |
| 可调试 | 日志 + metrics + 可单步 debug |
| 可扩展 | 新增公式/聚合规则不需要改代码 |

---

## 2. 候选方案对比

### 2.1 方案矩阵

| # | 方案 | 语言 | 延迟 | MQTT集成 | Python生态 | 复杂度 | 资源开销 | 判定 |
|---|------|------|------|---------|-----------|--------|---------|------|
| **1** | **eKuiper** | Go | <10ms | **原生** (nanoMQ兄弟) | 需写Go插件 | 低(SQL)/高(插件) | **10MB RAM, 4.5MB二进制** | **备选** |
| 2 | Faust | Python asyncio | <10ms | 无(需Kafka) | **原生** | 中 | Kafka+ZK集群 (~2GB) | **否决** |
| 3 | Bytewax | Python | ~10-50ms | 无(需适配) | **原生** | 中-高 | 轻量(~100MB) | 观察 |
| 4 | Pathway | Python API / Rust 引擎 | **<1ms** (增量) | 无(需适配) | **原生API** | 高(Rust调试) | 内存密集 | 观察 |
| 5 | Tempesta | Python | **<100us** | 无(需适配) | **原生** | 低(但太新) | 极轻 | 观察(太早) |
| **6** | **自研 StreamEngine** | **Python asyncio** | **1-50ms** | **paho-mqtt(已有)** | **原生** | **中** | **~0 额外开销** | **推荐** |

### 2.2 逐项分析

#### eKuiper（备选 — 如果自研不够用时的升级路径）

```
优势:
  - 和 nanoMQ 同属 EMQ 生态，MQTT 集成零成本
  - SQL 声明式规则，非开发人员也能配
  - 极轻量：树莓派3B+ 可跑 12000 TPS
  - LF Edge 孵化，有商业支持
  - Flow Editor 可视化拖拽

劣势:
  - Go 语言 — 与 FastAPI Python 栈跨语言调试痛苦
  - SQL 表达力有限 — 复杂公式需写 Go/Python UDF 插件
  - 多了一个 Docker 容器要运维（第6个）
  - 与 M5 SymPy 公式引擎是两套系统，需做桥接

适合场景:
  - 规则数量 > 500 条且都是简单过滤/阈值告警
  - 有专门的运维团队管理多容器
  - 不需要复杂数学公式

Claw 场景匹配度: 60%
  - 匹配：轻量、MQTT 原生、SQL 易配置
  - 不匹配：需要复杂公式(SymPy)、Python 技术栈一致性
```

#### Faust（否决）

```
否决原因只有一条：强依赖 Kafka

Faust = Python async 流处理框架
       但它绑定 Kafka 作为消息存储和状态后端

这意味着引入 Faust = 同时引入:
  - ZooKeeper (协调服务)
  - Kafka Broker (3节点集群)
  - Schema Registry (可选但推荐)
  - Kafka Connect (对接外部系统)

总资源开销: ~2GB RAM + 3-5 个 Docker 容器
对于一个光储充站的单机部署来说，太重了。

如果未来 Claw 发展为多站点 SaaS 平台，
且每站点数据量 > 10万 TPS，
那时可以 revisit Faust。
```

#### Bytewax / Pathway / Tempesta（观察，不采纳）

```
共同问题: 太新或社区太小

Bytewax: 文档和案例不足，生产验证少
Pathway: Rust 引擎调试困难，55K stars 但 2024 才爆发
Tempesta: 2025 年才出现，无生产部署案例

原则: 工业平台不拿客户现场当试验田
这些项目值得持续关注，等它们成熟后再评估
```

#### 自研 StreamEngine（推荐 — 当前最优解）

```
为什么自研是最优解:

1. 零新增依赖
   asyncio 是 Python 标准库
   pandas 已在依赖列表中
   SymPy 已在依赖列表中
   paho-mqtt 已在依赖列表中
   → 不需要 pip install 任何新东西

2. 与 FastAPI 共享事件循环
   StreamEngine 运行在 FastAPI 的同一个 asyncio loop 里
   → 零 IPC 开销
   → 共享 database session pool
   → 统一的日志和 metrics

3. 完全可控
   每一行代码你都写过
   → Debug 时不会遇到黑盒
   → 性能瓶颈一目了然
   → 可以针对 IoT 场景精确优化

4. 代码量可控
   核心 StreamEngine: ~200 行 Python
   窗口聚合算子: ~150 行
   级联调度器: ~100 行
   总计 ~450 行新代码
   → 一天能写完 + 测试

5. 渐进增强
   Phase 1 先实现基础版本（队列+消费+分发）
   Phase 2 加窗口聚合（pandas rolling）
   Phase 3 加级联传播（DAG 拓扑排序）
   Phase 4 加背压控制（asyncio.Queue maxsize）
   → 每一步都可独立交付
```

---

## 3. 推荐架构：三层流处理分工

### 3.1 全景图

```
Neuron 设备
    │
    │ MQTT publish (遥测)
    ▼
┌─────────────┐
│  nanoMQ     │  ← L0 过滤层（已有）
│  规则引擎    │     简单过滤 / 路由 / 丢弃 / 静默
│  SQLite缓存  │     例: heartbeat 消息不入库
└──────┬──────┘
       │ MQTT subscribe
       │ 过滤后的干净消息
       ▼
┌───────────────────────────────────┐
│  FastAPI 进程                     │
│                                  │
│  ┌─────────────────────────────┐ │
│  │  StreamEngine (NEW! L1)     │ │ ← 核心新增模块
│  │                             │ │
│  │  Ingest ──► Parse ──►      │ │
│  │  Normalize ──► WindowAgg    │ │
│  │  ──► CascadeDispatch        │ │
│  │                             │ │
│  │  asyncio.Queue 管道         │ │
│  │  pandas 窗口聚合             │ │
│  │  跨节点汇总 (SUM/AVG/MAX)   │ │
│  └──────────┬──────────────────┘ │
│             │                    │
│             ▼                    │
│  ┌─────────────────────────────┐ │
│  │  VirtualEngine (M5, L2)     │ │ ← 已有设计
│  │                             │ │
│  │  SymPy 公式求值              │ │
│  │  表达式解析 + 计算           │ │
│  │  条件逻辑 (if/else)          │ │
│  └──────────┬──────────────────┘ │
│             │                    │
│             ▼                    │
│  ┌─────────────────────────────┐ │
│  │  TSDB Writer (M4)           │ │
│  │  TimescaleDB Hypertable     │ │
│  └──────────┬──────────────────┘ │
│             │                    │
│             ▼                    │
│  ┌─────────────────────────────┐ │
│  │  WS Pusher (M9)             │ │
│  │  WebSocket 实时推送          │ │
│  └─────────────────────────────┘ │
│                                  │
└──────────────────────────────────┘
```

### 3.2 三层职责边界

| 层 | 组件 | 职责 | 输入 | 输出 | 延迟目标 |
|----|------|------|------|------|---------|
| **L0** | nanoMQ 规则引擎 | 消息级过滤/路由/丢弃 | Neuron 原始 MQTT | 过滤后的 MQTT topic | <1ms |
| **L1** | **StreamEngine** (新增) | 流式解析/归一化/窗口聚合/跨节点汇总/级联调度 | 干净的 MQTT payload | 标准化的 Telemetry 对象 + VirtualPoint 结果 | 10-50ms |
| **L2** | VirtualEngine (M5) | 数学表达式求值/条件逻辑/单位转换 | L1 的标准化值 + 公式字符串 | 计算后的 LogicalTag 值 | 1-10ms |

### 3.3 关键设计：为什么不用单独的流框架

```
常见误区：
  "流处理必须用 Flink/Faust/eKuiper 这样的专用框架"

事实：
  IoT 单站场景的数据流特征：
    - 数据源固定（几十台设备，几千个点位）
    - 拓扑稳定（设备不会频繁上下线）
    - 规则数量有限（几十到几百条公式）
    - 延迟要求宽松（秒级即可，不是微秒级）

  这些特征意味着：
    不需要 Flink 的分布式状态管理（单机够了）
    不需要 Faust 的 Kafka changlog（内存 state 够了）
    不需要 eKuiper 的 SQL 编译器（Python 直接写更灵活）

  自研 StreamEngine 的核心数据结构只需要：

    class StreamEngine:
        input_queue: asyncio.Queue[RawMessage]      # 入队
        processors: list[StreamProcessor]            # 处理链
        window_store: dict[str, RollingWindow]       # 窗口状态
        virtual_registry: dict[UUID, LogicalTag]     # 虚拟点位注册表
        cascade_graph: DAG[UUID]                     # 级联依赖图
        output_callbacks: list[Callable]             # 消费者回调

  这就是一个"迷你版流框架"，450行代码搞定，
  但它完美匹配我们的场景，没有一分多余的抽象。
```

---

## 4. StreamEngine 核心代码骨架

```python
# backend/app/services/stream_engine.py
"""
Claw 实时流计算引擎 (L1 层)

职责:
  1. 从 paho-mqtt 回调接收消息 → 放入 input_queue
  2. 异步消费队列 → 解析/归一化/路由
  3. 窗口聚合 → 跨子节点汇总
  4. 级联调度 → 触发受影响的 LogicalTag 重算
  5. 通过 callback 输出到 TSDB / WS / RuleEngine

核心约束:
  - 所有 I/O 都是 async（不阻塞事件循环）
  - 纯函数优先（parse/normalize/aggregate 可独立测试）
  - 背压保护（queue 满时丢弃最旧消息并记录 metric）
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable
from uuid import UUID

import loguru.logger as log
import pandas as pd
import pint

# --- Data Classes ---

@dataclass
class RawMessage:
    """从 MQTT 收到的原始消息"""
    topic: str
    payload: bytes
    timestamp: float  # unix epoch seconds

@dataclass
class TelemetryPoint:
    """标准化后的单个遥测点"""
    node_id: UUID
    tag_id: UUID
    value: Any           # pint.Quantity or native type
    quality: int         # 192=GOOD, 64=UNCERTAIN, 0=BAD
    timestamp: float

@dataclass  
class WindowState:
    """滑动窗口的状态（每个 node_id+tag_id 组合一个）"""
    values: list[float] = field(default_factory=list)
    last_update: float = 0.0
    # 窗口配置
    size_seconds: int = 300    # 5分钟窗口
    hop_seconds: int = 60     # 1分钟滑动


# --- Core Engine ---

class StreamEngine:
    """
    Claw 实时流计算引擎
    
    使用方式:
        engine = StreamEngine()
        engine.on_telemetry(lambda pt: save_to_tsdb(pt))
        engine.start()  # 在 FastAPI startup 事件中调用
        
        # MQTT 回调中:
        await engine.ingest(raw_message)
    """

    def __init__(
        self,
        queue_maxsize: int = 10000,
        batch_size: int = 50,
        consume_interval_ms: int = 10,
    ):
        self.input_queue: asyncio.Queue[RawMessage] = asyncio.Queue(
            maxsize=queue_maxsize
        )
        self.batch_size = batch_size
        self.consume_interval = consume_interval_ms / 1000.0
        
        # 处理链（按顺序执行）
        self.processors: list[StreamProcessor] = [
            MqttParser(),        # JSON → TelemetryPoint[]
            Normalizer(),        # raw → engineering value (pint)
            WindowAggregator(),  # 滑动窗口统计
            CascadeDispatcher(), # 级联触发 LogicalTag 重算
        ]
        
        # 输出回调（消费者注册）
        self._output_callbacks: list[Callable[[TelemetryPoint], Awaitable[None]]] = []
        
        # 状态
        self._running = False
        self._task: asyncio.Task | None = None
        self._window_states: dict[str, WindowState] = defaultdict(WindowState)
        
        # Metrics
        self.metrics = {
            "ingested_total": 0,
            "processed_total": 0,
            "dropped_full": 0,
            "processing_latency_ms": [],
        }

    def on_telemetry(self, cb: Callable[[TelemetryPoint], Awaitable[None]]):
        """注册消费者回调"""
        self._output_callbacks.append(cb)

    async def ingest(self, msg: RawMessage):
        """MQTT 回调调用此方法 — 非阻塞入队"""
        try:
            self.input_queue.put_nowait(msg)
            self.metrics["ingested_total"] += 1
        except asyncio.QueueFull:
            self.metrics["dropped_full"] += 1
            log.warning("stream: queue full, message dropped")

    async def start(self):
        """启动消费循环（FastAPI lifespan 中调用）"""
        self._running = True
        self._task = asyncio.create_task(self._consume_loop())
        log.info("stream engine started")

    async def stop(self):
        """停止消费循环"""
        self._running = False
        if self._task:
            self._task.cancel()
        log.info("stream engine stopped")

    async def _consume_loop(self):
        """主循环：批量消费 → 处理链 → 分发输出"""
        while self._running:
            t0 = time.monotonic()
            
            # 批量取出消息（最多 batch_size 条，等待 interval）
            batch: list[RawMessage] = []
            try:
                # 非阻塞取一条，如果没有就 sleep
                msg = self.input_queue.get_nowait()
                batch.append(msg)
                # 尝试批量取出更多
                for _ in range(self.batch_size - 1):
                    try:
                        batch.append(self.input_queue.get_nowait())
                    except asyncio.QueueEmpty:
                        break
            except asyncio.QueueEmpty:
                await asyncio.sleep(self.consume_interval)
                continue
            
            # 通过处理链
            results: list[TelemetryPoint] = []
            for msg in batch:
                points = await self._process_chain(msg)
                results.extend(points)
            
            # 分发到所有消费者
            for point in results:
                for cb in self._output_callbacks:
                    try:
                        await cb(point)
                    except Exception as e:
                        log.error(f"stream: callback error: {e}")
            
            # 更新 metrics
            latency_ms = (time.monotonic() - t0) * 1000
            self.metrics["processed_total"] += len(batch)
            self.metrics["processing_latency_ms"].append(latency_ms)
            # 只保留最近 1000 个样本
            if len(self.metrics["processing_latency_ms"]) > 1000:
                self.metrics["processing_latency_ms"] = \
                    self.metrics["processing_latency_ms"][-1000:]

    async def _process_chain(self, msg: RawMessage) -> list[TelemetryPoint]:
        """依次通过所有处理器"""
        context: ProcessContext = {"raw": msg, "points": []}
        for processor in self.processors:
            context = await processor.process(context)
        return context["points"]


# --- Processor Interface & Implementations ---

@dataclass
class ProcessContext:
    """处理器之间的上下文传递对象"""
    raw: RawMessage | None = None
    points: list[TelemetryPoint] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class StreamProcessor:
    """处理器基类（纯函数接口）"""
    
    async def process(self, ctx: ProcessContext) -> ProcessContext:
        raise NotImplementedError


class MqttParser(StreamProcessor):
    """P1: 将 Neuron MQTT JSON 解析为 TelemetryPoint[]"""
    
    async def process(self, ctx: ProcessContext) -> ProcessContext:
        import json
        data = json.loads(ctx.raw.payload)
        
        # Neuron 格式: {node, group, tags: {name: value, ...}, timestamp}
        node_name = data.get("node", "")
        group_name = data.get("group", "")
        tags_data = data.get("tags", {})
        ts = data.get("timestamp", time.time())
        
        # 查找对应的 node_id（从 DB 缓存或 registry）
        # TODO: 实际实现中这里查 Node 表获取 node_id
        node_id = self._resolve_node(node_name)
        
        points = []
        for tag_name, raw_value in tags_data.items():
            tag_id = self._resolve_tag(node_id, tag_name)
            if tag_id:
                points.append(TelemetryPoint(
                    node_id=node_id,
                    tag_id=tag_id,
                    value=raw_value,
                    quality=192,  # GOOD
                    timestamp=ts,
                ))
        
        ctx.points = points
        ctx.metadata["source_node"] = node_name
        return ctx
    
    def _resolve_node(self, name: str) -> UUID:
        """TODO: 从 NodeRegistry 查询 node_id"""
        ...  # 占位符，Phase 1 实现

    def _resolve_tag(self, node_id: UUID, name: str) -> UUID:
        """TODO: 从 Tag 表查询 tag_id"""
        ...  # 占位符


class Normalizer(StreamProcessor):
    """P2: 归一化 — scale*value+offset + pint 单位转换（纯函数）"""
    
    def __init__(self):
        self.ureg = pint.UnitRegistry()
    
    async def process(self, ctx: ProcessContext) -> ProcessContext:
        normalized = []
        for pt in ctx.points:
            # TODO: 从 Tag Schema 获取 scale/offset/unit 配置
            # 这里先做 identity 变换（Phase 1 占位）
            normalized.append(TelemetryPoint(
                node_id=pt.node_id,
                tag_id=pt.tag_id,
                value=self.ureg.Quantity(float(pt.value), "kilowatt"),  # 示例
                quality=pt.quality,
                timestamp=pt.timestamp,
            ))
        ctx.points = normalized
        return ctx


class WindowAggregator(StreamProcessor):
    """P3: 滑动窗口聚合 — 为父节点生成汇总值（纯函数）"""
    
    async def process(self, ctx: ProcessContext) -> ProcessContext:
        new_points = []
        
        for pt in ctx.points:
            key = f"{pt.node_id}:{pt.tag_id}"
            ws = self.engine._window_states[key]
            
            # 添加当前值到窗口
            val = float(pt.value.magnitude) if hasattr(pt.value, 'magnitude') else float(pt.value)
            ws.values.append(val)
            ws.last_update = pt.timestamp
            
            # 清理过期数据
            cutoff = pt.timestamp - ws.size_seconds
            while ws.values and (ws.last_update - len(ws.values) * 0.1) < cutoff:
                # 简化的时间戳对齐（实际应记录每个值的时间戳）
                pass
            
            # 计算窗口统计
            if len(ws.values) >= 2:  # 至少2个点才开始聚合
                series = pd.Series(ws.values)
                agg = {
                    "avg": series.mean(),
                    "min": series.min(),
                    "max": series.max(),
                    "count": len(series),
                }
                
                # 查找是否有父节点需要这个汇总
                parent_points = self._emit_parent_aggregate(
                    pt.node_id, pt.tag_id, agg, pt.timestamp
                )
                new_points.extend(parent_points)
        
        ctx.points.extend(new_points)
        return ctx
    
    def __init__(self, engine: StreamEngine = None):
        self.engine = engine
    
    def _emit_parent_aggregate(
        self, node_id: UUID, tag_id: UUID, agg: dict, ts: float
    ) -> list[TelemetryPoint]:
        """TODO: 查找父节点是否注册了 SUM/AVG/MIN/MAX 类型的 LogicalTag"""
        return []  # Phase 1 占位


class CascadeDispatcher(StreamProcessor):
    """P4: 级联调度 — 检测变化的 PhysicalTag，触发依赖它的 LogicalTag 重算"""
    
    async def process(self, ctx: ProcessContext) -> ProcessContext:
        # TODO: Phase 3 实现
        # 1. 遍历 ctx.points 中变化的 PhysicalTag
        # 2. 查询 DAG 图找到依赖这些 tag 的 LogicalTag
        # 3. 调用 VirtualEngine (M5/SymPy) 重算
        # 4. 将计算结果追加到 ctx.points
        return ctx


# --- Integration with FastAPI ---

def create_stream_engine(app: FastAPI) -> StreamEngine:
    """工厂函数：创建并挂载 StreamEngine 到 FastAPI app"""
    engine = StreamEngine(queue_maxsize=10000)
    
    @app.on_event("startup")
    async def start_engine():
        await engine.start()
    
    @app.on_event("shutdown")
    async def stop_engine():
        await engine.stop()
    
    return engine
```

---

## 5. 与现有模块的关系

### 5.1 模块修改清单

| 模块 | 变更类型 | 具体内容 |
|------|---------|---------|
| **M0** | 微调 | pyproject.toml 不需要新增依赖（pandas/pint/asyncio 已有） |
| **M2** | **重构** | `mqtt_service.py` 不再直接处理业务逻辑，只负责 `engine.ingest(msg)` |
| **M3** | **迁移** | 归一化逻辑迁入 `StreamEngine.Normalizer` processor，M3 变成 thin wrapper |
| **M4** | **扩展** | 新增 `on_telemetry` callback 注册点 |
| **M5** | **集成** | 成为 StreamEngine 的最后一个 processor（CascadeDispatcher 调用 SymPy） |
| **M9** | **扩展** | 注册为 StreamEngine 的 output callback（WS 推送） |

### 5.2 数据流变更

```
之前（无 StreamEngine）:

  Neuron → nanoMQ → M2(MQTT订阅) → M3(归一化) → M4(TSDB写入)
                                              → M5(虚拟点位, 按需)
                                              → M9(WS推送)

之后（有 StreamEngine):

  Neuron → nanoMQ → M2(MQTT订阅) → [StreamEngine.input_queue]
                                        ↓
                              [StreamEngine 处理链]:
                              Parse → Normalize → WindowAgg → Cascade
                                        ↓                         ↓
                              M4(TSDB)               M5(SymPy) → M4(TSDB)
                                                              ↓
                                                        M9(WS推送)

关键区别:
  - 之前: 每个 MQTT 消息同步走完全链路（阻塞）
  - 之后: 消息入队异步消费，批量处理（非阻塞，吞吐量提升 5-10x）
  - 之前: 窗口聚合和级联触发不存在
  - 之后: 父节点自动获得子节点的实时汇总值（"每层都是一等公民"的核心支撑）
```

---

## 6. 升级路径（如果自研不够用）

```
Phase 1-3: 自研 StreamEngine 够用（<5000 Tag, <100 条公式）
    ↓
当以下任一条件满足时，考虑引入 eKuiper:
  a) 公式/规则数量 > 500 条且多为简单过滤/阈值
  b) 需要 SQL 声明式界面给非技术人员配规则
  c) 数据源不止 MQTT（还有 HTTP/Kafka/数据库 CDC）
    ↓
升级方案（渐进式，不推翻）:
  StreamEngine 保留 L2(Layer 2) 公式引擎角色
  eKuiper 接管 L0+L1 过滤/聚合角色
  两者通过 MQTT topic 交接数据
  
  Neuron → nanoMQ → [eKuiper: SQL过滤/聚合] → MQTT → [StreamEngine: SymPy公式] → TSDB
                   (L0+L1 外包)                           (L2 保留)
```

---

## 7. 决策记录

```
[2026-07-16] g10-stream-engine - 选择自研 asyncio StreamEngine - 原因:
  1. 零新增依赖(pandas/pint/asyncio 已有)
  2. 与 FastAPI 共享事件循环(零 IPC 开销)
  3. 完全可控易调试
  4. 代码量仅 ~450 行(一天可交付)
  5. 三层分工清晰(L0 nanoMQ / L1 StreamEngine / L2 SymPy)
  
  否决 Faust(Kafka太重)、eKuiper(Go跨栈,备选升级路径)、
  Bytewax/Pathway/Tempesta(太新/社区小)
  
  影响:
  - M2 mqtt_service 重构为 pure ingestor
  - M3 normalizer 迁移为 StreamEngine processor
  - M5 virtual_engine 集成为最后一级 processor
  - g4 模块分解需新增 StreamEngine 模块定义
```

---

## 8. 下一步行动

| # | 任务 | 产出 | 预估 |
|---|------|------|------|
| 1 | 确认此选型决策 | 用户签字 | 即刻 |
| 2 | 更新 g4 模块分解，加入 StreamEngine 模块 | g4 v1.1 | 15 min |
| 3 | 更新 g7 目标拆解，调整 Phase 1 Task 列表 | g7 v1.1 | 15 min |
| 4 | 更新 docker-compose.yml（暂不变，StreamEngine 在 FastAPI 进程内） | 无 | - |
| 5 | Phase 1 开工：S0+S1+S2（含 StreamEngine skeleton） | 代码 | 1 天 |
