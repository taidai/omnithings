# OmniThings 总目标拆解书

> 从愿景到代码行的完整分解
> 基于: architecture-v1.md + g4-module-decomposition + g5-difficulty-reduction + **g11-feature-domains.md (v2.1)**
> 日期: 2026-07-15 / **更新 2026-07-17 对齐 g11**
> 状态: 待用户确认后启动 Phase 1

---

## ⚠️ g11 功能域映射 (2026-07-17 追加)

> **g11 已重新定义功能域分层。以下映射表将旧定义(L1 F1/F2/F3)对应到新定义(F0/F1/F2/F3)。**

| 旧定义 (g7 v1.0) | 新定义 (g11 v2.1) | 变化说明 |
|-------------------|---------------------|---------|
| (无) | **F0: 数据管道流计算** | **新增**。MQTT→解析→归一化→Hook链→TSDB，CE 内置 |
| F1 多级节点架构 | **F3: 自定义节点树挂载点位+策略** | 编号调整+范围扩大(含聚合规则) |
| F2 自定义实时点位 | **F1: 自定义物理/虚拟点位** | 编号调整(点位域先于节点域在运行时执行) |
| F3 可配置控制规则 | **F2: 控制策略(GoRules)** | 编号调整(控制域在最上层) |

### 新的功能域层次（以 g11 为准）

```
┌─────────────────────────────────────────┐
│  F2: 控制域 (GoRules + RPC + 审计)      │  ← 写入通道
├─────────────────────────────────────────┤
│  F3: 节点树域 (5层统一模型 + 聚合汇总)    │  ← 层级聚合
├─────────────────────────────────────────┤
│  F1: 点位域 (PhysicalTag + LogicalTag)   │  ← 虚拟值生产(SymPy)
├─────────────────────────────────────────┤
│  F0: 数据管道 + CE骨架(方案B透传)         │  ← 基础设施(MQTT→TSDB)
├═════════════════════════════════════════╤
│  TimescaleDB (全域共享持久层)             │
└─────────────────────────────────────────┘
```

### 开发顺序更新（按 g11 第8节）

| Phase | 旧定义 | 新定义 | 关键变化 |
|-------|--------|--------|---------|
| Phase 1 | 骨架跑通 | **F0 基线** (Mode1 读存) | 明确为数据管道基线 |
| Phase 2 | 上行闭环 | **F1+F3 并行** (Mode3 读算存) | F1⊥F3 正交可并行 |
| Phase 3 | 下行闭环 | **F2 控制** (Mode2 读写读存) | 控制域最后激活 |
| Phase 4 | 规则引擎 | **F2 深化** (GoRules集成) | 合入 Phase 3 |

**⚠️ 下文 L1-L5 内容仍保留作为历史参考，新项目规划请以 g11 为准。**

---

## L0 愿景（一句话）

**用户通过界面配置，零代码实现工业控制系统 —— 完全替代 ThingsBoard。**

### 成功标准（什么时候算做完了）

```
Given: 一个光储充 EMS 场站，有 Neuron 采集的 PCS/BMS/逆变器/电表设备
When: 用户通过 Web UI 完成以下操作（不写任何代码）
  1. 拖拽搭建五层节点树（场站→电站→能源节点→设备→点位）
  2. 一键从 Neuron 导入物理点位 + 手动创建逻辑点位（公式计算）
  3. 可视化编辑 GoRules 决策表/决策图绑定到节点
Then:
  - 设备遥测数据实时入库、归一化、展示（上行闭环 ✓）
  - 前端点击按钮下发控制指令到 Modbus 设备（下行闭环 ✓）
  - 规则引擎自动评估告警/联动/控制策略（自治能力 ✓）
```

---

## L1 三大功能域

### F1 多级节点架构

| 层级 | 名称 | 示例 | 用户操作 |
|------|------|------|---------|
| L5 | Site | 某某工业园 | 新建站点 |
| L4 | Station | 1号光储充站 | 新建电站 |
| L3 | EnergyNode | ESS/PV/GRID/EVSE | 选择能源类型 |
| L2 | Device | PCS #1 / BMS #1 / 逆变器 #1 | 选择品牌型号 |
| L1 | Tag | 有功功率(kW) / SOC(%) / 虚拟总功率 | 配置物理或逻辑点位 |

**核心价值**: TB 的 Asset/Device/Profile 三件套合并为一棵树。一个 JSON 描述完整层级。

### F2 自定义实时点位

| 类型 | 数据来源 | 更新频率 | 是否可写 |
|------|---------|---------|---------|
| **PhysicalTag** | Neuron MQTT 上报 | 跟随采集周期 (500ms~2s) | 是（Neuron REST API） |
| **LogicalTag** | 公式引擎计算派生 | 源点位更新后级联触发 | 否（只读） |

**公式类型**:
- **expression**: 数学表达式 `(dc_power/ac_power)*100` → SymPy 求值
- **aggregate**: 跨设备聚合 `SUM(PCS1.power, PCS2.power)` → Python 内建
- **condition**: 条件判断 `soc > 90 AND temp > 55` → 输出布尔值

### F3 可配置控制规则

| 类型 | JDM 格式 | hitPolicy | 用途 |
|------|---------|-----------|------|
| alarm | Decision Table | collect(多条) | 告警检测 |
| control | Decision Graph | first(首条) | 控制策略 |
| fault_map | Decision Table | first | 故障码翻译 |
| linkage | Decision Graph | collect | 联动规则 |

**运行位置**: FastAPI 进程内，GoRules Rust 核心（微秒级延迟），JDM JSON 热更新无需重启。

---

## L2 六个实施阶段（时间线）

### 总览

```
Phase 1 [Day 1-5]    骨架跑通           M0+M2(stub)+S1 Health     ~200 PY
Phase 2 [Day 6-12]   上行闭环           M1+M3+M4+M5+M9(base)      ~550 PY
Phase 3 [Day 13-17]  下行闭环           M7+M8                      ~350 PY
Phase 4 [Day 18-27]  规则引擎           M6                         ~260 PY
Phase 5 [Day 28-37]  配置体验打磨       M10(full)+M11+M12        ~2500 TSX
Phase 6 [持续]       生产化             监控/备份/压测/合规         按需
```

### Phase 1: 骨架跑通（Day 1-5）

**目标**: Docker Compose 五容器启动 → MQTT 收消息打日志 → Health API 可访问

**交付物清单**:
| 切片 | 任务 | 产出文件 | 验收标准 |
|------|------|---------|---------|
| S0 | 项目初始化 | `pyproject.toml`, `.env`, `.env.example` | `uv sync` 成功安装 15 个依赖 |
| S0 | 目录骨架 | `backend/app/{core,models,api,services}/` | `python -c "from app.main import app"` 不报错 |
| S0 | Docker 编排 | `docker-compose.yml`(5容器), `backend/Dockerfile` | `docker compose up` 全部 healthy |
| S0 | DB Schema | `init-db/001-schema.sql` | TimescaleDB 启动后自动建 Hypertable |
| S1 | Health API | `api/health.py` + `tests/test_health.py` | GET /api/health 返回 `{"status":"ok"}` |
| S2 | MQTT Stub | `core/mqtt_client.py` | 订阅 telemetry/# → 日志打印 payload |

**关键决策**:
- 先用 fastapi-template 骨架还是从零搭？→ **从零搭**（template 太重，我们只需 10% 功能）
- Python 版本？→ **3.12**（asyncio 性能最优，所有库都支持）
- 先写测试还是先写代码？→ **TDD：先写测试（RED），再写代码（GREEN）**

**不在此阶段做的**:
- ❌ 不做 Node Model（Phase 2）
- ❌ 不做数据归一化（Phase 2）
- ❌ 不做前端（Phase 2 末尾才加基础 Dashboard）

---

### Phase 2: 上行闭环（Day 6-12）

**目标**: Neuron 采真实数据 → 归一化 → 入库 → 虚拟点位计算 → 前端显示

**交付物清单**:
| 任务 | 模块 | 核心产出 | 验收标准 |
|------|------|---------|---------|
| 五层节点树 CRUD | M1 | `models/node.py`, `api/nodes.py` | POST Site→Station→ESS→Device→Tag 全链路通 |
| 物理点位管理 | M1 | `api/tags.py`, `tags/import-neuron` | 选 Neuron node → 自动扫描导入 50 个 tag |
| 数据归一化器 | M3 | `core/normalizer.py` + 5 个单测 | scale*val+offset 正确，pint W→kW 正确 |
| MQTT 全链路集成 | M2 | `mqtt_client.py` (stub→real) | 发消息 → 归一化 → 入库 < 20ms |
| 时序存储写入 | M4 | `core/telemetry_store.py` | psycopg2 execute_values 批量写入 200 条 < 100ms |
| 虚拟点位引擎 | M5 | `core/virtual_engine.py` + 10 个单测 | SymPy 表达式求正确 + 级联 A→B→C 正确 |
| WS 实时推送 | M9 | `api/websocket.py` | 浏览器连接后 100ms 内收到数字变化 |
| 基础 Dashboard | M10(mini) | `pages/Dashboard.tsx`, `TelemetryView.tsx` | 页面跳动数字 ≥ 1Hz |

**此阶段结束状态**: 用户打开浏览器看到实时跳动的设备数据。

---

### Phase 3: 下行闭环（Day 13-17）

**目标**: 前端按钮 → API → Neuron REST API 写入 → Modbus 寄存器 → 设备响应

**交付物清单**:
| 任务 | 模块 | 核心产出 | 验收标准 |
|------|------|---------|---------|
| Neuron RPC Client | M7 | `core/rpc_controller.py` | POST /rpc → Neuron write → success |
| JWT 自动刷新 | M7 | tenacity 装饰器 | 401 → 自动 login → 重试成功 |
| 权限校验 | M7 | 依赖中间件 | 无权限用户返回 403 |
| 审计日志 | M7 | t_audit_log 写入 | 每次 RPC 操作可追溯 |
| 定时任务调度 | M8 | `core/scheduler.py` | APScheduler 5 个 job 运行正常 |
| 前端 RPC 控件 | M10 | `components/RpcButton.tsx` | 点击 → 3s 内显示结果 |

**最大风险**: Neuron JWT 过期 → 已被 tenacity + 定时刷新双保险覆盖。

---

### Phase 4: 规则引擎（Day 18-27）

**目标**: JDM 编辑器 → 规则保存 → 实时评估 → 告警/联动/自动控制

**交付物清单**:
| 任务 | 模块 | 核心产出 | 验收标准 |
|------|------|---------|---------|
| GoRules SDK 集成 | M6 | `core/rules_service.py` | `pip install zen-engine` evaluate() 返回正确 |
| 内置告警模板 | M6 | 7 条 EMS 告警规则 JDM | SOC>95% 触发 CRITICAL 告警 |
| 内置控制策略图 | M6 | ESS 控制决策图 | 高温 → emergency_stop 动作正确 |
| 规则 CRUD API | M6 | `api/rules.py` | 创建/修改/删除/版本管理 |
| 热更新机制 | M6 | hot_reload() | JDM Editor 保存后立即生效 |
| 规则模拟器 | M6 | POST /simulate | 传测试数据 → 显示命中详情 |
| JDM Editor 嵌入 | M10 | `RuleDesigner.tsx` | 可视化编辑决策表 + 保存 |

**此阶段结束状态**: 系统具备自治能力——越限自动告警、告警触发自动控制。

---

### Phase 5: 配置体验打磨（Day 28-37）

**目标**: 非技术用户零代码完成全流程配置

**交付物清单**:
| 任务 | 模块 | 验收标准 |
|------|------|---------|
| 节点树可视化构建器 | M12 | 3 分钟搭完 5 层树（拖拽/右键/向导） |
| 物理点位一键导入 | M12 | 选 Neuron node → 50 个点位 10 秒导完 |
| 逻辑点位公式编辑器 | M12 | 选源点位 → 写公式 → 实时预览 → 即时生效 |
| Dashboard Builder | M12 | 拖拽卡片布局 5 分钟搞定面板 |
| JDM Editor 完整集成 | M12 | 决策表/图可视化编辑 + 模拟测试 + 版本历史 |
| 国标报表导出 | M11 | 日/月/年发电量 Excel 导出 |
| Redis 实时缓存 | M0(升级) | 最新值 < 1ms 查询 |

**此阶段结束状态**: 产品可以交付给客户试用。

---

### Phase 6: 生产化（持续迭代）

- Ansible 自动部署脚本
- Grafana 全局监控大盘 + Prometheus 指标采集
- 备份恢复策略（TimescaleDB 连续归档）
- 性能压测 & 优化（万级并发目标）
- 国标合规性验证（GB/T 19964 等）

---

## L3 十三个模块详单

### 后端模块（M0-M9）

#### M0: 项目骨架 (~50 行配置)
**文件**: `pyproject.toml`, `.env`, `docker-compose.yml`, `init-db/001-schema.sql`
**依赖**: 无（一切之始）
**被依赖**: 所有其他模块
**DoD**: `docker compose up` → 5 容器全部 healthy

#### M1: 节点树引擎 (~250 PY)
**文件**: `models/node.py`, `models/rule.py`, `api/nodes.py`, `api/tags.py`
**核心库**: SQLModel, Alembic
**职责**: 五层节点树 CRUD + 导入导出 + 点位管理
**DoD**: POST 完整 5 层树 + 8 个单测全绿

#### M2: MQTT 接入层 (~120 PY)
**文件**: `core/mqtt_client.py`
**核心库**: paho-mqtt
**职责**: 订阅 nanoMQ → 解析 payload → 路由到 M3/M4/M5
**DoD**: 收消息打印日志 → 全链路集成

#### M3: 数据归一化器 (~100 PY) ★纯函数
**文件**: `core/normalizer.py`
**核心库**: pint, loguru
**职责**: scale*val+offset + 单位换算 + 字段映射
**DoD**: 5 个单测覆盖正常/边界/异常路径

#### M4: 时序存储引擎 (~180 PY)
**文件**: `core/telemetry_store.py`, `api/telemetry.py`
**核心库**: psycopg2(execute_values), pandas
**职责**: Hypertable 批量写入 + time_bucket 查询 + 聚合
**DoD**: 200 msg/s 写入 < 100ms

#### M5: 虚拟点位引擎 (~200 PY) ★纯函数
**文件**: `core/virtual_engine.py`
**核心库**: SymPy(sympify)
**职责**: expression/aggregate/condition 三种公式 + 级联 A→B→C
**DoD**: 10 个单测含循环依赖检测和深度限制

#### M6: GoRules 规则引擎 (~260 PY)
**文件**: `core/rules_service.py`, `api/rules.py`
**核心库**: zen-engine
**职责**: JDM 加载/评估/热更新 + 告警/控制/故障/联动四类规则
**DoD**: 6 个单测 + simulate API

#### M7: RPC 控制通道 (~220 PY)
**文件**: `core/rpc_controller.py`, `api/rpc.py`
**核心库**: tenacity, httpx, passlib+jose
**职责**: Neuron REST API write + JWT 管理 + 权限校验 + 审计日志
**DoD**: 4 个 mock 测试（正常/无权/JWT过期/超时）

#### M8: 定时任务调度器 (~120 PY)
**文件**: `core/scheduler.py`
**核心库**: APScheduler(AsyncIOScheduler)
**职责**: JWT刷新(30min) + 规则重载(5min) + 巡检(30s) + 清理 + 告警恢复
**DoD**: 5 个 job 日志可见

#### M9: WebSocket 实时通信 (~150 PY)
**文件**: `api/websocket.py`
**核心库**: FastAPI WebSocket
**职责**: 遥测推送 + 告警广播 + RPC 结果回推
**DoD**: 浏览器订阅后 100ms 内收到数据

### 前端模块（M10-M12）

#### M10: Frontend Dashboard (~1500 TSX)
**目录**: `frontend/src/pages/`, `components/`
**核心库**: React19, shadcn/ui, react-query, ECharts, TanStack Router
**页面**: Dashboard / NodeTree / TagConfig / TelemetryView / AlarmPanel / RuleDesigner
**DoE**: 数字跳动 ≥ 1Hz + 图表渲染 < 200ms

#### M11: 报表服务 (~230 PY)
**文件**: `services/report_service.py`, `api/reports.py`
**核心库**: pandas, openpyxl
**报表**: 日发电量 / 储能效率 / 电费估算 / 设备利用率
**DoD**: GET /reports/daily 返回带样式 Excel

#### M12: 配置体验优化 (~800 TSX)
**目录**: `frontend/src/components/{tree,jdm-editor,wizard}/`
**核心库**: @gorules/jdm-editor
**功能**: 向导建站 / 一键导入 / 公式编辑器 / Dashboard Builder
**DoE**: 新手 5 分钟完成站点搭建

---

## L4 每个 Module 的 Task 级拆解示例（以 M3 为例）

```
M3: Data Normalizer (pure function, ~100 lines)
├── task-m3-01: 创建 normalizer.py 类骨架
│   产物: backend/app/core/__init__.py, normalizer.py
│   验证: python -c "from app.core.normalizer import DataNormalizer"
│
├── task-m3-02: 实现 scale*val+offset 转换
│   产物: _convert_scale_offset(field, value, cfg) 方法
│   验证: test_normalizer_scale_offset() 通过
│
├── task-m3-03: 实现 pint 单位换算
│   产物: _convert_pint(field, value, cfg) 方法
│   验证: test_normalizer_pint_conversion() 通过
│
├── task-m3-04: 实现 normalize() 主入口
│   产物: normalize(device_path, raw_values, tag_configs) -> dict
│   验证: test_normalize_integration() 通过
│
├── task-m3-05: 异常场景覆盖
│   产物: 未注册字段跳过 / 超范围标记None / 空输入处理
│   验证: test_missing_tag_skipped(), test_out_of_range(), test_empty_input()
│
└── DoD checklist:
    □ pytest --cov=normalizer 覆盖率 > 90%
    □ loguru 日志 DEBUG/INFO/WARNING 各至少一条
    □ git tag v0.1-m3
```

**其他模块的 Task 级拆解格式相同，在 Phase 开工时逐个展开。**

---

## L5 代码预算总表

| 类别 | 行数 | 占比 |
|------|------|------|
| 后端 Python (M0-M9, 含测试) | ~3,800 行 | 57% |
| 前端 TypeScript (M10-M12) | ~2,300 行 | 35% |
| 配置/SQL/YAML/Dockerfile | ~500 行 | 8% |
| **合计** | **~6,600 行** | 100% |

### 对比参考
| 项目 | 代码量 | 团队 | 时间 |
|------|--------|------|------|
| Claw IoT Platform (预估) | ~4,000 行核心 | 1 人 + AI | 37 天 |
| ThingsBoard CE | ~500,000 行 | 20+ 人 | 5 年+ |
| MyEMS | ~80,000 行 | 5 人 | 3 年 |
| **Claw/MyEMS 代码比** | **1:20** | — | — |

---

## 关键约束与不做列表

### 明确不做（Won't Have）— Phase 1-5 范围
| 功能 | 原因 | 可能加入的时机 |
|------|------|---------------|
| 多租户 RBAC | MVP 单站点够用 | Phase 6 或客户需求 |
| Redis 缓存 | TimescaleDB 查询够快 | 万级并发时再加 |
| 移动端 App | 响应式 Web 够用 | 有明确需求时 |
| 国际化 i18n | 中文市场优先 | 出海时 |
| 插件系统 | 配置即平台已满足扩展性 | 生态成熟时 |
| GraphQL API | REST 足够简洁 | 前端复杂查询需求出现时 |

### 技术约束
| 约束 | 值 | 原因 |
|------|-----|------|
| Python 最低版本 | 3.12 | asyncio 性能 + 所有库支持 |
| PostgreSQL | 16+ | TimescaleDB v2.28 要求 |
| 浏览器支持 | Chrome/Firefox/Edge (最新两版) | 不支持 IE |
| Docker | 24.0+, Compose v2 | docker compose (不是 docker-compose) |
| 目标响应延迟 | 单条消息 < 20ms 端到端 | 含 DB 写入和规则评估 |

---

*文档版本: GOAL-v1.0*
*最后更新: 2026-07-15*
