import { useEffect, useState } from 'react'
import {
  fetchNeuronGroups, fetchNeuronTags,
  startNeuronNode, stopNeuronNode, deleteNeuronNode,
  type NeuronGroup, type NeuronTag,
} from '../api/client'

interface NeuronStatusCardProps {
  nodeName: string
  onClose: () => void
}

export default function NeuronStatusCard({ nodeName, onClose }: NeuronStatusCardProps) {
  const [groups, setGroups] = useState<NeuronGroup[]>([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [tags, setTags] = useState<NeuronTag[]>([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState('')

  useEffect(() => {
    if (!nodeName) return
    setLoading(true)
    fetchNeuronGroups(nodeName)
      .then((data) => {
        setGroups(data)
        if (data.length > 0) setSelectedGroup(data[0].name)
      })
      .catch(() => setGroups([]))
      .finally(() => setLoading(false))
  }, [nodeName])

  useEffect(() => {
    if (!nodeName || !selectedGroup) return
    fetchNeuronTags(nodeName, selectedGroup)
      .then(setTags)
      .catch(() => setTags([]))
  }, [nodeName, selectedGroup])

  const handleStart = async () => {
    setActionLoading('start')
    try { await startNeuronNode(nodeName) } finally { setActionLoading('') }
  }

  const handleStop = async () => {
    setActionLoading('stop')
    try { await stopNeuronNode(nodeName) } finally { setActionLoading('') }
  }

  const handleDelete = async () => {
    if (!confirm(`确定删除 Neuron 节点 ${nodeName}？`)) return
    setActionLoading('delete')
    try { await deleteNeuronNode(nodeName); onClose() } finally { setActionLoading('') }
  }

  return (
    <div className="neu-card p-4 mb-4 border border-[#52c41a]/30">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#52c41a]" />
          <h3 className="text-sm font-bold text-gray-800">Neuron 采集节点 — {nodeName}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleStart}
            disabled={actionLoading === 'start'}
            className="neu-btn px-2 py-1 text-xs text-green-600 disabled:opacity-50"
          >
            启动
          </button>
          <button
            onClick={handleStop}
            disabled={actionLoading === 'stop'}
            className="neu-btn px-2 py-1 text-xs text-amber-600 disabled:opacity-50"
          >
            停止
          </button>
          <button
            onClick={handleDelete}
            disabled={actionLoading === 'delete'}
            className="neu-btn px-2 py-1 text-xs text-red-600 disabled:opacity-50"
          >
            删除
          </button>
          <button onClick={onClose} className="neu-btn px-2 py-1 text-xs text-gray-400">×</button>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-gray-400">加载中...</div>
      ) : groups.length === 0 ? (
        <div className="text-xs text-gray-400">该节点无采集组</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <button
                key={g.name}
                onClick={() => setSelectedGroup(g.name)}
                className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                  selectedGroup === g.name ? 'bg-[#52c41a] text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {g.name} ({g.interval}ms)
              </button>
            ))}
          </div>
          {selectedGroup && (
            <div className="text-xs text-gray-500">
              采集组 {selectedGroup} 共 {tags.length} 个点位
            </div>
          )}
        </div>
      )}
    </div>
  )
}
