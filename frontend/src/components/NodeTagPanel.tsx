import { useCallback, useEffect, useState } from 'react'
import {
  fetchTags, updateTag, batchUpdateTags, connectTelemetryWS,
  type Tag, type TelemetryUpdate,
} from '../api/client'
import EditableCell from './EditableCell'
import TrendChart from './TrendChart'

const SORTABLE_COLUMNS = [
  { key: 'name', label: '点位名' },
  { key: 'data_type', label: '类型' },
  { key: 'unit', label: '单位' },
  { key: 'raw_value', label: '原始值' },
  { key: 'eng_value', label: '工程值' },
  { key: 'scale_factor', label: 'Scale' },
  { key: 'value_offset', label: 'Offset' },
] as const

interface NodeTagPanelProps {
  nodeId: string
}

export default function NodeTagPanel({ nodeId }: NodeTagPanelProps) {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [dataType, setDataType] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [sortBy, setSortBy] = useState('sort_order')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [realtimeValues, setRealtimeValues] = useState<Map<string, TelemetryUpdate>>(new Map())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchScale, setBatchScale] = useState('')
  const [batchOffset, setBatchOffset] = useState('')
  const [batchSaving, setBatchSaving] = useState(false)
  const [trendTag, setTrendTag] = useState<Tag | null>(null)
  const pageSize = 50

  const loadTags = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchTags(
        nodeId,
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
  }, [nodeId, page, search, dataType, sortBy, sortOrder])

  useEffect(() => {
    setPage(1)
  }, [nodeId, search, dataType])

  useEffect(() => {
    loadTags()
  }, [loadTags])

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

  const handleUpdateScale = async (tagId: string, v: number) => {
    await updateTag(tagId, { scale_factor: v })
    loadTags()
  }

  const handleUpdateOffset = async (tagId: string, v: number) => {
    await updateTag(tagId, { value_offset: v })
    loadTags()
  }

  const toggleAll = () => {
    if (tags.length > 0 && tags.every((t) => selectedIds.has(t.id))) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(tags.map((t) => t.id)))
    }
  }

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
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

  const allSelected = tags.length > 0 && tags.every((t) => selectedIds.has(t.id))
  const someSelected = tags.some((t) => selectedIds.has(t.id))

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">类型:</label>
          <select
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
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

      {/* 批量编辑 */}
      {selectedIds.size > 0 && (
        <div className="neu-card p-3 flex flex-wrap items-center gap-4 bg-[#52c41a]/5 border border-[#52c41a]/20">
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

      {/* 表格 */}
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
                {SORTABLE_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-2 font-medium text-gray-500 text-[11px] uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 ${
                      ['raw_value', 'eng_value', 'scale_factor', 'value_offset'].includes(col.key) ? 'text-right' : 'text-left'
                    }`}
                    onClick={() => handleSort(col.key)}
                  >
                    <div className={`flex items-center gap-1 ${['raw_value', 'eng_value', 'scale_factor', 'value_offset'].includes(col.key) ? 'justify-end' : ''}`}>
                      {col.label}
                      {sortBy === col.key && (
                        <span className="text-[#52c41a]">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="text-center px-3 py-2 font-medium text-gray-500 text-[11px] uppercase tracking-wider">公式</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => {
                const rt = realtimeValues.get(tag.id)
                const rawVal = rt?.raw_value ?? tag.raw_value
                const engVal = rt?.eng_value ?? tag.eng_value

                return (
                  <tr
                    key={tag.id}
                    className={`border-b border-gray-100 hover:bg-white/30 ${selectedIds.has(tag.id) ? 'bg-[#52c41a]/5' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(tag.id)}
                        onChange={() => toggleOne(tag.id)}
                        className="w-4 h-4 accent-[#52c41a]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setTrendTag(tag)}
                        className="text-left hover:text-[#389e0d] transition-colors"
                        title="点击查看趋势"
                      >
                        <div className="font-medium text-gray-800 underline decoration-dotted underline-offset-2 decoration-gray-300 hover:decoration-[#52c41a]">
                          {tag.display_name || tag.name}
                        </div>
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
                      <EditableCell value={tag.scale_factor} onSave={(v) => handleUpdateScale(tag.id, v)} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <EditableCell value={tag.value_offset} onSave={(v) => handleUpdateOffset(tag.id, v)} />
                    </td>
                    <td className="px-3 py-2 text-center text-[11px] text-gray-400 font-mono-value">
                      ({rawVal !== null ? (typeof rawVal === 'number' ? rawVal.toFixed(1) : '?') : '?'}
                      {tag.value_offset >= 0 ? '+' : ''}{tag.value_offset})×{tag.scale_factor}
                      ={engVal !== null ? (typeof engVal === 'number' ? engVal.toFixed(2) : '?') : '?'}
                    </td>
                  </tr>
                )
              })}
              {tags.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-gray-400">
                    该节点下暂无点位
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {trendTag && (
        <TrendChart
          tagId={trendTag.id}
          tagName={trendTag.display_name || trendTag.name}
          unit={trendTag.unit}
          onClose={() => setTrendTag(null)}
        />
      )}
    </div>
  )
}
