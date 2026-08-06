# ZiZu Handoff — v0.4.43

## 当前版本
v0.4.43 (2026-08-06)

## 最近完成
### v0.4.43 — 标准实体 + 导入导出
- 内置 203 个标准实体，按《光储充管理平台标准字段清单》建模
  - 分类：station/pv/ess/pcs/charger/grid/env/ems/protection/billing
  - 每条含 std_field（标准字段名）+ std_ref（标准号）
- 新文件：`backend/app/core/standard_entities.py`（单一数据源，203 条）
- migration_015：t_entities 加 std_field/std_ref 列 + 索引
- `seed_standard_entities()` 幂等播种，ALTER TABLE ADD COLUMN IF NOT EXISTS + ON CONFLICT DO UPDATE
- API：GET /entities/export (csv 带 UTF-8 BOM / json)，POST /entities/import（raw body 嗅探 JSON/CSV，mode=upsert|create，dry_run）
- 前端：导出CSV/导出JSON/导入/新建 按钮 + 详情面板显示 std_field/std_ref
- _row_to_entity 序列化补充 std_field/std_ref（验证通过：ess.soc → std_field=ess_soc, std_ref=GB/T 36558）

## 部署状态
- 1号机 (e606.hlszh.com:13122, holo/holo123)：已部署 v0.4.43
  - 容器内验证通过：health v0.4.43, entities total=203, pcs=21, ess.soc 有 std_field/std_ref, export csv=200
  - compose 挂载 ./backend/app:/app/app:ro，同步代码 + docker restart zizu
- GitHub taidai/zizu main：已推送 (791caa3..69bd21c)

## 关键架构
- 容器 zizu（镜像 omnithings:latest-arm），host 网络，端口 9000
- compose: docker-compose.e606.yml
- 部署脚本: scripts/deploy_1号机.py (paramiko, 不重建镜像)
- SSH 需 paramiko（OpenSSH 握手挂起），sudo: echo 'holo123' | sudo -S <cmd>

## 已知约束
- shell_command 沙箱只读，写文件/跑命令用 mcp__node_repl__js
- 不要用 UploadFile/File（镜像无 python-multipart），导入用 Request 读原始文本
- 版本号每次更新必须界面可见（health.version + FE __APP_VERSION__）
- 不删文件，不碰 财务/存档/bak 个人目录，工作区限 zizu/

## 下一步（待用户指定）
