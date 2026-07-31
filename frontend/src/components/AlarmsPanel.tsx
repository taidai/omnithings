import { useCallback, useEffect, useState } from 'react'
import { fetchAlarms, ackAlarm, type Alarm } from '../api/client'

const LEVEL_STYLE: Record<string, string> = {
  INFO: 'bg-blue-100 text-blue-600',
  WARNING: 'bg-yellow-100 text-yellow-700',
  MAJOR: 'bg-orange-100 text-orange-600',
  CRITICAL: 'bg-red-100 text-red-600',
}

const LEVEL_ORDER = ['CRITICAL', 'MAJOR', 'WARNING', 'INFO']

export default function AlarmsPanel() {
  const [alarms, setAlarms] = useState<Alarm[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [levelFilter, setLevelFilter] = useState('')
  const [ackFilter, setAckFilter] = useState<string>('')
  const [acking, setAcking] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAlarms({
        level: levelFilter || undefined,
        acknowledged: ackFilter === '' ? undefined : ackFilter === 'ack',
        limit: 100,
      })
      // 未确认优先，同级别按时间倒序
      const sorted = [...data.alarms].sort((a, b) => {
        if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1
        const la = LEVEL_ORDER.indexOf(a.level)
        const lb = LEVEL_ORDER.indexOf(b.level)
        if (la !== lb) return (la < 0 ? 99 : la) - (lb < 0 ? 99 : lb)
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      })
      setAlarms(sorted)
      setTotal(data.total)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [levelFilter, ackFilter])

  useEffect(() => { load() }, [load])

  const handleAck = async (alarm: Alarm) => {
    const user = prompt('确认人：', localStorage.getItem('ack_user') || 'admin')
    if (!user) return
    localStorage.setItem('ack_user', user)
    setAcking(alarm.id)
    try {
      await ackAlarm(alarm.id, user)
      await load()
    } catch (e: any) {
      alert(`确认失败: ${e.message}`)
    } finally {
      setAcking(null)
    }
  }

  const ackAllVisible = async () => {
    const unack = alarms.filter((a) => !a.acknowledged)
    if (!unack.length) return
    const user = prompt(`批量确认 ${unack.length} 条告警，确认人：`, localStorage.getItem('ack_user') || 'admin')
    if (!user) return
    localStorage.setItem('ack_user', user)
    setLoading(true)
    try {
      await Promise.all(unack.map((a) => ackAlarm(a.id, user)))
      await load()
    } catch (e: any) {
      alert(`批量确认失败: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="neu-card p-4 mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-gray-700">告警中心</span>
        <span className="text-xs text-gray-400">共 {total} 条</span>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="neu-input px-3 py-1.5 text-xs"
        >
          <option value="">全部级别</option>
          <option value="INFO">INFO</option>
          <option value="WARNING">WARNING</option>
          <option value="MAJOR">MAJOR</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>
        <select
          value={ackFilter}
          onChange={(e) => setAckFilter(e.target.value)}
          className="neu-input px-3 py-1.5 text-xs"
        >
          <option value="">全部状态</option>
          <option value="unack">未确认</option>
          <option value="ack">已确认</option>
        </select>
        <button
          onClick={load}
          disabled={loading}
          className="neu-btn px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-[#389e0d] disabled:opacity-50"
        >
          {loading ? '加载中...' : '刷新'}
        </button>
        <button
          onClick={ackAllVisible}
          disabled={loading || !alarms.some((a) => !a.acknowledged)}
          className="neu-btn px-4 py-1.5 text-xs font-medium text-white bg-[#52c41a] hover:bg-[#389e0d] disabled:opacity-50"
        >
          批量确认
        </button>
      </div>

      <div className="neu-card overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2.5 font-medium">时间</th>
              <th className="px-4 py-2.5 font-medium">级别</th>
              <th className="px-4 py-2.5 font-medium">规则</th>
              <th className="px-4 py-2.5 font-medium">消息</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {alarms.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  {loading ? '加载中...' : '暂无告警'}
                </td>
              </tr>
            )}
            {alarms.map((alarm) => (
              <tr
                key={alarm.id}
                className={`border-b border-gray-50 hover:bg-gray-50/50 ${alarm.acknowledged ? 'opacity-60' : ''}`}
              >
                <td className="px-4 py-2.5 font-mono text-gray-500 whitespace-nowrap">
                  {alarm.created_at ? new Date(alarm.created_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${LEVEL_STYLE[alarm.level] || 'bg-gray-100 text-gray-500'}`}>
                    {alarm.level}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-600">{alarm.rule_name || '—'}</td>
                <td className="px-4 py-2.5 text-gray-700">{alarm.message}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {alarm.acknowledged ? (
                    <span className="text-[#389e0d]">已确认{alarm.ack_user ? ` · ${alarm.ack_user}` : ''}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-500 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      未确认
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {!alarm.acknowledged && (
                    <button
                      onClick={() => handleAck(alarm)}
                      disabled={acking === alarm.id}
                      className="neu-btn px-3 py-1 text-xs font-medium text-white bg-[#52c41a] hover:bg-[#389e0d] disabled:opacity-50"
                    >
                      {acking === alarm.id ? '确认中...' : '确认'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
