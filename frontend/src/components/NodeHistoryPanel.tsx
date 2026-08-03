/**
 * NodeHistoryPanel — 历史数据面板
 * 显示选中节点下点位的趋势图，支持多点位对比和时间范围选择。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { fetchTags, fetchTagHistory, type Tag, type HistoryPoint } from '../api/client'

interface NodeHistoryPanelProps {
  nodeId: string
}

type RangeOption = '1h' | '24h' | '7d'

const RANGE_OPTIONS: { key: RangeOption; label: string }[] = [
  { key: '1h', label: '1小时' },
  { key: '24h', label: '24小时' },
  { key: '7d', label: '7天' },
]

// Distinct colors for multi-series chart
const SERIES_COLORS = [
  '#52c41a', '#1890ff', '#fa8c16', '#eb2f96',
  '#722ed1', '#13c2c2', '#faad14', '#f5222d',
]

export default function NodeHistoryPanel({ nodeId }: NodeHistoryPanelProps) {
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [range, setRange] = useState<RangeOption>('1h')
  const [loading, setLoading] = useState(false)
  const [historyData, setHistoryData] = useState<Map<string, HistoryPoint[]>>(new Map())
  const chartRef = useRef<ReactECharts>(null)

  const loadTags = useCallback(async () => {
    try {
      const data = await fetchTags(nodeId, 1, 200, undefined, undefined, undefined, undefined, true)
      // Only show tags that have numeric data (FLOAT/INT)
      const numericTags = data.tags.filter((t) => t.data_type === 'FLOAT' || t.data_type === 'INT')
      setTags(numericTags)
      // Auto-select first 3 tags
      if (numericTags.length > 0 && selectedTagIds.size === 0) {
        setSelectedTagIds(new Set(numericTags.slice(0, 3).map((t) => t.id)))
      }
    } catch {
      setTags([])
    }
  }, [nodeId])

  useEffect(() => {
    loadTags()
    // Reset selection when node changes
    setSelectedTagIds(new Set())
  }, [nodeId])

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (next.size >= 8) return prev // Max 8 series
        next.add(id)
      }
      return next
    })
  }

  // Fetch history for all selected tags when range or selection changes
  useEffect(() => {
    if (selectedTagIds.size === 0) {
      setHistoryData(new Map())
      return
    }

    setLoading(true)
    const promises = Array.from(selectedTagIds).map(async (tagId) => {
      try {
        const data = await fetchTagHistory(tagId, range)
        return { tagId, points: data.points }
      } catch {
        return { tagId, points: [] }
      }
    })

    Promise.all(promises).then((results) => {
      const map = new Map<string, HistoryPoint[]>()
      for (const r of results) {
        map.set(r.tagId, r.points)
      }
      setHistoryData(map)
      setLoading(false)
    })
  }, [selectedTagIds, range])

  const buildChartOption = () => {
    const selectedTags = tags.filter((t) => selectedTagIds.has(t.id))
    const series = selectedTags.map((tag, idx) => {
      const points = historyData.get(tag.id) || []
      return {
        name: tag.display_name || tag.name,
        type: 'line' as const,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: SERIES_COLORS[idx % SERIES_COLORS.length], width: 2 },
        areaStyle: idx === 0 ? {
          color: {
            type: 'linear' as const,
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: SERIES_COLORS[idx % SERIES_COLORS.length] + '30' },
              { offset: 1, color: SERIES_COLORS[idx % SERIES_COLORS.length] + '02' },
            ],
          },
        } : undefined,
        data: points.map((p) => [p.ts, p.eng_value]),
      }
    })

    return {
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 60, right: 30, top: 50, bottom: 30 },
      legend: {
        show: selectedTags.length > 1,
        top: 5,
        textStyle: { fontSize: 11, color: '#666' },
        data: selectedTags.map((t) => t.display_name || t.name),
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderColor: '#d1d9e6',
        textStyle: { color: '#333', fontSize: 12 },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#d1d9e6' } },
        axisLabel: { color: '#666', fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: '#666', fontSize: 11 },
        splitLine: { lineStyle: { color: '#e8ecf1', type: 'dashed' } },
      },
      series,
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                range === opt.key
                  ? 'bg-[#52c41a] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500">
          已选 {selectedTagIds.size}/8 个点位
        </span>
      </div>

      {/* Tag selector */}
      <div className="neu-card p-3">
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const isSelected = selectedTagIds.has(tag.id)
            const tagIdx = tags.filter((t) => selectedTagIds.has(t.id)).indexOf(tag)
            return (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-all ${
                  isSelected
                    ? 'text-white border-transparent'
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300'
                }`}
                style={isSelected ? { backgroundColor: SERIES_COLORS[tagIdx >= 0 ? tagIdx % SERIES_COLORS.length : 0] } : {}}
              >
                {tag.display_name || tag.name}
                {tag.unit ? ` (${tag.unit})` : ''}
              </button>
            )
          })}
          {tags.length === 0 && (
            <span className="text-xs text-gray-400 py-2">该节点下无数值型点位</span>
          )}
        </div>
      </div>

      {/* Chart */}
      {selectedTagIds.size > 0 ? (
        <div className="neu-card p-4">
          {loading ? (
            <div className="h-[400px] flex items-center justify-center text-gray-400 text-sm">
              加载中...
            </div>
          ) : (
            <ReactECharts
              ref={chartRef}
              option={buildChartOption()}
              style={{ height: '400px', width: '100%' }}
              notMerge
            />
          )}
        </div>
      ) : (
        <div className="neu-card p-8 text-center text-gray-400 text-sm">
          请选择至少一个点位查看历史趋势
        </div>
      )}
    </div>
  )
}