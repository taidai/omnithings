import React, { useEffect, useState, useCallback } from 'react'
import {
  fetchNodes, fetchTags, fetchTelemetry, fetchSnapshots,
  exportTelemetryCsv, exportSnapshotsCsv,
  type Node, type Tag, type TelemetryPoint, type SnapshotPoint,
} from '../api/client'

type TableType = 't_telemetry' | 't_node_snapshot'
type TimeRange = '1h' | '24h' | '7d' | 'all'

const PAGE_SIZE = 20

export default function DataBrowser() {
  // 级联选择状态
  const [table, setTable] = useState<TableType>('t_telemetry')
  const [nodes, setNodes] = useState<Node[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedNode, setSelectedNode] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [range, setRange] = useState<TimeRange>('1h')

  // 结果状态
  const [telemetryRows, setTelemetryRows] = useState<TelemetryPoint[]>([])
  const [snapshotRows, setSnapshotRows] = useState<SnapshotPoint[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // 初始化：加载节点列表
  useEffect(() => {
    fetchNodes().then(setNodes).catch(() => {})
  }, [])

  // 级联：节点变化 → 加载该节点点位
  useEffect(() => {
    setSelectedTag('')
    setTags([])
    if (!selectedNode || table !== 't_telemetry') return
    fetchTags(selectedNode, 1, 500)
      .then((r) => setTags(r.tags))
      .catch(() => {})
  }, [selectedNode, table])

  // 查询数据
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      if (table === 't_telemetry') {
        const r = await fetchTelemetry(
          selectedTag || undefined,
          range,
          page,
          PAGE_SIZE,
          selectedNode || undefined,
        )
        setTelemetryRows(r.points)
        setTotal(r.total)
        setTotalPages(r.total_pages)
      } else {
        const r = await fetchSnapshots(selectedNode || undefined, range, page, PAGE_SIZE)
        setSnapshotRows(r.snapshots)
        setTotal(r.total)
        setTotalPages(r.total_pages)
      }
    } catch {
      setTelemetryRows([])
      setSnapshotRows([])
      setTotal(0)
      setTotalPages(0)
    } finally {
      setLoading(false)
    }
  }, [table, selectedNode, selectedTag, range, page])

  // 筛选变化 → 重置页码
 useEffect(() => {
   setPage(1)
 }, [table, selectedNode, selectedTag, range])


 const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleExport = () => {
    if (table === 't_telemetry') {
      exportTelemetryCsv(selectedTag || undefined, range, selectedNode || undefined)
    } else {
      exportSnapshotsCsv(selectedNode || undefined, range)
    }
  }

  return (
    <div className="neu-card p-4">
      <h3 className="text-sm font-bold text-gray-800 mb-3">级联数据查询</h3>

      {/* 第一行：数据表切换 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-gray-600">数据表:</span>
        <button
          onClick={() => setTable('t_telemetry')}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            table === 't_telemetry'
              ? 'bg-[#52c41a] text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          t_telemetry (遥测数据)
        </button>
        <button
          onClick={() => setTable('t_node_snapshot')}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            table === 't_node_snapshot'
              ? 'bg-[#52c41a] text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          t_node_snapshot (节点快照)
        </button>
      </div>

      {/* 第二行：级联筛选 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-gray-600">节点:</span>
        <select
          value={selectedNode}
          onChange={(e) => setSelectedNode(e.target.value)}
          className="neu-input px-2 py-1 text-xs bg-transparent min-w-[120px]"
        >
          <option value="">全部节点</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} ({n.tag_count})
            </option>
          ))}
        </select>

        {table === 't_telemetry' && (
          <>
            <span className="text-xs text-gray-400">→</span>
            <span className="text-xs text-gray-600">点位:</span>
            <select
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
              disabled={!selectedNode}
              className="neu-input px-2 py-1 text-xs bg-transparent min-w-[140px] disabled:opacity-50"
            >
              <option value="">全部点位</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name || t.name}
                </option>
              ))}
            </select>
          </>
        )}

        <span className="text-xs text-gray-400">→</span>
        <span className="text-xs text-gray-600">时间:</span>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as TimeRange)}
          className="neu-input px-2 py-1 text-xs bg-transparent"
        >
          <option value="1h">最近 1 小时</option>
          <option value="24h">最近 24 小时</option>
          <option value="7d">最近 7 天</option>
          <option value="all">全部</option>
        </select>

        <button
          onClick={loadData}
          disabled={loading}
          className="neu-btn px-3 py-1 text-xs font-medium text-gray-600 hover:text-[#389e0d] disabled:opacity-50"
        >
          {loading ? '查询中...' : '↻ 刷新'}
        </button>
        <button
          onClick={handleExport}
          className="neu-btn px-3 py-1 text-xs font-medium text-gray-600 hover:text-[#389e0d]"
        >
          导出 CSV
        </button>
      </div>

      {/* 结果表格 */}
      <div className="neu-inset p-2 rounded-xl">
        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
          {table === 't_telemetry' ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#f0f0f0]">
                <tr className="border-b border-gray-200">
                  <th className="text-left px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wider">时间</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wider">节点</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wider">点位</th>
                  <th className="text-right px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wider">原始值</th>
                  <th className="text-right px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wider">工程值</th>
                  <th className="text-center px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wider">Quality</th>
                </tr>
              </thead>
              <tbody>
                {telemetryRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-gray-400 text-xs">
                      {loading ? '查询中...' : '暂无数据'}
                    </td>
                  </tr>
                ) : (
                  telemetryRows.map((p, i) => (
                    <tr key={`${p.tag_id}-${p.ts}-${i}`} className="border-b border-gray-100 hover:bg-white/30">
                      <td className="px-2 py-1.5 text-gray-700 font-mono text-[11px]">
                        {new Date(p.ts).toLocaleString('zh-CN', { hour12: false })}
                      </td>
                      <td className="px-2 py-1.5 text-gray-700">{p.node_name}</td>
                      <td className="px-2 py-1.5 text-gray-700">{p.tag_name}</td>
                      <td className="px-2 py-1.5 text-right text-gray-700 font-mono">
                        {p.raw_value !== null ? p.raw_value.toFixed(2) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right text-[#389e0d] font-mono font-medium">
                        {p.eng_value !== null ? p.eng_value.toFixed(2) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                            p.quality === 192
                              ? 'bg-green-100 text-green-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {p.quality ?? '—'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#f0f0f0]">
                <tr className="border-b border-gray-200">
                  <th className="text-left px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wider">时间</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wider">节点</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wider">数据预览</th>
                  <th className="text-center px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wider">Quality</th>
                </tr>
              </thead>
              <tbody>
                {snapshotRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-gray-400 text-xs">
                      {loading ? '查询中...' : '暂无数据'}
                    </td>
                  </tr>
                ) : (
                  snapshotRows.map((s) => {
                    const key = `${s.node_id}-${s.ts}`
                    const isExpanded = expandedRows.has(key)
                    const entries = Object.entries(s.data || {})
                    const preview = entries.slice(0, 3)
                    return (
                      <React.Fragment key={key}>
                        <tr
                          onClick={() => toggleRow(key)}
                          className="border-b border-gray-100 hover:bg-white/30 cursor-pointer"
                        >
                          <td className="px-2 py-1.5 text-gray-700 font-mono text-[11px]">
                            {isExpanded ? '▼ ' : '▶ '}
                            {new Date(s.ts).toLocaleString('zh-CN', { hour12: false })}
                          </td>
                          <td className="px-2 py-1.5 text-gray-700">{s.node_name}</td>
                          <td className="px-2 py-1.5 text-gray-500 font-mono text-[11px]">
                            {preview.map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`).join(', ')}
                            {entries.length > 3 && ` ... (+${entries.length - 3})`}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                                s.quality === 192
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-yellow-100 text-yellow-700'
                              }`}
                            >
                              {s.quality ?? '—'}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-gray-100 bg-white/20">
                            <td colSpan={4} className="px-4 py-2">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">工程值</div>
                                  <pre className="text-[11px] font-mono text-gray-700 whitespace-pre-wrap">
                                    {JSON.stringify(s.data, null, 2)}
                                  </pre>
                                </div>
                                <div>
                                  <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">原始值</div>
                                  <pre className="text-[11px] font-mono text-gray-500 whitespace-pre-wrap">
                                    {JSON.stringify(s.raw_data, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 分页栏 */}
      <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
        <span>
          共 {total} 条 · 第 {page}/{totalPages || 1} 页
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="neu-btn px-3 py-1 text-xs font-medium text-gray-600 hover:text-[#389e0d] disabled:opacity-40"
          >
            ← 上一页
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="neu-btn px-3 py-1 text-xs font-medium text-gray-600 hover:text-[#389e0d] disabled:opacity-40"
          >
            下一页 →
          </button>
        </div>
      </div>
    </div>
  )
}
