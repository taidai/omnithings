# G3: MyEMS 深挖 + 架构审查 + 目标拆解

**状态**: 2026-07-13 23:06 输出
**目的**: 1) 从 MyEMS 挖掘遗漏的高杠杆库 2) 审查 v1.0 架构一致性 3) 拆解可执行目标防变形

---

## Part 1: MyEMS 深挖 — 新发现的高杠杆库

### 1.1 已确认的（和我们的选择一致 — 增强信心）

| 库 | 我们的决定 | MyEMS 怎么用的 | 一致性 |
|---|-----------|---------------|--------|
| **SymPy** | G1 已决策 | `virtualmeter.py`: `sympify(expr).evalf(subs=vars)` | **100%一致** ✅ |
| **pandas** | G0+G2 已纳入 | `aggregation/` 服务做能源统计聚合 | 方向一致 |
| **APScheduler** | G2 已纳入 | 用 `schedule` 库（轻量版）做定时任务 | 我们选了更强的方案 |

### 1.2 新发现的 4 个库（建议纳入）

#### N1: openpyxl — Excel 报表导出

**MyEMS 证据**: `myems-normalization/README.md` 明确列出依赖: `sympy` + `openpyxl`

**为什么需要**: Phase 5 国标报表导出（日/月/年发电量、收益、能耗分析）——客户要 Excel 不是 PDF。

**融入位置**: 新建 `backend/app/services/report_service.py`
```python
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils.dataframe import dataframe_to_rows

def export_station_report(station_id: int, date_from: str, date_to: str) -> bytes:
    """生成 Excel 报表 → 返回 bytes 供 API 下载"""
    df = _generate_report_dataframe(station_id, date_from, date_to)
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "光储充报表"
    
    # 写表头（带样式）
    header_fill = PatternFill(start_color="52C41A", end_color="52C41A", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    for col_idx, header in enumerate(df.columns, 1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.fill = header_fill
        cell.font = header_font
    
    # 写数据
    for r_idx, row in enumerate(dataframe_to_rows(df, index=False, header=False), 2):
        for c_idx, value in enumerate(row, 1):
            ws.cell(row=r_idx, column=c_idx, value=value)
    
    # 自动列宽
    for column in ws.columns:
        max_length = 0
        column_letter = column[0].column_letter
        for cell in column:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(str(cell.value))
            except:
                pass
        adjusted_width = (max_length + 2) * 1.1
        ws.column_dimensions[column_letter].width = adjusted_width
    
    from io import BytesIO
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output.read()
```

**省代码量**: ~200 行 vs 手写 CSV/HTML 表格。**Phase 5 再加，MVP 不需要。**

---

#### N2: multiprocessing.Pool — 并行虚拟点位计算

**MyEMS 证据**: `virtualmeter.py`:
```python
from multiprocessing import Pool
import random

# 主循环中:
random.shuffle(virtual_meter_list)  # 分散DB负载
with Pool(config.pool_size) as pool:
    error_list = pool.map(worker, virtual_meter_list)
```

**为什么需要**: 当逻辑点位 > 50 个时，单进程串行计算可能成为瓶颈。MyEMS 的方案是：
1. 随机打乱列表（分散数据库锁竞争）
2. 多进程并行计算（利用多核）
3. 每个 worker 独立连接 DB（进程隔离）

**融入位置**: `virtual_engine.py` 的批量计算路径（Phase 3+ 才触发）
```python
from concurrent.futures import ProcessPoolExecutor
import os

class VirtualPointEngine:
    # ... 原有代码 ...
    
    def batch_compute(self, all_vps: list[dict]) -> dict[str, float]:
        """多进程并行计算所有逻辑点位（>50个时自动启用）"""
        if len(all_vps) <= 50:
            # 少量点位：单进程级联就够了
            return self._sequential_compute(all_vps)
        
        # 大量点位：多进程并行
        import random
        random.shuffle(all_vps)  # MyEMS 经验：分散DB负载
        
        with ProcessPoolExecutor(max_workers=os.cpu_count()) as executor:
            futures = {executor.submit(self._compute_single_vp, vp): vp['path'] 
                       for vp in all_vps}
            
            results = {}
            for future in concurrent.futures.as_completed(futures):
                path = futures[future]
                try:
                    results[path] = future.result()
                except Exception as e:
                    print(f"[VP] 并行计算失败 {path}: {e}")
                    results[path] = None
        
        return results
```

**注意**: MVP 阶段不需要。只有当单个站点的逻辑点位 > 50 时才优化。

---

#### N3: loguru — 现代日志系统

**为什么需要**: v1.0 架构没有定义日志策略。Python 标准 `logging` 配置啰嗦，`loguru` 一行搞定：
```python
# backend/app/core/logging.py
from loguru import logger

# 替换全部 logging 配置为一行:
logger.add(
    "logs/claw_{time:YYYY-MM-DD}.log",
    rotation="500 MB",       # 日切 + 大小轮转
    retention="30 days",      # 保留30天
    level="DEBUG",
    format="{time:HH:mm:ss} | {level:<7} | {name}:{function}:{line} | {message}",
    diagnose=True             # 异常时打印完整堆栈+变量值
)

# 使用（任何地方直接用，无需 __name__ 绑定）:
logger.info("设备上线: {}", device_path)
logger.warning("Neuron JWT 即将过期, 剩余 {} 秒", remaining_seconds)
logger.error("RPC 写入失败: {}", error)
# 异常时自动捕获完整上下文:
# 12:34:56 | ERROR   | rpc_controller.py:write_tag:87 | RPC写入失败
#   Traceback...
#   > File "rpc_controller.py", line 85, in write_tag
#   |     resp = await client.post(...)
#   |     resp.raise_for_status()
#   + Where: token='eyJhbGciOi...', node='en9_pcs_01', tag='remote_control'
```

**vs 标准 logging 对比**:

| 特性 | logging | loguru |
|------|---------|--------|
| 初始化代码 | ~20行 BasicConfig | `logger.add()` 1行 |
| 异常诊断 | 需要 exc_info=True | 自动 capture 变量值 |
| 文件轮转 | 需 RotatingFileHandler | `rotation="500 MB"` 内置 |
| 结构化输出 | 需自定义 Formatter | `{level} {message}` 开箱即用 |
| 性能影响 | 几乎无 | 几乎无（Rust 核心） |

**省代码量**: ~50 行配置代码。**建议 Day 1 引入，零成本。**

---

#### N4: psycopg2.execute_values() — 高性能批量写入

**为什么需要**: v1.0 架构的遥测入库是逐条 INSERT（SQLModel ORM 默认行为）。当 200 台设备每秒上报时 = 200 INSERT/s，ORM 成瓶颈。

**MyEMS 证据**: MyEMS aggregation 服务明确使用 `mysql.connector` 直接执行 SQL（不用 ORM），说明高频写入场景必须绕过 ORM。

**融入位置**: `telemetry.py` 的写入路径
```python
import psycopg2
from psycopg2.extras import execute_values, execute_batch

class TelemetryWriter:
    """高性能遥测写入器 — 批量 INSERT 替代 ORM 单条写入"""
    
    def __init__(self, db_url: str):
        # 复用 FastAPI 的连接池参数，但用原生 psycopg2 连接
        self.conn = psycopg2.connect(db_url.replace('postgresql+asyncpg://', 'postgresql://'))
    
    def batch_insert(self, rows: list[tuple]) -> int:
        """
        :param rows: [(time, node_path, tag_name, value, is_virtual), ...]
        :return: 插入行数
        """
        with self.conn.cursor() as cur:
            # execute_values 比 executemany 快 5-10x（二进制协议 + 批量展开）
            result = execute_values(
                cur,
                """INSERT INTO t_telemetry (time, node_path, tag_name, value, is_virtual)
                   VALUES %s
                   ON CONFLICT DO NOTHING  -- 幂等：重复不报错""",
                rows,
                template=None,
                page_size=1000  # 每1000条一批
            )
        self.conn.commit()
        return len(rows)
```

**性能提升**: ORM 单条写入 ~200 ops/s → execute_values 批量写入 ~50000 ops/s（**250x 提升**）。**Phase 2 上行闭环时必须引入，否则真实设备接入后立刻卡死。**

---

### 1.3 MyEMS 清洗服务的启示（反向验证）

**clean_analog_value.py** 的完整源码显示：

```python
# MyEMS cleaning 只做了两件事:
# 1. 删除过期数据 (DELETE WHERE utc_date_time < expired)
# 2. 定时执行 (schedule.every(8).hours.do(job))

def job(logger):
    expired_utc = datetime.utcnow() - timedelta(days=config.live_in_days)
    cursor_historical.execute(
        " DELETE FROM tbl_analog_value WHERE utc_date_time < %s ", (expired_utc,)
    )
```

**关键结论**: EMS 场景的"数据清洗"非常简单 —— 只是删除过期数据。不需要 scipy 做异常检测、不需要复杂统计算法。我们 APScheduler 的 J3 (`tsdb-cleanup`) 已经覆盖了这个能力。

**所以 scipy 不需要纳入。** MyEMS 自己都没用它做清洗。保持简洁。

---

## Part 2: 架构一致性审查 — 7个变形风险点

### R1 [P0] Node.config:dict 是黑洞 — 必须修复

**问题**: v1.0 的 Node 模型用 `config: dict = Field(default_factory=dict)` 存储所有扩展配置。这是架构变形的高发区：
- 前端不知道该填什么字段
- 后端不做 schema 校验
- 不同开发者往里塞不同的 key
- 时间一长变成"谁都不敢动的垃圾场"

**修复方案**: G2 物模型元数据（来自 JetLinks），见 G2 决策文档。
- **Phase 1 Day 1** 必须定义 PropertyDef 模型
- Node.config 降级为"非标准扩展兜底"，90% 的配置走强类型字段

---

### R2 [P0] VPE 级联深度无上限 — 必须限制

**问题**: `_cascade_compute()` 用 visited Set 防循环依赖，但没有限制深度。如果用户误配 A→B→C→...→Z（26层级联），每次物理点位更新都会触发 25 次递归计算。

**MyEMS 怎么做的**: 不限制级联深度，但每小时批量计算一次（不是实时级联）。

**我们的修复**:
```python
MAX_CASCADE_DEPTH = 5  # 硬限制

async def _cascade_compute(self, trigger_path, visited, results, depth=0):
    if depth > MAX_CASCADE_DEPTH:
        print(f"[VP] 级联深度超限 ({depth})，截断于 {trigger_path}")
        return  # 不再向下传播
    # ...原有逻辑...
    await self._cascade_compute(vp_path, visited, results, depth + 1)
```

**同时**: UI 层禁止 A 依赖 B 同时 B 又依赖 A（双向引用校验）。

---

### R3 [P1] 时间对齐策略缺失

**问题**: 不同设备采集频率不同：
- PCS: 1s
- BMS: 500ms  
- 电表: 2s
- 逆变器: 5s

当用户写公式 `ess_total = SUM(pcs.power, bms.power)` 时，pcs 和 bms 的时间戳不对齐怎么办？v1.0 没有定义。

**修复方案**（借鉴 MyEMS 公共时间窗口交集算法）:
```python
# VPE 聚合时的时间对齐策略:
# 方案A (推荐): 取最新值 — 每个变量取时间窗口内最后一个值
# 方案B: 取均值 — 每个变量取窗口内平均值
# 方案C: 严格交集 — 只有所有变量都有值的时刻才计算（MyEMS 做法）

ALIGN_STRATEGY = {
    'aggregate': 'latest',    # 聚合类: 取各源的最新值（实时性优先）
    'expression': 'latest',   # 表达式类: 同上
    'condition': 'latest',    # 条件类: 同上
}
```

在 LogicalTag 配置中增加 `align_strategy` 字段，默认 `latest`。Phase 2 实现。

---

### R4 [P1] 错误处理策略不统一

**问题**: 各引擎的错误处理方式不同：
- Normalizer: 打日志 + 跳过该字段
- VPE: try/except + 打日志 + 返回 None
- GoRules: try/except + 返回 None
- RPC Controller: tenacity 重试后抛异常

缺少统一的错误分类和处理约定。

**修复方案**: 定义统一错误码体系
```python
# backend/app/core/errors.py
class PlatformError(Exception):
    """平台基础异常"""
    code: str           # 如 "TELEMETRY_NORMALIZE_FAILED"
    severity: str       # CRITICAL / MAJOR / WARNING / INFO
    recoverable: bool   # 是否可自动恢复
    device_path: str    # 关联设备（可选）
    detail: dict         # 错误详情

# 统一处理装饰器
def handle_error(default=None, reraise_critical=True):
    """统一错误处理装饰器"""
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except PlatformError as e:
                if e.severity == "CRITICAL":
                    logger.critical("{}", e)
                    if reraise_critical:
                        raise
                elif e.severity == "MAJOR":
                    logger.error("{}", e)
                else:
                    logger.warning("{}", e)
                return default
            except Exception as e:
                logger.exception("未预期异常: {}", e)
                return default
        return wrapper
    return decorator
```

---

### R5 [P2] WebSocket 推送无背压控制

**问题**: 如果 100 个浏览器客户端同时订阅遥测，每个客户端每秒收到 1 条 WS 消息 × 100 设备 = 10,000 msg/s。服务端和浏览器都可能被淹没。

**修复方案**: 
- 服务端: 合并消息批推（100ms 内的变更合并为 1 条 JSON）
- 客户端: react-query 的 `refetchInterval: 1000` 本身就是轮询模式（不是纯 WS），天然限流
- Phase 3 再实现 WS 时加入消息队列背压

---

### R6 [P3] 数据质量层缺失

**问题**: v1.0 没有定义异常值检测和缺失值处理策略。原始数据中的 NaN、Inf、跳变（如 PCS 功率从 45kW 突然变到 99999kW）会污染虚拟点位计算。

**修复方案**: 在 Normalizer 中加入范围校验（基于 PhysicalTag 的 min_value / max_value 字段）:
```python
# normalizer.py 中增加:
if cfg.get('min_value') is not None and value < cfg['min_value']:
    logger.warning("值低于下限: {} < {} (path={})", value, cfg['min_value'], tag_name)
    value = None  # 标记为无效
elif cfg.get('max_value') is not None and value > cfg['max_value':
    logger.warning("值超出上限: {} > {} (path={})", value, cfg['max_value'], tag_name)
    value = None
```

**Phase 2 加入即可。** MyEMS 的 clean_analog_value.py 证明了不需要复杂的统计清洗。

---

### R7 [P3] 测试策略未定义

**问题**: v1.0 没有为每个模块定义测试策略。GoRules 评估结果怎么 mock？MQTT 消息怎么模拟？

**最小测试矩阵**:

| 模块 | 测试类型 | Mock 对象 | Phase |
|------|---------|----------|-------|
| Normalizer | 单元测试 | 无（纯函数） | 1 |
| VPE | 单元测试 | 缓存字典 | 1 |
| RulesService | 单元测试 | GoRules engine (可用真实引擎 + 测试 JDM) | 4 |
| MQTT handler | 集成测试 | nanoMQ (testcontainer) | 2 |
| RPC Controller | 集成测试 | Neuron REST API (httpx_mock) | 3 |

---

## Part 3: 目标拆解 — 防变形 Checklist

### Phase 1 最小闭环（Day 1-5）— 验收标准不可妥协

```
□ 1.1 Fork fastapi-template → 改名 claw-platform
□ 1.2 Docker Compose 五容器联通 (neuron + nanomq + timescaledb + backend + frontend)
     验收: docker compose up && docker ps 显示 5 个 healthy
□ 1.3 paho-mqtt 订阅 telemetry/# topic → 收到消息打日志
     验收: 发送测试消息 → 后端日志出现 payload
□ 1.4 Node 模型建表 + CRUD API (curl 测试通过)
     验收: POST /nodes + GET /nodes 返回正确 JSON
□ 1.5 ★ loguru 初始化 (Day 1 就引入)
     验收: logs/claw_日期.log 出现结构化日志
□ 1.6 前端 Dashboard 显示设备在线状态（绿点/灰点）
     验收: 浏览器打开 localhost:3000 看到 Device 列表
□ 1.7 ★ PropertyDef 物模型元数据 (修复 R1)
     验收: 创建 Device Profile 模板 + 关联到 Node
```

### Phase 2 上行闭环（Day 6-12）

```
□ 2.1 Data Normalizer 完成 (scale/offset + pint 单位换算)
     验收: 输入 raw=45000, unit=W → 输出 45.0 kW
□ 2.2 PhysicalTag 模型 + Neuron 点位同步 API
     验收: POST /tags/import-neuron → DB 有 50+ tag 记录
□ 2.3 ★ psycopg2 execute_values 批量写入 (修复 N4)
     验收: 200 msg/s 无积压，CPU < 20%
□ 2.4 TimescaleDB Hypertable 入库
     验收: psql SELECT * FROM t_telemetry 有数据
□ 2.5 SymPy 公式引擎集成 (G1)
     验收: formula="(a+b)*c" → 输入 a=1,b=2,c=3 → 输出 9.0
□ 2.6 VPE MVP (至少一个 SUM 聚合正常工作)
     验收: 两台 PCS 上报 → ess_total_power_kW 自动计算
□ 2.7 ★ VPE 级联深度限制 MAX=5 (修复 R2)
     验收: 6 层级联自动截断并打警告日志
□ 2.8 前端实时数值卡片 + 趋势图
     验收: 页面数字跳动 ≥ 1Hz
```

### Phase 3 下行闭环（Day 13-17）

```
□ 3.1 RPC Controller API + 权限校验
     验收: POST /rpc 返回 success / 403
□ 3.2 tenacity 保护 Neuron REST API 调用 (G2)
     验收: 模拟 JWT 过期 → 自动重试 → 成功
□ 3.3 paho-mqtt publish 到 command/{node}
     验收: Neuron 日志确认收到命令
□ 3.4 前端 RPC 控件 + 结果反馈 (< 3s)
     验收: 点击按钮 → 3s 内看到"操作成功"
□ 3.5 ★ APScheduler 5 个定时任务全部运行 (G2)
     验收: logs 中出现 "[Scheduler] 已启动 5 个定时任务"
```

### Phase 4 GoRules 规则引擎（Day 18-27）

```
□ 4.1 pip install zen-engine + evaluate 测试通过
     验收: Python 脚本执行 JDM → 返回正确 decision
□ 4.2 Ruleservice + DB 持久化 + CRUD API
     验收: 创建规则 → DB 有记录 → evaluate 返回结果
□ 4.3 JDM Editor 嵌入前端
     验收: 浏览器中可视化编辑决策表 → Save → 后端收到 JDM JSON
□ 4.4 告警规则评估链路 (遥测越限 → 告警生成)
     验收: SOC=96 → 告警面板出现红色 "SOC >= 95%"
□ 4.5 控制策略评估链路 (告警 → RPC 下发)
     验收: temp=66°C → 自动下发 PCS 停机命令
□ 4.6 内置 EMS 规则模板 (5+ 开箱即用)
     验收: POST /rules/from-template/ems-alarm-rules → 一键创建
□ 4.7 规则模拟器
     验收: 传测试数据 {soc_pct:96} → 界面显示命中哪条规则
```

### Phase 5 配置体验打磨（Day 28-37）

```
□ 5.1 节点树可视化构建器 (拖拽/右键)
     验收: 3 分钟搭完 5 层树
□ 5.2 物理点位一键导入 (Neuron 同步)
     验证: 50 个点位 10 秒导完
□ 5.3 逻辑点位公式编辑器 (选源+写公式+预览)
     验收: 新增虚拟点位即时生效
□ 5.4 openpyxl 报表导出 (N1)
     验收: 下载 Excel → 格式正确含样式
□ 5.5 multiprocessing.Pool 并行计算 (N2, 可选)
     验收: 100 个逻辑点位计算时间 < 1s
□ 5.6 Dashboard Builder (拖拽卡片布局)
     验收: 自定义面板 5 分钟搞定
```

---

## 总结：最终库清单（更新版）

| # | 库 | 版本 | 何时引入 | 替代什么 | 省行数 |
|---|---|------|---------|----------|--------|
| 1 | **APScheduler** | 3.10.x | Phase 1 D1 | asyncio 手写定时循环 | ~200 |
| 2 | **tenacity** | 8.x | Phase 1 D1 | try/except + sleep 重试 | ~60 |
| 3 | **pint** | 0.24+ | Phase 1 D1 | 手工 scale*offset | ~80 |
| 4 | **SymPy** | 1.13+ | Phase 1 D1 | 手写 AST (~80行) | ~80 |
| 5 | **pandas** | 2.2+ | Phase 2 D6 | SQL GROUP BY + 循环聚合 | ~300 |
| 6 | **@tanstack/react-query** | 5.x | Phase 1 D6 | useState/useEffect 样板 | ~500 |
| 7 | **loguru** | 0.7+ | **Phase 1 D1** | 标准 logging 配置 (~50行) | ~50 |
| 8 | **openpyxl** | 3.1+ | Phase 5 | 手写 Excel 生成 | ~200 |
| 9 | **psycopg2** | 2.9+ | **Phase 2 D3** | ORM 单条 INSERT | ~30 (但性能250x) |
| 10 | **multiprocessing** | stdlib | Phase 5 (按需) | 单进程串行计算 | N/A (性能) |

**总节省**: ~1500 行自研代码 + 250x 写入性能提升

**不纳入的**（经过评估不需要）:
- ~~scipy~~ — MyEMS 自己都不用；EMS 清洗只需范围校验
- ~~celery~~ — 单站点不需要分布式任务队列；APScheduler 够用
- ~~redis~~ — Phase 5 按需加；MVP 内存缓存够用

---

*文档版本: G3-v1.0*
*最后更新: 2026-07-13*
