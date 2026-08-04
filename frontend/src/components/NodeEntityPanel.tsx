import { useEffect, useMemo, useState } from 'react'
import {
  fetchEntities,
  fetchEntitiesByNode,
  fetchEntityRealtime,
  fetchTags,
  bindTagToEntity,
  unbindTagFromEntity,
  type Entity,
  type Tag,
} from '../api/client'

interface Props {
  nodeId: string
}

export default function NodeEntityPanel({ nodeId }: Props) {
  const [entities, setEntities] = useState<Entity[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [allEntities, setAllEntities] = useState<Entity[]>([])
  const [realtimeMap, setRealtimeMap] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(false)
  const [showBind, setShowBind] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [eData, tData] = await Promise.all([
        fetchEntitiesByNode(nodeId),
        fetchTags(nodeId, 1, 200),
      ])
      setEntities(eData.items)
      setTags(tData.tags)
    } finally {
      setLoading(false)
    }
  }

  const loadAllEntities = async () => {
    try {
      const data = await fetchEntities({ page_size: 200 })
      setAllEntities(data.items)
    } catch {}
  }

  useEffect(() => {
    load()
    loadAllEntities()
  }, [nodeId])

  useEffect(() => {
    if (entities.length === 0) return
    let cancelled = false
    const poll = async () => {
      const map: Record<string, any> = {}
      await Promise.all(
        entities.map(async (e) => {
          try {
            map[e.id] = await fetchEntityRealtime(e.id)
          } catch {
            map[e.id] = null
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
  }, [entities])

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

  const handleUnbind = async (entityId: string, bindingId?: string) => {
    if (!bindingId) return
    if (!confirm('确定解除该绑定？')) return
    await unbindTagFromEntity(entityId, bindingId)
    load()
  }

  return (
    <div className="neu-card p-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-800">全局实体</h3>
        <button
          onClick={() => setShowBind(true)}
          className="neu-btn px-3 py-1.5 text-xs bg-[#52c41a] text-white"
        >
          绑定实体
        </button>
      </div>

      {loading && <div className="text-xs text-gray-400">加载中...</div>}

      <div className="space-y-2">
        {entities.map((e) => {
          const rt = realtimeMap[e.id]
          return (
            <div key={e.id} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-800">
                    {e.display_name || e.name}
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600">
                      {e.entity_type}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {e.name} · {e.data_type} · 绑定 {e.binding_count} 个点位
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-mono-value font-bold text-gray-800">
                    {rt?.value === null || rt?.value === undefined ? '—' : String(rt.value)}
                    {rt?.value !== null && rt?.value !== undefined && e.unit ? ` ${e.unit}` : ''}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {rt?.ts ? new Date(rt.ts).toLocaleString() : '无实时值'}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {entities.length === 0 && !loading && (
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


