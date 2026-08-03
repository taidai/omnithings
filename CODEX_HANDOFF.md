# OmniThings 会话交接

## 当前状态

  - 部署版本：**0.4.11**
  - 服务器：`e606.hlszh.com:13122` 健康检查通过
  - GitHub：`main` 已推送至 `https://github.com/taidai/omnithings.git`（commit `1c58d6d`）

## 本次完成：自定义虚拟点位

### 后端
  - `backend/app/api/tags.py` 的 `list_tags` 和 `get_tag` SQL SELECT 查询增加了 `t.aggregate_fn, t.formula, t.formula_type, t.sources` 字段，API 响应现在返回完整的公式配置信息。
  - 虚拟点位的计算引擎已就绪：
    - `backend/app/services/aggregator.py`：每 10s 执行 `formula_type='aggregate'` 的 LOGICAL 点位（SUM/AVG/MAX/MIN/COUNT/LAST）
    - `backend/app/services/formula_engine.py`：每 10s 执行 `formula_type='expression'` 和 `'condition'` 的 LOGICAL 点位（安全 AST 求值）
  - `POST /api/v1/tags` 和 `PUT /api/v1/tags/{id}` 已支持完整公式字段（之前已有，无需改动）。

### 前端
  - `frontend/src/api/client.ts`：`Tag` 接口增加 `aggregate_fn`, `formula`, `formula_type`, `sources` 字段。
  - `frontend/src/components/NodeTagPanel.tsx`：`TagFormModal` 增强：
    - 选择「LOGICAL（虚拟点位）」时动态展开公式配置区。
    - 三种计算方式：
      1. **聚合**：选 SUM/AVG/MAX/MIN/COUNT/LAST + 勾选来源点位
      2. **表达式**：输入公式（如 `s0 * 2 + s1`）+ 勾选来源点位
      3. **条件判断**：输入条件（如 `s0 > 100 and s1 < 50`）+ 勾选来源点位
    - 来源点位选择器：支持跨节点选择，自动生成变量名 s0, s1, s2...
    - 编辑 LOGICAL 点位时自动加载已有公式配置。

### 验证
  - `GET /api/v1/tags?page=1&page_size=2` 返回的 LOGICAL 点位包含 `aggregate_fn`, `formula_type`, `sources` 字段。
  - 现有虚拟点位「ABC」正确显示 `aggregate_fn: SUM, formula_type: aggregate, sources: [3个点位UUID]`。

## 已完成（历史）

1. 节点树后端 CRUD + 级联删除 + 告警清理
2. 点位 CRUD + 批量操作 + 高级过滤 + 质量与最后更新列
3. 节点树搜索 + 告警角标
4. 规则模板后端 + 前端加载
5. 规则引擎（gorules/zen + jdm-editor）
6. IPO 闭环：输入（节点数据）→ 处理（Rule Engine）→ 输出（NE API 下发控制指令）
7. 安全点位心跳信号下发（1!420622）
8. 虚拟点位支持（本次）

## 下一步建议

1. **拖拽节点进画布 + Edit Table 表格切换**：jdm-editor 前端功能完善。
2. **IPO 闭环验证**：规则模板选择 → 输入字段映射 → 输出点位绑定 → NE API 下发控制链路的完整端到端验证。
3. **虚拟点位调试**：在前端创建一个虚拟点位（表达式模式），验证后端公式引擎是否正确计算并写回实时值。
4. **自动化测试**：后端 API 单元测试、前端关键组件测试。
5. **规则版本管理、执行日志与回滚**：满足工业控制系统的审计要求。

## 关键命令

```powershell
# 本地编译
python -m py_compile backend/app/api/tags.py

# 前端构建
cd frontend; npm run build

# 打包（自动 bump 版本）
python C:\tmp\make_omnithings_zip.py

# 部署（需 SSH key）
scp -i ~/.ssh/omnithings_key -P 13122 <zip> root@e606.hlszh.com:/tmp/
ssh -i ~/.ssh/omnithings_key -p 13122 root@e606.hlszh.com "<deploy commands>"
```

## 关键文件

- [`backend/app/api/tags.py`](/C:/Users/chent/Documents/omnithings-explore/backend/app/api/tags.py)
- [`backend/app/services/aggregator.py`](/C:/Users/chent/Documents/omnithings-explore/backend/app/services/aggregator.py)
- [`backend/app/services/formula_engine.py`](/C:/Users/chent/Documents/omnithings-explore/backend/app/services/formula_engine.py)
- [`frontend/src/api/client.ts`](/C:/Users/chent/Documents/omnithings-explore/frontend/src/api/client.ts)
- [`frontend/src/components/NodeTagPanel.tsx`](/C:/Users/chent/Documents/omnithings-explore/frontend/src/components/NodeTagPanel.tsx)