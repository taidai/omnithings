# Claw UI 界面规格书 v1.0

> 全页面 Mockup + 设计 Token + 组件映射 + 路由表 + 交互流程
> 基于: g7-goal-breakdown.md + architecture-v1.md
> 日期: 2026-07-16
> **状态: 待用户确认后锁死，作为 Phase 2-5 前端开发唯一依据**

---

## 0. 设计哲学

| 原则 | 说明 |
|------|------|
| 工业级克制 | 不花哨、不渐变、不动画（除告警闪烁外），每像素都有信息密度 |
| 数据优先 | 数字 > 图标 > 文字，实时值用大号字体 + 单位 |
| 操作可逆 | 危险操作(控制/删除)需二次确认 + 审计日志 |
| 一致性 | 所有页面共用同一侧栏+顶栏+面包屑，切换页面无学习成本 |
| 浅色主基调 | 白色背景(#FAFAF8)，深灰文字(#2C2C2A)，绿强调色(#97C459) |

---

## 1. 全局布局 (Mockup #1)

```
┌─────────────────────────────────────────────────────┐
│  [Logo] Claw v0.1                    [ESS] [!3] [陈] │ ← Header Bar (48px)
├──────┬──────────────────────────────────────────────┤
│      │  面包屑: Dashboard / Overview                 │
│  侧栏│ ┌──────────────────────────────────────────┐  │
│ 240px│ │                                          │  │
│      │ │          主内容区                         │  │
│      │ │          (per-page)                      │  │
│      │ │                                          │  │
│      │ └──────────────────────────────────────────┘  │
│      │                                              │
│      │  Online ● 5 nodes                            │ ← 底部状态
└──────┴──────────────────────────────────────────────┘
```

### 侧栏导航项（10 项，3 组）

| 分组 | 导航项 | 路由 | 图标色 | Phase |
|------|--------|------|--------|-------|
| 核心 | Dashboard | `/` | 绿 #3B6D11 | P2 |
| 核心 | Node Tree | `/nodes` | 默认 | P2 |
| 核心 | Tag Config | `/tags` | 默认 | P2 |
| 核心 | Telemetry | `/telemetry` | 默认 | P2 |
| 核心 | RPC Control | `/rpc` | 默认 | P3 |
| --- | --- | --- | --- | --- |
| 智能 | Rules | `/rules` | 默认 | P4 |
| 智能 | Alarms | `/alarms` | 默认 | P4 |
| 智能 | Reports | `/reports` | 默认 | P5 |
| --- | --- | --- | --- | --- |
| 系统 | Settings | `/settings` | 灰 | P6 |

### Header Bar 元素

| 位置 | 元素 | 说明 |
|------|------|------|
| 左 | 面包屑 | `当前页 / 子页面` 格式 |
| 右-1 | 当前节点选择器 | 下拉选 ESS/PV/GRID/EVSE，切换全局上下文 |
| 右-2 | 告警铃铛 + 未读数 | 点击跳转 Alarms 页面 |
| 右-3 | 用户头像 | 下拉: 个人设置 / 登出 |

---

## 2. 页面清单与路由表

### P2 阶段页面（上行闭环）

#### Page 1: Dashboard — 实时监控总览 (Mockup #2)

**路由**: `GET /`
**文件**: `frontend/src/pages/Dashboard.tsx`

| 区域 | 组件 | 数据源 | 更新频率 |
|------|------|--------|---------|
| KPI 卡片行 (x4) | MetricCard | WS 推送 / react-query | 实时 |
| 系统状态条 | StatusBar | GET /api/health | 30s |
| 节点树迷你版 | MiniTree (collapsible) | GET /api/nodes?tree=flat | 手动刷新 |
| 实时遥测网格 | TelemetryGrid | WS /api/ws/telemetry | 1s |
| 功率趋势图 | PowerChart (ECharts) | GET /api/telemetry?agg=24h | 5min |

**KPI 卡片定义**:

| 卡片 | 指标 | 单位 | 正常色 | 告警色 |
|------|------|------|--------|--------|
| PV 发电功率 | 光伏总有功 | kW | 绿 #3B6D11 | 灰(夜间) |
| ESS SOC | 储能荷电状态 | % | 蓝 #185FA5 | 橙 #BA7517 |
| 电网交换功率 | 并网有功 (+买/-卖) | kW | 绿 | 红(倒送超限) |
| 设备在线率 | 在线/总数 | 台 | 黑 | 红(离线>0) |

---

#### Page 2: Node Tree Editor — 节点架构编辑器 (Mockup #3)

**路由**: `GET /nodes`
**文件**: `frontend/src/pages/NodeTreeEditor.tsx`

| 区域 | 组件 | 交互 | API |
|------|------|------|-----|
| 工具栏 | Toolbar | 添加/导入/搜索/撤销/保存 | POST /api/nodes |
| 树画布 | TreeCanvas | 展开/折叠/选中/右键菜单/拖拽 | GET/PUT/DELETE /api/nodes/:id |
| 右键菜单 | ContextMenu | 添加子设备/点位/绑定规则/删除 | - |
| 属性面板 | PropertyPanel | 编辑名称/类型/Neuron映射/描述 | PUT /api/nodes/:id |
| 点位统计 | StatsBlock | 只读展示物理/逻辑/规则数 | - |

**右键菜单（按节点类型不同）**:

| 菜单项 | Site | Station | EnergyNode | Device | Tag |
|--------|------|---------|------------|-------|-----|
| 添加子节点 | ✓ | ✓ | ✓ | ✓(Tag) | ✗ |
| 导入 Neuron | ✗ | ✓ | ✓ | ✗ | ✗ |
| 添加物理点位 | ✗ | ✗ | ✗ | ✓ | ✗ |
| 添加逻辑点位 | ✗ | ✗ | ✓ | ✓ | ✗ |
| 绑定规则 | ✓ | ✓ | ✓ | ✓ | ✗ |
| 删除 | ✗(根不可删)| ✓ | ✓ | ✓ | ✓ |

**节点图标颜色系统**:

| 类型 | 颜色 | 色值 | 形状 |
|------|------|------|------|
| Site | 深绿 | #3B6D11 | 圆形 |
| Station | 蓝 | #185FA5 | 圆形 |
| ESS | 绿 | #97C459 | 圆角方块 |
| PV | 中绿 | #639922 | 圆角方块 |
| GRID | 橙红 | #D85A30 | 圆角方块 |
| EVSE | 琥珀 | #EF9F27 | 圆角方块 |
| Device-PCS | 橙 | #BA7517 | 小圆 |
| Device-BMS | 青绿 | #0F6E56 | 小圆 |
| Device-Meter | 灰 | #5F5E5A | 小圆 |
| Physical Tag | 蓝 | #85B7EB | 小方块 |
| Logical Tag | 紫 | #CECBF6 | 小方块 |

---

#### Page 3: Tag Config — 点位配置 (Mockup #4)

**路由**: `GET /tags?node_id={id}`
**文件**: `frontend/src/pages/TagConfig.tsx`

| 区域 | 组件 | 说明 | API |
|------|------|------|-----|
| Tab 栏 | TabBar | 物理点位 / 逻辑点位 切换 | - |
| 导入按钮 | ImportButton | 从 Neuron 扫描导入全部 tag | POST /api/tags/import-neuron |
| 物理点位表格 | DataTable | 可排序/筛选/内联编辑 | GET/PUT /api/tags |
| 逻辑点位卡片 | FormulaCardList | 公式卡片网格，点击编辑 | GET/PUT /api/tags?type=logical |
| 新建公式按钮 | AddFormulaBtn | 打开公式编辑器弹窗 | POST /api/tags |

**物理点位表格列定义**:

| 列名 | 字段 | 类型 | 编辑 | 说明 |
|------|------|------|------|------|
| 名称 | name | string | ✓ | 中文显示名 |
| Neuron Tag | neuron_tag | string | ✗ | 原始 tag 名 |
| 数据类型 | data_type | enum | ✓ | float/int/bool/uint16/... |
| 单位 | unit | string | ✓ | kW/V/A/%/°C |
| 缩放因子 | scale_factor | float | ✓ | Neuron raw → 工程 |
| 偏移量 | offset | float | ✓ | val * scale + offset |
| 读写 | rw_attribute | badge | ✗ | R/W/RW 来自 Neuron |
| 状态 | status | badge | ✗ | 在线(绿)/超时(红)/未知(灰) |

**逻辑点位公式卡片**:

```
┌─────────────────────────────────┐
│ 总放电量 (MWh)                  │ ← 名称 + 单位
│ INTEGRAL(PCS#1.active_power)   │ ← SymPy 表达式
│ [aggregate]                     │ ← 类型标签
│ ●                               │ ← 运行状态
└─────────────────────────────────┘
```

三种公式类型:
- **expression**: 数学表达式 `(discharge/charge)*100` — SymPy sympify()
- **aggregate**: 时间聚合 `INTEGRAL()`, `SUM()`, `AVG()`, `MAX()`, `MIN()` — Python 内建
- **condition**: 条件判断 `temp > 55 AND soc > 90` — 输出 bool，驱动告警

**依赖图**: 每个逻辑点位记录 source_tag_paths，前端渲染 DAG，检测循环依赖。

---

### P3 阶段页面（下行闭环）

#### Page 4: RPC Control — 远程控制面板 (Mockup #5)

**路由**: `GET /rpc?node_id={id}`
**文件**: `frontend/src/pages/RpcControl.tsx`

**安全设计**:
- 顶部红色警告横幅（每次进入必见）
- 操作必须填写"原因"（审计追踪）
- 危险按钮(紧急停机)用红色底色
- 所有操作写入审计日志表

| 区域 | 组件 | 说明 |
|------|------|------|
| 警告横幅 | WarningBanner | 固定显示，不可关闭 |
| 快捷控制 | QuickActions | 预定义按钮组(启停/模式/功率设定) |
| 功率滑块 | Slider | 拖拽设功率，实时显示百分比和kW值 |
| 写入表单 | WriteForm | 选点位→看当前值→输新值→填原因→执行 |
| 审计日志 | AuditLogTable | 最近20条操作记录(时间/人/点位/旧→新/原因/结果/耗时) |

**快捷控制按钮定义**:

| 按钮 | 动作 | 目标点位 | 颜色 | 二次确认 |
|------|------|---------|------|---------|
| 启动运行 | run_state=1 | PCS.run_state | 绿 | 否 |
| 紧急停机 | emergency_stop | PCS.run_state | 红 | 弹窗确认 |
| 恒功率 | mode=1 | PCS.mode | 选中态绿 | 否 |
| 恒电压 | mode=2 | PCS.mode | 默认 | 否 |
| 恒流 | mode=3 | PCS.mode | 默认 | 否 |

**审计日志字段**: `timestamp, operator, node_path, tag_name, old_value, new_value, reason, result(success/fail), duration_ms`

---

### P4 阶段页面（规则引擎）

#### Page 5: Rule Designer — 规则可视化编辑器 (Mockup #6)

**路由**: `GET /rules?node_id={id}`
**文件**: `frontend/src/pages/RuleDesigner.tsx`
**第三方组件**: GoRules JDM Editor React (`@gorules/jdm-editor`)

| 区域 | 组件 | 说明 |
|------|------|------|
| 工具栏 | RuleToolbar | 保存/模拟/版本历史/决策表↔决策图切换 |
| 决策表 | DecisionTable | 条件列 + 输出行，单元格可编辑 |
| 决策图 | DecisionGraph | 流程图式规则编排（备选视图） |
| 模拟器 | SimulatorPanel | 输入测试数据 → 显示命中结果 + 耗时 |
| JSON 视图 | JsonView | 查看/编辑原始 JDM JSON |
| 绑定面板 | BindingPanel | 映射条件列到实际 Tag 路径 |
| 规则列表 | RuleCardList | 本节点绑定的所有规则概览卡 |

**决策表示例（高温告警）**:

| 条件名称 | SOC (%) | 温度 (°C) | 输出动作 | 严重度 |
|---------|---------|----------|---------|--------|
| CRITICAL: 超温高SOC | > 90 | > 55 | emergency_stop + CRITICAL告警 | 🔴 |
| WARN: 温度偏高 | > 85 | > 50 | reduce_power + WARN告警 | 🟠 |
| INFO: 正常范围 | 20~85 | 25~50 | none | 🟢 |

**模拟器工作流**:
1. 用户输入测试值 (SOC=92, Temp=58)
2. 点击"运行模拟"
3. 前端调用 `POST /api/rules/simulate` (后端 zen-engine.evaluate())
4. 显示命中行 + 执行的动作 + 耗时(微秒级)

**规则四类型**:

| 类型 | JDM格式 | hitPolicy | 用途 | 示例 |
|------|---------|-----------|------|------|
| alarm | Decision Table | collect | 多条件告警 | 高温告警 |
| control | Decision Graph | first | 控制策略(优先级) | 充电策略 |
| fault_map | Decision Table | first | 故障码翻译 | PCS故障码→中文 |
| linkage | Decision Graph | collect | 多设备联动 | SOC满→切离网 |

---

#### Page 6: Alarm Panel — 告警面板 (Mockup #7)

**路由**: `GET /alarms`
**文件**: `frontend/src/pages/AlarmPanel.tsx`

| 区域 | 组件 | 说明 |
|------|------|------|
| 统计卡行 | SeverityStats | CRIT/WARN/INFO/已确认 四个数字卡 |
| 控制条 | ControlBar | 自动刷新开关 + 声音开关 + 筛选器 |
| 筛选栏 | FilterBar | 按严重度/确认状态/时间范围过滤 |
| 告警列表 | AlarmList | 按时间倒序，CRIT置顶，未确认高亮 |
| 告警项 | AlarmCard | 严重度标签 + 标题 + 来源 + 触发值 + 确认按钮 |

**告警状态机**:

```
firing → active(闪烁) → acknowledged(虚线框) → resolved(绿色)
                              ↓
                        auto-resolved(规则自动恢复)
```

**告警严重度视觉规范**:

| 级别 | 背景色 | 边框色 | 文字色 | 动效 |
|------|--------|--------|--------|------|
| CRITICAL | #FCEBEB (40%) | #F09595 | #A32D2D | 红点脉冲 1.5s |
| WARNING | #FAEEDA (40%) | #EF9F27 | #993C1D | 静态橙点 |
| INFO | #FFFFFF | #E6E6E0 | #444441 | 无 |
| 已确认 | #F1EFE8 | 虚线 | #888780 | 无 |
| 已恢复 | #EAF3DE (30%) | 无 | #639922 | 绿点 |

**告警数据模型**:

```python
class Alarm(SQLModel, table=True):
    id: int
    severity: str              # CRITICAL / WARNING / INFO
    rule_id: int               # 触发来源
    rule_name: str             # 规则名
    node_path: str             # 触发节点
    message: str               # 告警标题
    detail: dict               # 触发时的快照值 {soc: 92, temp: 58}
    status: str                # active / acknowledged / resolved
    acknowledged_by: str       # 确认人
    acknowledged_at: datetime  
    resolved_at: datetime
    created_at: datetime
```

---

### P5 阶段页面（体验打磨）

#### Page 7: Reports — 报表导出

**路由**: `GET /reports`
**功能**: 日/月/年发电量、储能效率、电费估算、设备利用率 → Excel 导出(pandas + openpyxl)

#### Page 8: Settings — 系统设置

**路由**: `GET /settings`
**功能**: Neuron连接配置、MQTT参数、告警通知(webhook/email)、用户管理、系统信息

---

## 3. 设计 Token（Design System）

### 配色方案

| 角色 | Token | 色值 | 使用场景 |
|------|-------|------|---------|
| 主色 Primary | --color-primary | #3B6D11 | 按钮、链接、活跃态、成功 |
| 主色浅 Primary Light | --color-primary-light | #97C459 | KPI高亮、Tab选中、次要按钮 |
| 主色背景 Primary BG | --color-primary-bg | #EAF3DE | 标签背景、成功状态底色 |
| 信息 Info | --color-info | #185FA5 | 物理点位、在线状态、蓝色语义 |
| 信息背景 Info BG | --color-info-bg | #E6F1FB | 信息类标签背景 |
| 警告 Warning | --color-warning | #993C1D / #BA7517 | WARNING告警、电网方向、 caution |
| 警告背景 Warning BG | --color-warning-bg | #FAECE7 / #FAEEDA | 告警底色、危险操作提示 |
| 危险 Danger | --color-danger | #A32D2D | CRITICAL告警、删除、紧急停止 |
| 危险背景 Danger BG | --color-danger-bg | #FCEBEB | CRITICAL底色 |
| 规则/公式 Rule | --color-rule | #534AB7 | 逻辑点位、规则引擎、公式相关 |
| 规则背景 Rule BG | --color-rule-bg | #EEEDFE | 公式卡片背景、JDM编辑区 |
| 文字主色 Text Primary | --text-primary | #2C2C2A | 标题、正文、重要数值 |
| 文字次要 Text Secondary | --text-secondary | #888780 | 辅助说明、占位符、禁用态 |
| 文字 hint Text Tertiary | --text-tertiary | #B4B2A9 | 时间戳、元数据、次级信息 |
| 边框 Border | --border-color | #E6E6E0 | 分隔线、输入框、卡片边框 |
| 边框强 Border Strong | --border-color-strong | #D3D1C7 | hover态、聚焦态 |
| 背景页面 Page BG | --bg-page | #FAFAF8 | 整体页面底色 |
| 背景卡片 Card BG | --bg-card | #FFFFFF | 卡片、面板、表格容器 |
| 背景悬浮 Surface BG | --bg-surface | #F1EFE8 | 侧栏、工具栏、输入框底色 |

### 字体

| 用途 | 字体族 | 字号 | 字重 |
|------|--------|------|------|
| 页面标题 H1 | Inter / Noto Sans SC | 15px | 500 |
| 区块标题 H2 | Inter / Noto Sans SC | 12-13px | 500 |
| 正文 Body | Inter / Noto Sans SC | 11-13px | 400 |
| 辅助 Caption | Inter / Noto Sans SC | 9-10px | 400 |
| 数值/代码 Mono | JetBrains Mono / monospace | 10-16px | 400/500 |

### 间距

| Token | 值 | 用途 |
|-------|-----|------|
| xs | 4px | 图标与文字间距 |
| sm | 8px | 紧凑元素间距 |
| md | 12px | 表格行内元素间距 |
| lg | 16px | 卡片内边距、区块间距 |
| xl | 24px | 大区块间距、页面边距 |
| xxl | 32px | 独立模块分隔 |
| radius-sm | 4px | 小按钮、输入框 |
| radius-md | 6px | 标签、小卡片 |
| radius-lg | 8px | 面板、表格容器 |
| radius-xl | 12px | 对话框、模态框 |

### shadcn/ui 组件映射

| UI 元素 | shadcn/ui 组件 | 自定义 | 出现页面 |
|---------|--------------|--------|---------|
| 侧栏导航 | SidebarNav (自建) | - | 全局 |
| KPI 卡片 | Card + 自定义 MetricCard | 数值大字号 | Dashboard |
| 数据表格 | Table | 可排序/筛选/分页 | Tag Config, Audit Log |
| 树形控件 | Tree (shadcn扩展) | 右键菜单 + 拖拽 | Node Tree |
| Tab 切换 | Tabs | - | Tag Config, Rule Designer |
| 表单输入 | Input, Select, Textarea | - | NodeTree属性, RPC写入 |
| 滑块 | Slider | 双向绑定数值 | RPC 控制 |
| 按钮 | Button | 三种样式(primary/secondary/danger) | 全局 |
| 徽章 Badge | Badge | 严重度/RW/状态 | 全局 |
| 告警卡片 | Card + AlarmBadge | 脉冲动效 | Alarms |
| 决策表 | JDM Editor (@gorules) | - | Rule Designer |
| 图表 | ECharts 5.5 | 折线/柱状/仪表盘 | Dashboard, Reports |
| 模态框 | Dialog | 二次确认(危险操作) | RPC Control |
| 工具提示 | Tooltip | - | 全局 |
| 公式编辑器 | CodeEditor (Monaco轻量) | SymPy语法高亮 | Tag Config |

---

## 4. 关键交互流程

### Flow A: 新站点上线（首次配置）

```
Login → Dashboard(空) → Node Tree Editor
  → [+ 添加节点] → 选 "Site" → 输入名称 → 回车
  → 右键 Site → "添加子节点" → 选 "Station" → 输入名称
  → 右键 Station → "添加子节点" → 选 "EnergyNode" → 选 ESS
  → 右键 ESS → "添加子节点" → 选 "Device" → 输入 "PCS #1"
  → 右键 PCS#1 → "从 Neuron 导入" → 选 modbus-pcs1 → 自动扫入18个tag
  → 右键 ESS → "添加逻辑点位" → 写公式 INTEGRAL(...) → 保存
  → 切换到 Dashboard → 看到 KPI 卡片跳动
  → 全程约 5 分钟
```

### Flow B: 告警触发与处理

```
规则引擎评估 (每秒) → 条件命中(SOC>90 AND Temp>55)
  → 创建 Alarm(CRITICAL) → 写入 DB + WebSocket 广播
  → Alarms 页面实时出现红色闪烁卡片
  → 浏览器声音提醒(可选)
  → Header 告警铃铛数 +1
  → 运维人员点击 [确认] → 填写处理备注
  → Alarm 变为 "acknowledged" 状态(虚线框)
  → 若问题修复 → 规则不再命中 → Alarm 自动 resolved(绿色)
```

### Flow C: 远程控制下发

```
RPC Control 页面 → 选择目标设备(PCS#1)
  → 看到快捷按钮 + 当前遥测值
  → 点击 [启动运行] 或自定义写入值
  → 填写操作原因(必填) → 点击 [执行写入]
  → 前端 POST /api/rpc/write
  → 后端 httpx → Neuron REST API /api/v2/write/tag
  → Neuron 写 Modbus 寄存器 → 设备执行
  → 结果回传 → 审计日志新增一行
  → WebSocket 推送新遥测值 → 前端更新
```

### Flow D: 规则配置与验证

```
Rule Designer → 选节点(ESS) → [+ 新建规则]
  → 选类型(alarm/control/fault_map/linkage)
  → 编辑决策表: 添加条件列(映射到Tag) + 输出动作
  → 点击 [模拟] → 输入测试值 → 查看命中结果
  → 确认无误 → 点击 [保存]
  → 后端 zen-engine 加载新 JDM → 立即生效(热更新)
  → 版本号 +1 → 记录变更历史
```

---

## 5. 响应式断点

| 断点 | 宽度 | 布局变化 | 适用场景 |
|------|------|---------|---------|
| Desktop | >= 1280px | 侧栏展开 + 双栏布局 | 运维工作站 |
| Tablet | 768-1279px | 侧栏收起(仅图标) + 单栏 | 现场平板 |
| Mobile | < 768px | 侧栏隐藏(汉堡菜单) + 全宽堆叠 | 手机巡检 |

**P5 阶段实现响应式，P2-P4 仅优化 Desktop (1280+)。**

---

## 6. 不在此阶段做的 (Won't Have)

| 功能 | 原因 | 加入时机 |
|------|------|---------|
| 暗色主题 Dark Mode | MVP 先做好一套 | 用户明确要求时 |
| 国际化 i18n | 中文市场优先 | 出海需求 |
| 多语言公式编辑 | SymPy 英文表达式够用 | 有非技术用户时 |
| 拖拽式 Dashboard Builder | Phase 5 再做 | P5 阶段 |
| 移动端原生 App | 响应式 Web 够用 | 明确移动需求时 |
| 实时协作(多人同时编辑) | 单用户 MVP | 多租户场景 |

---

## 7. 与后端 API 的对应关系

| 页面 | 主要消费的 API |
|------|---------------|
| Dashboard | GET /api/health, WS /api/ws/telemetry, GET /api/telemetry?agg=24h |
| Node Tree | CRUD /api/nodes/* |
| Tag Config | CRUD /api/tags/*, POST /api/tags/import-neuron |
| Telemetry | GET /api/telemetry?, WS /api/ws/telemetry |
| RPC Control | POST /api/rpc/write, GET /api/rpc/audit-log |
| Rules | CRUD /api/rules/*, POST /api/rules/simulate |
| Alarms | GET /api/alarms?, PUT /api/alarms/:id/acknowledge |
| Reports | GET /api/reports/{type}?format=excel |
| Settings | GET/PUT /api/settings |

---

*规格书版本: UI-SPEC-v1.0*
*最后更新: 2026-07-16*
*确认后锁死，Phase 2-5 前端开发严格遵循此文档*
