import { useEffect, useState } from 'react'
import {
  fetchFaultMaps,
  createFaultMap,
  updateFaultMap,
  deleteFaultMap,
  type FaultMap,
  type FaultMapEntry,
} from '../api/client'

export default function FaultMapManager() {
  const [maps, setMaps] = useState<FaultMap[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<FaultMap | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<{ name: string; description: string; entries: FaultMapEntry[] }>({
    name: '',
    description: '',
    entries: [],
  })

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchFaultMaps()
      setMaps(data.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name,
        description: editing.description || '',
        entries: editing.entries?.length ? [...editing.entries] : [],
      })
      setShowForm(true)
    } else {
      setForm({ name: '', description: '', entries: [] })
    }
  }, [editing])

  const handleSave = async () => {
    if (!form.name.trim()) return
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      entries: form.entries.filter((e) => e.code.trim() && e.message.trim()),
    }
    try {
      if (editing) {
        await updateFaultMap(editing.id, payload)
      } else {
        await createFaultMap(payload)
      }
      setShowForm(false)
      setEditing(null)
      load()
    } catch (e: any) {
      alert('保存失败：' + (e.message || e))
    }
  }

  const handleDelete = async (map: FaultMap) => {
    if (!confirm(`确定删除故障码映射表 "${map.name}"？`)) return
    try {
      await deleteFaultMap(map.id)
      load()
    } catch (e: any) {
      alert('删除失败：' + (e.message || e))
    }
  }

  const updateEntry = (idx: number, field: keyof FaultMapEntry, value: string) => {
    const next = [...form.entries]
    next[idx] = { ...next[idx], [field]: value }
    setForm({ ...form, entries: next })
  }

  const addEntry = () => {
    setForm({ ...form, entries: [...form.entries, { code: '', message: '' }] })
  }

  const removeEntry = (idx: number) => {
    const next = [...form.entries]
    next.splice(idx, 1)
    setForm({ ...form, entries: next })
  }

  return (
    <div className="neu-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-800">故障码映射表</h3>
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          className="neu-btn px-3 py-1.5 text-xs font-medium text-white bg-[#52c41a] hover:bg-[#389e0d]"
        >
          新建映射表
        </button>
      </div>

      {showForm && (
        <div className="neu-inset p-3 mb-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="映射表名称"
              className="neu-input px-3 py-2 text-xs"
            />
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="描述"
              className="neu-input px-3 py-2 text-xs"
            />
          </div>
          <div className="space-y-2">
            <div className="text-xs text-gray-500">故障码条目</div>
            {form.entries.map((entry, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  value={entry.code}
                  onChange={(e) => updateEntry(idx, 'code', e.target.value)}
                  placeholder="故障码"
                  className="neu-input px-2 py-1 text-xs w-32"
                />
                <input
                  value={entry.message}
                  onChange={(e) => updateEntry(idx, 'message', e.target.value)}
                  placeholder="故障描述"
                  className="neu-input px-2 py-1 text-xs flex-1"
                />
                <button
                  onClick={() => removeEntry(idx)}
                  className="neu-btn px-2 py-1 text-xs text-red-500"
                >
                  删除
                </button>
              </div>
            ))}
            <button onClick={addEntry} className="neu-btn px-3 py-1 text-xs text-gray-600">
              + 添加条目
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowForm(false); setEditing(null) }}
              className="neu-btn px-4 py-1.5 text-xs"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="neu-btn px-4 py-1.5 text-xs font-medium text-white bg-[#52c41a] hover:bg-[#389e0d]"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-xs text-gray-400">加载中...</div>}

      <div className="space-y-2">
        {maps.map((map) => (
          <div key={map.id} className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-800">{map.name}</div>
                <div className="text-xs text-gray-400">{map.description || '无描述'} · {map.entries?.length || 0} 条映射</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditing(map)}
                  className="neu-btn px-3 py-1 text-xs"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(map)}
                  className="neu-btn px-3 py-1 text-xs text-red-500"
                >
                  删除
                </button>
              </div>
            </div>
            {map.entries && map.entries.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                {map.entries.slice(0, 6).map((entry, idx) => (
                  <div key={idx} className="neu-inset px-2 py-1 truncate">
                    <span className="font-mono text-gray-600">{entry.code}</span>
                    <span className="mx-1 text-gray-300">→</span>
                    <span className="text-gray-700">{entry.message}</span>
                  </div>
                ))}
                {map.entries.length > 6 && (
                  <div className="text-xs text-gray-400">+{map.entries.length - 6} 条</div>
                )}
              </div>
            )}
          </div>
        ))}
        {maps.length === 0 && !loading && (
          <div className="text-center text-gray-400 text-xs py-6">暂无故障码映射表</div>
        )}
      </div>
    </div>
  )
}
