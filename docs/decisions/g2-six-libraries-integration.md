# G2: 六库融入 Claw 架构 v1.1

**状态**: 待实施 (Phase 1 Day 1 全部引入)
**原则**: 不改 v1.0 架构设计，只在函数级做 drop-in 替换
**总节省**: ~1420 行代码（后端 920 + 前端 500）

---

## 总览

| # | 库 | 版本 | 融入模块 | 替代什么 | 省行数 |
|---|---|------|---------|----------|--------|
| 1 | **APScheduler** | 3.10.x | `main.py` / 新建 `scheduler.py` | asyncio 手写定时循环 + cron 解析 | ~200 |
| 2 | **tenacity** | 8.x | `rpc_controller.py` / `mqtt_client.py` | try/except + sleep 重试循环 + 指数退避 | ~60 |
| 3 | **pint** | 0.24+ | `normalizer.py` | `scale_factor * value + offset` 手工换算 | ~80 |
| 4 | **SymPy** | 1.13+ | `virtual_engine.py` | `_eval_expression()` 手写 AST (~80行) | ~80 |
| 5 | **pandas** | 2.2+ | `telemetry.py` / `report_service.py` | 原始 SQL GROUP BY + Python 循环聚合 | ~300 |
| 6 | **@tanstack/react-query** | 5.x | `Dashboard.tsx` / `TelemetryView.tsx` | useState+useEffect+fetch+loading 缓存样板 | ~500 |

**安装命令（一次性）**:
```bash
pip install apscheduler tenacity pint sympy pandas
npm install @tanstack/react-query
```

---

## 1. APScheduler — 定时任务引擎

**v1.0 问题**: `main.py` 里用 `asyncio.create_task()` + `while True: asyncio.sleep()` 写定时逻辑，没有 cron 支持、没有错误隔离、没有持久化。

### 融入位置

```python
# backend/app/core/scheduler.py — 新文件
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

class PlatformScheduler:
    """统一定时任务调度器 — 替代散落的 asyncio 循环"""

    def __init__(self):
        self.scheduler = AsyncIOScheduler(
            timezone='Asia/Shanghai',
            job_defaults={
                'coalesce': True,          # 错过的执行合并为一次
                'max_instances': 1,        # 同一 job 不并发
                'misfire_grace_time': 300  # 误执行宽容 5 分钟
            }
        )
        self._register_jobs()

    def _register_jobs(self):
        # J1: Neuron JWT Token 定时刷新（解决 P0 痛点）
        self.scheduler.add_job(
            self._refresh_neuron_tokens,
            IntervalTrigger(minutes=30),
            id='neuron-jwt-refresh',
            name='Neuron JWT Token 刷新',
            replace_existing=True
        )

        # J2: 规则引擎从 DB 热重载
        self.scheduler.add_job(
            self._reload_rules,
            IntervalTrigger(minutes=5),
            id='rules-hot-reload',
            name='规则热重载检查',
            replace_existing=True
        )

        # J3: Hypertable 数据清理（冷数据压缩）
        self.scheduler.add_job(
            self._cleanup_old_data,
            CronTrigger(hour=2, minute=0),  # 每天凌晨 2 点
            id='tsdb-cleanup',
            name='TSDB 冷数据压缩',
            replace_existing=True
        )

        # J4: 设备在线状态巡检
        self.scheduler.add_job(
            self._health_check_devices,
            IntervalTrigger(seconds=30),
            id='device-health-check',
            name='设备在线状态巡检',
            replace_existing=True
        )

        # J5: 告警自动恢复检测（持续 N 分钟无触发 → 自动 resolve）
        self.scheduler.add_job(
            self._check_alarm_recovery,
            IntervalTrigger(minutes=1),
            id='alarm-recovery-check',
            name='告警恢复检测',
            replace_existing=True
        )

    async def start(self):
        self.scheduler.start()
        print(f"[Scheduler] 已启动 {len(self.scheduler.get_jobs())} 个定时任务")

    async def _refresh_neuron_tokens(self):
        """J1: 刷新所有 Neuron 实例的 JWT Token"""
        # 遍历所有配置了 neuronHost 的站点，POST /api/v2/login
        # 更新共享缓存（内存 or Redis）
        pass

    async def _reload_rules(self):
        """J2: 检查 DB 中规则版本变化，热更新 GoRules 引擎"""
        pass

    async def _cleanup_old_data(self):
        """J3: TimescaleDB 冷数据压缩/降采样"""
        # CALL compress_chunk() / drop_chunks(older than retention)
        pass

    async def _health_check_devices(self):
        """J4: 30s 无数据上报的设备标记为离线"""
        pass

    async def _check_alarm_recovery(self):
        """J5: 检查告警条件是否已恢复"""
        pass


# backend/app/main.py — 启动集成
from app.core.scheduler import PlatformScheduler

@app.on_event("startup")
async def startup():
    # ... 已有初始化 ...
    platform_scheduler = PlatformScheduler()
    await platform_scheduler.start()
    app.state.scheduler = platform_scheduler  # 挂到 app state 上
```

### 对应 v1.0 变更

| v1.0 代码位置 | 改动 |
|--------------|------|
| `main.py` 散落的 `asyncio.create_task()` 循环 | 删除，全部迁移到 `scheduler.py` |
| 无 cron 能力 | 新增：每天凌晨 2 点 TSDB 清理等 cron 任务 |
| 无 job 错误隔离 | 一个 job 异常不影响其他 job |
| 无误执行处理 | `coalesce=True` + `misfire_grace_time` 自动兜底 |

---

## 2. tenacity — 重试装饰器

**v1.0 问题**: `rpc_controller.py` 里调 Neuron REST API 时，如果 JWT 过期或网络抖动，需要手写 `try/except` + `time.sleep()` 重试逻辑。之前技能里记录过这是 P0 痛点。

### 融入位置

```python
# backend/app/core/rpc_controller.py — 增强
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type, before_sleep_log
import logging

logger = logging.getLogger(__name__)

class NeuronClient:
    """Neuron REST API 客户端 — 带 tenacity 自动重试"""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self._token = None

    @retry(
        stop=stop_after_attempt(3),                    # 最多重试 3 次
        wait=wait_exponential(multiplier=1, min=1, max=10),  # 指数退避: 1s, 2s, 4s...
        retry=retry_if_exception_type((httpx.HTTPError, httpx.StatusError)),  # 仅网络/5xx 重试
        reraise=True,                                   # 3 次都失败才抛异常
        before_sleep=before_sleep_log(logger, logging.WARNING)  # 每次重试打日志
    )
    async def write_tag(self, node: str, group: str, tag: str, value):
        """
        写寄存器 — 自动处理 JWT 过期 + 网络抖动
        第一次失败: 等 1 秒重试 (可能 JWT 过期，中间件会自动刷新)
        第二次失败: 等 2-3 秒重试
        第三次失败: 抛出异常给上层处理
        """
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                f"{self.base_url}/api/v2/write",
                headers={"Authorization": f"Bearer {self._token}"},
                json={"node": node, "group": group, "tag": tag, "value": value}
            )
            resp.raise_for_status()
            return resp.json()

    @retry(
        stop=stop_after_attempt(2),
        wait=wait_exponential(min=0.5, max=2),
        retry=retry_if_exception_type(httpx.HTTPError)
    )
    async def read_tag(self, node: str, group: str, tags: list[str]):
        """读寄存器 — 轻量重试即可（读操作幂等）"""
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.post(
                f"{self.base_url}/api/v2/read",
                json={"node": node, "group": group, "tags": tags}
            )
            resp.raise_for_status()
            return resp.json()

    # JWT 刷新也用 tenacity 保护
    @retry(stop=stop_after_attempt(2), wait=wait_exponential(min=0.5, max=1))
    async def login(self, username: str = "admin", password: str = "password"):
        """登录获取新 token — 失败快速重试 1 次"""
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.post(f"{self.base_url}/api/v2/login", json={
                "name": username, "pass": password
            })
            resp.raise_for_status()
            self._token = resp.json()["token"]
            return self._token
```

### 对应 v1.0 变更

| v1.0 代码位置 | 改动 |
|--------------|------|
| `rpc_controller.py` 手写 `requests.post()` + try/except | 替换为带 `@retry` 的 `httpx.AsyncClient()` |
| 无指数退避 | `wait_exponential`: 1s→2s→4s |
| 无重试日志 | `before_sleep_log`: 每次 WARNING 级别记录重试原因 |
| JWT 过期手动 curl | 结合 APScheduler J1 定时刷新 + tenacity 运行时重试，双保险 |

---

## 3. pint — 物理单位换算

**v1.0 问题**: PhysicalTag 用 `scale_factor * value + offset` 做单位转换。问题：
- 不同品牌设备原始值单位不统一（W vs mW vs kW 混用）
- 忘记乘 scale_factor 或搞反方向是常见 bug
- 无法表达复合单位（kWh、kVA、℃ 转 ℉）

### 融入位置

```python
# backend/app/core/normalizer.py — 重写归一化层
import pint

# 全局 ureg 实例（应用生命周期内只初始化一次）
ureg = pint.UnitRegistry(auto_reduce_dimensions=True)

# 定义 EMS 常用单位缩写
ureg.define('kW = kilowatt')
ureg.define('kWh = kilowatt_hour')
ureg.define('V = volt')
ureg.define('degC = degree_Celsius')

class DataNormalizer:
    """
    归一化引擎: Neuron 原始值 → 标准 SI 单位工程值
    pint 保证单位正确性，消灭一类 bug
    """

    async def normalize(self, device_path: str, raw_values: dict,
                         tag_configs: dict[str, dict]) -> dict:
        """
        :param device_path: 设备节点路径
        :param raw_values: {tag_name: raw_int_value} 来自 Neuron MQTT
        :param tag_configs: {tag_name: {unit_from, unit_to, ...}} 来自 DB
        :return: {standard_field_name: float_value}
        """
        result = {}
        for tag_name, raw_val in raw_values.items():
            cfg = tag_configs.get(tag_name, {})

            if 'unit_from' in cfg and 'unit_to' in cfg:
                # ★ pint 换算: 原始单位 → 目标单位
                raw_q = ureg.Quantity(raw_val, cfg['unit_from'])
                converted = raw_q.to(cfg['unit_to'])
                value = converted.magnitude
            elif cfg.get('scale_factor', 1.0) != 1.0 or cfg.get('offset', 0) != 0:
                # 兼容旧模式: scale/offset
                value = raw_val * cfg.get('scale_factor', 1.0) + cfg.get('offset', 0)
            else:
                value = raw_val

            standard_name = cfg.get('field_alias', tag_name)
            result[standard_name] = round(value, 4)

        result['_device_path'] = device_path
        result['_timestamp'] = datetime.utcnow().isoformat()
        return result
```

### Node 模型变更

```python
# PhysicalTag 扩展字段变更
# BEFORE (v1.0):
scale_factor: float = 1.0   # 缩放因子
offset: float = 0.0         # 偏移量

# AFTER (v1.1, pint 模式优先):
unit_from: Optional[str] = None     # 原始单位, 如 "mW" / "mV" / "0.1degC"
unit_to: Optional[str] = None       # 目标单位, 如 "kW" / "V" / "degC"
# 兼容旧字段:
scale_factor: float = 1.0           # pint 不用时 fallback
offset: float = 0.0
```

### 使用示例

```python
# Neuron 上报: {"activePower": 45000}  ← 单位: W (瓦特)
# DB 配置: unit_from="W", unit_to="kW"
normalizer.normalize(..., {"activePower": 45000}, {"activePower": {"unit_from":"W","unit_to":"kW"}})
# → {"activePower_kW": 45.0}

# BMS 温度: raw=352, unit_from="0.1degC", unit_to="degC"
# → {"max_temp_c": 35.2}

# 电能计量: raw=12345678, unit_from="Wh", unit_to="kWh"
# → {"total_energy_kWh": 12345.678}
```

---

## 4. SymPy — 公式引擎（详见 G1 文档）

**精简版融入说明**：

```python
# backend/app/core/virtual_engine.py — 只改动一个方法

# 删除这些 (~80 行):
# - _OPS 映射表 (运算符白名单)
# - _eval_node() 递归函数
# - _eval_expression() 的 ast.parse 实现

# 替换为 (~15 行):
from sympy import sympify, SympifyError

def _eval_expression(self, formula: str, source_paths: list[str]) -> float:
    variables = self._extract_variables(source_paths)  # 从缓存取值
    expr = sympify(formula)                            # 字符串 → 符号表达式
    result = expr.evalf(subs=variables)                # 代入求值
    return float(result)
```

完整决策文档见 `docs/decisions/g1-sympy-engine.md`。

---

## 5. pandas — 数据分析聚合

**v1.0 问题**: Phase 2 的遥测查询 API 需要支持时间窗口聚合（1min/1hour/1day），以及报表计算。纯 SQL + Python 循环写起来啰嗦。

### 融入位置

```python
# backend/app/api/telemetry.py — 查询 API
import pandas as pd
from sqlalchemy import text

async def query_telemetry(paths: list[str], fields: list[str],
                          from_t: datetime, to_t: datetime,
                          agg: str = 'raw',          # raw | 1m | 1h | 1d
                          limit: int = 10000) -> dict:
    """
    遥测查询 — pandas 做 SQL 做不到的后处理
    """
    # 1. 从 TimescaleDB 取原始数据
    sql = text("""
        SELECT time, node_path, tag_name, value
        FROM t_telemetry
        WHERE time BETWEEN :t_from AND :t_to
          AND node_path = ANY(:paths)
          AND tag_name = ANY(:fields)
        ORDER BY time DESC
        LIMIT :limit
    """)
    rows = db.execute(sql, {
        "t_from": from_t, "t_to": to_t,
        "paths": paths, "fields": fields, "limit": limit
    }).fetchall()

    if not rows:
        return {"data": [], "count": 0}

    # 2. 转为 DataFrame
    df = pd.DataFrame([dict(r._mapping) for r in rows])
    df['time'] = pd.to_datetime(df['time'])

    if agg == 'raw':
        # 原始值返回
        data = df.to_dict(orient='records')
    else:
        # 3. 时间窗口聚合 — pandas 比 SQL GROUP BY 灵活得多
        freq_map = {'1m': '1min', '1h': '1h', '1d': '1D'}
        freq = freq_map.get(agg, '1min')

        grouped = (
            df.groupby(['node_path', 'tag_name', pd.Grouper(key='time', freq=freq)])
              .agg(avg=('value', 'mean'),
                   min=('value', 'min'),
                   max=('value', 'max'),
                   count=('value', 'count'))
              .reset_index()
              .round(4)
        )
        data = grouped.to_dict(orient='records')

    return {"data": data, "count": len(data)}
```

```python
# backend/app/services/report_service.py — 报表服务 (Phase 5)

def generate_daily_report(station_id: int, date: str) -> dict:
    """日发电量/用电量/收益报表 — pandas 聚合 + 计算"""

    df = _load_telemetry_range(station_id, date, date + '1 day')

    report = {}

    # 光伏发电量统计
    pv_df = df[df['node_path'].str.contains('pv') & (df['tag_name'] == 'daily_energy_kwh')]
    if not pv_df.empty:
        pv_daily = pv_df.groupby('node_path')['value'].sum()
        report['pv_total_kwh'] = round(pv_daily.sum(), 2)
        report['pv_per_inverter'] = pv_daily.round(2).to_dict()

    # 储能效率分析
    pwr_df = df[df['tag_name'].isin(['charge_power_kW', 'discharge_power_kW'])]
    if not pwr_df.empty:
        pivot = pwr_df.pivot_table(
            values='value', index='time',
            columns='tag_name', aggfunc='mean', freq='1h'
        )
        report['ess_round_trip_efficiency_pct'] = round(
            pivot['discharge_power_kW'].sum() /
            max(pivot['charge_power_kW'].sum(), 0.01) * 100, 2
        )

    # 峰谷电费估算
    tariff_map = {'peak': 1.2, 'flat': 0.7, 'valley': 0.3}  # 元/kWh
    for period, rate in tariff_map.items():
        hours = _get_tariff_hours(period)
        period_usage = df[df['time'].dt.hour.isin(hours)]['value'].sum() if not df.empty else 0
        report[f'cost_{period}_cny'] = round(period_usage * rate, 2)

    report['total_cost_cny'] = sum(v for k, v in report.items() if k.startswith('cost_'))

    return report
```

### pandas vs 纯 SQL 对比

| 场景 | 纯 SQL | pandas | 胜出 |
|------|--------|--------|------|
| 时间窗口聚合 | `time_bucket()` + GROUP BY | `df.groupby(pd.Grouper(freq))` | 平手 |
| 多指标同时 avg/min/max/count | 4 个聚合函数 | `.agg(dict)` 一行 | **pandas** |
| pivot 表（充放电对比）| CASE WHEN + 条件聚合 | `.pivot_table()` | **pandas** |
| 缺失值插值 | COALESCE (复杂) | `.interpolate()` / `.fillna(method='ffill')` | **pandas** |
| 分位数 (P95/P99) | PERCENTILE_CONT (PG 支持) | `.quantile(0.95)` | 平手 |
| 导出 Excel/CSV | COPY TO STDOUT | `.to_excel()` / `.to_csv()` | **pandas** |

---

## 6. @tanstack/react-query — 前端状态管理

**v1.0 问题**: 每个 Dashboard 卡片都要写 `useState + useEffect + setInterval(fetch) + loading + error` —— 至少 50 行样板代码。10 个卡片就是 500 行。

### 融入位置

```tsx
// frontend/src/lib/api-client.ts — Query Client 配置
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,       // 2 秒内认为数据新鲜
      refetchInterval: 1000,  // 每 1 秒轮询（遥测场景）
      retry: 2,               // 失败重试 2 次
      refetchOnWindowFocus: false,  // 切 tab 不重新请求
    },
  },
})

// frontend/src/pages/Dashboard.tsx — 使用前（v1.0 样板）
// function PowerCard({ deviceId }: Props) {
//   const [power, setPower] = useState<number | null>(null)
//   const [loading, setLoading] = useState(true)
//   const [error, setError] = useState<string | null>(null)
//
//   useEffect(() => {
//     const timer = setInterval(async () => {
//       try {
//         const res = await fetch(`/api/v1/telemetry/latest?paths=${deviceId}&fields=activePower_kW`)
//         const data = await res.json()
//         setPower(data[0]?.value ?? null)
//       } catch (e) {
//         setError(e.message)
//       } finally {
//         setLoading(false)
//       }
//     }, 1000)
//     return () => clearInterval(timer)
//   }, [deviceId])
//
//   if (loading) return <Spinner />
//   if (error) return <ErrorText>{error}</ErrorText>
//   return <MetricCard label="Active Power" value={power} unit="kW" />  // 50 行
// }

// frontend/src/pages/Dashboard.tsx — 使用后（react-query）
function PowerCard({ devicePath }: { devicePath: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['telemetry', devicePath, 'activePower_kW'],
    queryFn: () =>
      api.get('/telemetry/latest', {
        params: { paths: devicePath, fields: 'activePower_kW' },
      }).then(r => r.data.data?.[0]?.value ?? null),
    refetchInterval: 1000,  // 1s 刷新
  })

  if (isLoading) return <Spinner />
  if (error) return <ErrorText>{error.message}</ErrorText>
  return <MetricCard label="Active Power" value={data} unit="kW" />  // 12 行
}

// RPC 控制 mutation
function RpcButton({ deviceId, method, params }: RpcProps) {
  const rpcMutation = useMutation({
    mutationFn: () => api.post(`/devices/${deviceId}/rpc`, { method, params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telemetry', deviceId] })
      toast.success('控制指令已发送')
    },
    onError: (err) => toast.error(`控制失败: ${err.message}`),
  })

  return (
    <Button
      onClick={() => rpcMutation.mutate()}
      disabled={rpcMutation.isPending}
    >
      {rpcMutation.isPending ? '发送中...' : 'PCS 停机'}
    </Button>
  )
}
```

### Provider 注入

```tsx
// frontend/src/main.tsx
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/api-client'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
)
```

---

## 依赖关系图

```
APScheduler ──→ 调度 tenacity 保护的 NeuronClient.login()
                 │
tenacity ──────┼──→ 保护 NeuronClient.write_tag() / read_tag()
                 │
pint ──────────┼──→ 在 DataNormalizer.normalize() 内部调用
                 │
SymPy ─────────┼──→ 在 VirtualPointEngine._eval_expression() 内部调用
                 │
pandas ─────────┼──→ 在 telemetry.query_telemetry() 和 report_service 内部调用
                 │
react-query ────┘   前端独立运行，通过 REST API 与后端通信
```

六个库之间无循环依赖，各自在独立模块内工作。

---

## requirements.txt 变更

```
# 新增（追加到 fastapi-template 原有依赖之后）
apscheduler>=3.10.0
tenacity>=8.3.0
pint>=0.24.0
sympy>=1.13.0
pandas>=2.2.0
```

## package.json 变更

```json
{
  "dependencies": {
    "@tanstack/react-query": "^5.0.0",
    "...": "其他已有依赖不变"
  }
}
```

---

*文档版本: G2-v1.0*
*最后更新: 2026-07-13*
