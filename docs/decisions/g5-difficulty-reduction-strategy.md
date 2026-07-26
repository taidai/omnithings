# G5: 降低实现和调试难度的实施策略

**状态**: 2026-07-13 23:19 输出
**目的**: 基于 12 模块拆分 + 高杠杆库 + 审查风险，给出可执行的降难度方法论
**核心主张**: 不是"写得更聪明"，而是"让每一步都不可失败"

---

## 一、五层防御体系（从编码到回滚）

### L1: 纯函数优先 — 调试难度降 70%

**原则**: 有依赖外部服务的模块先放最后写。纯函数模块（输入→输出）最先写、最先测、最先交付。

**适用模块**:
| 模块 | 输入 | 输出 | 依赖外部？ | 测试方式 |
|------|------|------|-----------|---------|
| **M3 Normalizer** | dict (原始值) | dict (归一化值) | **无** | pytest 直接跑 |
| **M5 VPE (核心逻辑)** | dict (缓存+公式) | float (计算结果) | **无** | pytest 直接跑 |
| **M1 Node Model** | SQLModel CRUD | JSON | 只需 SQLite 内存库 | pytest + in-memory DB |

**执行顺序**: M3 → M5(核心计算) → M1 → 其他

**为什么有效**: 纯函数的 bug 只有两种可能——输入错或算法错。没有网络超时、没有数据库锁、没有 MQTT 断连。`pytest` 跑一遍就知道对不对。

```python
# M3 的测试——不需要启动任何服务：
def test_normalizer_scale_offset():
    n = DataNormalizer()
    result = n.normalize(
        device_path="test",
        raw_values={"activePower": 45000, "soc": 852},
        tag_configs={
            "activePower": {"scale_factor": 0.001, "field_alias": "activePower_kW"},
            "soc":          {"scale_factor": 0.1,   "field_alias": "soc_pct"},
        }
    )
    assert result["activePower_kW"] == 45.0
    assert result["soc_pct"] == 85.2

# M5 的测试——不需要任何基础设施：
def test_vpe_expression():
    vpe = VirtualPointEngine()
    vpe.register_logical_tag("vp_efficiency", formula="(dc/ac)*100", sources=["dc","ac"])
    
    result = vpe.on_physical_update("pcs_01", "dc", 15.0)
    assert result is None  # dc 到了，ac 还没
    
    result = vpe.on_physical_update("pcs_01", "ac", 20.0)
    assert abs(result["vp_efficiency"] - 75.0) < 0.01  # (15/20)*100
```

---

### L2: 桩集成 — 集成痛苦降 60%

**原则**: 先用假数据跑通全链路，再逐个替换成真实组件。

**每个有依赖模块的三步走**:

```
Step 1: Stub 阶段（30 分钟）
  ┌─ M2 on_message → print(payload)                    ← 确认消息能收到
  └─ M4 batch_insert → print(rows, count="N rows")      ← 确认数据能到这

Step 2: Fake 注入阶段（1 小时）
  ┌─ M2 on_message → FakeNormalizer (直接返回 input)     ← 确认调用链通
  │               → FakeStore (print 不入库)             ← 确认下游被调
  └─ M4 batch_insert → 本地 SQLite (不连 TimescaleDB)     ← 确认写入逻辑对

Step 3: 真实集成阶段（按需）
  ┌─ 替换 FakeNormalizer → real DataNormalizer (M3)
  └─ 替换 FakeStore → real TelemetryWriter + psycopg2 (M4)
```

**关键规则**: Step 1 和 Step 2 不算"完成"，但必须通过才能进入 Step 3。这样当你最终做真实集成时，**唯一可能出问题的是真实组件本身**，不是你的代码。

---

### L3: 全量可观测 — 排因时间降 50%

**原则**: loguru Day 1 引入。每个模块入口和出口都有结构化日志。异常自动打印变量值。

**统一日志模板**:

```python
# backend/app/core/logging.py — 全局初始化（Day 1 写一次）
from loguru import logger
import sys

logger.remove()  # 移除默认 handler
logger.add(
    sys.stderr,
    format="{time:HH:mm:ss.SSS} | {level:<7} | {name}:{line} | {message}",
    level="DEBUG",
)
logger.add(
    "logs/claw_{time:YYYY-MM-DD}.log",
    rotation="500 MB",
    retention="14 days",     # 开发阶段只保留 14 天
    compression="gz",       # 自动压缩旧日志
    diagnose=True,           # 异常时自动打印变量值 ★
)

# 每个模块的标准用法：
class DataNormalizer:
    def normalize(self, device_path: str, raw_values: dict, tag_configs: dict) -> dict:
        logger.debug("[M3] normalize start: path={}, fields={}", device_path, list(raw_values.keys()))
        
        result = {}
        for field, value in raw_values.items():
            cfg = tag_configs.get(field)
            if not cfg:
                logger.debug("[M3] skip unregistered field: {}", field)
                continue
            
            try:
                converted = self._convert(field, value, cfg)
                result[cfg["field_alias"]] = converted
                logger.debug("[M3] {} → {}: raw={} result={}", field, cfg["field_alias"], value, converted)
            except Exception as e:
                # diagnose=True 会自动打印 cfg 和 value 的值！
                logger.warning("[M3] convert failed: field={} error={}", field, e)
                result[cfg["field_alias"]] = None
        
        logger.info("[M3] normalize done: path={}, output_fields={}", device_path, list(result.keys()))
        return result
```

**日志级别约定**:

| 级别 | 用途 | 示例 |
|------|------|------|
| DEBUG | 每条数据的处理细节 | `[M3] activePower → activePower_kW: raw=45000 result=45.0` |
| INFO | 模块级事件（开始/结束/统计） | `[M3] normalize done: path=xxx, output_fields=[...]` |
| WARNING | 可恢复的数据异常 | `[M3] convert failed: field=xxx error=...` |
| ERROR | 需要关注的系统异常 | `[M2] MQTT connection lost: broker=nanomq:1883` |
| CRITICAL | 影响业务连续性的事件 | `[M7] Neuron JWT expired, all RPC blocked` |

---

### L4: 每个模块一个 Checkpoint — 回滚成本降 80%

**原则**: 每个 Module DoD checklist 全部勾选后，打一个 git tag。任何时刻出问题，最多回退 1 个模块的工作量。

**Tag 规范**:
```
v0.1-m0      — Docker Compose 五容器联通
v0.1-m1      — Node 模型 CRUD API + 8 个单测通过
v0.1-m3      — Data Normalizer + 5 个单测通过
v0.1-m5-core — VPE 核心计算 + 10 个单测通过
v0.1-m2-stub — MQTT 收消息打日志（Stub 阶段）
v0.1-m2-real — MQTT 全链路集成完成
...
```

**回滚操作**（假设 M5 集成后发现设计缺陷）:
```bash
# 查看最近的 checkpoint
git tag -l "v0.1-*" --sort=-version:refname | head -10

# 回退到 M5 之前的稳定状态（保留工作区修改）
git checkout v0.1-m3

# 或者完全丢弃 M4/M5 的改动
git reset --hard v0.1-m3
```

**最大损失控制**: 最坏情况只损失 1 个模块的开发时间（1-2 天），而不是整个 Phase。

---

### L5: 并行编写，串行集成 — 进度风险降 55%

**原则**: 无互相依赖的模块可以同时写；但有依赖关系的必须串行集成。

**并行编写矩阵**:

```
Day 1-3 (并行):
┌─── M0: Docker Compose (独立)
├─── M1: Node 模型 (独立)
└─── M3: Normalizer (纯函数，独立)

Day 3-5 (串行集成):
M1 完成 → M2 可以开始 (M2 依赖 M1 的节点查询)
M3 完成 → M5 核心可以开始 (M5 不依赖 M3，但测试数据格式要对齐)

Day 6-8 (并行):
├─── M2: MQTT 全链路 (依赖 M1+M3)
├─── M5: VPE 完善 (独立，纯函数)
└─── M4: TSDB 存储 (依赖 M1 建表)

Day 9-12 (串行集成):
M2+M4 完成 → M9 WS 推送可以开始
M5 完成 → M6 GoRules 可以开始（M6 是最复杂的，放最后）
```

**禁止并行的组合**:
| 组合 | 为什么不能并行 |
|------|--------------|
| M1 和 M2 | M2 需要 M1 的节点树来路由消息 |
| M4 和 M11 | M11 报表依赖 M4 的数据模型 |
| M6 和 M10 | M6 的 JDM Editor 是 M10 RuleDesigner 页面的子功能 |

---

## 二、每个 Phase 的具体执行策略

### Phase 1 (Day 1-5): 骨架 + 消息链路

**目标**: `docker compose up` 后能看到数据在流动

**每日计划**:

| Day | 任务 | 产出 | 验收 |
|-----|------|------|------|
| D1 | Fork fastapi-template + Docker Compose 五容器 | docker-compose.yml, .env | `docker ps` 显示 5 healthy |
| D2 | loguru 初始化 + Node 数据模型 + PropertyDef 物模型 | models/node.py, models/profile.py | `alembic upgrade head` 成功建表 |
| D3 | **M3 Normalizer 编写 + 单测** (L1 纯函数优先) | normalizer.py, test_normalizer.py (≥5 cases) | `pytest` 全绿 |
| D3 | **M5 VPE 核心 SymPy 编写 + 单测** (L1 纯函数优先) | virtual_engine.py, test_vpe.py (≥10 cases) | `pytest` 全绿 |
| D4 | M1 节点树 CRUD API | api/nodes.py, api/tags.py | `curl POST /nodes` 返回正确 JSON |
| D4 | **Tag v0.1-m0+m1+m3+m5** (L4 checkpoint) | git tag | 4 个基础模块锁定 |
| D5 | M2 MQTT Stub (on_message 打日志) | mqtt_client.py | 发送测试消息 → 日志出现 payload |

**Phase 1 结束状态**: 消息能进不能存，但所有纯函数模块已验证无误。

---

### Phase 2 (Day 6-12): 上行闭环

**目标**: 设备数据从 Neuron → nanoMQ → FastAPI → TimescaleDB 全链路跑通

**难点与应对**:

| 难点 | 应对策略 | 所属 Layer |
|------|---------|-----------|
| psycopg2 批量写入调试 | 先用 ORM 单条写入跑通逻辑，再替换 execute_values | L2 Stubby |
| pint 单位换算报错 | loguru diagnose=True 自动打印单位字符串 | L3 Observable |
| SymPy 公式解析失败 | SympifyError 被 except 捕获 + logger.warning 打印公式原文 | L3 Observable |
| 时间戳不一致 | M2 解析时强制 UTC 标准化，打 DEBUG 日志记录原始值 vs 标准值 | L3 Observable |

**每日计划**:

| Day | 任务 | 产出 | 验收 |
|-----|------|------|------|
| D6 | M4 TelemetryStore (ORM 版先跑通) | telemetry_store.py | INSERT 1 条数据成功 |
| D6 | M2 MQTT → M3 → M4 全链路 (Stub→Real 过渡) | mqtt_client.py 更新 | 发送测试消息 → TSDB 有新行 |
| D7 | psycopg2 execute_values 替换 ORM | telemetry_store.py 重构 | 200 msg/s < 100ms |
| D7 | **Tag v0.1-m2+m4** (L4 checkpoint) | git tag | 上行链路锁定 |
| D8-D9 | M5 VPE 级联 + 聚合完善 | virtual_engine.py 扩展 | ess_total_power 自动计算 |
| D10 | M9 WS 推送基础版 (订阅/发布) | websocket.py | 浏览器连接后收到实时数字 |
| D11-D12 | 前端 Dashboard 基础 (设备列表 + 数值卡片) | Dashboard.tsx, TelemetryView.tsx | 页面数字跳动 ≥ 1Hz |

**Phase 2 结束状态**: 上行闭环跑通，前端能看到实时数据。

---

### Phase 3 (Day 13-17): 下行闭环

**目标**: 按钮 → API → Neuron → Modbus 设备

**最大风险**: Neuron REST API 的 JWT Token 过期 + 网络超时。**tenacity 直接消灭这个问题。**

**每日计划**:

| Day | 任务 | 产出 | 验收 |
|-----|------|------|------|
| D13 | M7 NeuronClient (tenacity 保护) | rpc_controller.py | POST /rpc 返回 success |
| D13 | JWT 自动刷新测试 (模拟 401) | test_rpc.py | 401 → 自动 login → 重试成功 |
| D14 | M7 权限校验 + 审计日志 | rpc_controller.py 完善 | 无权限返回 403 |
| D15 | M8 APScheduler 5 个定时任务 | scheduler.py | 日志显示 "[Scheduler] 已启动 5 job" |
| D16 | 前端 RPC 控件 + 结果反馈 | RpcButton.tsx | 点击按钮 → 3s 内显示结果 |
| D17 | **Tag v0.1-m7+m8** (L4 checkpoint) + 端到端联调 | git tag | 下行闭环锁定 |

---

## 三、调试工具箱

### 开发阶段必备工具

| 工具 | 用途 | 安装 |
|------|------|------|
| **MQTT Explorer** | 手动发测试消息到 nanoMQ | GUI 应用 |
| **DBeaver / pgAdmin** | 直接连 TimescaleDB 查看数据 | GUI 应用 |
| **curl / httpie** | 手动测 REST API | 已有 |
| **pytest + pytest-watch** | 文件保存自动重跑单测 | `pip install pytest-watch` |
| **loguru console** | 终端彩色输出 | 已在 L3 配置 |

### 关键调试场景 SOP

**SOP1: 消息没到达后端**
```
1. MQTT Explorer 连 nanoMQ:1883 → publish test topic
2. 看 FastAPI 日志有没有 [M2] on_message
3. 没有 → paho-mqtt 订阅 topic 不匹配（检查 # 通配符）
4. 有但不解析 → payload 格式不对（logger.debug 打原始 bytes）
```

**SOP2: 入库了但前端不显示**
```
1. DBeaver 查 t_telemetry 有数据？
2. 有 → 检查 node_path 是否和前端订阅的一致
3. 没有 → 检查 M4 batch_insert 的 execute_values 参数
4. loguru diagnose=True 会打印完整的 rows 内容
```

**SOP3: GoRules 规则没触发**
```
1. RulesService.load_test_rule 加载测试 JDM
2. 手动构造 context 字典调用 evaluate_alarm
3. 看返回结果是 [] 还是有内容
4. [] → JDM 的 rules 条件不匹配（检查字段名和比较符）
5. 有内容但告警没出现 → 检查 alarm_dispatcher 是否被调用
```

---

## 四、"不可能失败"的 Checklist

每个模块交付前必须全部勾选：

```
□ 代码运行无语法错误 (python -c "import module")
□ 单测全绿 (pytest --cov)
□ loguru 日志正常输出（DEBUG/INFO/WARNING/ERROR 各至少一条）
□ 异常场景测试过（None 输入 / 空 dict / 超范围值 / 网络超时）
□ git tag 打好（版本号规范）
□ README.md 中本模块的"如何调试"段落写好（SOP 参考）
```

---

*文档版本: G5-v1.0*
*最后更新: 2026-07-13*
