import { useEffect, useRef, useState } from 'react'

interface EditableCellProps {
  value: number
  onSave: (v: number) => Promise<void>
  disabled?: boolean
  className?: string
}

export default function EditableCell({ value, onSave, disabled, className = '' }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState(String(value))
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select()
    }
  }, [editing])

  const handleSave = async () => {
    const num = parseFloat(editVal)
    if (isNaN(num) || num === value) {
      setEditing(false)
      setEditVal(String(value))
      return
    }
    setSaving(true)
    try {
      await onSave(num)
      setEditing(false)
    } catch {
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (disabled) {
    return <span className={`font-mono-value text-gray-500 ${className}`}>{value}</span>
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        step="any"
        value={editVal}
        onChange={(e) => setEditVal(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') {
            setEditing(false)
            setEditVal(String(value))
          }
        }}
        disabled={saving}
        className="neu-input w-20 px-2 py-1 text-xs font-mono-value text-center editable-cell editing"
      />
    )
  }

  return (
    <span
      className={`editable-cell font-mono-value ${className}`}
      onClick={() => setEditing(true)}
      title="点击编辑"
    >
      {value}
    </span>
  )
}
