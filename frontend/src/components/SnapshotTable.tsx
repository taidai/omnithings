import React, { useEffect, useState, useCallback } from 'react'
import {
  fetchNodes, fetchSnapshots, exportSnapshotsCsv,
  type Node, type SnapshotPoint,
} from '../api/client'

export default function SnapshotTable() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [selectedNode, setSelectedNode] = useState('')
  const [range, setRange] = useState<'1h' | '24h' | '7d' | 'all'>('1h')
  const [snapshots, setSnapshots] = useState<SnapshotPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const pageSize = 50

  useEffect(() => {
    fetchNodes().then((n) => setNodes(n.filter((node) => node.layer >= 3)))
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchSnapshots(selectedNode || undefined, range, page, pageSize)
      setSnapshots(data.snapshots)
      setTotal(data.total)
      setTotalPages(data.total_pages || 1)
    } finally {
      setLoading(false)
    }
  }, [selectedNode, range, page])

  useEffect(() => { loadData() }, [loadData])

  const toggleExpand = (key: string) => {
    const next = new Set(expandedRows)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedRows(next)
  }

  const formatDataPreview = (data: Record<string, any>) => {
    const keys = Object.keys(data || {})
    if (keys.length === 0) return '—'
    const preview = keys.slice(0, 3).map((k) => `${k}: ${formatValue(data[k])}`).join(', ')
    return keys.length > 3 ? `${preview} ... (+${keys.length - 3})` : preview
  }

  const formatValue = (v: any) => {
    if (v === null || v === undefined) return '—'
    if (typeof v === 'number') return v.toFixed(2)
    return String(v)
  }

  return (
    <div>
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
              <option key={n.id} value={n.id}>{n.name} ({n.tag_count})</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">时间:</label>
          {(['1h', '24h', '7d', 'all'] as const).map((r) => (
            <button
              key={r}
              onClick={() => { setRange(r); setPage(1) }}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                range === r ? 'bg-[#52c41a] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {r === '1h' ? '1小时' : r === '24h' ? '24小时' : r === '7d' ? '7天' : '全部'}
            </button>
          ))}
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="neu-btn px-4 py-1.5 text-xs font-medium text-[#389e0d] disabled:opacity-50"
        >
          {loading ? '加载中...' : '刷新'}
        </button>

        <button
          onClick={() => exportSnapshotsCsv(selectedNode || undefined, range)}
          className="neu-btn px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-[#389e0d]"
        >
          导出 CSV
        </button>

        <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
          <span>共 {total} 条{snapshots.length !== total ? ` / 本页去重后 ${snapshots.length} 条` : ''}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="neu-btn w-7 h-7 flex items-center justify-center disabled:opacity-30"
            >
              ‹
            </button>
            <span className="px-2 font-mono">{page} / {totalPages}</span>
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

      {/* 快照表 */}
      <div className="neu-card overflow-hidden">
        <div className="table-container overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#f0f0f0] z-10">
              <tr className="border-b border-gray-200">
                <th className="text-left px-3 py-2 font-medium text-gray-500 text-[11px] uppercase tracking-wider w-8"></th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 text-[11px] uppercase tracking-wider">时间</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 text-[11px] uppercase tracking-wider">节点</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 text-[11px] uppercase tracking-wider">数据预览</th>
                <th className="text-center px-3 py-2 font-medium text-gray-500 text-[11px] uppercase tracking-wider">Quality</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => {
                const key = `${s.node_id}-${s.ts}`
                const isExpanded = expandedRows.has(key)
                return (
                  <React.Fragment key={key}>
                    <tr
                      key={key}
                      className="border-b border-gray-100 hover:bg-white/30 cursor-pointer"
                      onClick={() => toggleExpand(key)}
                    >
                      <td className="px-3 py-2 text-gray-400">
                        {isExpanded ? '▼' : '▶'}
                      </td>
                      <td className="px-3 py-2 text-gray-600 font-mono text-[11px]">
                        {new Date(s.ts).toLocaleString('zh-CN', { hour12: false })}
                      </td>
                      <td className="px-3 py-2 text-gray-800 font-medium">{s.node_name}</td>
                      <td className="px-3 py-2 text-gray-600 font-mono text-[11px] truncate max-w-[300px]">
                        {formatDataPreview(s.data)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                          s.quality === 192 ? 'bg-green-100 text-green-700' :
                          s.quality === 0 ? 'bg-gray-100 text-gray-600' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {s.quality === 192 ? 'GOOD' : s.quality === 0 ? 'BAD' : s.quality ?? '—'}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-gray-50/50">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <h4 className="text-[11px] font-bold text-gray-600 mb-2 uppercase">工程值 (data)</h4>
                              <pre className="text-[11px] font-mono text-gray-700 bg-white p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto">
                                {JSON.stringify(s.data, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <h4 className="text-[11px] font-bold text-gray-600 mb-2 uppercase">原始值 (raw_data)</h4>
                              <pre className="text-[11px] font-mono text-gray-700 bg-white p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto">
                                {JSON.stringify(s.raw_data, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
              {snapshots.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                    暂无快照数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
