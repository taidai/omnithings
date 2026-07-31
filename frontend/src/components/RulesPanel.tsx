import { useCallback, useEffect, useState } from 'react'
import {
  fetchRules, createRule, updateRule, deleteRule, simulateRule,
  type Rule, type RuleSimulateResult,
} from '../api/client'

const TYPE_LABEL: Record<string, string> = {
  alarm: '告警',
  control: '控制',
  linkage: '联动',
}

const TYPE_STYLE: Record<string, string> = {
  alarm: 'bg-red-100 text-red-600',
  control: 'bg-blue-100 text-blue-600',
  linkage: 'bg-purple-100 text-purple-600',
}

export default function RulesPanel() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [simResult, setSimResult] = useState<Record<string, RuleSimulateResult>>({})

  // 新建表单
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('alarm')
  const [newWhen, setNewWhen] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [newLevel, setNewLevel] = useState('WARNING')
  const [creating, setCreating] = useState(false)

  // 模拟输入
  const [simContext, setSimContext] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRules(await fetchRules())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!newName.trim() || !newWhen.trim()) {
      alert('请填写规则名和触发条件')
      return
    }
    setCreating(true)
    try {
      await createRule({
        name: newName.trim(),
        rule_type: newType,
        jdm_content: {
          when: newWhen.trim(),
          actions: [{ type: 'alarm', level: newLevel, message: newMessage.trim() || newName.trim() }],
        },
        enabled: true,
      })
      setShowCreate(false)
      setNewName(''); setNewWhen(''); setNewMessage('')
      await load()
    } catch (e: any) {
      alert(`创建失败: ${e.message}`)
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (rule: Rule) => {
    try {
      await updateRule(rule.id, { enabled: !rule.enabled })
      await load()
    } catch (e: any) {
      alert(`更新失败: ${e.message}`)
    }
  }

  const handleDelete = async (rule: Rule) => {
    if (!confirm(`确认删除规则「${rule.name}」？`)) return
    try {
      await deleteRule(rule.id)
      await load()
    } catch (e: any) {
      alert(`删除失败: ${e.message}`)
    }
  }

  const handleSimulate = async (rule: Rule) => {
    const raw = (simContext[rule.id] || '').trim()
    let context: Record<string, any> = {}
    if (raw) {
      try {
        context = JSON.parse(raw)
      } catch {
        alert('模拟上下文需为 JSON，例如 {"电流": 500}')
        return
      }
    }
    try {
      const result = await simulateRule(rule.id, context)
      setSimResult((prev) => ({ ...prev, [rule.id]: result }))
    } catch (e: any) {
      alert(`模拟失败: ${e.message}`)
    }
  }

  return (
    <div>
      <div className="neu-card p-4 mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-gray-700">规则引擎</span>
        <span className="text-xs text-gray-400">共 {rules.length} 条规则</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="neu-btn px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-[#389e0d] disabled:opacity-50"
          >
            {loading ? '加载中...' : '刷新'}
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="neu-btn px-4 py-1.5 text-xs font-medium text-white bg-[#52c41a] hover:bg-[#389e0d]"
          >
            {showCreate ? '取消' : '+ 新建规则'}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="neu-card p-4 mb-4 bg-[#52c41a]/5 border border-[#52c41a]/20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">规则名</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：电流越限告警"
                className="neu-input w-full px-3 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">类型</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="neu-input w-full px-3 py-1.5 text-xs"
              >
                <option value="alarm">告警</option>
                <option value="control">控制</option>
                <option value="linkage">联动</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">触发条件（when 表达式）</label>
              <input
                value={newWhen}
                onChange={(e) => setNewWhen(e.target.value)}
                placeholder={'例如：电流 > 500'}
                className="neu-input w-full px-3 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">告警级别</label>
              <select
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value)}
                className="neu-input w-full px-3 py-1.5 text-xs"
              >
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="MAJOR">MAJOR</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">告警消息</label>
              <input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="触发时写入的告警内容"
                className="neu-input w-full px-3 py-1.5 text-xs"
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="neu-btn px-4 py-1.5 text-xs font-medium text-white bg-[#52c41a] hover:bg-[#389e0d] disabled:opacity-50"
          >
            {creating ? '创建中...' : '创建规则'}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {rules.length === 0 && !loading && (
          <div className="neu-card p-8 text-center text-xs text-gray-400">
            暂无规则，点击「+ 新建规则」创建第一条
          </div>
        )}
        {rules.map((rule) => {
          const sim = simResult[rule.id]
          return (
            <div key={rule.id} className="neu-card p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${TYPE_STYLE[rule.rule_type] || 'bg-gray-100 text-gray-500'}`}>
                  {TYPE_LABEL[rule.rule_type] || rule.rule_type}
                </span>
                <span className="text-sm font-medium text-gray-800">{rule.name}</span>
                <span className={`w-2 h-2 rounded-full ${rule.enabled ? 'bg-[#52c41a]' : 'bg-gray-300'}`} />
                <span className="text-xs text-gray-400">{rule.enabled ? '已启用' : '已停用'}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => handleToggle(rule)}
                    className="neu-btn px-3 py-1 text-xs text-gray-600 hover:text-[#389e0d]"
                  >
                    {rule.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    onClick={() => handleDelete(rule)}
                    className="neu-btn px-3 py-1 text-xs text-red-500 hover:text-red-600"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500 font-mono bg-gray-50 rounded px-3 py-2">
                when: {rule.jdm_content?.when || '—'}
              </div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <input
                  value={simContext[rule.id] || ''}
                  onChange={(e) => setSimContext((prev) => ({ ...prev, [rule.id]: e.target.value }))}
                  placeholder='模拟上下文 JSON，如 {"电流": 500}'
                  className="neu-input flex-1 min-w-[220px] px-3 py-1.5 text-xs font-mono"
                />
                <button
                  onClick={() => handleSimulate(rule)}
                  className="neu-btn px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-[#389e0d]"
                >
                  模拟
                </button>
                {sim && (
                  <span className={`text-xs font-medium ${sim.triggered ? 'text-red-500' : 'text-[#389e0d]'}`}>
                    {sim.triggered ? '✓ 触发' : '✗ 未触发'}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
