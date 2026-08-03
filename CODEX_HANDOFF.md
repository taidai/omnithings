# OmniThings 会话交接

## 当前状态

- 本地版本：**0.4.21**（commit `6774367`）
- GitHub：`main` 已推送至 `https://github.com/taidai/omnithings.git`
- 2 号机部署：`e606.hlszh.com:3723`（SSH 端口 3723，账号 `holo` / `holo123`）
  - Web：`http://e606.hlszh.com:3723`（实际服务端口 `9000`，FRP 转发）
  - 容器：`omnithings` 已重建，health 返回 `version: 0.4.21`
  - MQTT：已连接，订阅 `/neuron/#`

## 本次完成

### 1. AdminPanel 增加 MQTT 北向主题配置界面
- **问题**：后端 `/api/v1/mqtt-config` 与 `config_store.py` 已具备运行时重订阅能力，但 `AdminPanel.tsx` 只引入了接口、没有表单，用户无法在界面上配置 Neuron MQTT 主题。
- **修复**：在 `AdminPanel` 中新增「MQTT 北向主题配置」卡片：
  - 输入框编辑订阅主题，支持逗号分隔多主题与 `+/#` 通配符；
  - 显示当前生效主题标签；
  - 显示数据库持久化值（与编辑值不一致时提示）；
  - 点击「保存并重订阅」调用 `PUT /api/v1/mqtt-config`，后端立即取消旧订阅并订阅新主题。
- **文件**：[`frontend/src/components/AdminPanel.tsx`](/C:/Users/chent/Documents/omnithings-explore/frontend/src/components/AdminPanel.tsx)

### 2. 版本升级到 0.4.21
- 使用 `python scripts/bump_version.py patch` 同步更新 `VERSION`、`backend/app/VERSION`、`frontend/package.json`、`backend/pyproject.toml`。
- 本地 commit：`6774367 feat(admin): add MQTT northbound topic config UI with live resubscribe; bump v0.4.21`

### 3. 部署到 2 号机并推送到 GitHub
- 本地 `npm run build` 通过。
- 打包 `backend/app`、`frontend/dist`、`VERSION`、`init-db` 为 zip，通过 `pscp` 上传到 `/tmp`。
- 远程解压并移动到正确的挂载目录 `/home/omnithings/backend/app` 与 `/home/omnithings/frontend/dist`。
- `docker compose -f docker-compose.yml -f docker-compose.host.yml up -d --force-recreate backend` 重建后端容器。
- Health 检查通过，返回 `version: 0.4.21`。
- `git push origin main` 成功。

## 已知问题 / 注意

1. **Docker 镜像标签仍为 `omnithings:0.4.12`**：当前通过 volume 挂载最新代码运行，功能已生效；后续如需镜像标签一致，需要重新 build 并 tag 为 `0.4.21`。
2. **容器日志出现 `skipped: maximum number of running instances reached`**：F1/F2/F3 定时任务执行耗时较长导致 APScheduler 跳过重叠实例，目前不影响实时数据流，但需后续优化调度间隔或任务性能。
3. **部署脚本待整理**：本次使用临时 `deploy-remote-2.sh` 与 `deploy-fix-paths.sh` 完成；建议后续把 2 号机部署流程固化到 `scripts/deploy-2.ps1` 或 `deploy2.sh`，避免路径/权限问题。

## 关键文件

- [`frontend/src/components/AdminPanel.tsx`](/C:/Users/chent/Documents/omnithings-explore/frontend/src/components/AdminPanel.tsx)
- [`backend/app/api/admin.py`](/C:/Users/chent/Documents/omnithings-explore/backend/app/api/admin.py)
- [`backend/app/services/config_store.py`](/C:/Users/chent/Documents/omnithings-explore/backend/app/services/config_store.py)
- [`backend/app/services/mqtt_client.py`](/C:/Users/chent/Documents/omnithings-explore/backend/app/services/mqtt_client.py)
- [`backend/app/services/pipeline.py`](/C:/Users/chent/Documents/omnithings-explore/backend/app/services/pipeline.py)

## 下一步建议

1. 验证 AdminPanel 中 MQTT 主题修改后，Neuron 实时数据是否按新主题流入。
2. 清理 2 号机 `/tmp` 中的历史部署 zip，避免占用空间。
3. 优化 APScheduler 任务重叠问题（增大间隔或拆分耗时任务）。
4. 如需要，统一 Docker 镜像 tag 并重新 build 镜像。
5. 继续完善节点树、规则引擎、IPO 闭环等工业控制功能。
