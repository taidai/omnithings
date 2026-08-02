import { useEffect, useMemo, useState } from 'react'
import { DecisionGraph, GraphSimulator, JdmConfigProvider } from '@gorules/jdm-editor'
import { PlayCircleOutlined } from '@ant-design/icons'
import json5 from 'json5'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import {
  fetchRules, fetchNodes, fetchNodeDetail, createRule, updateRule, deleteRule, simulateRule, evaluateGraph, writeNeuronTag,
  type Rule, type RuleCreateRequest, type Node, type NodeTag,
} from '../api/client'

type DecisionGraphType = {
  nodes: any[]
  edges: any[]
}

type NeuronWriteAction = {
  type: 'neuron_write'
  node: string
  group: string
  tag: string
  value: any
  cooldown?: number
}

type OutputBinding = {
  field: string
  name?: string
  node: string
  group: string
  tag: string
  cooldown: number
}

type RuleConfig = {
  sourceNodeIds: string[]
  actions: NeuronWriteAction[]
  inputMappings?: Record<string, string>
  outputBindings?: OutputBinding[]
  template?: string
}

function extractConfig(content: any): RuleConfig {
  if (content && typeof content === 'object' && content._config) {
    const cfg = content._config
    return {
      sourceNodeIds: cfg.sourceNodeIds || [],
      actions: (cfg.actions || []).map((a: any) => ({
        type: 'neuron_write',
        node: a.node || '',
        group: a.group || '',
        tag: a.tag || '',
        value: a.value ?? '',
        cooldown: a.cooldown ?? 60,
      })),
      inputMappings: cfg.inputMappings || {},
      outputBindings: (cfg.outputBindings || []).map((b: any) => ({
        field: b.field || '',
        name: b.name || '',
        node: b.node || '',
        group: b.group || '',
        tag: b.tag || '',
        cooldown: b.cooldown ?? 60,
      })),
      template: cfg.template || 'custom',
    }
  }
  return { sourceNodeIds: [], actions: [], inputMappings: {}, outputBindings: [], template: 'custom' }
}

const RULE_TYPES: RuleCreateRequest['rule_type'][] = ['alarm', 'control', 'fault_map', 'linkage']

const TYPE_LABELS: Record<RuleCreateRequest['rule_type'], string> = {
  alarm: '告警 alarm',
  control: '控制 control',
  fault_map: '故障映射 fault_map',
  linkage: '联动 linkage',
}

// 规则模板：光储充（PV + ESS + EVSE）调度决策表
function energyDispatchGraph(): DecisionGraphType {
  return {
      nodes: [
      {
        id: 'input-1',
        type: 'inputNode',
        name: 'Site Telemetry',
        position: { x: 70, y: 250 },
      },
      {
        id: 'table-1',
        type: 'decisionTableNode',
        name: 'Energy Dispatch',
        position: { x: 370, y: 250 },
        content: {
          hitPolicy: 'first',
          inputs: [
            { id: 'soc', name: 'SOC %', field: 'soc' },
            { id: 'pv_power', name: 'PV Power kW', field: 'pv_power' },
            { id: 'load_power', name: 'Load kW', field: 'load_power' },
            { id: 'tou_price', name: 'TOU Price', field: 'tou_price' },
          ],
          outputs: [
            { id: 'pcs_setpoint', name: 'PCS Setpoint kW', field: 'pcs_setpoint' },
            { id: 'evse_current', name: 'EV Current A', field: 'evse_current' },
            { id: 'strategy', name: 'Strategy', field: 'strategy' },
          ],
          rules: [
            { _id: 'r1', soc: '< 10', pv_power: '*', load_power: '*', tou_price: '*', pcs_setpoint: '0', evse_current: '0', strategy: '"电池亏电保护"' },
            { _id: 'r2', soc: '> 95', pv_power: '*', load_power: '*', tou_price: '*', pcs_setpoint: '0', evse_current: '16', strategy: '"电池充满，光伏直供"' },
            { _id: 'r3', soc: '*', pv_power: '> load_power', tou_price: '< 0.4', load_power: '*', pcs_setpoint: '-min(pv_power - load_power, 50)', evse_current: '16', strategy: '"光伏富余，低价储充"' },
            { _id: 'r4', soc: '*', pv_power: '< load_power', tou_price: '> 0.8', load_power: '*', pcs_setpoint: 'min(load_power - pv_power, 50)', evse_current: '8', strategy: '"高电价放电+限充"' },
            { _id: 'r5', soc: '*', pv_power: '*', load_power: '*', tou_price: '*', pcs_setpoint: 'pv_power - load_power', evse_current: '16', strategy: '"默认自发自用"' },
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
        name: 'Dispatch Command',
        position: { x: 670, y: 250 },
      },
    ],
    edges: [
      { id: 'e1', sourceId: 'input-1', targetId: 'table-1', type: 'edge' },
      { id: 'e2', sourceId: 'table-1', targetId: 'output-1', type: 'edge' },
    ],
    }
  }
  
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
  return energyDispatchGraph()
}


type RuleTemplate = {
  id: string
  name: string
  description: string
  ruleType: RuleCreateRequest['rule_type']
}

const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'energy_dispatch',
    name: '光储充调度',
    description: 'PV + ESS + EVSE，根据 SOC / 光伏 / 负载 / 电价自动调度 PCS 与充电桩',
    ruleType: 'control',
  },
  {
    id: 'heartbeat',
    name: '心跳测试',
    description: '固定写入心跳信号，验证控制链路是否打通',
    ruleType: 'control',
  },
  {
    id: 'custom',
    name: '自定义',
    description: '从空白决策图开始，自行拖拽节点',
    ruleType: 'control',
  },
]

function heartbeatGraph(): DecisionGraphType {
  return {
    nodes: [
      {
        id: 'input-1',
        type: 'inputNode',
        name: 'Trigger',
        position: { x: 70, y: 250 },
      },
      {
        id: 'table-1',
        type: 'decisionTableNode',
        name: 'Heartbeat',
        position: { x: 370, y: 250 },
        content: {
          hitPolicy: 'first',
          inputs: [{ id: 'trigger', name: 'Trigger', field: 'trigger' }],
          outputs: [{ id: 'value', name: 'Value', field: 'value' }],
          rules: [{ _id: 'r1', trigger: '*', value: '1' }],
          passThrough: false,
          inputField: null,
          outputPath: null,
          executionMode: 'single',
        },
      },
      {
        id: 'output-1',
        type: 'outputNode',
        name: 'Command',
        position: { x: 670, y: 250 },
      },
    ],
    edges: [
      { id: 'e1', sourceId: 'input-1', targetId: 'table-1', type: 'edge' },
      { id: 'e2', sourceId: 'table-1', targetId: 'output-1', type: 'edge' },
    ],
  }
}

function emptyGraph(): DecisionGraphType {
  return {
    nodes: [
      { id: 'input-1', type: 'inputNode', name: 'Request', position: { x: 70, y: 250 } },
      { id: 'output-1', type: 'outputNode', name: 'Response', position: { x: 670, y: 250 } },
    ],
    edges: [],
  }
}

function applyTemplate(templateId: string): { graph: DecisionGraphType; config: RuleConfig } {
  if (templateId === 'energy_dispatch') {
    return {
      graph: energyDispatchGraph(),
      config: {
        sourceNodeIds: [],
        actions: [],
        inputMappings: {},
        outputBindings: [
          { field: 'pcs_setpoint', name: 'PCS Setpoint kW', node: 'tk_db', group: 'meters', tag: 'PCS功率设定', cooldown: 60 },
          { field: 'evse_current', name: 'EV Current A', node: 'tk_db', group: 'meters', tag: 'EVSE电流设定', cooldown: 60 },
        ],
        template: 'energy_dispatch',
      },
    }
  }
  if (templateId === 'heartbeat') {
    return {
      graph: heartbeatGraph(),
      config: {
        sourceNodeIds: [],
        actions: [
          { type: 'neuron_write', node: 'tk_db', group: 'meters', tag: '心跳信号', value: '1', cooldown: 60 },
        ],
        inputMappings: {},
        outputBindings: [],
        template: 'heartbeat',
      },
    }
  }
  return {
    graph: emptyGraph(),
    config: {
      sourceNodeIds: [],
      actions: [],
      inputMappings: {},
      outputBindings: [],
      template: 'custom',
    },
  }
}

function extractGraphFields(graph: DecisionGraphType) {
  const table = graph.nodes.find((n: any) => n.type === 'decisionTableNode')
  const content = table?.content || {}
  const inputs = (content.inputs || []).map((i: any) => ({ id: i.field || i.id, name: i.name || i.field || i.id }))
  const outputs = (content.outputs || []).map((o: any) => ({ id: o.field || o.id, name: o.name || o.field || o.id }))
  return { inputs, outputs }
}

function bindingsToActions(bindings: OutputBinding[]): NeuronWriteAction[] {
  return bindings
    .filter((b) => b.node && b.group && b.tag)
    .map((b) => ({
      type: 'neuron_write',
      node: b.node,
      group: b.group,
      tag: b.tag,
      value: `{{${b.field}}}`,
      cooldown: b.cooldown,
    }))
}

function actionsToBindings(actions: NeuronWriteAction[], outputs: { id: string; name?: string }[]): OutputBinding[] {
  const map = new Map(outputs.map((o) => [o.id, o.name || o.id]))
  return actions
    .filter((a) => typeof a.value === 'string' && a.value.startsWith('{{') && a.value.endsWith('}}'))
    .map((a) => {
      const field = a.value.slice(2, -2)
      return {
        field,
        name: map.get(field) || field,
        node: a.node,
        group: a.group,
        tag: a.tag,
        cooldown: a.cooldown ?? 60,
      }
    })
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
  const isCreating = !initial
  const initialGraph = ensureGraph(initial?.jdm_content)
  const initialConfig = extractConfig(initial?.jdm_content)

  const [name, setName] = useState(initial?.name || '')
  const [ruleType, setRuleType] = useState<RuleCreateRequest['rule_type']>(initial?.rule_type || 'control')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [graph, setGraph] = useState<DecisionGraphType>(initialGraph)
  const [config, setConfig] = useState<RuleConfig>(initialConfig)
  const [nodes, setNodes] = useState<Node[]>([])
  const [nodeTags, setNodeTags] = useState<Record<string, NodeTag[]>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [simulate, setSimulate] = useState<any>()
  const [simLoading, setSimLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'input' | 'process' | 'output'>('input')
  const [advancedMode, setAdvancedMode] = useState(false)
  const [showRawActions, setShowRawActions] = useState(false)

  useEffect(() => {
    fetchNodes().then(setNodes).catch(() => {})
  }, [])

  // 加载已选节点下的 tags，用于输入映射下拉
  useEffect(() => {
    if (!config.sourceNodeIds.length) {
      setNodeTags({})
      return
    }
    const load = async () => {
      const map: Record<string, NodeTag[]> = {}
      await Promise.all(
        config.sourceNodeIds.map(async (nodeId) => {
          try {
            const detail = await fetchNodeDetail(nodeId)
            map[nodeId] = detail.tags || []
          } catch {
            map[nodeId] = []
          }
        }),
      )
      setNodeTags(map)
    }
    load()
  }, [config.sourceNodeIds])

  const graphFields = useMemo(() => extractGraphFields(graph), [graph])

  // 当 graph 输入输出变化时，同步更新 outputBindings / inputMappings 的字段列表
  useEffect(() => {
    setConfig((prev) => {
      const newInputMappings: Record<string, string> = {}
      graphFields.inputs.forEach((i: any) => {
        newInputMappings[i.id] = prev.inputMappings?.[i.id] || ''
      })
      const existingBindings = new Map((prev.outputBindings || []).map((b: any) => [b.field, b]))
      const newBindings: OutputBinding[] = graphFields.outputs
        .filter((o: any) => o.id !== 'strategy')
        .map((o: any) => existingBindings.get(o.id) || {
          field: o.id,
          name: o.name,
          node: '',
          group: '',
          tag: '',
          cooldown: 60,
        })
      return { ...prev, inputMappings: newInputMappings, outputBindings: newBindings }
    })
  }, [graphFields.inputs.length, graphFields.outputs.length])

  const allTags = useMemo(() => {
    const list: { nodeId: string; nodeName: string; tag: NodeTag }[] = []
    Object.entries(nodeTags).forEach(([nodeId, tags]) => {
      const nodeName = nodes.find((n) => n.id === nodeId)?.name || nodeId
      tags.forEach((tag) => list.push({ nodeId, nodeName, tag }))
    })
    return list
  }, [nodeTags, nodes])

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
              { pv_power: 120, load_power: 80, soc: 45, tou_price: 0.35 },
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

  const handleApplyTemplate = (templateId: string) => {
    const applied = applyTemplate(templateId)
    setGraph(applied.graph)
    setConfig(applied.config)
    setRuleType(applied.config.template === 'heartbeat' ? 'control' : 'control')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!graph.nodes.length) {
      setError('规则图至少包含一个节点')
      return
    }
    setSaving(true)
    try {
      // 输出绑定 -> 控制动作
      const derivedActions = showRawActions ? config.actions : bindingsToActions(config.outputBindings || [])
      const jdm_content = { ...graph, _config: { ...config, actions: derivedActions } }
      await onSave({ name, rule_type: ruleType, enabled, jdm_content: jdm_content as Record<string, any> })
      onCancel()
    } catch (e: any) {
      setError(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const updateInputMapping = (field: string, tagName: string) => {
    setConfig((prev) => ({
      ...prev,
      inputMappings: { ...(prev.inputMappings || {}), [field]: tagName },
    }))
  }

  const updateOutputBinding = (idx: number, patch: Partial<OutputBinding>) => {
    setConfig((prev) => {
      const bindings = [...(prev.outputBindings || [])]
      bindings[idx] = { ...bindings[idx], ...patch }
      return { ...prev, outputBindings: bindings }
    })
  }

  const testWrite = async (action: NeuronWriteAction) => {
    try {
      const v = action.value
      if (typeof v === 'string' && v.includes('{{')) {
        if (!confirm('当前值为模板，测试下发会写入字面量，确定继续？')) return
      }
      await writeNeuronTag(action.node, action.group, action.tag, action.value)
      alert('下发成功')
    } catch (e: any) {
      alert(`下发失败: ${e.message || e}`)
    }
  }

  const TabButton = ({ id, label }: { id: typeof activeTab; label: string }) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
        activeTab === id
          ? 'border-[#52c41a] text-[#52c41a]'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 bg-[#f0f2f5] flex flex-col">
      <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200/50 bg-white shadow-sm">
          <h3 className="text-sm font-bold text-gray-800">
            {initial ? '编辑规则' : '新建规则'}
          </h3>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
            ×
          </button>
        </div>

        {/* Basic info */}
        <div className="px-5 py-3 grid grid-cols-12 gap-3 items-end bg-white shadow-sm">
          <div className="col-span-4">
            <label className="block text-xs text-gray-600 mb-1">规则名称</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="neu-input w-full px-3 py-1.5 text-xs"
              placeholder="例如：光储充调度策略"
            />
          </div>
          <div className="col-span-2">
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
          <div className="col-span-2">
            {isCreating && (
              <>
                <label className="block text-xs text-gray-600 mb-1">规则模板</label>
                <select
                  value={config.template || 'custom'}
                  onChange={(e) => handleApplyTemplate(e.target.value)}
                  className="neu-input w-full px-3 py-1.5 text-xs bg-transparent"
                >
                  {RULE_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </>
            )}
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

        {/* IPO Tabs */}
        <div className="px-5 bg-white border-b border-gray-200/50 flex gap-2">
          <TabButton id="input" label="① 输入" />
          <TabButton id="process" label="② 处理" />
          <TabButton id="output" label="③ 输出" />
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 p-5 overflow-y-auto">
          {activeTab === 'input' && (
            <div className="grid grid-cols-12 gap-5 h-full">
              <div className="col-span-4 flex flex-col">
                <label className="block text-xs font-medium text-gray-700 mb-2">数据源节点</label>
                <div className="neu-inset flex-1 overflow-y-auto p-3 text-xs space-y-2">
                  {nodes.map((n) => (
                    <label key={n.id} className="flex items-center gap-2 cursor-pointer hover:bg-white/50 rounded px-1">
                      <input
                        type="checkbox"
                        checked={config.sourceNodeIds.includes(n.id)}
                        onChange={(e) => {
                          const ids = new Set(config.sourceNodeIds)
                          e.target.checked ? ids.add(n.id) : ids.delete(n.id)
                          setConfig({ ...config, sourceNodeIds: Array.from(ids) })
                        }}
                        className="w-3.5 h-3.5 accent-[#52c41a]"
                      />
                      <span className="truncate">{n.name}</span>
                      <span className="text-[10px] text-gray-400">L{n.layer}</span>
                    </label>
                  ))}
                  {nodes.length === 0 && <div className="text-gray-400">加载中…</div>}
                </div>
              </div>

              <div className="col-span-8 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-gray-700">字段映射</label>
                  <span className="text-[10px] text-gray-400">把决策表字段映射到节点里的真实 tag 名</span>
                </div>
                <div className="neu-inset flex-1 overflow-y-auto p-3 text-xs">
                  {graphFields.inputs.length === 0 ? (
                    <div className="text-gray-400">当前决策表没有输入字段</div>
                  ) : (
                    <table className="w-full">
                      <thead className="text-[10px] text-gray-500 border-b border-gray-200">
                        <tr>
                          <th className="text-left py-2 font-medium">决策表字段</th>
                          <th className="text-left py-2 font-medium">来源 tag</th>
                          <th className="text-left py-2 font-medium">来源节点</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {graphFields.inputs.map((field: any) => {
                          const selectedTagName = config.inputMappings?.[field.id] || ''
                          const selectedTag = allTags.find((t) => t.tag.name === selectedTagName)
                          return (
                            <tr key={field.id}>
                              <td className="py-2">
                                <span className="font-medium text-gray-700">{field.name}</span>
                                <span className="text-[10px] text-gray-400 ml-2">({field.id})</span>
                              </td>
                              <td className="py-2">
                                <select
                                  value={selectedTagName}
                                  onChange={(e) => updateInputMapping(field.id, e.target.value)}
                                  className="neu-input w-full px-2 py-1 text-xs bg-transparent"
                                >
                                  <option value="">-- 选择 tag --</option>
                                  {allTags.map((t) => (
                                    <option key={`${t.nodeId}-${t.tag.name}`} value={t.tag.name}>
                                      {t.tag.name} ({t.nodeName})
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2 text-gray-500">
                                {selectedTag ? selectedTag.nodeName : '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                  {allTags.length === 0 && config.sourceNodeIds.length > 0 && (
                    <div className="mt-3 text-[10px] text-gray-400">正在加载选中节点下的 tags…</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'process' && (
            <div className="flex flex-col gap-4 h-full">
              <div className="neu-card p-4 bg-white">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-gray-800">
                      {RULE_TEMPLATES.find((t) => t.id === config.template)?.name || '自定义规则'}
                    </h4>
                    <p className="text-xs text-gray-500 mt-1">
                      {RULE_TEMPLATES.find((t) => t.id === config.template)?.description || '自定义决策图'}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={advancedMode}
                      onChange={(e) => setAdvancedMode(e.target.checked)}
                      className="w-3.5 h-3.5 accent-[#52c41a]"
                    />
                    高级编辑模式
                  </label>
                </div>
                {!advancedMode && (
                  <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-gray-500">输入：</span>
                      <span className="text-gray-700">{graphFields.inputs.map((i: any) => i.name).join('、') || '无'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">输出：</span>
                      <span className="text-gray-700">{graphFields.outputs.map((o: any) => o.name).join('、') || '无'}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 neu-card rounded-xl overflow-hidden">
                {advancedMode ? (
                  <JdmConfigProvider>
                    <DndProvider backend={HTML5Backend}>
                      <DecisionGraph
                        value={graph}
                        onChange={(val) => setGraph(val as DecisionGraphType)}
                        simulate={simulate}
                        panels={panels}
                        defaultActivePanel="simulator"
                        mode="dev"
                      />
                    </DndProvider>
                  </JdmConfigProvider>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                    启用「高级编辑模式」后可拖拽节点、编辑决策表。
                    <br />
                    日常配置只需在「输入」「输出」两个标签页完成。
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'output' && (
            <div className="flex flex-col gap-4 h-full">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-gray-700">输出绑定</label>
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showRawActions}
                    onChange={(e) => setShowRawActions(e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#52c41a]"
                  />
                  显示原始控制动作
                </label>
              </div>

              {!showRawActions ? (
                <div className="neu-inset flex-1 overflow-y-auto p-3 text-xs">
                  {(config.outputBindings || []).length === 0 ? (
                    <div className="text-gray-400">当前决策表没有可绑定的输出字段</div>
                  ) : (
                    <table className="w-full">
                      <thead className="text-[10px] text-gray-500 border-b border-gray-200">
                        <tr>
                          <th className="text-left py-2 font-medium">决策输出</th>
                          <th className="text-left py-2 font-medium">NE 节点</th>
                          <th className="text-left py-2 font-medium">组</th>
                          <th className="text-left py-2 font-medium">点位名</th>
                          <th className="text-left py-2 font-medium">冷却(s)</th>
                          <th className="text-left py-2 font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(config.outputBindings || []).map((binding, idx) => (
                          <tr key={binding.field}>
                            <td className="py-2">
                              <span className="font-medium text-gray-700">{binding.name}</span>
                              <span className="text-[10px] text-gray-400 ml-2">({binding.field})</span>
                            </td>
                            <td className="py-2">
                              <input
                                value={binding.node}
                                onChange={(e) => updateOutputBinding(idx, { node: e.target.value })}
                                placeholder="tk_db"
                                className="neu-input w-full px-2 py-1"
                              />
                            </td>
                            <td className="py-2">
                              <input
                                value={binding.group}
                                onChange={(e) => updateOutputBinding(idx, { group: e.target.value })}
                                placeholder="meters"
                                className="neu-input w-full px-2 py-1"
                              />
                            </td>
                            <td className="py-2">
                              <input
                                value={binding.tag}
                                onChange={(e) => updateOutputBinding(idx, { tag: e.target.value })}
                                placeholder="PCS功率设定"
                                className="neu-input w-full px-2 py-1"
                              />
                            </td>
                            <td className="py-2">
                              <input
                                type="number"
                                value={binding.cooldown}
                                onChange={(e) => updateOutputBinding(idx, { cooldown: Number(e.target.value) })}
                                className="neu-input w-20 px-2 py-1"
                              />
                            </td>
                            <td className="py-2">
                              <button
                                type="button"
                                onClick={() => testWrite({
                                  type: 'neuron_write',
                                  node: binding.node,
                                  group: binding.group,
                                  tag: binding.tag,
                                  value: `{{${binding.field}}}`,
                                  cooldown: binding.cooldown,
                                })}
                                disabled={!binding.node || !binding.group || !binding.tag}
                                className="neu-btn px-2 py-1 text-[10px] text-[#389e0d] disabled:opacity-40"
                              >
                                测试下发
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <div className="neu-inset flex-1 overflow-y-auto p-3 text-xs space-y-2">
                  {config.actions.map((action, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        value={action.node}
                        onChange={(e) => {
                          const actions = [...config.actions]
                          actions[idx] = { ...action, node: e.target.value }
                          setConfig({ ...config, actions })
                        }}
                        placeholder="NE节点"
                        className="neu-input col-span-3 px-2 py-1"
                      />
                      <input
                        value={action.group}
                        onChange={(e) => {
                          const actions = [...config.actions]
                          actions[idx] = { ...action, group: e.target.value }
                          setConfig({ ...config, actions })
                        }}
                        placeholder="组"
                        className="neu-input col-span-2 px-2 py-1"
                      />
                      <input
                        value={action.tag}
                        onChange={(e) => {
                          const actions = [...config.actions]
                          actions[idx] = { ...action, tag: e.target.value }
                          setConfig({ ...config, actions })
                        }}
                        placeholder="点位名"
                        className="neu-input col-span-3 px-2 py-1"
                      />
                      <input
                        value={String(action.value ?? '')}
                        onChange={(e) => {
                          const actions = [...config.actions]
                          actions[idx] = { ...action, value: e.target.value }
                          setConfig({ ...config, actions })
                        }}
                        placeholder="值"
                        className="neu-input col-span-2 px-2 py-1"
                      />
                      <button
                        type="button"
                        onClick={() => testWrite(action)}
                        className="neu-btn col-span-2 px-1 py-1 text-[10px] text-[#389e0d]"
                      >
                        测试下发
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setConfig({
                        ...config,
                        actions: [...config.actions, { type: 'neuron_write', node: 'tk_db', group: 'meters', tag: '', value: '1', cooldown: 60 }],
                      })
                    }
                    className="neu-btn px-2 py-1 text-[10px] text-gray-600"
                  >
                    + 添加 NE 写点位
                  </button>
                </div>
              )}
            </div>
          )}
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
  const [context, setContext] = useState('{"pv_power": 120, "load_power": 80, "soc": 45, "tou_price": 0.35}')
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
          placeholder='{"pv_power": 120, "load_power": 80, "soc": 45, "tou_price": 0.35}'
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
