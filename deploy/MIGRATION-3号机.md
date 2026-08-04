# ZiZu 迁移到 3 号新机部署总结

## 一、2 号机部署踩坑总结

### 1. 目录结构陷阱（核心问题）
2 号机使用的 `docker-compose.host.yml` 挂载路径为：
- `./backend/app:/app/app:ro`
- `./frontend/dist:/app/frontend/dist:ro`

但 CI/手动打包出来的更新包结构是：
- `app/`（后端代码）
- `dist/`（前端构建产物）
- `VERSION`

导致 unzip 后新代码躺在 `/home/zizu/app/`、`/home/zizu/dist/`，而容器实际跑的仍是 `/home/zizu/backend/app/`、`/home/zizu/frontend/dist/` 下的旧代码。
**结果：VERSION 更新了，界面/功能没变化。**

### 2. 修复方式（已验证）
解压后必须再做一次路径同步：
```bash
cp -a app/. backend/app/
cp -a dist/. frontend/dist/
cp VERSION backend/app/VERSION
docker compose -f docker-compose.yml -f docker-compose.host.yml up -d --force-recreate backend
```

### 3. 其他 2 号机踩坑点
- **SSH 端口 3723 即目标端口**，登录账号 `holo`，sudo 需密码。
- **/home/zizu 目录权限为 root**，备份 `bak/` 需 `sudo`。
- **host 网络模式**：E606 内核无 `CONFIG_VETH`，bridge 网络残废。
- **`tmpfs: - /dev/mqueue`**：内核无 `CONFIG_POSIX_MQUEUE`。
- **内存限制**：backend 限制 1536M，避免 OOM。
- **外部 HTTPS (443) TLS 握手失败**：本机无法验证，但远程本地 127.0.0.1:9000 正常，需通过浏览器/代理访问。

## 二、3 号机推荐部署方案

目标：**一份 docker-compose 命令完成部署**，不再手动同步目录。

### 方案 A：3 号机可 build（推荐，最干净）
```bash
git clone https://github.com/taidai/zizu.git /opt/zizu
cd /opt/zizu
cp .env.example .env
# 根据 3 号机环境编辑 .env
docker compose up -d --build
```
适用：普通 Linux 服务器，内核完整，能走 bridge 网络。

### 方案 B：3 号机不可 build（E606/裁剪版）
使用新增的生产部署包 + `docker-compose.prod.yml`。

#### 1. 在 2 号机或能 build 的机器准备产物
```bash
# 构建前端
cd frontend && npm run build && cd ..

# 构建后端镜像（可选：在 x86 用 buildx 出 arm64）
# docker buildx build --platform linux/arm64 -t zizu:0.4.28 -f backend/Dockerfile . --load

# 打包生产部署包
tar -czf zizu-v0.4.28-prod.tar.gz \
  docker-compose.yml docker-compose.prod.yml .env.example \
  backend/app frontend/dist VERSION init-db config

# 导出镜像
docker save zizu:0.4.28 | gzip > zizu-0.4.28.tar.gz
```

#### 2. 在 3 号机一键部署
```bash
mkdir -p /opt/zizu && cd /opt/zizu

# 传上来的包结构应为：
# /opt/zizu/
#   docker-compose.yml
#   docker-compose.prod.yml
#   .env
#   app/          <- 后端代码
#   dist/         <- 前端构建产物
#   VERSION
#   init-db/
#   config/

# 加载镜像（如果 3 号机不能 build）
docker load -i zizu-0.4.28.tar.gz

# 真正的一份 docker-compose 启动
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

#### 为什么可以一份命令？
`docker-compose.prod.yml` 把挂载路径改为 `./app:/app/app` 和 `./dist:/app/frontend/dist`，与生产包目录完全对齐，无需再 `cp -a app/. backend/app/`。

## 三、数据迁移建议

如果 2 号机有生产数据需要保留，迁移步骤：
1. 2 号机备份数据库：
   ```bash
   docker exec zizu-tsdb pg_dump -U zizu -d zizu_iot > zizu_iot.sql
   ```
2. 3 号机启动空服务后恢复：
   ```bash
   docker cp zizu_iot.sql zizu-tsdb:/tmp/
   docker exec zizu-tsdb psql -U zizu -d zizu_iot -f /tmp/zizu_iot.sql
   ```
3. 若有 `/app/data` 持久化数据，同步 `zizu-data` volume 内容。

## 四、验证清单
- [ ] `docker compose ps` 三个服务均 healthy
- [ ] `curl http://127.0.0.1:9000/api/v1/health` 返回正确 version
- [ ] 浏览器访问前端，确认改动已生效
- [ ] 检查容器内文件时间戳：`docker exec zizu ls -la /app/frontend/dist/assets/`
