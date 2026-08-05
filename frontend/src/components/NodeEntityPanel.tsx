import { useEffect, useMemo, useState } from 'react'
import {
  fetchEntities,
  fetchEntityBindings,
  fetchEntityRealtime,
  fetchTags,
  bindTagToEntity,
  unbindTagFromEntity,
  batchBindEntityTags,
  batchUnbindEntityBindings,
  type Entity,
  type Tag,
  type EntityBinding,
  type BatchBindingItem,
  type EntityRealtime,
} from '../api/client'

interface Props {
  nodeId: string
}

type BindingExtra = EntityBinding & {
  entity_name?: string
  entity_display_name?: string
  entity_type?: string
  data_type?: string
  unit?: string | null
}

export default function NodeEntityPanel({ nodeId }: Props) {
  const [bindings, setBindings] = useState<BindingExtra[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [allEntities, setAllEntities] = useState<Entity[]>([])
  const [realtimeMap, setRealtimeMap] = useState<Record<string, EntityRealtime | null>>({})
  const [loading, setLoading] = useState(false)
  const [showBind, setShowBind] = useState(false)
  const [showBatchBind, setShowBatchBind] = useState(false)
  const [selectedBindingIds, setSelectedBindingIds] = useState<Set<string>>(new Set())

  const load = async () => {
    setLoading(true)
    try {
      const [bData, tData, eData] = await Promise.all([
        fetchEntityBindings({ node_id: nodeId }),
        fetchTags(nodeId, 1, 200),
        fetchEntities({ page_size: 200 }),
      ])
      setBindings(bData.bindings)
      setTags(tData.tags)
      setAllEntities(eData.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    setSelectedBindingIds(new Set())
  }, [nodeId])

  useEffect(() => {
    if (bindings.length === 0) return
    let cancelled = false
    const entityIds = Array.from(new Set(bindings.map((b) => b.entity_id)))
    const poll = async () => {
      const map: Record<string, EntityRealtime | null> = {}
      await Promise.all(
        entityIds.map(async (id) => {
          try {
            map[id] = await fetchEntityRealtime(id)
          } catch {
            map[id] = null
          }
        })
      )
      if (!cancelled) setRealtimeMap(map)
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [bindings])

  const handleBind = async (form: BindFormState) => {
    await bindTagToEntity(form.entityId, {
      tag_id: form.tagId,
      node_id: nodeId,
      binding_type: form.bindingType,
      brand: form.brand || null,
      priority: form.priority,
      enabled: true,
    })
    setShowBind(false)
    load()
  }

  const handleUnbind = async (bindingId: string) => {
    if (!confirm('确定解除该绑定？')) return
    await batchUnbindEntityBindings([bindingId])
    load()
  }

  const toggleBinding = (id: string) => {
    const next = new Set(selectedBindingIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedBindingIds(next)
  }

  const toggleAllBindings = () => {
    if (bindings.length > 0 && bindings.every((b) => selectedBindingIds.has(b.id))) {
      setSelectedBindingIds(new Set())
    } else {
      setSelectedBindingIds(new Set(bindings.map((b) => b.id)))
    }
  }

  const allSelected = bindings.length > 0 && bindings.every((b) => selectedBindingIds.has(b.id))
  const someSelected = bindings.some((b) => selectedBindingIds.has(b.id))

  const handleBatchUnbind = async () => {
    if (!confirm(`确定解除选中的 ${selectedBindingIds.size} 条绑定？`)) return
    try {
      await batchUnbindEntityBindings(Array.from(selectedBindingIds))
      setSelectedBindingIds(new Set())
      load()
    } catch (e: any) {
      alert('批量解绑失败：' + (e.message || e))
    }
  }

  return (
    <div className="neu-card p-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-800">全局实体绑定</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBind(true)}
            className="neu-btn px-3 py-1.5 text-xs bg-[#52c41a] text-white"
          >
            绑定实体
          </button>
          <button
            onClick={() => setShowBatchBind(true)}
            className="neu-btn px-3 py-1.5 text-xs bg-[#534AB7] text-white"
          >
            批量绑定
          </button>
        </div>
      </div>

      {selectedBindingIds.size > 0 && (
        <div className="neu-card p-2 mb-3 flex items-center gap-3 bg-[#52c41a]/5 border border-[#52c41a]/20">
          <span className="text-xs text-gray-700">
            已选 <span className="text-[#389e0d] font-bold">{selectedBindingIds.size}</span> 条绑定
          </span>
          <button
            onClick={handleBatchUnbind}
            className="neu-btn px-3 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600"
          >
            批量解绑
          </button>
          <button
            onClick={() => setSelectedBindingIds(new Set())}
            className="neu-btn px-3 py-1 text-xs text-gray-500"
          >
            取消选择
          </button>
        </div>
      )}

      {loading && <div className="text-xs text-gray-400">加载中...</div>}

      <div className="space-y-2">
        {bindings.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer mb-1">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
              onChange={toggleAllBindings}
              className="w-4 h-4 accent-[#52c41a]"
            />
            全选
          </label>
        )}
        {bindings.map((b) => {
          const rt = realtimeMap[b.entity_id]
          return (
            <div key={b.id} className="bg-gray-50 rounded-lg p-3 flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedBindingIds.has(b.id)}
                onChange={() => toggleBinding(b.id)}
                className="w-4 h-4 accent-[#52c41a] mt-1 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">
                      {b.entity_display_name || b.entity_name}
                      {b.entity_is_system && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">系统</span>
                      )}
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600">
                        {b.entity_type}
                      </span>
                      <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">
                        {b.data_type}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate">
                      {b.entity_name} · 绑定点位：{b.tag_display_name || b.tag_name}
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700">
                        {b.binding_type}
                      </span>
                      {b.brand && <span className="ml-2 text-gray-500">{b.brand}</span>}
                      <span className="ml-2 text-gray-400">优先级 {b.priority}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <div className="text-lg font-mono-value font-bold text-gray-800">
                      {rt?.value === null || rt?.value === undefined ? '—' : String(rt.value)}
                      {rt?.value !== null && rt?.value !== undefined && b.unit ? ` ${b.unit}` : ''}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {rt?.ts ? new Date(rt.ts).toLocaleString() : '无实时值'}
                    </div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleUnbind(b.id)}
                className="shrink-0 text-[11px] text-red-500 hover:underline mt-1"
              >
                解绑
              </button>
            </div>
          )
        })}
        {bindings.length === 0 && !loading && (
          <div className="text-center text-gray-400 text-xs py-8">该节点暂无绑定的全局实体</div>
        )}
      </div>

      {showBind && (
        <BindEntityModal
          nodeId={nodeId}
          tags={tags}
          entities={allEntities}
          onClose={() => setShowBind(false)}
          onBind={handleBind}
        />
      )}

      {showBatchBind && (
        <BatchBindModal
          nodeId={nodeId}
          tags={tags}
          entities={allEntities}
          onClose={() => setShowBatchBind(false)}
          onBound={() => {
            setShowBatchBind(false)
            load()
          }}
        />
      )}
    </div>
  )
}

interface BindFormState {
  entityId: string
  tagId: string
  bindingType: 'PHYSICAL' | 'VIRTUAL'
  brand: string
  priority: number
}

function BindEntityModal({
  tags,
  entities,
  onClose,
  onBind,
}: {
  nodeId: string
  tags: Tag[]
  entities: Entity[]
  onClose: () => void
  onBind: (form: BindFormState) => void
}) {
  const [form, setForm] = useState<BindFormState>({
    entityId: '',
    tagId: '',
    bindingType: 'PHYSICAL',
    brand: '',
    priority: 1,
  })

  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === form.entityId),
    [entities, form.entityId]
  )

  const canSubmit = form.entityId && form.tagId

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="neu-card p-5 w-[480px] max-h-[90vh] overflow-y-auto">
        <h3 className="text-sm font-bold mb-3">绑定全局实体</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">选择实体</label>
            <select
              value={form.entityId}
              onChange={(e) => setForm({ ...form, entityId: e.target.value })}
              className="neu-input w-full px-3 py-2 text-xs"
            >
              <option value="">请选择</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.display_name || e.name} ({e.entity_type} · {e.data_type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">选择点位</label>
            <select
              value={form.tagId}
              onChange={(e) => setForm({ ...form, tagId: e.target.value })}
              className="neu-input w-full px-3 py-2 text-xs"
            >
              <option value="">请选择</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name || t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">绑定类型</label>
              <select
                value={form.bindingType}
                onChange={(e) => setForm({ ...form, bindingType: e.target.value as any })}
                className="neu-input w-full px-3 py-2 text-xs"
              >
                <option value="PHYSICAL">物理</option>
                <option value="VIRTUAL">虚拟</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">优先级</label>
              <input
                type="number"
                min={1}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 1 })}
                className="neu-input w-full px-3 py-2 text-xs"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">品牌（可选）</label>
            <input
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              placeholder="例如：Sungrow / Pylontech"
              className="neu-input w-full px-3 py-2 text-xs"
            />
          </div>
          {selectedEntity && (
            <div className="text-[10px] text-gray-400 bg-gray-50 p-2 rounded">
              将实体 <span className="font-medium">{selectedEntity.name}</span> 绑定到当前节点的指定点位。
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="neu-btn px-4 py-2 text-xs">取消</button>
          <button
            onClick={() => onBind(form)}
            disabled={!canSubmit}
            className="neu-btn px-4 py-2 text-xs bg-[#52c41a] text-white disabled:opacity-50"
          >
            绑定
          </button>
        </div>
      </div>
    </div>
  )
}

type BindMode = 'auto' | 'manual'

function BatchBindModal({
  nodeId,
  tags,
  entities,
  onClose,
  onBound,
}: {
  nodeId: string
  tags: Tag[]
  entities: Entity[]
  onClose: () => void
  onBound: () => void
}) {
  const [mode, setMode] = useState<BindMode>('auto')
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set())
  const [tagSearch, setTagSearch] = useState('')
  const [entitySearch, setEntitySearch] = useState('')
  const [entityTypeFilter, setEntityTypeFilter] = useState('')
  const [bindingType, setBindingType] = useState<'PHYSICAL' | 'VIRTUAL'>('PHYSICAL')
  const [brand, setBrand] = useState('')
  const [priority, setPriority] = useState(1)
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)

  const filteredTags = useMemo(() => {
    const term = tagSearch.trim().toLowerCase()
    if (!term) return tags
    return tags.filter((t) =>
      t.name.toLowerCase().includes(term) ||
      (t.display_name || '').toLowerCase().includes(term)
    )
  }, [tags, tagSearch])

  const filteredEntities = useMemo(() => {
    let list = entities
    if (entityTypeFilter) {
      list = list.filter((e) => e.entity_type === entityTypeFilter)
    }
    const term = entitySearch.trim().toLowerCase()
    if (!term) return list
    return list.filter((e) =>
      e.name.toLowerCase().includes(term) ||
      (e.display_name || '').toLowerCase().includes(term) ||
      (e.category || '').toLowerCase().includes(term)
    )
  }, [entities, entitySearch, entityTypeFilter])

  const matchedAutoPairs = useMemo(() => {
    const selectedTags = tags.filter((t) => selectedTagIds.has(t.id))
    return selectedTags
      .map((tag) => {
        const entity = entities.find((e) => matchName(tag, e))
        return entity ? { tag, entity } : null
      })
      .filter(Boolean) as { tag: Tag; entity: Entity }[]
  }, [selectedTagIds, tags, entities])

  const manualBindingsCount = selectedEntityIds.size * selectedTagIds.size

  const toggleTag = (id: string) => {
    const next = new Set(selectedTagIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedTagIds(next)
  }

  const toggleEntity = (id: string) => {
    const next = new Set(selectedEntityIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedEntityIds(next)
  }

  const buildItems = (): BatchBindingItem[] => {
    const base = {
      node_id: nodeId,
      binding_type: bindingType,
      brand: brand || null,
      priority,
      enabled,
    }
    if (mode === 'auto') {
      return matchedAutoPairs.map((p) => ({
        ...base,
        entity_id: p.entity.id,
        tag_id: p.tag.id,
      }))
    }
    const items: BatchBindingItem[] = []
    selectedEntityIds.forEach((eid) => {
      selectedTagIds.forEach((tid) => {
        items.push({ ...base, entity_id: eid, tag_id: tid })
      })
    })
    return items
  }

  const canSubmit = mode === 'auto' ? matchedAutoPairs.length > 0 : manualBindingsCount > 0

  const handleSubmit = async () => {
    const items = buildItems()
    if (items.length === 0) return
    setSaving(true)
    try {
      const res = await batchBindEntityTags(items)
      alert(`批量绑定完成：新增 ${res.created} 个，跳过重复 ${res.skipped} 个`)
      onBound()
    } catch (e: any) {
      alert('批量绑定失败：' + (e.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="neu-card p-5 w-[720px] max-w-[92vw] max-h-[90vh] overflow-hidden flex flex-col">
        <h3 className="text-sm font-bold mb-3">批量绑定全局实体</h3>

        <div className="flex items-center gap-2 mb-3">
          {[
            { key: 'auto', label: '同名自动匹配' },
            { key: 'manual', label: '手动多选绑定' },
          ].map((m) => (
            <button
              key={m.key}
              onClick={() => {
                setMode(m.key as BindMode)
                setSelectedTagIds(new Set())
                setSelectedEntityIds(new Set())
              }}
              className={`px-3 py-1.5 text-xs rounded-full ${
                mode === m.key ? 'bg-[#534AB7] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-2 gap-4 overflow-hidden">
          {mode === 'auto' ? (
            <>
              <div className="flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700">选择点位（{selectedTagIds.size}）</label>
                  <input
                    type="text"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="搜索点位..."
                    className="neu-input px-2 py-1 text-xs w-32"
                  />
                </div>
                <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg bg-white/50 p-2">
                  {filteredTags.length === 0 && <div className="text-xs text-gray-400 p-2">无点位</div>}
                  {filteredTags.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 p-2 hover:bg-indigo-50 rounded cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTagIds.has(t.id)}
                        onChange={() => toggleTag(t.id)}
                        className="w-4 h-4 accent-[#52c41a] shrink-0"
                      />
                      <span className="truncate">{t.display_name || t.name}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{t.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-col min-h-0">
                <label className="text-xs font-medium text-gray-700 mb-2">匹配预览（{matchedAutoPairs.length}）</label>
                <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg bg-white/50 p-2">
                  {matchedAutoPairs.length === 0 && (
                    <div className="text-xs text-gray-400 p-2">所选点位未匹配到同名/同显示名实体</div>
                  )}
                  {matchedAutoPairs.map((p) => (
                    <div key={p.tag.id} className="text-xs p-2 border-b border-gray-100 last:border-0">
                      <div className="font-medium text-gray-800">{p.entity.display_name || p.entity.name}</div>
                      <div className="text-[10px] text-gray-400">→ {p.tag.display_name || p.tag.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700">选择实体（{selectedEntityIds.size}）</label>
                  <input
                    type="text"
                    value={entitySearch}
                    onChange={(e) => setEntitySearch(e.target.value)}
                    placeholder="搜索实体..."
                    className="neu-input px-2 py-1 text-xs w-32"
                  />
                </div>
                <select
                  value={entityTypeFilter}
                  onChange={(e) => setEntityTypeFilter(e.target.value)}
                  className="neu-input px-2 py-1 text-xs mb-2 bg-transparent"
                >
                  <option value="">全部类型</option>
                  <option value="R">R</option>
                  <option value="W">W</option>
                  <option value="RW">RW</option>
                </select>
                <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg bg-white/50 p-2">
                  {filteredEntities.length === 0 && <div className="text-xs text-gray-400 p-2">无实体</div>}
                  {filteredEntities.map((e) => (
                    <label
                      key={e.id}
                      className="flex items-center gap-2 p-2 hover:bg-indigo-50 rounded cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEntityIds.has(e.id)}
                        onChange={() => toggleEntity(e.id)}
                        className="w-4 h-4 accent-[#52c41a] shrink-0"
                      />
                      <span className="truncate">{e.display_name || e.name}</span>
                      <span className="text-[10px] px-1 rounded bg-gray-100 text-gray-600 shrink-0">{e.entity_type}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700">选择点位（{selectedTagIds.size}）</label>
                  <input
                    type="text"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="搜索点位..."
                    className="neu-input px-2 py-1 text-xs w-32"
                  />
                </div>
                <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg bg-white/50 p-2">
                  {filteredTags.length === 0 && <div className="text-xs text-gray-400 p-2">无点位</div>}
                  {filteredTags.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 p-2 hover:bg-indigo-50 rounded cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTagIds.has(t.id)}
                        onChange={() => toggleTag(t.id)}
                        className="w-4 h-4 accent-[#52c41a] shrink-0"
                      />
                      <span className="truncate">{t.display_name || t.name}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{t.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="mt-4 grid grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] text-gray-600 mb-1">绑定类型</label>
            <select
              value={bindingType}
              onChange={(e) => setBindingType(e.target.value as any)}
              className="neu-input w-full px-2 py-1.5 text-xs bg-transparent"
            >
              <option value="PHYSICAL">物理</option>
              <option value="VIRTUAL">虚拟</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-1">品牌</label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="可选"
              className="neu-input w-full px-2 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-1">优先级</label>
            <input
              type="number"
              min={1}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 1)}
              className="neu-input w-full px-2 py-1.5 text-xs"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#52c41a]"
              />
              启用
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="text-xs text-gray-500">
            {mode === 'auto'
              ? `将创建 ${matchedAutoPairs.length} 条绑定`
              : `将创建 ${manualBindingsCount} 条绑定（${selectedEntityIds.size} 实体 × ${selectedTagIds.size} 点位）`}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="neu-btn px-4 py-2 text-xs">取消</button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className="neu-btn px-4 py-2 text-xs bg-[#534AB7] text-white disabled:opacity-50"
            >
              {saving ? '绑定中...' : '确认绑定'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function matchName(tag: Tag, entity: Entity): boolean {
  const names = [
    tag.name,
    tag.display_name,
    entity.name,
    entity.display_name,
  ].filter(Boolean).map((n) => n!.trim().toLowerCase())
  const tagSet = new Set([names[0], names[1]])
  const entitySet = new Set([names[2], names[3]])
  return Array.from(tagSet).some((n) => entitySet.has(n))
}
