# ZiZu — e606.hlszh.com 部署指南

> **服务器**: e606.hlszh.com:13122 (SSH, ARM64)
> **系统**: Ubuntu 20.04 LTS aarch64
> **端口**: 9000 (避免与 Reflex 8000 冲突)
> **最后更新**: 2026-07-17

---

## 0. 架构总览

```
e606.hlszh.com (ARM64 Ubuntu)
├── Neuron 2.10.4      ← 原生进程 :7000  (PCS/BMS 不变!)
├── NanoMQ             ← Docker    :1883  (已有, 不变)
├── PostgreSQL 17       ← 原生     :5432  (已有, 新建 DB=zizu)
├── TimescaleDB 2.19   ← PG 扩展          (已装在 PG17 上)
├── Reflex (OmniPower) ← Docker    :8000  (旧系统, 不动)
├── NocoBase           ← 外部     :2160  (不动)
└── ★ ZiZu        ← Docker    :9000  (新部署! F0 数据管道)
```

**关键原则**: PCS/BMS 设备配置不变，Neuron 不动，NanoMQ 复用，PG 复用(新库)。

---

## 1. 前置条件 (服务器端)

### 1.1 已有服务确认

```bash
# SSH 连接
ssh -i ~/.ssh/id_omnopower_deploy_nopass root@e606.hlszh.com -p 13122

# 确认所有基础服务运行中:
systemctl is-active neuron postgresql              # active
docker ps | grep nanomq                             # Up
docker ps | grep omnipower                          # Up (Reflex)

# 确认 NanoMQ 在收数据
mosquitto_sub -h 127.0.0.1 -p 1883 -t "neuron/+/telemetry" -C 1 &
# 预期: 收到一条 JSON

# 确认 PG + TSDB 可用
sudo -u postgres psql -c "SELECT version();"         # PostgreSQL 17.x
sudo -u postgres psql -c "SELECT extversion FROM pg_extension WHERE extname='timescaledb';"
```

### 1.2 Docker + buildx (用于加载镜像)

```bash
# Docker 应已安装 (NanoMQ/Reflex 都在用)
docker --version

# 安装 buildx (如果还没有)
docker buildx version || docker buildx install
```

---

## 2. 首次部署

### 2.1 一键部署 (推荐)

**在 Windows 开发机上执行：**

```bash
cd C:\Users\chent\Desktop\2026成果\easyway\Claw

# Step A: 初始化数据库 (只需一次)
bash deploy.sh --init-db

# Step B: 完整构建+传输+部署
bash deploy.sh 0.1.0
```

输出预期：
```
[DEPLOY] Building zizu:0.1.0-arm for linux/arm64 ...
[✓] Image built: zizu:0.1.0-arm (280MB)
[DEPLOY] Pushing to root@e606.hlszh.com ...
[✓] Files pushed to /home/zizu
[SERVER] Loading Docker image from /tmp/zizu-0.1.0-arm.tar.gz ...
[SERVER] Container status: zizu Up 5 seconds
[SERVER] Health check: {"status":"ok",...}
========== DEPLOY COMPLETE ==========
```

### 2.2 手动分步 (调试时用)

如果一键脚本有问题，可分步执行：

#### Step 1: 本地构建 ARM64 镜像

```bash
cd C:\Users\chent\Desktop\2026成果\easyway\Claw

# 需要 Docker Desktop 开启 "Use containerd for pulling and storing images"
# Settings → General → "Use the containerd image store"

docker buildx create --name arm-builder --use --driver docker-container
docker buildx inspect --bootstrap

# 构建
docker buildx build \
    --platform linux/arm64 \
    -t zizu:0.1.0-arm \
    ./backend \
    --load

# 导出
docker save zizu:0.1.0-arm | gzip > zizu-0.1.0-arm.tar.gz
```

#### Step 2: 传输到服务器

```bash
# 传输镜像
scp -i ~/.ssh/id_omnopower_deploy_nopass -P 13122 \
    zizu-0.1.0-arm.tar.gz \
    root@e606.hlszh.com:/tmp/

# 传输代码 (tar+ssh 管道)
cd C:\Users\chent\Desktop\2026成果\easyway\Claw
tar czf - \
    --exclude='.venv' --exclude='__pycache__' --exclude='.web' \
    --exclude='*.pyc' --exclude='.git' --exclude='.workbuddy' \
    backend/ init-db/ docker-compose.yml .env.e606 | \
ssh -i ~/.ssh/id_omnopower_deploy_nopass -P 13122 \
    root@e606.hlszh.com "mkdir -p /home/zizu && cd /home/zizu && tar xzf -"
```

#### Step 3: 服务器端操作

```bash
# SSH 登录
ssh -i ~/.ssh/id_omnopower_deploy_nopass root@e606.hlszh.com -p 13122

# 加载镜像
docker load < /tmp/zizu-0.1.0-arm.tar.gz

# 准备环境变量
cd /home/zizu
cp .env.e606 .env   # 首次; 之后 .env 会保留修改

# 初始化数据库 (首次)
sudo -u postgres psql <<'SQL'
CREATE USER zizu WITH PASSWORD 'zizu_dev_2026';
CREATE DATABASE zizu OWNER zizu;
\c zizu
CREATE EXTENSION IF NOT EXISTS timescaledb;
SQL
sudo -u postgres psql -d zizu < init-db/001-schema.sql

# 启动容器
docker compose up -d backend
```

---

## 3. 代码更新流程

### 3.1 快速同步 (改了几个文件后)

```bash
# 单文件推送
scp -i ~/.ssh/id_omnopower_deploy_nopass -P 13122 \
    backend/app/services/pipeline.py \
    root@e606.hlszh.com:/home/zizu/backend/app/services/pipeline.py

# 重启容器 (代码通过 volume mount 热加载, 但有时需重启)
ssh -i ~/.ssh/id_omnopower_deploy_nopass -p 13122 \
    root@e606.hlszh.com "docker restart zizu"
```

### 3.2 全量重新部署 (依赖变了或重构了)

```bash
bash deploy.sh 0.1.1
```

---

## 4. 验证清单

```bash
# ===== 4.1 容器状态 =====
docker ps | grep zizu
# 预期: zizu ... Up ... 0.0.0.0:9000->9000/tcp

# ===== 4.2 Health API =====
curl http://127.0.0.1:9000/api/v1/health | python3 -m json.tool
# 预期:
{
  "status": "ok",
  "components": {
    "timescaledb": {"status": "connected"},
    "mqtt": {"status": "connected"}
  },
  "pipeline": {
    "status": "RUNNING",
    "messages_received": 123,
    "messages_parsed_ok": 120,
    ...
  }
}

# ===== 4.3 API 文档 =====
curl http://127.0.0.1:9000/api/docs
# 预期: FastAPI Swagger UI HTML

# ===== 4.4 MQTT 消费验证 =====
# 查看 ZiZu 是否收到 Neuron 数据
docker logs zizu 2>&1 | grep -E "(MQTT|telemetry|Pipeline)" | tail -20
# 预期:
# [MQTT] Connected ✅
# [Pipeline] messages_parsed_ok=56, points_written_db=52

# ===== 4.5 数据入库验证 =====
sudo -u postgres psql -d zizu -c "
    SELECT COUNT(*) as total_rows,
           MAX(ts) as latest_ts
    FROM t_telemetry;"
# 预期: total_rows > 100 且 latest_ts 为几秒前

# ===== 4.6 远程访问 (从 Windows 浏览器) =====
http://e606.hlszh.com:9000/api/v1/health
http://e606.hlszh.com:9000/api/docs
```

---

## 5. 日志与排错

### 5.1 查看日志

```bash
# 实时跟踪
docker logs -f zizu

# 最近 50 行
docker logs --tail 50 zizu 2>&1

# 只看错误
docker logs zizu 2>&1 | grep -i error | tail -20
```

### 5.2 常见问题

| 症状 | 排查命令 | 解决方案 |
|------|---------|---------|
| Health 显示 `mqtt: disconnected` | `docker logs zizu \| grep MQTT` | 检查 NanoMQ: `docker ps \| grep nanomq` |
| Health 显示 `tsdb: disconnected` | `docker logs zizu \| grep TSDB` | 检查 PG: `systemctl status postgresql`, 确认 DB 存在 |
| `messages_parse_error` 递增 | `docker logs zizu \| grep parse` | 检查 Neuron topic 格式是否匹配 |
| 容器不停重启 | `docker logs zizu 2>&1 \| tail -30` | 语法错误或缺少依赖 |
| `port already in use` | `ss -tlnp \| grep 9000` | 改 `.env` 中 `APP_PORT` |

### 5.3 重置 (从头来)

```bash
# 停止并删除容器
docker stop zizu && docker rm zizu

# 清空数据 (可选, 谨慎!)
sudo -u postgres psql -d zizu -c "TRUNCATE t_telemetry CASCADE;"

# 重新启动
cd /home/zizu && docker compose up -d backend
```

---

## 6. Neuron 对接配置

ZiZu 的 MQTT 订阅需要和 Neuron 的推送配置对齐：

### 6.1 Neuron 端 (Web UI: e606.hlszh.com:7000)

在 Neuron 中已有的订阅配置应保持不变:

```
Topic 格式: neuron/{node_name}/telemetry
示例:
  neuron/en9_meter/telemetry    → 电表数据
  neuron/en9_bms/telemetry      → BMS 数据  
  neuron/en9_pcs/telemetry      → PCS 数据
  neuron/en9_inv/telemetry      → 逆变器数据
```

**不要改动这些!** PCS/BMS 配置保持原样。

### 6.2 ZiZu 端 (.env 配置)

```env
MQTT_TELEMETRY_TOPIC=neuron/+/telemetry   # 匹配 Neuron 推送格式
```

解析器 (`parser.py`) 会自动识别以下 Neuron payload 格式:

```json
{"node":"en9_meter","timestamp":1721234567890,"values":{"meter_p_act":12.5,...}}
// 或
{"node_name":"en9_meter","group":"default","timestamp":1721234567890,"tags":{"activePower":45000,...}}
```

---

## 7. 网络安全说明

| 服务 | 绑定地址 | 公网暴露 |
|------|---------|---------|
| ZiZu API | `0.0.0.0:9000` | ✅ 是 (有防火墙则受限) |
| NanoMQ MQTT | `0.0.0.0:1883` | ⚠️ 已有 (建议防火墙限制) |
| Neuron UI | `0.0.0.0:7000` | ✅ 已有 |
| PostgreSQL | `127.0.0.1:5432` | ❌ 仅本地 (安全) |

**生产加固建议** (Phase 4):
- Nginx 反代 + TLS 终结
- JWT 强制鉴权 (M7 已预留)
- IP 白名单限制 API 访问
- NanoMQ 关闭公网 1883 或加认证

---

## 8. 文件清单 (服务器上 `/home/zizu/`)

```
/home/zizu/
├── .env                    # 运行环境变量 (从 .env.e606 复制)
├── .env.e606               # e606 专用模板
├── docker-compose.yml      # 编排文件 (仅 backend 服务)
├── init-db/
│   └── 001-schema.sql      # 数据库初始化 (7表 + 3CAGG)
└── backend/
    ├── Dockerfile          # 多阶段构建
    ├── pyproject.toml      # Python 依赖
    └── app/
        ├── main.py         # FastAPI 入口
        ├── core/config.py  # pydantic-settings 配置
        ├── models/schemas.py
        ├── api/health.py
        └── services/       # M2/M3/M4/Pipeline 全部模块
            ├── mqtt_client.py
            ├── parser.py
            ├── normalizer.py
            ├── telemetry_store.py
            └── pipeline.py
```
