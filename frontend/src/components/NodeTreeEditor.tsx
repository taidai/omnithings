import { useEffect, useState, useCallback, useRef } from 'react'
import {
  fetchNodes, fetchNodeTree, fetchNodeDetail, connectTelemetryWS,
  createNode, updateNode, deleteNode, createTag, importNeuronTags,
  fetchNeuronNodes, fetchNeuronGroups, fetchNeuronTags,
  type Node, type TreeNode, type NodeTag, type TelemetryUpdate,
  type NeuronNode, type NeuronGroup, type NeuronTag,
} from '../api/client'

// ── 节点类型 → 图标 / 颜色 ──
const LAYER_META: Record<number, { icon: string; label: string; color: string }> = {
  1: { icon: '🏢', label: 'Site', color: '#52c41a' },
  2: { icon: '⚡', label: 'Station', color: '#1890ff' },
  3: { icon: '🔋', label: 'EnergyNode', color: '#722ed1' },
  4: { icon: '📟', label: 'Device', color: '#fa8c16' },
  5: { icon: '🏷️', label: 'Tag', color: '#13c2c2' },
}

const AGG_FNS = ['SUM', 'AVG', 'MAX', 'MIN', 'COUNT', 'LAST']

// ── 递归树行 ──
function TreeRow({
  node, depth, selectedId, onSelect, expanded, onToggle, tagValueCount,
}: {
  node: TreeNode
  depth: number
  selectedId: string | null
  onSelect: (n: TreeNode) => void
  expanded: Set<string>
  onToggle: (id: string) => void
  tagValueCount: Map<string, number>
}) {
  const meta = LAYER_META[node.layer] || { icon: '•', label: `L${node.layer}`, color: '#8c8c8c' }
  const hasChildren = node.children && node.children.length > 0
  const isOpen = expanded.has(node.id)
  const isSelected = selectedId === node.id
  const liveCount = tagValueCount.get(node.id) || 0
  const boundDevice = node.config?.neuron_node ? `${node.config.neuron_node}/${node.config.neuron_group || '*'}` : null

  return (
    <>
      <div
        onClick={() => onSelect(node)}
        className={`flex items-center gap-2 py-1.5 pr-3 rounded-lg cursor-pointer transition-colors text-xs ${
          isSelected ? 'bg-[#52c41a]/10' : 'hover:bg-white/50'
        } ${node.enabled ? '' : 'opacity-50'}`}
        style={{ paddingLeft: `${depth * 18 + 8}px` }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(node.id) }}
            className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 shrink-0"
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="shrink-0" style={{ fontSize: '13px' }}>{meta.icon}</span>
        <span className={`font-medium truncate ${node.enabled ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{node.name}</span>
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
          style={{ background: `${meta.color}18`, color: meta.color }}
        >
          {meta.label}
        </span>
        {boundDevice && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#13c2c2]/10 text-[#13c2c2] shrink-0">
            ⛓ {boundDevice}
          </span>
        )}
        {node.tag_count > 0 && (
          <span className="text-[10px] text-gray-400 shrink-0">{node.tag_count} 点位</span>
        )}
        {liveCount > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-[#389e0d] shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#52c41a] animate-pulse" />
            {liveCount} 实时
          </span>
        )}
      </div>
      {hasChildren && isOpen && node.children.map((c) => (
        <TreeRow
          key={c.id}
          node={c}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          expanded={expanded}
          onToggle={onToggle}
          tagValueCount={tagValueCount}
        />
      ))}
    </>
  )
}

// ── 自定义节点创建表单 ──
function CreateNodeForm({
  mode, parent, onCancel, onCreated,
}: {
  mode: 'site' | 'child'
  parent: Node | null
  onCancel: () => void
  onCreated: (node: Node) => void
}) {
  const [name, setName] = useState('')
  const [nodeType, setNodeType] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const targetLayer = mode === 'site' ? 1 : (parent?.layer || 0) + 1
  const meta = LAYER_META[targetLayer]

  const submit = async () => {
    if (!name.trim()) { setError('请输入节点名'); return }
    if (mode === 'child' && !parent) { setError('请先选择父节点'); return }
    if (targetLayer > 5) { setError('超过最大层级 5'); return }
    setBusy(true)
    setError('')
    try {
      const res = await createNode({
        name: name.trim(),
        parent_id: mode === 'site' ? null : parent!.id,
        layer: targetLayer,
        node_type: nodeType.trim() || '',
        sort_order: Number(sortOrder) || 0,
        enabled,
      })
      onCreated(res.node)
    } catch (e: any) {
      setError(e?.message || '创建失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="neu-inset rounded-xl p-3 mb-3 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-bold text-gray-700">{mode === 'site' ? '新建 Site 根节点' : `在「${parent?.name}」下新建子节点`}</span>
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: `${meta.color}18`, color: meta.color }}>
          {meta.icon} {meta.label} · L{targetLayer}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="节点名 *" className="neu-input px-3 py-1.5 bg-transparent col-span-2" />
        <input value={nodeType} onChange={(e) => setNodeType(e.target.value)} placeholder="子类型 (ESS/PV/GRID/EVSE, 可选)" className="neu-input px-3 py-1.5 bg-transparent" />
        <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="排序 sort_order" className="neu-input px-3 py-1.5 bg-transparent" />
      </div>
      <label className="mt-2 flex items-center gap-2 text-gray-600">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 启用
      </label>
      {error && <div className="mt-2 text-red-500">{error}</div>}
      <div className="mt-2 flex gap-2">
        <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded-lg bg-[#52c41a] text-white disabled:opacity-50">
          {busy ? '创建中...' : '创建节点'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg bg-white/60 text-gray-600">取消</button>
      </div>
    </div>
  )
}

// ── 选中节点的点位/操作面板 ──
function TagPanel({
  node, tags, loading, realtimeValues, onNodeChanged, onNodeDeleted,
}: {
  node: Node | null
  tags: NodeTag[]
  loading: boolean
  realtimeValues: Map<string, TelemetryUpdate>
  onNodeChanged: (patch?: Partial<Node>) => void
  onNodeDeleted: () => void
}) {
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [renameOpen, setRenameOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('')

  const [mountOpen, setMountOpen] = useState(false)
  const [neuronNodes, setNeuronNodes] = useState<NeuronNode[]>([])
  const [neuronNode, setNeuronNode] = useState('')
  const [groups, setGroups] = useState<NeuronGroup[]>([])
  const [group, setGroup] = useState('')
  const [neuronTags, setNeuronTags] = useState<NeuronTag[]>([])

  const [logicalOpen, setLogicalOpen] = useState(false)
  const [logicalName, setLogicalName] = useState('')
  const [logicalDisplay, setLogicalDisplay] = useState('')
  const [logicalUnit, setLogicalUnit] = useState('')
  const [aggFn, setAggFn] = useState('SUM')
  const [logicalSources, setLogicalSources] = useState<Set<string>>(new Set())

  useEffect(() => {
    setMsg('')
    setErr('')
    setRenameOpen(false)
    setMountOpen(false)
    setLogicalOpen(false)
    setNewName(node?.name || '')
    setNewType(node?.node_type || '')
    setNeuronNode(node?.config?.neuron_node || '')
    setGroup(node?.config?.neuron_group || '')
    setGroups([])
    setNeuronTags([])
    setLogicalSources(new Set())
  }, [node?.id])

  if (!node) {
    return (
      <div className="neu-inset rounded-2xl p-8 flex items-center justify-center h-full min-h-[300px]">
        <p className="text-xs text-gray-400">← 从左侧节点树选择一个节点查看其挂载点位与实时值</p>
      </div>
    )
  }

  const meta = LAYER_META[node.layer] || { icon: '•', label: `L${node.layer}`, color: '#8c8c8c' }
  const boundDevice = node.config?.neuron_node ? `${node.config.neuron_node}/${node.config.neuron_group || '*'}` : null
  const isRootSite = node.layer === 1 && !node.parent_id

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr('')
    setMsg('')
    try { await fn() } catch (e: any) { setErr(e?.message || '操作失败') } finally { setBusy(false) }
  }

  const openMount = () => {
    setMountOpen((v) => !v)
    if (neuronNodes.length === 0) {
      fetchNeuronNodes().then(setNeuronNodes).catch((e) => setErr(e?.message || 'Neuron 节点加载失败'))
    }
  }

  const onNeuronNodeChange = (v: string) => {
    setNeuronNode(v)
    setGroup('')
    setGroups([])
    setNeuronTags([])
    if (v) fetchNeuronGroups(v).then(setGroups).catch((e) => setErr(e?.message || 'Neuron 组加载失败'))
  }

  const onGroupChange = (v: string) => {
    setGroup(v)
    setNeuronTags([])
    if (neuronNode && v) fetchNeuronTags(neuronNode, v).then(setNeuronTags).catch((e) => setErr(e?.message || 'Neuron 点位加载失败'))
  }

  const doMount = () => run(async () => {
    if (!neuronNode || !group) throw new Error('请选择 Neuron 节点与采集组')
    const res = await importNeuronTags({ node_id: node.id, neuron_node: neuronNode, neuron_group: group })
    const config = { ...(node.config || {}), neuron_node: neuronNode, neuron_group: group, mounted_at: new Date().toISOString() }
    try { await updateNode(node.id, { config }) } catch { /* 配置回写失败不阻断点位导入 */ }
    setMsg(`已挂载 ${neuronNode}/${group}：导入 ${res.imported}，跳过 ${res.skipped}`)
    onNodeChanged({ config })
  })

  const toggleSource = (id: string) => {
    setLogicalSources((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const doCreateLogical = () => run(async () => {
    if (!logicalName.trim()) throw new Error('请输入汇总点位名')
    if (logicalSources.size === 0) throw new Error('请至少勾选一个来源点位')
    const res = await createTag({
      node_id: node.id,
      name: logicalName.trim(),
      display_name: logicalDisplay.trim() || undefined,
      unit: logicalUnit.trim() || undefined,
      tag_type: 'LOGICAL',
      data_type: 'FLOAT',
      formula_type: 'aggregate',
      aggregate_fn: aggFn,
      sources: [...logicalSources],
    })
    setMsg(`已创建汇总点位 ${res.name}`)
    setLogicalName('')
    setLogicalDisplay('')
    setLogicalUnit('')
    setLogicalSources(new Set())
    onNodeChanged()
  })

  return (
    <div className="neu-card p-4 h-full">
      <div className="flex items-start gap-2 mb-3 pb-3 border-b border-gray-100">
        <span style={{ fontSize: '18px' }}>{meta.icon}</span>
        <div className="min-w-0">
          <div className="font-bold text-gray-800 text-sm truncate">{node.name}</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">
            {meta.label} · Layer {node.layer}{node.node_type ? ` · ${node.node_type}` : ''}{node.enabled ? '' : ' · 已停用'}
          </div>
          {boundDevice && <div className="text-[10px] text-[#13c2c2] mt-0.5">⛓ 已挂载设备：{boundDevice}</div>}
        </div>
        <span
          className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0"
          style={{ background: `${meta.color}18`, color: meta.color }}
        >
          {tags.length} 点位
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <button onClick={() => setRenameOpen((v) => !v)} className="px-2 py-1 rounded-lg bg-white/60 hover:bg-white text-gray-700">重命名</button>
        <button
          onClick={() => run(async () => { await updateNode(node.id, { enabled: !node.enabled }); setMsg(node.enabled ? '已停用节点' : '已启用节点'); onNodeChanged({ enabled: !node.enabled }) })}
          className="px-2 py-1 rounded-lg bg-white/60 hover:bg-white text-gray-700"
        >
          {node.enabled ? '停用' : '启用'}
        </button>
        <button
          onClick={() => {
            if (isRootSite) { setErr('根节点 Site 禁止删除'); return }
            if (window.confirm(`删除节点「${node.name}」将级联删除其子节点与挂载点位，确认？`)) {
              run(async () => { await deleteNode(node.id); onNodeDeleted() })
            }
          }}
          className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600"
        >
          删除
        </button>
        <button onClick={openMount} className="px-2 py-1 rounded-lg bg-[#13c2c2]/10 hover:bg-[#13c2c2]/20 text-[#08979c]">挂载设备</button>
        <button onClick={() => setLogicalOpen((v) => !v)} className="px-2 py-1 rounded-lg bg-[#722ed1]/10 hover:bg-[#722ed1]/20 text-[#722ed1]">新增汇总</button>
      </div>

      {(msg || err) && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-xs ${err ? 'bg-red-50 text-red-600' : 'bg-[#52c41a]/10 text-[#389e0d]'}`}>
          {err || msg}
        </div>
      )}

      {renameOpen && (
        <div className="neu-inset rounded-xl p-3 mb-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="节点名" className="neu-input px-3 py-1.5 bg-transparent" />
            <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="子类型 (可选)" className="neu-input px-3 py-1.5 bg-transparent" />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => run(async () => {
                if (!newName.trim()) throw new Error('节点名不能为空')
                await updateNode(node.id, { name: newName.trim(), node_type: newType.trim() || '' })
                setMsg('节点已更新')
                setRenameOpen(false)
                onNodeChanged({ name: newName.trim(), node_type: newType.trim() || undefined })
              })}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-[#52c41a] text-white disabled:opacity-50"
            >保存</button>
            <button onClick={() => setRenameOpen(false)} className="px-3 py-1.5 rounded-lg bg-white/60 text-gray-600">取消</button>
          </div>
        </div>
      )}

      {mountOpen && (
        <div className="neu-inset rounded-xl p-3 mb-3 text-xs">
          <div className="font-bold text-gray-700 mb-2">挂载 Neuron 设备到当前节点</div>
          <div className="grid grid-cols-2 gap-2">
            <select value={neuronNode} onChange={(e) => onNeuronNodeChange(e.target.value)} className="neu-input px-3 py-1.5 bg-transparent">
              <option value="">选择 Neuron 节点</option>
              {neuronNodes.map((n) => <option key={n.name} value={n.name}>{n.name} ({n.plugin})</option>)}
            </select>
            <select value={group} onChange={(e) => onGroupChange(e.target.value)} className="neu-input px-3 py-1.5 bg-transparent" disabled={!neuronNode}>
              <option value="">选择采集组</option>
              {groups.map((g) => <option key={g.name} value={g.name}>{g.name} ({g.interval}ms)</option>)}
            </select>
          </div>
          <div className="mt-2 text-[10px] text-gray-400">
            {neuronNode && group ? `将导入 ${neuronTags.length} 个点位到「${node.name}」，source_path=${neuronNode}/${group}/...` : '选择节点与采集组后显示待导入点位数'}
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={doMount} disabled={busy || !neuronNode || !group} className="px-3 py-1.5 rounded-lg bg-[#13c2c2] text-white disabled:opacity-50">
              {busy ? '挂载中...' : '导入并挂载'}
            </button>
            <button onClick={() => setMountOpen(false)} className="px-3 py-1.5 rounded-lg bg-white/60 text-gray-600">收起</button>
          </div>
        </div>
      )}

      {logicalOpen && (
        <div className="neu-inset rounded-xl p-3 mb-3 text-xs">
          <div className="font-bold text-gray-700 mb-2">新增汇总点位 (LogicalTag)</div>
          <div className="grid grid-cols-2 gap-2">
            <input value={logicalName} onChange={(e) => setLogicalName(e.target.value)} placeholder="点位名 * (如 total_power)" className="neu-input px-3 py-1.5 bg-transparent" />
            <input value={logicalDisplay} onChange={(e) => setLogicalDisplay(e.target.value)} placeholder="显示名 (可选)" className="neu-input px-3 py-1.5 bg-transparent" />
            <select value={aggFn} onChange={(e) => setAggFn(e.target.value)} className="neu-input px-3 py-1.5 bg-transparent">
              {AGG_FNS.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
            </select>
            <input value={logicalUnit} onChange={(e) => setLogicalUnit(e.target.value)} placeholder="单位 (可选)" className="neu-input px-3 py-1.5 bg-transparent" />
          </div>
          <div className="mt-2 max-h-28 overflow-y-auto rounded-lg bg-white/40 p-2">
            {tags.length === 0 ? (
              <div className="text-gray-400">当前节点无可作为来源的点位，请先挂载设备或选择有挂载点位的节点</div>
            ) : tags.map((t) => (
              <label key={t.id} className="flex items-center gap-2 py-0.5 text-gray-600">
                <input type="checkbox" checked={logicalSources.has(t.id)} onChange={() => toggleSource(t.id)} />
                <span className="truncate">{t.display_name || t.name}</span>
                <span className="text-[10px] text-gray-400">{t.data_type}</span>
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={doCreateLogical} disabled={busy} className="px-3 py-1.5 rounded-lg bg-[#722ed1] text-white disabled:opacity-50">
              {busy ? '创建中...' : '创建汇总点位'}
            </button>
            <button onClick={() => setLogicalOpen(false)} className="px-3 py-1.5 rounded-lg bg-white/60 text-gray-600">收起</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-xs text-gray-400">加载中...</div>
      ) : tags.length === 0 ? (
        <div className="text-center py-8 text-xs text-gray-400">该节点未挂载任何点位，可点击「挂载设备」导入 Neuron 点位</div>
      ) : (
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#f0f2f5] z-10">
              <tr className="border-b border-gray-200">
                <th className="text-left px-2 py-2 font-medium text-gray-500 text-[10px] uppercase tracking-wider">点位</th>
                <th className="text-left px-2 py-2 font-medium text-gray-500 text-[10px] uppercase tracking-wider">类型</th>
                <th className="text-right px-2 py-2 font-medium text-gray-500 text-[10px] uppercase tracking-wider">实时值</th>
                <th className="text-left px-2 py-2 font-medium text-gray-500 text-[10px] uppercase tracking-wider">单位</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => {
                const rt = realtimeValues.get(tag.id)
                const engVal = rt?.eng_value
                const isLogical = tag.tag_type === 'LOGICAL'
                return (
                  <tr key={tag.id} className="border-b border-gray-100 hover:bg-white/30">
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {isLogical && (
                          <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-[#722ed1]/10 text-[#722ed1]">Σ</span>
                        )}
                        <div>
                          <div className="font-medium text-gray-800">{tag.display_name || tag.name}</div>
                          {tag.display_name && <div className="text-gray-400 text-[10px]">{tag.name}</div>}
                          {tag.source_path && <div className="text-[#13c2c2] text-[10px]">{tag.source_path}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        tag.data_type === 'FLOAT' ? 'bg-blue-100 text-blue-700' :
                        tag.data_type === 'INT' ? 'bg-purple-100 text-purple-700' :
                        tag.data_type === 'BOOL' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{tag.data_type}</span>
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono-value ${rt ? 'value-flash' : ''}`}>
                      {engVal !== null && engVal !== undefined ? (
                        <span className="text-[#389e0d] font-medium">
                          {typeof engVal === 'number' ? engVal.toFixed(3) : String(engVal)}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-gray-500">{tag.unit || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 主组件 ──
export default function NodeTreeEditor() {
  const [roots, setRoots] = useState<Node[]>([])
  const [rootId, setRootId] = useState<string>('')
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [nodeTags, setNodeTags] = useState<NodeTag[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [realtimeValues, setRealtimeValues] = useState<Map<string, TelemetryUpdate>>(new Map())
  const [refreshKey, setRefreshKey] = useState(0)
  const [createMode, setCreateMode] = useState<{ mode: 'site' | 'child' } | null>(null)
  const [actionMsg, setActionMsg] = useState('')
  const wsCleanup = useRef<(() => void) | null>(null)
  const selectedNodeRef = useRef<Node | null>(null)

  useEffect(() => {
    selectedNodeRef.current = selectedNode
  }, [selectedNode])

  // 加载所有 Site (layer 1) 作为树根候选
  useEffect(() => {
    fetchNodes().then((all) => {
      const sites = all.filter((n) => n.layer === 1)
      setRoots(sites)
      setRootId((prev) => (prev && sites.some((s) => s.id === prev) ? prev : sites[0]?.id || ''))
    })
  }, [refreshKey])

  // 加载选中根的整棵树
  useEffect(() => {
    if (!rootId) { setTree(null); return }
    setTreeLoading(true)
    fetchNodeTree(rootId)
      .then((t) => {
        setTree(t)
        if (t) {
          const ids = new Set<string>([t.id])
          for (const c of t.children || []) ids.add(c.id)
          setExpanded(ids)
        }
      })
      .catch(() => setTree(null))
      .finally(() => setTreeLoading(false))
  }, [rootId, refreshKey])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const loadTagsForNode = useCallback((nodeId: string) => {
    setTagsLoading(true)
    if (wsCleanup.current) { wsCleanup.current(); wsCleanup.current = null }
    fetchNodeDetail(nodeId)
      .then(({ tags }) => {
        setNodeTags(tags)
        const tagIds = tags.map((t) => t.id)
        if (tagIds.length > 0) {
          wsCleanup.current = connectTelemetryWS((updates) => {
            setRealtimeValues((prev) => {
              const next = new Map(prev)
              for (const u of updates) next.set(u.tag_id, u)
              return next
            })
          }, tagIds)
        }
      })
      .catch(() => setNodeTags([]))
      .finally(() => setTagsLoading(false))
  }, [])

  // 选中节点 → 拉取其点位 → 订阅 WebSocket 实时值
  const handleSelect = useCallback((n: TreeNode) => {
    setSelectedNode({
      id: n.id, name: n.name, parent_id: n.parent_id, layer: n.layer,
      node_type: n.node_type, config: n.config, sort_order: n.sort_order,
      enabled: n.enabled, tag_count: n.tag_count,
    })
    setRealtimeValues(new Map())
    loadTagsForNode(n.id)
  }, [loadTagsForNode])

  const handleNodeChanged = useCallback((patch?: Partial<Node>) => {
    if (patch) setSelectedNode((prev) => (prev ? { ...prev, ...patch } : prev))
    setRefreshKey((k) => k + 1)
    const current = selectedNodeRef.current
    if (current) loadTagsForNode(current.id)
  }, [loadTagsForNode])

  const handleNodeDeleted = useCallback(() => {
    if (wsCleanup.current) { wsCleanup.current(); wsCleanup.current = null }
    setSelectedNode(null)
    setNodeTags([])
    setRealtimeValues(new Map())
    setRefreshKey((k) => k + 1)
  }, [])

  const handleNodeCreated = useCallback((node: Node) => {
    setActionMsg(`已创建节点「${node.name}」`)
    setCreateMode(null)
    setRefreshKey((k) => k + 1)
    if (node.layer === 1) {
      setRootId(node.id)
      return
    }
    const parentId = node.parent_id
    if (parentId) {
      setExpanded((prev) => {
        const next = new Set(prev)
        next.add(parentId)
        return next
      })
    }
  }, [])

  // 卸载时清理 WS
  useEffect(() => () => { if (wsCleanup.current) wsCleanup.current() }, [])

  // 当前选中节点的实时点位数
  const tagValueCount = new Map<string, number>()
  if (selectedNode) {
    const live = nodeTags.filter((t) => {
      const rt = realtimeValues.get(t.id)
      return rt && rt.eng_value !== null && rt.eng_value !== undefined
    }).length
    if (live > 0) tagValueCount.set(selectedNode.id, live)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,420px)_1fr] gap-4">
      {/* 左：节点树 */}
      <div className="neu-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">站点:</label>
          <select
            value={rootId}
            onChange={(e) => { setRootId(e.target.value); setSelectedNode(null); setNodeTags([]); setCreateMode(null) }}
            className="neu-input px-3 py-1.5 text-xs bg-transparent flex-1"
          >
            {roots.length === 0 && <option value="">（无 Site 节点）</option>}
            {roots.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 mb-3 text-xs">
          <button onClick={() => setCreateMode({ mode: 'site' })} className="px-2 py-1 rounded-lg bg-white/60 hover:bg-white text-gray-700">+ 站点</button>
          <button
            onClick={() => setCreateMode({ mode: 'child' })}
            disabled={!selectedNode || selectedNode.layer >= 5}
            className="px-2 py-1 rounded-lg bg-[#52c41a]/10 hover:bg-[#52c41a]/20 text-[#389e0d] disabled:opacity-40"
          >
            + 子节点
          </button>
          {actionMsg && <span className="text-[10px] text-[#389e0d]">{actionMsg}</span>}
        </div>

        {createMode && (
          <CreateNodeForm
            mode={createMode.mode}
            parent={createMode.mode === 'child' ? selectedNode : null}
            onCancel={() => setCreateMode(null)}
            onCreated={handleNodeCreated}
          />
        )}

        <div className="neu-inset rounded-xl p-2 max-h-[560px] overflow-y-auto">
          {treeLoading ? (
            <div className="text-center py-8 text-xs text-gray-400">加载节点树...</div>
          ) : tree ? (
            <TreeRow
              node={tree}
              depth={0}
              selectedId={selectedNode?.id || null}
              onSelect={handleSelect}
              expanded={expanded}
              onToggle={toggle}
              tagValueCount={tagValueCount}
            />
          ) : (
            <div className="text-center py-8 text-xs text-gray-400">暂无节点树数据，可点击「+ 站点」创建</div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-gray-400">
          {Object.entries(LAYER_META).map(([layer, m]) => (
            <span key={layer} className="flex items-center gap-1">
              <span>{m.icon}</span>{m.label}
            </span>
          ))}
        </div>
      </div>

      {/* 右：点位/操作面板 */}
      <TagPanel
        node={selectedNode}
        tags={nodeTags}
        loading={tagsLoading}
        realtimeValues={realtimeValues}
        onNodeChanged={handleNodeChanged}
        onNodeDeleted={handleNodeDeleted}
      />
    </div>
  )
}
