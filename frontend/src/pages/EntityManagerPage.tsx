import { useEffect, useMemo, useState } from 'react'
import {
  fetchEntities,
  fetchEntity,
  createEntity,
  updateEntity,
  deleteEntity,
  bindTagToEntity,
  unbindTagFromEntity,
  fetchEntityRealtime,
  fetchTags,
  fetchNodes,
  type Entity,
  type EntityBinding,
  type Tag,
  type Node,
} from '../api/client'

const DATA_TYPES = ['FLOAT', 'INT', 'BOOL', 'STRING', 'ENUM']
const ENTITY_TYPES = [
  { key: 'R', label: '只读 R' },
  { key: 'W', label: '只写 W' },
  { key: 'RW', label: '读写 RW' },
]

export default function EntityManagerPage() {
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Entity | null>(null)
  const [detail, setDetail] = useState<(Entity & { bindings: EntityBinding[] }) | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Entity | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [nodes, setNodes] = useState<Node[]>([])
  const [realtime, setRealtime] = useState<any>(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchEntities({ search, page_size: 200 })
      setEntities(data.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [search])

  useEffect(() => {
    if (selected) {
      fetchEntity(selected.id).then(setDetail)
      fetchEntityRealtime(selected.id).then(setRealtime).catch(() => setRealtime(null))
    } else {
      setDetail(null)
      setRealtime(null)
    }
  }, [selected])

  useEffect(() => {
    Promise.all([fetchTags(undefined, 1, 200, undefined, undefined, undefined, undefined, true), fetchNodes()]).then(([t, n]) => {
      setTags(t.tags)
      setNodes(n)
    })
  }, [])

  const categories = useMemo(() => {
    const set = new Set<string>()
    entities.forEach((e) => { if (e.category) set.add(e.category) })
    return Array.from(set).sort()
  }, [entities])

  const handleCreate = async (form: any) => {
    await createEntity(form)
    setShowForm(false)
    load()
  }

  const handleUpdate = async (form: any) => {
    if (!editing) return
    await updateEntity(editing.id, form)
    setEditing(null)
    load()
    if (selected?.id === editing.id) fetchEntity(editing.id).then(setDetail)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该实体？绑定关系会一并删除。')) return
    await deleteEntity(id)
    if (selected?.id === id) setSelected(null)
    load()
  }

  const handleBind = async (form: Omit<EntityBinding, 'id' | 'entity_id' | 'tag_name' | 'tag_display_name' | 'node_name'>) => {
    if (!selected) return
    await bindTagToEntity(selected.id, form)
    fetchEntity(selected.id).then(setDetail)
  }

  const handleUnbind = async (bindingId: string) => {
    if (!selected || !confirm('确定解除绑定？')) return
    await unbindTagFromEntity(selected.id, bindingId)
    fetchEntity(selected.id).then(setDetail)
  }

  return (
    <div className="min-h-0 flex gap-4">
      {/* 左侧列表 */}
      <div className="w-1/3 neu-card p-4 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-gray-800">全局实体</h2>
          <button onClick={() => setShowForm(true)} className="neu-btn px-3 py-1.5 text-xs bg-[#52c41a] text-white">新建实体</button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索实体名..."
          className="neu-inset w-full px-3 py-2 text-xs mb-3"
        />
        <div className="flex-1 overflow-y-auto space-y-2">
          {entities.map((e) => (
            <div
              key={e.id}
              onClick={() => setSelected(e)}
              className={`p-3 rounded-xl cursor-pointer transition-colors ${selected?.id === e.id ? 'bg-[#52c41a] text-white' : 'bg-gray-50 hover:bg-gray-100'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm flex items-center gap-2">
                  {e.display_name || e.name}
                  {e.is_system && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${selected?.id === e.id ? 'bg-white/20 text-white' : 'bg-purple-100 text-purple-700'}`}>系统</span>}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${e.entity_type === 'R' ? 'bg-blue-100 text-blue-700' : e.entity_type === 'W' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>{e.entity_type}</span>
              </div>
              <div className={`text-xs mt-1 ${selected?.id === e.id ? 'text-white/80' : 'text-gray-400'}`}>{e.name} · 绑定 {e.binding_count} 个点位</div>
            </div>
          ))}
          {entities.length === 0 && !loading && <div className="text-center text-gray-400 text-xs py-8">暂无实体</div>}
        </div>
      </div>

      {/* 右侧详情 */}
      <div className="flex-1 neu-card p-4 overflow-y-auto">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">请选择左侧实体</div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-800">{detail.display_name || detail.name}</h3>
                  {detail.is_system && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">系统</span>}
                </div>
                <div className="text-xs text-gray-500 mt-1">{detail.name} · {detail.data_type} · {detail.entity_type} · {detail.category || '未分类'}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(detail)} className="neu-btn px-3 py-1.5 text-xs">编辑</button>
                {!detail.is_system && <button onClick={() => handleDelete(detail.id)} className="neu-btn px-3 py-1.5 text-xs text-red-500">删除</button>}
              </div>
            </div>

            {realtime && (
              <div className="neu-inset p-3">
                <div className="text-xs text-gray-400">实时值</div>
                <div className="text-xl font-mono-value font-bold text-gray-800 mt-1">
                  {realtime.value === null ? '—' : String(realtime.value)} {detail.unit || ''}
                </div>
                <div className="text-[10px] text-gray-400 mt-1">来源: {realtime.node_name} / {realtime.tag_name} · {realtime.ts ? new Date(realtime.ts).toLocaleString() : '—'}</div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold text-gray-700">绑定点位</h4>
                <EntityBindForm tags={tags} nodes={nodes} onBind={handleBind} />
              </div>
              <div className="space-y-2">
                {detail.bindings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg">
                    <div>
                      <div className="text-sm font-medium">{b.tag_display_name || b.tag_name}</div>
                      <div className="text-xs text-gray-400">{b.node_name} · {b.binding_type} · 优先级 {b.priority}{b.brand ? ` · ${b.brand}` : ''}</div>
                    </div>
                    <button onClick={() => handleUnbind(b.id)} className="text-xs text-red-500 hover:underline">解绑</button>
                  </div>
                ))}
                {detail.bindings.length === 0 && <div className="text-xs text-gray-400 py-4 text-center">暂无绑定</div>}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">加载中...</div>
        )}
      </div>

      {(showForm || editing) && (
        <EntityForm
          categories={categories}
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSubmit={editing ? handleUpdate : handleCreate}
        />
      )}
    </div>
  )
}

function EntityForm({ categories, initial, onClose, onSubmit }: any) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    display_name: initial?.display_name || '',
    entity_type: initial?.entity_type || 'R',
    data_type: initial?.data_type || 'FLOAT',
    unit: initial?.unit || '',
    category: initial?.category || '',
    description: initial?.description || '',
    enabled: initial?.enabled ?? true,
  })

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="neu-card p-5 w-[480px] max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-bold mb-4">{initial ? `编辑实体${initial.is_system ? '（系统内置）' : ''}` : '新建实体'}</h3>
        <div className="space-y-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="实体全局名，如 pcs.activePower" className="neu-inset w-full px-3 py-2 text-xs" disabled={!!initial} />
          <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="显示名" className="neu-inset w-full px-3 py-2 text-xs" />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value as any })} className="neu-inset w-full px-3 py-2 text-xs" disabled={initial?.is_system}>
              {ENTITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <select value={form.data_type} onChange={(e) => setForm({ ...form, data_type: e.target.value })} className="neu-inset w-full px-3 py-2 text-xs" disabled={initial?.is_system}>
              {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="单位" className="neu-inset w-full px-3 py-2 text-xs" />
          <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="分类，如 pcs / bms / meter" list="cat-list" className="neu-inset w-full px-3 py-2 text-xs" disabled={initial?.is_system} />
          <datalist id="cat-list">{categories.map((c: string) => <option key={c} value={c} />)}</datalist>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="描述" className="neu-inset w-full px-3 py-2 text-xs h-16" />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> 启用
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="neu-btn px-4 py-2 text-xs">取消</button>
          <button onClick={() => onSubmit(form)} className="neu-btn px-4 py-2 text-xs bg-[#52c41a] text-white">保存</button>
        </div>
      </div>
    </div>
  )
}

function EntityBindForm({ tags, nodes, onBind }: any) {
  const [tagId, setTagId] = useState('')
  const [nodeId, setNodeId] = useState('')
  const [bindingType, setBindingType] = useState<'PHYSICAL' | 'VIRTUAL'>('PHYSICAL')
  const [brand, setBrand] = useState('')
  const [priority, setPriority] = useState(1)

  const selectedTag = tags.find((t: Tag) => t.id === tagId)

  useEffect(() => {
    if (selectedTag) setNodeId(selectedTag.node_id)
  }, [tagId, selectedTag])

  const submit = () => {
    if (!tagId || !nodeId) return
    onBind({ tag_id: tagId, node_id: nodeId, binding_type: bindingType, brand: brand || undefined, priority })
    setTagId('')
    setBrand('')
    setPriority(1)
  }

  return (
    <div className="flex items-center gap-2">
      <select value={tagId} onChange={(e) => setTagId(e.target.value)} className="neu-inset px-2 py-1.5 text-xs max-w-[160px]">
        <option value="">选择点位</option>
        {tags.map((t: Tag) => <option key={t.id} value={t.id}>{t.display_name || t.name} ({t.node_name})</option>)}
      </select>
      <select value={bindingType} onChange={(e) => setBindingType(e.target.value as any)} className="neu-inset px-2 py-1.5 text-xs">
        <option value="PHYSICAL">物理</option>
        <option value="VIRTUAL">虚拟</option>
      </select>
      <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="品牌" className="neu-inset px-2 py-1.5 text-xs w-20" />
      <input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value || '1'))} placeholder="优先级" className="neu-inset px-2 py-1.5 text-xs w-16" />
      <button onClick={submit} className="neu-btn px-3 py-1.5 text-xs bg-[#52c41a] text-white">绑定</button>
    </div>
  )
}
