import { useEffect, useState, useCallback, useRef } from 'react'
import {
  fetchNodes, fetchTags, fetchHealth, updateTag, connectTelemetryWS, exportTagsCsv, batchUpdateTags,
  type Node, type Tag, type HealthStatus, type TelemetryUpdate,
} from './api/client'
import TrendChart from './components/TrendChart'
import TelemetryTable from './components/TelemetryTable'
import AdminPanel from './components/AdminPanel'
import SnapshotTable from './components/SnapshotTable'
import NeuronPanel from './components/NeuronPanel'

// ── 管道状态条 ──
function PipelineBar({ health }: { health: HealthStatus | null }) {
  if (!health) return null
  const p = health.pipeline
  const isOk = p.status.toLowerCase() === 'running' && health.components.mqtt.status === 'connected'

  return (
    <div className="neu-card px-4 py-2 mb-4 flex items-center gap-6 text-xs">
      <div className="flex items-center">
        <span className={`status-dot ${isOk ? 'ok' : 'error'}`} />
        <span className="font-medium">{isOk ? 'Pipeline 运行中' : 'Pipeline 异常'}</span>
      </div>
      <div className="text-gray-500">
        消息: <span className="font-mono-value">{p.messages_received.toLocaleString()}</span>
      </div>
      <div className="text-gray-500">
        入库: <span className="font-mono-value">{p.points_written_db.toLocaleString()}</span>
      </div>
      <div className="text-gray-500">
        MQTT: <span className={health.components.mqtt.status === 'connected' ? 'text-green-600' : 'text-red-500'}>{health.components.mqtt.status}</span>
      </div>
      <div className="text-gray-500">
        最后消息: {p.last_message_at ? new Date(p.last_message_at).toLocaleTimeString() : '—'}
      </div>
      <div className="ml-auto text-gray-400">v{health.version}</div>
    </div>
  )
}

// ── 可编辑数值单元格 ──
function EditableCell({
  value, onSave, disabled, className = '',
}: {
  value: number
  onSave: (v: number) => Promise<void>
  disabled?: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState(String(value))
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select()
    }
  }, [editing])

  const handleSave = async () => {
    const num = parseFloat(editVal)
    if (isNaN(num) || num === value) {
      setEditing(false)
      setEditVal(String(value))
      return
    }
    setSaving(true)
    try {
      await onSave(num)
      setEditing(false)
    } catch {
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (disabled) {
    return <span className={`font-mono-value text-gray-500 ${className}`}>{value}</span>
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        step="any"
        value={editVal}
        onChange={(e) => setEditVal(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') { setEditing(false); setEditVal(String(value)) }
        }}
        disabled={saving}
        className="neu-input w-20 px-2 py-1 text-xs font-mono-value text-center editable-cell editing"
      />
    )
  }

  return (
    <span
      className={`editable-cell font-mono-value ${className}`}
      onClick={() => setEditing(true)}
      title="点击编辑"
    >
      {value}
    </span>
  )
}

// ── 表头排序配置 ──
const SORTABLE_COLUMNS = [
  { key: 'name', label: '点位名' },
  { key: 'data_type', label: '类型' },
  { key: 'unit', label: '单位' },
  { key: 'raw_value', label: '原始值' },
  { key: 'eng_value', label: '工程值' },
  { key: 'scale_factor', label: 'Scale' },
  { key: 'value_offset', label: 'Offset' },
] as const

// ── 主表格组件 ──
function TagsTable({ tags, onTagUpdate, realtimeValues, onShowTrend, selectedIds, onSelectionChange, sortBy, sortOrder, onSort }: {
  tags: Tag[]
  onTagUpdate: () => void
  realtimeValues: Map<string, TelemetryUpdate>
  onShowTrend: (tag: Tag) => void
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  sortBy: string
  sortOrder: 'asc' | 'desc'
  onSort: (column: string) => void
}) {
  const handleUpdateOffset = async (tagId: string, newOffset: number) => {
    await updateTag(tagId, { value_offset: newOffset })
    onTagUpdate()
  }

  const handleUpdateScale = async (tagId: string, newScale: number) => {
    await updateTag(tagId, { scale_factor: newScale })
    onTagUpdate()
  }

  const allSelected = tags.length > 0 && tags.every((t) => selectedIds.has(t.id))
  const someSelected = tags.some((t) => selectedIds.has(t.id))

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(tags.map((t) => t.id)))
    }
  }

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(next)
  }

  const SortHeader = ({ column, label, align = 'left' }: { column: string; label: string; align?: 'left' | 'right' }) => (
    <th
      className={`px-3 py-2 font-medium text-gray-500 text-[11px] uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => onSort(column)}
    >
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {sortBy === column && (
          <span className="text-[#52c41a]">{sortOrder === 'asc' ? '↑' : '↓'}</span>
        )}
      </div>
    </th>
  )

  return (
    <div className="neu-card overflow-hidden">
      <div className="table-container overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#f0f2f5] z-10">
            <tr className="border-b border-gray-200">
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                  onChange={toggleAll}
                  className="w-4 h-4 accent-[#52c41a]"
                />
              </th>
              <th className="text-left px-3 py-2 font-medium text-gray-500 text-[11px] uppercase tracking-wider">节点</th>
              <SortHeader column="name" label="点位名" />
              <SortHeader column="data_type" label="类型" />
              <SortHeader column="unit" label="单位" />
              <SortHeader column="raw_value" label="原始值" align="right" />
              <SortHeader column="eng_value" label="工程值" align="right" />
              <SortHeader column="scale_factor" label="Scale" align="right" />
              <SortHeader column="value_offset" label="Offset" align="right" />
              <th className="text-center px-3 py-2 font-medium text-gray-500 text-[11px] uppercase tracking-wider">公式</th>
            </tr>
          </thead>
          <tbody>
            {tags.map((tag) => {
              const rt = realtimeValues.get(tag.id)
              const rawVal = rt?.raw_value ?? tag.raw_value
              const engVal = rt?.eng_value ?? tag.eng_value

              return (
                <tr key={tag.id} className={`border-b border-gray-100 hover:bg-white/30 ${selectedIds.has(tag.id) ? 'bg-[#52c41a]/5' : ''}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(tag.id)}
                      onChange={() => toggleOne(tag.id)}
                      className="w-4 h-4 accent-[#52c41a]"
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-600">{tag.node_name}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onShowTrend(tag)}
                      className="text-left hover:text-[#389e0d] transition-colors"
                      title="点击查看趋势"
                    >
                      <div className="font-medium text-gray-800 underline decoration-dotted underline-offset-2 decoration-gray-300 hover:decoration-[#52c41a]">{tag.display_name || tag.name}</div>
                      <div className="text-gray-400 text-[11px]">{tag.name}</div>
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                      tag.data_type === 'FLOAT' ? 'bg-blue-100 text-blue-700' :
                      tag.data_type === 'INT' ? 'bg-purple-100 text-purple-700' :
                      tag.data_type === 'BOOL' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{tag.data_type}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{tag.unit || '—'}</td>
                  <td className={`px-3 py-2 text-right font-mono-value ${rt ? 'value-flash' : ''}`}>
                    {rawVal !== null && rawVal !== undefined ? (
                      <span className="text-gray-700">{typeof rawVal === 'number' ? rawVal.toFixed(2) : String(rawVal)}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono-value ${rt ? 'value-flash' : ''}`}>
                    {engVal !== null && engVal !== undefined ? (
                      <span className="text-[#389e0d] font-medium">{typeof engVal === 'number' ? engVal.toFixed(4) : String(engVal)}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <EditableCell
                      value={tag.scale_factor}
                      onSave={(v) => handleUpdateScale(tag.id, v)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <EditableCell
                      value={tag.value_offset}
                      onSave={(v) => handleUpdateOffset(tag.id, v)}
                    />
                  </td>
                  <td className="px-3 py-2 text-center text-[11px] text-gray-400 font-mono-value">
                    ({rawVal !== null ? (typeof rawVal === 'number' ? rawVal.toFixed(1) : '?') : '?'}
                    {tag.value_offset >= 0 ? '+' : ''}{tag.value_offset})×{tag.scale_factor}
                    ={engVal !== null ? (typeof engVal === 'number' ? engVal.toFixed(2) : '?') : '?'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 主页面 ──
export default function App() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [selectedNode, setSelectedNode] = useState<string>('')
  const [tags, setTags] = useState<Tag[]>([])
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [realtimeValues, setRealtimeValues] = useState<Map<string, TelemetryUpdate>>(new Map())
  const [loading, setLoading] = useState(false)
  const [trendTag, setTrendTag] = useState<Tag | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [dataType, setDataType] = useState('')
  const [sortBy, setSortBy] = useState('sort_order')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchScale, setBatchScale] = useState('')
  const [batchOffset, setBatchOffset] = useState('')
  const [batchSaving, setBatchSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'tags' | 'telemetry' | 'admin' | 'snapshots' | 'neuron'>('tags')
  const pageSize = 50

  // 加载节点列表
  useEffect(() => {
    fetchNodes().then((n) => {
      setNodes(n.filter((node) => node.layer >= 3)) // 只显示 Device/Tag 层
    })
  }, [])

  // 加载健康状态 (轮询)
  useEffect(() => {
    const poll = () => fetchHealth().then(setHealth).catch(() => {})
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  // 搜索/筛选防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, dataType])

  // 加载点位
  const loadTags = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchTags(
        selectedNode || undefined,
        page,
        pageSize,
        search || undefined,
        dataType || undefined,
        sortBy,
        sortOrder,
      )
      setTags(data.tags)
      setTotal(data.total)
      setTotalPages(data.total_pages || 1)
    } finally {
      setLoading(false)
    }
  }, [selectedNode, page, search, dataType, sortBy, sortOrder])

  useEffect(() => { loadTags() }, [loadTags])

  // WebSocket 实时值
  useEffect(() => {
    const tagIds = tags.map((t) => t.id)
    if (tagIds.length === 0) return

    const cleanup = connectTelemetryWS((updates) => {
      setRealtimeValues((prev) => {
        const next = new Map(prev)
        for (const u of updates) {
          next.set(u.tag_id, u)
        }
        return next
      })
    }, tagIds)

    return cleanup
  }, [tags])

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('asc')
    }
  }

  const handleBatchApply = async () => {
    const scale = batchScale ? parseFloat(batchScale) : undefined
    const offset = batchOffset ? parseFloat(batchOffset) : undefined
    if (scale === undefined && offset === undefined) {
      alert('请至少填写 Scale 或 Offset')
      return
    }
    setBatchSaving(true)
    try {
      await batchUpdateTags(Array.from(selectedIds), { scale_factor: scale, value_offset: offset })
      setSelectedIds(new Set())
      setBatchScale('')
      setBatchOffset('')
      loadTags()
    } catch {
      alert('批量更新失败')
    } finally {
      setBatchSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5] p-6">
      <div className="max-w-[1600px] mx-auto">
        {/* 页面标题 + Tab 切换 */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-800">OmniThings F0</h1>
            <p className="text-xs text-gray-500 mt-0.5">Neuron → NanoMQ → FastAPI → TimescaleDB</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('tags')}
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                activeTab === 'tags' ? 'bg-[#52c41a] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              点位管理
            </button>
            <button
              onClick={() => setActiveTab('telemetry')}
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                activeTab === 'telemetry' ? 'bg-[#52c41a] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              数据表查询
            </button>
            <button
              onClick={() => setActiveTab('snapshots')}
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                activeTab === 'snapshots' ? 'bg-[#52c41a] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              节点快照
            </button>
            <button
              onClick={() => setActiveTab('neuron')}
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                activeTab === 'neuron' ? 'bg-[#52c41a] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              采集管理
            </button>
            <button
              onClick={() => setActiveTab('admin')}
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                activeTab === 'admin' ? 'bg-[#52c41a] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              开发者工具
            </button>
          </div>
        </div>

        {/* 管道状态条 */}
        <PipelineBar health={health} />

        {/* Tab 内容 */}
        {activeTab === 'tags' ? (
          <>
            {/* 工具栏 */}
        <div className="neu-card p-4 mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600 whitespace-nowrap">节点:</label>
            <select
              value={selectedNode}
              onChange={(e) => { setSelectedNode(e.target.value); setPage(1) }}
              className="neu-input px-3 py-1.5 text-xs bg-transparent min-w-[160px]"
            >
              <option value="">全部节点</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.tag_count})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600 whitespace-nowrap">类型:</label>
            <select
              value={dataType}
              onChange={(e) => { setDataType(e.target.value); setPage(1) }}
              className="neu-input px-3 py-1.5 text-xs bg-transparent min-w-[100px]"
            >
              <option value="">全部</option>
              <option value="FLOAT">FLOAT</option>
              <option value="INT">INT</option>
              <option value="BOOL">BOOL</option>
              <option value="STRING">STRING</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600 whitespace-nowrap">搜索:</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="点位名 / 显示名..."
              className="neu-input px-3 py-1.5 text-xs bg-transparent min-w-[160px]"
            />
          </div>

          <button
            onClick={loadTags}
            disabled={loading}
            className="neu-btn px-4 py-1.5 text-xs font-medium text-[#389e0d] disabled:opacity-50"
          >
            {loading ? '加载中...' : '刷新'}
          </button>

          <button
            onClick={() => exportTagsCsv(selectedNode || undefined, search || undefined)}
            className="neu-btn px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-[#389e0d]"
          >
            导出 CSV
          </button>

          <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
            <span>共 {total} 个点位</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="neu-btn w-7 h-7 flex items-center justify-center disabled:opacity-30"
              >
                ‹
              </button>
              <span className="px-2 font-mono">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="neu-btn w-7 h-7 flex items-center justify-center disabled:opacity-30"
              >
                ›
              </button>
            </div>
          </div>
        </div>

        {/* 批量编辑面板 */}
        {selectedIds.size > 0 && (
          <div className="neu-card p-4 mb-4 flex flex-wrap items-center gap-4 bg-[#52c41a]/5 border border-[#52c41a]/20">
            <span className="text-xs font-medium text-gray-700">
              已选 <span className="text-[#389e0d] font-bold">{selectedIds.size}</span> 个点位
            </span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">Scale:</label>
              <input
                type="number"
                step="any"
                value={batchScale}
                onChange={(e) => setBatchScale(e.target.value)}
                placeholder="统一 Scale"
                className="neu-input px-2 py-1 text-xs w-24"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">Offset:</label>
              <input
                type="number"
                step="any"
                value={batchOffset}
                onChange={(e) => setBatchOffset(e.target.value)}
                placeholder="统一 Offset"
                className="neu-input px-2 py-1 text-xs w-24"
              />
            </div>
            <button
              onClick={handleBatchApply}
              disabled={batchSaving}
              className="neu-btn px-4 py-1.5 text-xs font-medium text-white bg-[#52c41a] hover:bg-[#389e0d] disabled:opacity-50"
            >
              {batchSaving ? '应用中...' : '批量应用'}
            </button>
            <button
              onClick={() => { setSelectedIds(new Set()); setBatchScale(''); setBatchOffset('') }}
              className="neu-btn px-3 py-1.5 text-xs text-gray-500"
            >
              取消选择
            </button>
          </div>
        )}

        {/* 点位表格 */}
        <TagsTable
          tags={tags}
          onTagUpdate={loadTags}
          realtimeValues={realtimeValues}
          onShowTrend={setTrendTag}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
        />

        {/* 趋势图弹窗 */}
        {trendTag && (
          <TrendChart
            tagId={trendTag.id}
            tagName={trendTag.display_name || trendTag.name}
            unit={trendTag.unit}
            onClose={() => setTrendTag(null)}
          />
        )}

        {/* 底部信息 */}
        <div className="mt-4 text-center text-[11px] text-gray-400">
          <p>点击 Scale / Offset 列可直接编辑 · 修改后工程值自动重算 · WebSocket 实时推送最新值</p>
        </div>
          </>
        ) : activeTab === 'telemetry' ? (
          <TelemetryTable />
        ) : activeTab === 'snapshots' ? (
          <SnapshotTable />
        ) : activeTab === 'neuron' ? (
          <NeuronPanel />
        ) : (
          <AdminPanel />
        )}
      </div>
    </div>
  )
}
