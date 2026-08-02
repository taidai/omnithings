import { useEffect, useMemo, useState } from 'react'
import { DecisionGraph, GraphSimulator, JdmConfigProvider } from '@gorules/jdm-editor'
import { PlayCircleOutlined } from '@ant-design/icons'
import json5 from 'json5'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import {
  fetchRules, createRule, updateRule, deleteRule, simulateRule, evaluateGraph,
  type Rule, type RuleCreateRequest,
} from '../api/client'

type DecisionGraphType = {
  nodes: any[]
  edges: any[]
}

const RULE_TYPES: RuleCreateRequest['rule_type'][] = ['alarm', 'control', 'fault_map', 'linkage']

const TYPE_LABELS: Record<RuleCreateRequest['rule_type'], string> = {
  alarm: '告警 alarm',
  control: '控制 control',
  fault_map: '故障映射 fault_map',
  linkage: '联动 linkage',
}

// 默认 GoRules 动态定价教程示例：运费决策表
const defaultGraph = (): DecisionGraphType => ({
  nodes: [
    {
      id: 'input-1',
      type: 'inputNode',
      name: 'Request',
      position: { x: 70, y: 250 },
    },
    {
      id: 'table-1',
      type: 'decisionTableNode',
      name: 'Shipping Fees',
      position: { x: 370, y: 250 },
      content: {
        hitPolicy: 'first',
        inputs: [
          { id: 'country', name: 'Customer Country', field: 'customer.country' },
          { id: 'totals', name: 'Cart Totals', field: 'cart.totals' },
        ],
        outputs: [
          { id: 'flat', name: 'Fees Flat', field: 'fees.flat' },
          { id: 'percent', name: 'Fees Percent', field: 'fees.percent' },
        ],
        rules: [
          { _id: 'r1', country: '"US"', totals: '> 1000', flat: '', percent: '2', _description: 'US orders over $1000' },
          { _id: 'r2', country: '"US"', totals: '', flat: '30', percent: '', _description: 'US orders under $1000' },
          { _id: 'r3', country: '"CA","MX"', totals: '> 1000', flat: '', percent: '5', _description: 'CA/MX orders over $1000' },
          { _id: 'r4', country: '"CA","MX"', totals: '', flat: '50', percent: '', _description: 'CA/MX orders under $1000' },
          { _id: 'r5', country: '', totals: '', flat: '150', percent: '', _description: 'Rest of the world' },
        ],
        passThrough: false,
        inputField: null,
        outputPath: null,
        executionMode: 'single',
      },
    },
    {
      id: 'output-1',
      type: 'outputNode',
      name: 'Response',
      position: { x: 670, y: 250 },
    },
  ],
  edges: [
    { id: 'e1', sourceId: 'input-1', targetId: 'table-1', type: 'edge' },
    { id: 'e2', sourceId: 'table-1', targetId: 'output-1', type: 'edge' },
  ],
})

// 兼容旧数据：decisionNode / startNode / endNode / 纯 DecisionTable
function ensureGraph(content: any): DecisionGraphType {
  if (content && typeof content === 'object') {
    if (Array.isArray(content.nodes)) {
      const graph = { ...content } as DecisionGraphType
      graph.nodes = graph.nodes.map((node) => {
        const n = { ...node }
        if (n.type === 'startNode') n.type = 'inputNode'
        if (n.type === 'endNode') n.type = 'outputNode'
        if (n.type === 'decisionNode') n.type = 'decisionTableNode'
        return n
      })
      return graph
    }
    if (Array.isArray(content.inputs) && Array.isArray(content.outputs) && Array.isArray(content.rules)) {
      return {
        nodes: [
          { id: 'input-1', type: 'inputNode', name: 'Request', position: { x: 70, y: 250 } },
          { id: 'table-1', type: 'decisionTableNode', name: 'Decision Table', position: { x: 370, y: 250 }, content },
          { id: 'output-1', type: 'outputNode', name: 'Response', position: { x: 670, y: 250 } },
        ],
        edges: [
          { id: 'e1', sourceId: 'input-1', targetId: 'table-1', type: 'edge' },
          { id: 'e2', sourceId: 'table-1', targetId: 'output-1', type: 'edge' },
        ],
      }
    }
  }
  return defaultGraph()
}

function RuleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Rule
  onSave: (data: RuleCreateRequest) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name || '')
  const [ruleType, setRuleType] = useState<RuleCreateRequest['rule_type']>(initial?.rule_type || 'alarm')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [graph, setGraph] = useState<DecisionGraphType>(() => ensureGraph(initial?.jdm_content))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [simulate, setSimulate] = useState<any>()
  const [simLoading, setSimLoading] = useState(false)

  const panels = useMemo(
    () => [
      {
        id: 'simulator',
        title: 'Simulator',
        icon: <PlayCircleOutlined />,
        hideHeader: true,
        renderPanel: () => (
          <GraphSimulator
            defaultRequest={json5.stringify(
              { customer: { country: 'US' }, cart: { totals: 1500 } },
              null,
              2,
            )}
            loading={simLoading}
            onClear={() => setSimulate(undefined)}
            onRun={async ({ graph: g, context }) => {
              setSimLoading(true)
              try {
                const data = await evaluateGraph(g, context as Record<string, any>)
                setSimulate({
                  result: {
                    performance: data.evaluation?.performance || '',
                    result: data.evaluation?.result ?? null,
                    snapshot: g,
                    trace: data.evaluation?.trace ?? {},
                  },
                })
              } catch (e: any) {
                setSimulate({
                  error: {
                    title: 'Evaluation failed',
                    message: e.message || 'Unknown error',
                    data: {},
                  },
                })
              } finally {
                setSimLoading(false)
              }
            }}
          />
        ),
      },
    ],
    [simLoading],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!graph.nodes.length) {
      setError('规则图至少包含一个节点')
      return
    }
    setSaving(true)
    try {
      await onSave({ name, rule_type: ruleType, enabled, jdm_content: graph as Record<string, any> })
      onCancel()
    } catch (e: any) {
      setError(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#f0f2f5] flex flex-col">
      <form
        onSubmit={handleSubmit}
        className="flex-1 flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200/50 bg-white shadow-sm">
          <h3 className="text-sm font-bold text-gray-800">
            {initial ? '编辑规则' : '新建规则'}
          </h3>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
            ×
          </button>
        </div>

        <div className="px-5 py-3 grid grid-cols-12 gap-3 items-end bg-white shadow-sm">
          <div className="col-span-5">
            <label className="block text-xs text-gray-600 mb-1">规则名称</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="neu-input w-full px-3 py-1.5 text-xs"
              placeholder="例如：动态定价"
            />
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-gray-600 mb-1">规则类型</label>
            <select
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as RuleCreateRequest['rule_type'])}
              className="neu-input w-full px-3 py-1.5 text-xs bg-transparent"
            >
              {RULE_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2 flex items-center pb-1.5">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#52c41a]"
              />
              启用
            </label>
          </div>
          <div className="col-span-2 flex justify-end pb-1">
            <button
              type="submit"
              disabled={saving}
              className="neu-btn px-4 py-1.5 text-xs font-medium text-white bg-[#52c41a] hover:bg-[#389e0d] disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>

        {error && <div className="px-5 text-xs text-red-500 mb-2">{error}</div>}

        <div className="flex-1 min-h-0 p-5">
          <JdmConfigProvider>
            <DndProvider backend={HTML5Backend}>
              <div className="w-full h-full neu-card rounded-xl overflow-hidden">
                <DecisionGraph
                  value={graph}
                  onChange={(val) => setGraph(val as DecisionGraphType)}
                  simulate={simulate}
                  panels={panels}
                  defaultActivePanel="simulator"
                  mode="dev"
                />
              </div>
            </DndProvider>
          </JdmConfigProvider>
        </div>
      </form>
    </div>
  )
}

function SimulateModal({
  rule,
  onClose,
}: {
  rule: Rule
  onClose: () => void
}) {
  const [context, setContext] = useState('{"customer": {"country": "US"}, "cart": {"totals": 1500}}')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleRun = async () => {
    setError('')
    setResult(null)
    let ctx: Record<string, any>
    try {
      ctx = JSON.parse(context)
    } catch {
      setError('上下文 JSON 格式错误')
      return
    }
    setLoading(true)
    try {
      const data = await simulateRule(rule.id, ctx)
      setResult(data)
    } catch (e: any) {
      setError(e.message || '模拟失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="neu-card w-[560px] max-w-[90vw] p-5">
        <h3 className="text-sm font-bold text-gray-800 mb-2">规则模拟: {rule.name}</h3>
        <p className="text-xs text-gray-500 mb-3">输入测试上下文 JSON，调用后端 zen-engine 评估。</p>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={6}
          className="neu-input w-full px-3 py-2 text-xs font-mono mb-3"
          placeholder='{"customer": {"country": "US"}, "cart": {"totals": 1500}}'
        />
        <div className="flex justify-between items-center">
          <button
            onClick={handleRun}
            disabled={loading}
            className="neu-btn px-4 py-1.5 text-xs font-medium text-[#389e0d] disabled:opacity-50"
          >
            {loading ? '运行中...' : '运行模拟'}
          </button>
          <button onClick={onClose} className="neu-btn px-4 py-1.5 text-xs text-gray-600">
            关闭
          </button>
        </div>
        {error && <div className="text-xs text-red-500 mt-3">{error}</div>}
        {result && (
          <div className="mt-3">
            <div className="text-xs text-gray-500 mb-1">模拟结果</div>
            <pre className="neu-inset p-3 text-[11px] font-mono text-gray-700 overflow-x-auto max-h-[240px]">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

export default function RuleEnginePage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Rule | null>(null)
  const [creating, setCreating] = useState(false)
  const [simulating, setSimulating] = useState<Rule | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchRules()
      setRules(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (data: RuleCreateRequest) => {
    await createRule(data)
    load()
  }

  const handleUpdate = async (data: RuleCreateRequest) => {
    if (!editing) return
    await updateRule(editing.id, data)
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该规则？')) return
    await deleteRule(id)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-800">规则引擎</h2>
          <p className="text-xs text-gray-500">管理 GoRules 决策图，为节点绑定规则。</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="neu-btn px-4 py-1.5 text-xs font-medium text-white bg-[#52c41a] hover:bg-[#389e0d]"
        >
          + 新建规则
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {rules.map((rule) => (
          <div key={rule.id} className="neu-card p-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-800">{rule.name}</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">v{rule.version} · {rule.id.slice(0, 8)}</p>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                rule.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {rule.enabled ? '启用' : '禁用'}
              </span>
            </div>
            <div className="mt-3 text-xs text-gray-600">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#534AB7]/10 text-[#534AB8] mr-2">
                {TYPE_LABELS[rule.rule_type]}
              </span>
              更新于 {new Date(rule.updated_at).toLocaleString('zh-CN', { hour12: false })}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => setSimulating(rule)}
                className="neu-btn px-3 py-1 text-xs text-[#389e0d]"
              >
                模拟
              </button>
              <button
                onClick={() => setEditing(rule)}
                className="neu-btn px-3 py-1 text-xs text-gray-600"
              >
                编辑
              </button>
              <button
                onClick={() => handleDelete(rule.id)}
                className="neu-btn px-3 py-1 text-xs text-red-500 hover:bg-red-50"
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {rules.length === 0 && !loading && (
          <div className="neu-card p-8 text-center text-gray-400 text-sm col-span-full">
            暂无规则，点击右上角「新建规则」开始。
          </div>
        )}
      </div>

      {creating && (
        <RuleForm
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}
      {editing && (
        <RuleForm
          initial={editing}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      )}
      {simulating && (
        <SimulateModal
          rule={simulating}
          onClose={() => setSimulating(null)}
        />
      )}
    </div>
  )
}
