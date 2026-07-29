import { useEffect, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { fetchTagHistory, type HistoryPoint } from '../api/client'

interface TrendChartProps {
  tagId: string
  tagName: string
  unit: string | null
  onClose: () => void
}

type RangeOption = '1h' | '24h' | '7d'

export default function TrendChart({ tagId, tagName, unit, onClose }: TrendChartProps) {
  const [range, setRange] = useState<RangeOption>('1h')
  const [points, setPoints] = useState<HistoryPoint[]>([])
  const [loading, setLoading] = useState(false)
  const chartRef = useRef<ReactECharts>(null)

  useEffect(() => {
    setLoading(true)
    fetchTagHistory(tagId, range)
      .then((data) => {
        setPoints(data.points)
      })
      .catch((err) => {
        console.error('[TrendChart] fetch failed:', err)
        setPoints([])
      })
      .finally(() => setLoading(false))
  }, [tagId, range])

  const option = {
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.95)',
      borderColor: '#d1d9e6',
      textStyle: { color: '#333', fontSize: 12 },
      formatter: (params: any) => {
        const p = params[0]
        const d = new Date(p.axisValue)
        return `<div style="font-family:monospace">${d.toLocaleString()}</div>
          <div style="color:#389e0d;font-weight:bold">${p.seriesName}: ${p.data ?? '—'} ${unit || ''}</div>`
      },
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: '#d1d9e6' } },
      axisLabel: { color: '#666', fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: unit || '',
      nameTextStyle: { color: '#888', fontSize: 11 },
      axisLine: { show: false },
      axisLabel: { color: '#666', fontSize: 11 },
      splitLine: { lineStyle: { color: '#e8ecf1', type: 'dashed' } },
    },
    series: [
      {
        name: tagName,
        type: 'line',
        showSymbol: false,
        smooth: true,
        lineStyle: { color: '#52c41a', width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(82,196,26,0.25)' },
              { offset: 1, color: 'rgba(82,196,26,0.02)' },
            ],
          },
        },
        data: points.map((p) => [p.ts, p.eng_value]),
      },
    ],
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="neu-card w-full max-w-4xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div>
            <h3 className="text-sm font-bold text-gray-800">{tagName}</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">历史趋势</p>
          </div>
          <div className="flex items-center gap-2">
            {(['1h', '24h', '7d'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                  range === r
                    ? 'bg-[#52c41a] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {r === '1h' ? '1小时' : r === '24h' ? '24小时' : '7天'}
              </button>
            ))}
            <button
              onClick={onClose}
              className="ml-2 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
        </div>

        {/* 图表区 */}
        <div className="flex-1 min-h-[400px] p-4">
          {loading ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">加载中...</div>
          ) : points.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">暂无数据</div>
          ) : (
            <ReactECharts ref={chartRef} option={option} style={{ height: '100%', width: '100%' }} />
          )}
        </div>

        {/* 底部统计 */}
        <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-6 text-[11px] text-gray-500">
          <span>共 {points.length} 个点</span>
          {points.length > 0 && (
            <>
              <span>
                最新: <span className="text-[#389e0d] font-mono">{points[points.length - 1]?.eng_value ?? '—'}</span> {unit || ''}
              </span>
              <span>
                平均: <span className="font-mono">
                  {(points.reduce((s, p) => s + (p.eng_value || 0), 0) / points.length).toFixed(2)}
                </span> {unit || ''}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
