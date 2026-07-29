/**
 * OmniThings API Client
 * 封装后端 REST + WebSocket 调用
 */

const API_BASE = '/api/v1'
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/ws/telemetry`

// ── Types ──

export interface Node {
  id: string
  name: string
  parent_id: string | null
  layer: number
  node_type: string
  sort_order: number
  enabled: boolean
  tag_count: number
}

export interface Tag {
  id: string
  node_id: string
  node_name: string
  name: string
  display_name: string | null
  data_type: string
  tag_type: string
  unit: string | null
  scale_factor: number
  value_offset: number
  source_path: string | null
  read_write: string
  enabled: boolean
  description: string | null
  raw_value: number | null
  eng_value: number | null
  latest_ts: string | null
  quality: number | null
}

export interface HealthStatus {
  status: string
  version: string
  uptime_seconds: number
  components: {
    timescaledb: { status: string }
    mqtt: { status: string }
    neuron: { status: string }
  }
  pipeline: {
    status: string
    messages_received: number
    points_written_db: number
    last_message_at: string | null
  }
}

export interface TelemetryUpdate {
  tag_id: string
  raw_value: number | null
  eng_value: number | null
  ts: string | null
  quality: number
}

// ── REST API ──

export async function fetchNodes(): Promise<Node[]> {
  const res = await fetch(`${API_BASE}/nodes`)
  const data = await res.json()
  return data.nodes || []
}

export async function fetchTags(
  nodeId?: string,
  page = 1,
  pageSize = 50,
  search?: string,
  dataType?: string,
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
): Promise<{ tags: Tag[]; total: number; page: number; page_size: number; total_pages: number }> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (nodeId) params.set('node_id', nodeId)
  if (search) params.set('search', search)
  if (dataType) params.set('data_type', dataType)
  if (sortBy) params.set('sort_by', sortBy)
  if (sortOrder) params.set('sort_order', sortOrder)
  const res = await fetch(`${API_BASE}/tags?${params}`)
  return res.json()
}

export async function batchUpdateTags(tagIds: string[], updates: { scale_factor?: number; value_offset?: number }): Promise<any> {
  const res = await fetch(`${API_BASE}/tags/batch`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_ids: tagIds, ...updates }),
  })
  if (!res.ok) throw new Error(`Batch update failed: ${res.status}`)
  return res.json()
}

export function exportTagsCsv(nodeId?: string, search?: string): void {
  const params = new URLSearchParams()
  if (nodeId) params.set('node_id', nodeId)
  if (search) params.set('search', search)
  const url = `${API_BASE}/tags/export?${params}`
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export async function updateTag(tagId: string, updates: Partial<Pick<Tag, 'scale_factor' | 'value_offset' | 'unit' | 'display_name'>>): Promise<any> {
  const res = await fetch(`${API_BASE}/tags/${tagId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error(`Update failed: ${res.status}`)
  return res.json()
}

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API_BASE}/health`)
  return res.json()
}

export interface HistoryPoint {
  ts: string
  raw_value: number | null
  eng_value: number | null
}

export interface HistoryResponse {
  tag_id: string
  tag_name: string
  range: string
  bucket: string
  points: HistoryPoint[]
}

export async function fetchTagHistory(tagId: string, range: '1h' | '24h' | '7d'): Promise<HistoryResponse> {
  const res = await fetch(`${API_BASE}/tags/${tagId}/history?range=${range}`)
  if (!res.ok) throw new Error(`History fetch failed: ${res.status}`)
  return res.json()
}

export interface TelemetryPoint {
  ts: string
  tag_id: string
  tag_name: string
  node_name: string
  raw_value: number | null
  eng_value: number | null
  quality: number | null
}

export interface TelemetryResponse {
  points: TelemetryPoint[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export async function fetchTelemetry(
  tagId?: string,
  range: '1h' | '24h' | '7d' | 'all' = '1h',
  page = 1,
  pageSize = 50,
): Promise<TelemetryResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), range })
  if (tagId) params.set('tag_id', tagId)
  const res = await fetch(`${API_BASE}/telemetry?${params}`)
  return res.json()
}

export function exportTelemetryCsv(tagId?: string, range: '1h' | '24h' | '7d' | 'all' = '1h'): void {
  const params = new URLSearchParams({ range })
  if (tagId) params.set('tag_id', tagId)
  const url = `${API_BASE}/telemetry/export?${params}`
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ── Admin / Developer API ──

export interface PipelineConfig {
  batch_size: number
  flush_interval_sec: number
}

export async function fetchPipelineConfig(): Promise<PipelineConfig> {
  const res = await fetch(`${API_BASE}/pipeline/config`)
  return res.json()
}

export async function updatePipelineConfig(config: PipelineConfig): Promise<any> {
  const res = await fetch(`${API_BASE}/pipeline/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!res.ok) throw new Error(`Update failed: ${res.status}`)
  return res.json()
}

export interface SqlQueryResult {
  columns: string[]
  rows: any[][]
  row_count: number
  sql: string
}

export async function executeSql(sql: string, limit = 500): Promise<SqlQueryResult> {
  const res = await fetch(`${API_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, limit }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
    throw new Error(err.detail || `Query failed: ${res.status}`)
  }
  return res.json()
}

export async function truncateTable(table: string, confirm: string): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/truncate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, confirm }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
    throw new Error(err.detail || `Truncate failed: ${res.status}`)
  }
  return res.json()
}

// ── WebSocket ──

export type TelemetryCallback = (updates: TelemetryUpdate[]) => void

export function connectTelemetryWS(
  onMessage: TelemetryCallback,
  tagIds?: string[],
): () => void {
  const ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    if (tagIds && tagIds.length > 0) {
      ws.send(JSON.stringify({ subscribe: tagIds }))
    }
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.tags && Array.isArray(data.tags)) {
        onMessage(data.tags)
      }
    } catch {
      // ignore parse errors
    }
  }

  ws.onerror = (err) => {
    console.error('[WS] Error:', err)
  }

  return () => {
    ws.close()
  }
}
