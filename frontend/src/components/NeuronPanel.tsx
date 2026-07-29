import { useEffect, useState } from 'react'
import {
  fetchNeuronNodes, fetchNeuronGroups, fetchNeuronTags,
  startNeuronNode, stopNeuronNode, deleteNeuronNode,
  type NeuronNode, type NeuronGroup, type NeuronTag,
} from '../api/client'

export default function NeuronPanel() {
  const [nodes, setNodes] = useState<NeuronNode[]>([])
  const [selectedNode, setSelectedNode] = useState('')
  const [groups, setGroups] = useState<NeuronGroup[]>([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [tags, setTags] = useState<NeuronTag[]>([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState('')

  const loadNodes = async () => {
    setLoading(true)
    try {
      const data = await fetchNeuronNodes()
      setNodes(data)
      if (data.length > 0 && !selectedNode) {
        setSelectedNode(data[0].name)
      }
    } finally {
      setLoading(false)
    }
  }

  const loadGroups = async (nodeName: string) => {
    try {
      const data = await fetchNeuronGroups(nodeName)
      setGroups(data)
      if (data.length > 0 && !selectedGroup) {
        setSelectedGroup(data[0].name)
      }
    } catch {
      setGroups([])
    }
  }

  const loadTags = async (nodeName: string, groupName: string) => {
    try {
      const data = await fetchNeuronTags(nodeName, groupName)
      setTags(data)
    } catch {
      setTags([])
    }
  }

  useEffect(() => { loadNodes() }, [])

  useEffect(() => {
    if (selectedNode) {
      setSelectedGroup('')
      setTags([])
      loadGroups(selectedNode)
    }
  }, [selectedNode])

  useEffect(() => {
    if (selectedNode && selectedGroup) {
      loadTags(selectedNode, selectedGroup)
    }
  }, [selectedNode, selectedGroup])

  const handleStart = async (name: string) => {
    setActionLoading(`start-${name}`)
    try {
      await startNeuronNode(name)
      await loadNodes()
    } finally {
      setActionLoading('')
    }
  }

  const handleStop = async (name: string) => {
    setActionLoading(`stop-${name}`)
    try {
      await stopNeuronNode(name)
      await loadNodes()
    } finally {
      setActionLoading('')
    }
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`确定删除节点 ${name}？此操作不可恢复。`)) return
    setActionLoading(`delete-${name}`)
    try {
      await deleteNeuronNode(name)
      if (selectedNode === name) {
        setSelectedNode('')
        setGroups([])
        setTags([])
      }
      await loadNodes()
    } finally {
      setActionLoading('')
    }
  }

  return (
    <div className="space-y-4">
      {/* 节点列表 */}
      <div className="neu-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-800">Neuron 驱动节点</h3>
          <button
            onClick={loadNodes}
            disabled={loading}
            className="neu-btn px-3 py-1 text-xs text-[#389e0d] disabled:opacity-50"
          >
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
        <div className="space-y-2">
          {nodes.map((node) => (
            <div
              key={node.name}
              className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                selectedNode === node.name ? 'border-[#52c41a] bg-[#52c41a]/5' : 'border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => setSelectedNode(node.name)}
            >
              <div>
                <div className="text-sm font-medium text-gray-800">{node.name}</div>
                <div className="text-xs text-gray-500">{node.plugin}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${node.state === 1 ? 'bg-green-500' : 'bg-gray-300'}`} />
                <button
                  onClick={(e) => { e.stopPropagation(); handleStart(node.name) }}
                  disabled={actionLoading === `start-${node.name}`}
                  className="neu-btn px-2 py-1 text-xs text-green-600 disabled:opacity-50"
                >
                  启动
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleStop(node.name) }}
                  disabled={actionLoading === `stop-${node.name}`}
                  className="neu-btn px-2 py-1 text-xs text-amber-600 disabled:opacity-50"
                >
                  停止
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(node.name) }}
                  disabled={actionLoading === `delete-${node.name}`}
                  className="neu-btn px-2 py-1 text-xs text-red-600 disabled:opacity-50"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
          {nodes.length === 0 && !loading && (
            <div className="text-center text-gray-400 text-sm py-4">暂无 Neuron 节点</div>
          )}
        </div>
      </div>

      {/* 组列表 */}
      {selectedNode && (
        <div className="neu-card p-4">
          <h3 className="text-sm font-bold text-gray-800 mb-3">采集组 — {selectedNode}</h3>
          <div className="flex flex-wrap gap-2">
            {groups.map((group) => (
              <button
                key={group.name}
                onClick={() => setSelectedGroup(group.name)}
                className={`px-3 py-1.5 text-xs rounded-full font-medium transition-colors ${
                  selectedGroup === group.name
                    ? 'bg-[#52c41a] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {group.name} ({group.interval}ms)
              </button>
            ))}
            {groups.length === 0 && (
              <div className="text-gray-400 text-sm">暂无采集组</div>
            )}
          </div>
        </div>
      )}

      {/* 点位列表 */}
      {selectedNode && selectedGroup && (
        <div className="neu-card p-4">
          <h3 className="text-sm font-bold text-gray-800 mb-3">
            点位列表 — {selectedNode} / {selectedGroup}
          </h3>
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#f0f2f5]">
                <tr className="border-b border-gray-200">
                  <th className="text-left px-3 py-2 font-medium text-gray-500">点位名</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">地址</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">类型</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((tag) => (
                  <tr key={tag.name} className="border-b border-gray-100 hover:bg-white/30">
                    <td className="px-3 py-2 text-gray-800">{tag.name}</td>
                    <td className="px-3 py-2 text-gray-600 font-mono">{tag.address}</td>
                    <td className="px-3 py-2 text-gray-600">{tag.type || '—'}</td>
                  </tr>
                ))}
                {tags.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-gray-400">暂无点位</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
