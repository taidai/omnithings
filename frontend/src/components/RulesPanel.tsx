
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchRules, createRule, updateRule, deleteRule, simulateRule,
  type Rule, type RuleSimulateResult,
} from '../api/client'

// GoRules JDM Editor
import '@gorules/jdm-editor/dist/style.css'
import { DecisionGraph, JdmConfigProvider } from '@gorules/jdm-editor'
import type { ThemeConfig } from '@gorules/jdm-editor'

const TYPE_LABEL: Record<string, string> = {
  alarm: '告警',
  control: '控制',
  linkage: '联动',
  fault_map: '故障映射',
}

const TYPE_STYLE: Record<string, string> = {
  alarm: 'bg-red-100 text-red-600',
  control: 'bg-blue-100 text-blue-600',
  linkage: 'bg-purple-100 text-purple-600',
  fault_map: 'bg-amber-100 text-amber-600',
}

const ENGINE_LABEL: Record<string, string> = {
  zen: 'GoRules',
  ast: 'AST',
  error: '错误',
}

// OmniThings 主题适配：浅色 + 科技绿主色
const JDM_THEME: ThemeConfig = {
  mode: 'light',
  token: {
    colorPrimary: '#52c41a',
    colorLink: '#389e0d',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#f5222d',
    colorInfo: '#1890ff',
    borderRadius: 8,
  },
}

const EXPRESSION_TEMPLATE = {
  nodes: [
    { id: 'input', name: '输入', type: 'inputNode', position: { x: 80, y: 180 } },
    {
      id: 'expression',
      name: '条件判断',
      type: 'expressionNode',
      position: { x: 360, y: 180 },
      content: { expressions: { triggered: 'bms_current > -2000' } },
    },
    { id: 'output', name: '输出', type: 'outputNode', position: { x: 680, y: 180 } },
  ],
  edges: [
    { id: 'e1', sourceId: 'input', targetId: 'expression' },
    { id: 'e2', sourceId: 'expression', targetId: 'output' },
  ],
}

const DECISION_TABLE_TEMPLATE = {
  nodes: [
    { id: 'input', name: '输入', type: 'inputNode', position: { x: 60, y: 200 } },
    {
      id: 'table',
      name: '电流分级告警',
      type: 'decisionTableNode',
      position: { x: 300, y: 120 },
      content: {
        hitPolicy: 'first',
        inputs: [{ id: 'current', name: '电流', field: 'bms_current' }],
        outputs: [
          { id: 'triggered', name: '触发', field: 'triggered' },
          { id: 'level', name: '级别', field: 'level' },
          { id: 'message', name: '消息', field: 'message' },
        ],
        rules: [
          { current: '< -3000', triggered: 'true', level: 'CRITICAL', message: '电流严重越下限' },
          { current: '< -2000', triggered: 'true', level: 'MAJOR', message: '电流越下限' },
          { current: '>= -2000', triggered: 'false', level: '', message: '' },
        ],
      },
    },
    { id: 'output', name: '输出', type: 'outputNode', position: { x: 720, y: 200 } },
  ],
  edges: [
    { id: 'e1', sourceId: 'input', targetId: 'table' },
    { id: 'e2', sourceId: 'table', targetId: 'output' },
  ],
}

const MULTI_BRANCH_TEMPLATE = {
  nodes: [
    { id: 'input', name: '输入', type: 'inputNode', position: { x: 60, y: 200 } },
    {
      id: 'table',
      name: '温湿度联合告警',
      type: 'decisionTableNode',
      position: { x: 300, y: 120 },
      content: {
        hitPolicy: 'first',
        inputs: [
          { id: 'temp', name: '温度', field: 'temperature' },
          { id: 'humi', name: '湿度', field: 'humidity' },
        ],
        outputs: [
          { id: 'triggered', name: '触发', field: 'triggered' },
          { id: 'level', name: '级别', field: 'level' },
          { id: 'message', name: '消息', field: 'message' },
        ],
        rules: [
          { temp: '> 40', humi: '', triggered: 'true', level: 'CRITICAL', message: '温度过高' },
          { temp: '', humi: '> 80', triggered: 'true', level: 'CRITICAL', message: '湿度过高' },
          { temp: '> 35', humi: '', triggered: 'true', level: 'MAJOR', message: '温度偏高' },
          { temp: '', humi: '> 70', triggered: 'true', level: 'MAJOR', message: '湿度偏高' },
          { temp: '', humi: '', triggered: 'false', level: '', message: '' },
        ],
      },
    },
    { id: 'output', name: '输出', type: 'outputNode', position: { x: 720, y: 200 } },
  ],
  edges: [
    { id: 'e1', sourceId: 'input', targetId: 'table' },
    { id: 'e2', sourceId: 'table', targetId: 'output' },
  ],
}

const TEMPLATES: Record<string, { label: string; graph: any }> = {
  expression: { label: '表达式条件', graph: EXPRESSION_TEMPLATE },
  decisionTable: { label: '决策表（分级告警）', graph: DECISION_TABLE_TEMPLATE },
  multiBranch: { label: '多分支联合（温湿度）', graph: MULTI_BRANCH_TEMPLATE },
}

function isStandardJdm(content: any): boolean {
  return !!content && typeof content === 'object' && Array.isArray(content.nodes)
}

function summarizeRule(rule: Rule): string {
  const c = rule.jdm_content
  if (!c) return '—'
  if (c.when) return `when: ${c.when}`
  if (Array.isArray((c as any).nodes)) {
    const expr = (c as any).nodes.find((n: any) => n.type === 'expressionNode')
    const table = (c as any).nodes.find((n: any) => n.type === 'decisionTableNode')
    if (table) {
      const outs = table.content?.outputs || []
      return `JDM 决策表: ${outs.length ? outs.map((o: any) => o.name).join('/') : '未命名'} (${table.content?.rules?.length || 0} 规则)`
    }
    if (expr?.content?.expressions) {
      return `JDM: ${Object.entries(expr.content.expressions).map(([k, v]) => `${k}=${v}`).join(', ')}`
    }
    return `JDM: ${(c as any).nodes.length} 节点`
  }
  return JSON.stringify(c).slice(0, 80)
}

export default function RulesPanel() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createMode, setCreateMode] = useState<'simple' | 'jdm'>('simple')
  const [templateKey, setTemplateKey] = useState('expression')
  const [simResult, setSimResult] = useState<Record<string, RuleSimulateResult>>({})
  const [editingJdm, setEditingJdm] = useState<string | null>(null)

  // 新建表单
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('alarm')
  const [newWhen, setNewWhen] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [newLevel, setNewLevel] = useState('WARNING')
  const [newJdmGraph, setNewJdmGraph] = useState<any>(EXPRESSION_TEMPLATE)
  const [creating, setCreating] = useState(false)

  // 模拟输入
  const [simContext, setSimContext] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRules(await fetchRules())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const resetCreate = () => {
    setNewName('')
    setNewWhen('')
    setNewMessage('')
    setNewLevel('WARNING')
    setNewJdmGraph(TEMPLATES[templateKey]?.graph || EXPRESSION_TEMPLATE)
    setShowCreate(false)
  }

  const applyTemplate = (key: string) => {
    setTemplateKey(key)
    setNewJdmGraph(TEMPLATES[key]?.graph || EXPRESSION_TEMPLATE)
  }

  const handleCreate = async () => {
    if (!newName.trim()) {
      alert('请填写规则名')
      return
    }

    let jdmContent: any
    if (createMode === 'simple') {
      if (!newWhen.trim()) {
        alert('请填写触发条件')
        return
      }
      jdmContent = {
        when: newWhen.trim(),
        actions: [{ type: 'alarm', level: newLevel, message: newMessage.trim() || newName.trim() }],
      }
    } else {
      jdmContent = newJdmGraph
    }

    setCreating(true)
    try {
      await createRule({
        name: newName.trim(),
        rule_type: newType,
        jdm_content: jdmContent,
        enabled: true,
      })
      resetCreate()
      await load()
    } catch (e: any) {
      alert(`创建失败: ${e.message}`)
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (rule: Rule) => {
    try {
      await updateRule(rule.id, { enabled: !rule.enabled })
      await load()
    } catch (e: any) {
      alert(`更新失败: ${e.message}`)
    }
  }

  const handleDelete = async (rule: Rule) => {
    if (!confirm(`确认删除规则「${rule.name}」？`)) return
    try {
      await deleteRule(rule.id)
      await load()
    } catch (e: any) {
      alert(`删除失败: ${e.message}`)
    }
  }

  const handleSimulate = async (rule: Rule) => {
    const raw = (simContext[rule.id] || '').trim()
    let context: Record<string, any> = {}
    if (raw) {
      try {
        context = JSON.parse(raw)
      } catch {
        alert('模拟上下文需为 JSON，例如 {"电流": 500}')
        return
      }
    }
    try {
      const result = await simulateRule(rule.id, context)
      setSimResult((prev) => ({ ...prev, [rule.id]: result }))
    } catch (e: any) {
      alert(`模拟失败: ${e.message}`)
    }
  }

  return (
    <div>
      <div className="neu-card p-4 mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-gray-700">规则引擎</span>
        <span className="text-xs text-gray-400">共 {rules.length} 条规则</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="neu-btn px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-[#389e0d] disabled:opacity-50"
          >
            {loading ? '加载中...' : '刷新'}
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="neu-btn px-4 py-1.5 text-xs font-medium text-white bg-[#52c41a] hover:bg-[#389e0d]"
          >
            {showCreate ? '取消' : '+ 新建规则'}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="neu-card p-4 mb-4 bg-[#52c41a]/5 border border-[#52c41a]/20">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-medium text-gray-700">创建模式</span>
            <div className="flex bg-gray-100 rounded p-0.5">
              <button
                onClick={() => setCreateMode('simple')}
                className={`px-3 py-1 text-xs rounded ${createMode === 'simple' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}
              >
                简单表达式
              </button>
              <button
                onClick={() => setCreateMode('jdm')}
                className={`px-3 py-1 text-xs rounded ${createMode === 'jdm' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}
              >
                JDM 编辑器
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">规则名</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：电流越限告警"
                className="neu-input w-full px-3 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">类型</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="neu-input w-full px-3 py-1.5 text-xs"
              >
                <option value="alarm">告警</option>
                <option value="control">控制</option>
                <option value="linkage">联动</option>
                <option value="fault_map">故障映射</option>
              </select>
            </div>
            {createMode === 'simple' && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">告警级别</label>
                <select
                  value={newLevel}
                  onChange={(e) => setNewLevel(e.target.value)}
                  className="neu-input w-full px-3 py-1.5 text-xs"
                >
                  <option value="INFO">INFO</option>
                  <option value="WARNING">WARNING</option>
                  <option value="MAJOR">MAJOR</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>
            )}
          </div>

          {createMode === 'simple' ? (
            <>
              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">触发条件（when 表达式，GoRules 语法）</label>
                <input
                  value={newWhen}
                  onChange={(e) => setNewWhen(e.target.value)}
                  placeholder={'例如：bms_current > -2000'}
                  className="neu-input w-full px-3 py-1.5 text-xs font-mono"
                />
              </div>
              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">告警消息</label>
                <input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="触发时写入的告警内容"
                  className="neu-input w-full px-3 py-1.5 text-xs"
                />
              </div>
            </>
          ) : (
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs text-gray-500">规则模板：</span>
                {Object.entries(TEMPLATES).map(([key, tmpl]) => (
                  <button
                    key={key}
                    onClick={() => applyTemplate(key)}
                    className={`px-2 py-1 text-[11px] rounded ${
                      templateKey === key
                        ? 'bg-[#52c41a] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {tmpl.label}
                  </button>
                ))}
              </div>
              <div className="rounded border border-gray-200 overflow-hidden" style={{ height: 460 }}>
                <JdmConfigProvider theme={JDM_THEME}>
                  <DecisionGraph
                    value={newJdmGraph as any}
                    onChange={(val: any) => setNewJdmGraph(val)}
                  />
                </JdmConfigProvider>
              </div>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={creating}
            className="neu-btn px-4 py-1.5 text-xs font-medium text-white bg-[#52c41a] hover:bg-[#389e0d] disabled:opacity-50"
          >
            {creating ? '创建中...' : '创建规则'}
          </button>
        </div>
      )}

      <div className="neu-card overflow-hidden mb-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2.5 font-medium">类型</th>
              <th className="px-4 py-2.5 font-medium">规则名</th>
              <th className="px-4 py-2.5 font-medium">条件摘要</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                  暂无规则，点击「+ 新建规则」创建第一条
                </td>
              </tr>
            )}
            {rules.map((rule) => {
              const sim = simResult[rule.id]
              return (
                <tr key={rule.id} className="border-b border-gray-50 hover:bg-gray-50/50 align-top">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${TYPE_STYLE[rule.rule_type] || 'bg-gray-100 text-gray-500'}`}>
                      {TYPE_LABEL[rule.rule_type] || rule.rule_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm font-medium text-gray-800">{rule.name}</td>
                  <td className="px-4 py-2.5 text-gray-500 font-mono text-[11px] max-w-md truncate">
                    {summarizeRule(rule)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${rule.enabled ? 'bg-[#52c41a]' : 'bg-gray-300'}`} />
                      <span className="text-xs text-gray-400">{rule.enabled ? '已启用' : '已停用'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      {isStandardJdm(rule.jdm_content) && (
                        <button
                          onClick={() => setEditingJdm(rule.id)}
                          className="neu-btn px-3 py-1 text-xs text-gray-600 hover:text-[#389e0d]"
                        >
                          JDM
                        </button>
                      )}
                      <button
                        onClick={() => handleToggle(rule)}
                        className="neu-btn px-3 py-1 text-xs text-gray-600 hover:text-[#389e0d]"
                      >
                        {rule.enabled ? '停用' : '启用'}
                      </button>
                      <button
                        onClick={() => handleDelete(rule)}
                        className="neu-btn px-3 py-1 text-xs text-red-500 hover:text-red-600"
                      >
                        删除
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2 justify-end">
                      <input
                        value={simContext[rule.id] || ''}
                        onChange={(e) => setSimContext((prev) => ({ ...prev, [rule.id]: e.target.value }))}
                        placeholder='{"bms_current": -1500}'
                        className="neu-input w-48 px-2 py-1 text-[11px] font-mono"
                      />
                      <button
                        onClick={() => handleSimulate(rule)}
                        className="neu-btn px-3 py-1 text-[11px] font-medium text-gray-600 hover:text-[#389e0d]"
                      >
                        模拟
                      </button>
                      {sim && (
                        <span
                          title={sim.engine ? `引擎: ${ENGINE_LABEL[sim.engine] || sim.engine}` : ''}
                          className={`text-[11px] font-medium ${sim.triggered ? 'text-red-500' : 'text-[#389e0d]'}`}
                        >
                          {sim.triggered ? '✓ 触发' : '✗ 未触发'}
                          {sim.engine && ` (${ENGINE_LABEL[sim.engine] || sim.engine})`}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editingJdm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-medium text-gray-700">编辑 JDM 决策图</span>
              <button
                onClick={() => setEditingJdm(null)}
                className="neu-btn px-3 py-1 text-xs text-gray-500"
              >
                关闭
              </button>
            </div>
            <div className="flex-1 p-4 overflow-hidden">
              <JdmConfigProvider theme={JDM_THEME}>
                <DecisionGraph
                  value={(rules.find((r) => r.id === editingJdm)?.jdm_content || EXPRESSION_TEMPLATE) as any}
                  onChange={(val: any) => {
                    const rule = rules.find((r) => r.id === editingJdm)
                    if (!rule) return
                    updateRule(rule.id, { jdm_content: val }).catch((e) => alert(`保存失败: ${e.message}`))
                  }}
                />
              </JdmConfigProvider>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
