/**
 * NodeRealtimePanel — 实时数据面板
 * 显示选中节点下所有点位的实时值，通过 WebSocket 自动更新。
 */
import { useCallback, useEffect, useState } from 'react'
import { fetchTags, connectTelemetryWS, type Tag, type TelemetryUpdate } from '../api/client'

interface NodeRealtimePanelProps {
  nodeId: string
}

export default function NodeRealtimePanel({ nodeId }: NodeRealtimePanelProps) {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(false)
  const [realtimeValues, setRealtimeValues] = useState<Map<string, TelemetryUpdate>>(new Map())

  const loadTags = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchTags(nodeId, 1, 200, undefined, undefined, undefined, undefined, undefined)
      setTags(data.tags)
    } finally {
      setLoading(false)
    }
  }, [nodeId])

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

  const formatTs = (ts: string | null) => {
    if (!ts) return '—'
    const d = new Date(ts)
    const now = new Date()
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000)
    if (diffSec < 60) return '刚刚'
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`
    return d.toLocaleString('zh-CN')
  }

  const isOnline = (tag: Tag, rt?: TelemetryUpdate) => {
    const q = rt?.quality ?? tag.quality
    if (q === undefined || q === null) return false
    return q >= 192
  }

  const getValue = (tag: Tag, rt?: TelemetryUpdate) => {
    const raw = rt?.raw_value ?? tag.raw_value
    const eng = rt?.eng_value ?? tag.eng_value
    return { raw, eng }
  }

  const formatValue = (val: number | null | undefined, dataType: string) => {
    if (val === null || val === undefined) return '—'
    if (typeof val === 'boolean') return val ? 'ON' : 'OFF'
    if (typeof val === 'number') {
      if (dataType === 'INT') return Math.round(val).toString()
      return val.toFixed(2)
    }
    return String(val)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">共 {tags.length} 个点位</span>
        <button
          onClick={loadTags}
          disabled={loading}
          className="neu-btn px-3 py-1.5 text-xs font-medium text-[#389e0d] disabled:opacity-50"
        >
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {tags.map((tag) => {
          const rt = realtimeValues.get(tag.id)
          const { raw, eng } = getValue(tag, rt)
          const online = isOnline(tag, rt)
          const displayVal = eng ?? raw
          const isFlash = rt !== undefined

          return (
            <div
              key={tag.id}
              className={`neu-card p-3 relative overflow-hidden transition-all ${
                isFlash ? 'ring-2 ring-[#52c41a]/30' : ''
              }`}
            >
              {/* Quality indicator dot */}
              <div className="flex items-center gap-1.5 mb-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-gray-300'}`}
                  title={online ? '在线' : '离线'}
                />
                <span className="text-[11px] text-gray-500 truncate flex-1">
                  {tag.display_name || tag.name}
                </span>
                <span className={`text-[9px] px-1 rounded ${
                  tag.tag_type === 'PHYSICAL' ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-100 text-indigo-600'
                }`}>
                  {tag.tag_type === 'PHYSICAL' ? 'P' : 'V'}
                </span>
              </div>

              {/* Value */}
              <div className={`text-2xl font-bold font-mono-value ${online ? 'text-gray-800' : 'text-gray-300'} ${isFlash ? 'text-[#389e0d]' : ''}`}>
                {formatValue(displayVal, tag.data_type)}
              </div>

              {/* Unit */}
              <div className="text-[11px] text-gray-400 mt-0.5">
                {tag.unit || '—'} <span className="ml-1 text-gray-300">({tag.data_type})</span>
              </div>

              {/* Last update */}
              <div className="text-[10px] text-gray-400 mt-1">
                {formatTs(rt?.ts ?? tag.latest_ts)}
              </div>

              {/* Tag name (technical) */}
              <div className="text-[10px] text-gray-300 mt-1 truncate font-mono">
                {tag.name}
              </div>
            </div>
          )
        })}
        {tags.length === 0 && !loading && (
          <div className="col-span-full text-center text-gray-400 text-xs py-8">
            该节点下暂无点位
          </div>
        )}
      </div>
    </div>
  )
}