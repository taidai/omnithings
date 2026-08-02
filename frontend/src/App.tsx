import { useEffect, useState } from 'react'
import { fetchHealth, type HealthStatus } from './api/client'
import NodeTreePage from './pages/NodeTreePage'
import RuleEnginePage from './pages/RuleEnginePage'
import AlarmCenterPage from './pages/AlarmCenterPage'
import AdminPanel from './components/AdminPanel'

function PipelineBar({ health }: { health: HealthStatus | null }) {
  if (!health) return null
  const p = health.pipeline
  const isOk = p.status.toLowerCase() === 'running' && health.components.mqtt.status === 'connected'

  return (
    <div className="neu-card px-4 py-2 flex items-center gap-6 text-xs">
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

type PageKey = 'tree' | 'rules' | 'alarms' | 'admin'

const NAV_ITEMS: { key: PageKey; label: string; icon: string }[] = [
  { key: 'tree', label: '节点树', icon: '⊞' },
  { key: 'rules', label: '规则引擎', icon: '⚖' },
  { key: 'alarms', label: '告警中心', icon: '🔔' },
  { key: 'admin', label: '系统工具', icon: '⚙' },
]

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>('tree')
  const [health, setHealth] = useState<HealthStatus | null>(null)

  useEffect(() => {
    const poll = () => fetchHealth().then(setHealth).catch(() => {})
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex">
      {/* 侧边栏 */}
      <aside className="w-56 neu-card m-4 mr-0 p-3 flex flex-col">
        <div className="mb-6 px-2 pt-1">
          <h1 className="text-lg font-bold text-gray-800">OmniThings</h1>
          <p className="text-[10px] text-gray-400">工业 IoT 平台</p>
        </div>
        <nav className="space-y-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => setActivePage(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activePage === item.key
                  ? 'bg-[#52c41a] text-white shadow'
                  : 'text-gray-600 hover:bg-white/40'
              }`}
            >
              <span className="text-sm">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-2 pb-1 text-[10px] text-gray-400">
          <div>融合：节点快照 + 点位管理</div>
          <div className="mt-1 font-mono-value">FE {__APP_VERSION__}</div>
        </div>
      </aside>

      {/* 主内容 */}
      <main className="flex-1 p-6 overflow-auto min-w-0">
        <PipelineBar health={health} />
        <div className="mt-4">
          {activePage === 'tree' && <NodeTreePage />}
          {activePage === 'rules' && <RuleEnginePage />}
          {activePage === 'alarms' && <AlarmCenterPage />}
          {activePage === 'admin' && <AdminPanel />}
        </div>
      </main>
    </div>
  )
}
