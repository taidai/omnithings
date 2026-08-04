/**
 * ZiZu API Client
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
  config?: Record<string, any>
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
  aggregate_fn: string | null
  formula: string | null
  formula_type: string | null
  sources: string[] | null
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
  validation?: {
    mqtt_connection: { status: string; message: string }
    message_parsing: { status: string; success_rate: number; parse_errors: number }
    normalization: { status: string; points_normalized: number; unmatched_rules: number }
    db_write: { status: string; write_errors: number; buffered_records: number; last_write_at: string | null }
  }
}

export interface NeuronNode {
  name: string
  plugin: string
  state?: number
}

export interface NeuronGroup {
  name: string
  interval: number
}

export interface NeuronTag {
  name: string
  address: string
  type?: number
}

export interface Category {
  id: string
  name: string
  node_type: string
  snapshot_enabled: boolean
  retention_days: number
  description: string | null
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

// ── Node Tree API (F3) ──

export interface TreeNode {
  id: string
  name: string
  parent_id: string | null
  layer: number
  node_type: string
  config: Record<string, any>
  sort_order: number
  enabled: boolean
  tag_count: number
  children: TreeNode[]
}

export interface NodeTag {
  id: string
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
}

/** 以 rootId 为根拉取整棵子树 (最大 5 层)。 */
export async function fetchNodeTree(rootId: string): Promise<TreeNode | null> {
  const res = await fetch(`${API_BASE}/nodes/${rootId}/tree`)
  if (!res.ok) throw new Error(`Fetch tree failed: ${res.status}`)
  const data = await res.json()
  return data.tree || null
}

/** 获取单个节点详情 (含其 tags 列表，用于实时值订阅)。 */
export async function fetchNodeDetail(nodeId: string): Promise<{ node: Node; tags: NodeTag[] }> {
  const res = await fetch(`${API_BASE}/nodes/${nodeId}`)
  if (!res.ok) throw new Error(`Fetch node failed: ${res.status}`)
  return res.json()
}

export interface NodeCreateInput {
  name: string
  parent_id?: string | null
  layer: number
  node_type?: string | null
  config?: Record<string, any>
  sort_order?: number
  enabled?: boolean
}

export async function createNode(input: NodeCreateInput): Promise<{ node: Node }> {
  const res = await fetch(`${API_BASE}/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Create node failed: ${res.status}`)
  }
  return res.json()
}

export async function deleteNode(nodeId: string): Promise<{ deleted: string; cascade_nodes: number }> {
  const res = await fetch(`${API_BASE}/nodes/${nodeId}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Delete node failed: ${res.status}`)
  }
  return res.json()
}

export interface TagCreateInput {
  node_id: string
  name: string
  tag_type?: 'PHYSICAL' | 'LOGICAL'
  data_type?: string
  display_name?: string
  unit?: string
  description?: string
  read_write?: string
  source_type?: string
  source_path?: string
  aggregate_fn?: string
  formula?: string
  formula_type?: string
  sources?: string[]
}

export async function createTag(input: TagCreateInput): Promise<{ status: string; id: string; name: string; tag_type: string }> {
  const res = await fetch(`${API_BASE}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Create tag failed: ${res.status}`)
  }
  return res.json()
}

export async function importNeuronTags(input: { node_id: string; neuron_node: string; neuron_group: string }): Promise<{ imported: number; skipped: number; total?: number; message?: string }> {
  const res = await fetch(`${API_BASE}/tags/import-neuron`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Import Neuron tags failed: ${res.status}`)
  }
  return res.json()
}

// ── Neuron Proxy API ──

export async function fetchNeuronNodes(): Promise<NeuronNode[]> {
  const res = await fetch(`${API_BASE}/neuron/nodes`)
  const data = await res.json()
  return data.nodes || []
}

export async function createNeuronNode(node: {
  name: string
  plugin: string
  host?: string
  port?: number
  device?: string
  baud?: number
}): Promise<any> {
  const res = await fetch(`${API_BASE}/neuron/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(node),
  })
  if (!res.ok) throw new Error(`Create node failed: ${res.status}`)
  return res.json()
}

export async function deleteNeuronNode(name: string): Promise<any> {
  const res = await fetch(`${API_BASE}/neuron/nodes/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`Delete node failed: ${res.status}`)
  return res.json()
}

export async function startNeuronNode(name: string): Promise<any> {
  const res = await fetch(`${API_BASE}/neuron/nodes/${encodeURIComponent(name)}/start`, {
    method: 'POST',
  })
  return res.json()
}

export async function stopNeuronNode(name: string): Promise<any> {
  const res = await fetch(`${API_BASE}/neuron/nodes/${encodeURIComponent(name)}/stop`, {
    method: 'POST',
  })
  return res.json()
}

export async function fetchNeuronGroups(node: string): Promise<NeuronGroup[]> {
  const res = await fetch(`${API_BASE}/neuron/groups?node=${encodeURIComponent(node)}`)
  const data = await res.json()
  return data.groups || []
}

export async function fetchNeuronTags(node: string, group: string): Promise<NeuronTag[]> {
  const res = await fetch(`${API_BASE}/neuron/tags?node=${encodeURIComponent(node)}&group=${encodeURIComponent(group)}`)
  const data = await res.json()
  return data.tags || []
}

export async function writeNeuronTag(node: string, group: string, tag: string, value: any): Promise<any> {
  const res = await fetch(`${API_BASE}/neuron/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node, group, tag, value }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Write tag failed: ${res.status}`)
  }
  return res.json()
}

// ── Category API ──

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE}/categories`)
  const data = await res.json()
  return data.categories || []
}

export async function createCategory(category: {
  name: string
  node_type: string
  snapshot_enabled: boolean
  retention_days: number
  description?: string
}): Promise<any> {
  const res = await fetch(`${API_BASE}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(category),
  })
  if (!res.ok) throw new Error(`Create category failed: ${res.status}`)
  return res.json()
}

export async function deleteCategory(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/categories/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`Delete category failed: ${res.status}`)
  return res.json()
}

export async function fetchTags(
  nodeId?: string,
  page = 1,
  pageSize = 50,
  search?: string,
  dataType?: string,
  tagType?: string,
  readWrite?: string,
  enabled?: boolean,
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
): Promise<{ tags: Tag[]; total: number; page: number; page_size: number; total_pages: number }> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (nodeId) params.set('node_id', nodeId)
  if (search) params.set('search', search)
  if (dataType) params.set('data_type', dataType)
  if (tagType) params.set('tag_type', tagType)
  if (readWrite) params.set('read_write', readWrite)
  if (enabled !== undefined) params.set('enabled', String(enabled))
  if (sortBy) params.set('sort_by', sortBy)
  if (sortOrder) params.set('sort_order', sortOrder)
  const res = await fetch(`${API_BASE}/tags?${params}`)
  return res.json()
}

export async function batchUpdateTags(
  tagIds: string[],
  updates: {
    scale_factor?: number
    value_offset?: number
    unit?: string
    read_write?: string
    enabled?: boolean
    node_id?: string
  },
): Promise<any> {
  const res = await fetch(`${API_BASE}/tags/batch`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_ids: tagIds, ...updates }),
  })
  if (!res.ok) throw new Error(`Batch update failed: ${res.status}`)
  return res.json()
}

export async function deleteTag(tagId: string): Promise<{ status: string; deleted: string }> {
  const res = await fetch(`${API_BASE}/tags/${tagId}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Delete tag failed: ${res.status}`)
  }
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
  nodeId?: string,
): Promise<TelemetryResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), range })
  if (tagId) params.set('tag_id', tagId)
  if (nodeId) params.set('node_id', nodeId)
  const res = await fetch(`${API_BASE}/telemetry?${params}`)
  return res.json()
}

export function exportTelemetryCsv(tagId?: string, range: '1h' | '24h' | '7d' | 'all' = '1h', nodeId?: string): void {
  const params = new URLSearchParams({ range })
  if (tagId) params.set('tag_id', tagId)
  if (nodeId) params.set('node_id', nodeId)
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

export interface MqttConfig {
  mqtt_telemetry_topic: string
  persisted: string | null
  effective_topics: string[]
}

export async function fetchMqttConfig(): Promise<MqttConfig> {
  const res = await fetch(`${API_BASE}/mqtt-config`)
  return res.json()
}

export async function updateMqttConfig(config: { mqtt_telemetry_topic: string }): Promise<MqttConfig> {
  const res = await fetch(`${API_BASE}/mqtt-config`, {
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

// ── Snapshot API ──

export interface SnapshotPoint {
  ts: string
  node_id: string
  node_name: string
  data: Record<string, any>
  raw_data: Record<string, any>
  quality: number | null
}

export interface SnapshotResponse {
  snapshots: SnapshotPoint[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export async function fetchSnapshots(
  nodeId?: string,
  range: '1h' | '24h' | '7d' | 'all' = '1h',
  page = 1,
  pageSize = 50,
): Promise<SnapshotResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), range })
  if (nodeId) params.set('node_id', nodeId)
  const res = await fetch(`${API_BASE}/snapshots?${params}`)
  return res.json()
}

export function exportSnapshotsCsv(nodeId?: string, range: '1h' | '24h' | '7d' | 'all' = '1h'): void {
  const params = new URLSearchParams({ range })
  if (nodeId) params.set('node_id', nodeId)
  const url = `${API_BASE}/snapshots/export?${params}`
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
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

// ── Node Config Update ──

export interface NodeUpdateRequest {
  name?: string
  node_type?: string
  sort_order?: number
  enabled?: boolean
  config?: Record<string, any>
}

export async function updateNode(nodeId: string, updates: NodeUpdateRequest): Promise<Node> {
  const res = await fetch(`${API_BASE}/nodes/${nodeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error(`Update node failed: ${res.status}`)
  const data = await res.json()
  return data.node || data
}

// ── Rules ──

export interface Rule {
  id: string
  name: string
  rule_type: 'alarm' | 'control' | 'fault_map' | 'linkage'
  jdm_content: Record<string, any>
  version: number
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface RuleCreateRequest {
  name: string
  rule_type: Rule['rule_type']
  jdm_content?: Record<string, any>
  enabled?: boolean
}

export async function fetchRules(): Promise<Rule[]> {
  const res = await fetch(`${API_BASE}/rules`)
  const data = await res.json()
  return data.rules || []
}

export async function fetchRule(ruleId: string): Promise<Rule> {
  const res = await fetch(`${API_BASE}/rules/${ruleId}`)
  if (!res.ok) throw new Error(`Fetch rule failed: ${res.status}`)
  return res.json()
}

export async function createRule(rule: RuleCreateRequest): Promise<Rule> {
  const res = await fetch(`${API_BASE}/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  })
  if (!res.ok) throw new Error(`Create rule failed: ${res.status}`)
  return res.json()
}

export async function updateRule(ruleId: string, updates: Partial<RuleCreateRequest>): Promise<Rule> {
  const res = await fetch(`${API_BASE}/rules/${ruleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error(`Update rule failed: ${res.status}`)
  return res.json()
}

export async function deleteRule(ruleId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/rules/${ruleId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`Delete rule failed: ${res.status}`)
}

export async function simulateRule(ruleId: string, context: Record<string, any>): Promise<any> {
  const res = await fetch(`${API_BASE}/rules/${ruleId}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context }),
  })
  if (!res.ok) throw new Error(`Simulate rule failed: ${res.status}`)
  return res.json()
}

export async function evaluateGraph(graph: Record<string, any>, context: Record<string, any>): Promise<any> {
  const res = await fetch(`${API_BASE}/rules/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: graph, context }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Evaluate graph failed: ${res.status}`)
  }
  return res.json()
}

// ── Rule Templates ──

export interface RuleTemplate {
  id: string
  name: string
  description: string | null
  rule_type: Rule['rule_type']
  graph: Record<string, any>
  config: Record<string, any>
  enabled: boolean
  is_default: boolean
  created_at: string
  updated_at: string
}

export async function fetchRuleTemplates(): Promise<RuleTemplate[]> {
  const res = await fetch(`${API_BASE}/rule-templates`)
  if (!res.ok) throw new Error(`Fetch templates failed: ${res.status}`)
  const data = await res.json()
  return data.templates || []
}

export async function fetchRuleTemplate(templateId: string): Promise<RuleTemplate> {
  const res = await fetch(`${API_BASE}/rule-templates/${templateId}`)
  if (!res.ok) throw new Error(`Fetch template failed: ${res.status}`)
  return res.json()
}

export interface RuleTemplateCreateInput {
  name: string
  description?: string | null
  rule_type: Rule['rule_type']
  graph?: Record<string, any>
  config?: Record<string, any>
  enabled?: boolean
}

export async function createRuleTemplate(input: RuleTemplateCreateInput): Promise<RuleTemplate> {
  const res = await fetch(`${API_BASE}/rule-templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Create template failed: ${res.status}`)
  return res.json()
}

export async function updateRuleTemplate(templateId: string, updates: Partial<RuleTemplateCreateInput>): Promise<RuleTemplate> {
  const res = await fetch(`${API_BASE}/rule-templates/${templateId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error(`Update template failed: ${res.status}`)
  return res.json()
}

export async function deleteRuleTemplate(templateId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/rule-templates/${templateId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete template failed: ${res.status}`)
}

// ── Alarms ──

export type AlarmLevel = 'INFO' | 'WARNING' | 'MAJOR' | 'CRITICAL'

export interface Alarm {
  id: string
  rule_id: string | null
  rule_name?: string
  node_id: string | null
  node_name?: string
  level: AlarmLevel
  message: string
  acknowledged: boolean
  ack_user: string | null
  ack_at: string | null
  created_at: string
  resolved_at: string | null
  source_topic?: string | null
  source_key?: string | null
  external_id?: string | null
}

export interface AlarmListResponse {
  alarms: Alarm[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export async function fetchAlarms(
  page = 1,
  pageSize = 50,
  level?: AlarmLevel,
  sourceKey?: string,
  acknowledged?: boolean,
  resolved?: boolean,
  nodeId?: string,
): Promise<AlarmListResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (level) params.set('level', level)
  if (sourceKey) params.set('source_key', sourceKey)
  if (acknowledged !== undefined) params.set('acknowledged', String(acknowledged))
  if (resolved !== undefined) params.set('resolved', String(resolved))
  if (nodeId) params.set('node_id', nodeId)
  const res = await fetch(`${API_BASE}/alarms?${params}`)
  if (!res.ok) throw new Error(`Fetch alarms failed: ${res.status}`)
  return res.json()
}

export async function fetchAlarmGroupCounts(): Promise<Record<string, number>> {
  const res = await fetch(`${API_BASE}/alarms/group-counts`)
  if (!res.ok) throw new Error(`Fetch alarm group counts failed: ${res.status}`)
  const data = await res.json()
  return data.counts || {}
}

export async function fetchAlarmCounts(nodeIds?: string[]): Promise<Record<string, number>> {
  const params = new URLSearchParams()
  if (nodeIds && nodeIds.length > 0) params.set('node_ids', nodeIds.join(','))
  const res = await fetch(`${API_BASE}/alarms/counts?${params}`)
  if (!res.ok) throw new Error(`Fetch alarm counts failed: ${res.status}`)
  const data = await res.json()
  return data.counts || {}
}

export async function acknowledgeAlarm(alarmId: string, ackUser = 'operator'): Promise<void> {
  const res = await fetch(`${API_BASE}/alarms/${alarmId}/acknowledge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ack_user: ackUser }),
  })
  if (!res.ok) throw new Error(`Acknowledge alarm failed: ${res.status}`)
}

export async function resolveAlarm(alarmId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/alarms/${alarmId}/resolve`, {
    method: 'PUT',
  })
  if (!res.ok) throw new Error(`Resolve alarm failed: ${res.status}`)
}
// ── Global Entities ──

export interface Entity {
  id: string
  name: string
  display_name: string | null
  entity_type: 'R' | 'W' | 'RW'
  data_type: string
  unit: string | null
  category: string | null
  description: string | null
  enabled: boolean
  binding_count: number
}

export interface EntityBinding {
  id: string
  entity_id: string
  tag_id: string
  node_id: string
  binding_type: 'PHYSICAL' | 'VIRTUAL'
  brand: string | null
  priority: number
  enabled: boolean
  tag_name?: string
  tag_display_name?: string
  node_name?: string
}

export interface EntityRealtime {
  entity_id: string
  entity_name: string
  entity_display_name: string | null
  value: number | string | boolean | null
  ts: string | null
  unit: string | null
  tag_id: string
  tag_name: string
  node_id: string
  node_name: string
}

export async function fetchEntities(params?: { category?: string; entity_type?: string; search?: string; enabled?: boolean; page?: number; page_size?: number }): Promise<{ items: Entity[]; total: number; page: number; page_size: number; total_pages: number }> {
  const qs = new URLSearchParams()
  if (params?.category) qs.set('category', params.category)
  if (params?.entity_type) qs.set('entity_type', params.entity_type)
  if (params?.search) qs.set('search', params.search)
  if (params?.enabled !== undefined) qs.set('enabled', String(params.enabled))
  qs.set('page', String(params?.page || 1))
  qs.set('page_size', String(params?.page_size || 50))
  const res = await fetch(`${API_BASE}/entities?${qs}`)
  if (!res.ok) throw new Error(`Fetch entities failed: ${res.status}`)
  return res.json()
}

export async function fetchEntity(entityId: string): Promise<Entity & { bindings: EntityBinding[] }> {
  const res = await fetch(`${API_BASE}/entities/${entityId}`)
  if (!res.ok) throw new Error(`Fetch entity failed: ${res.status}`)
  return res.json()
}

export async function createEntity(input: Omit<Entity, 'id' | 'binding_count'>): Promise<{ id: string; created_at: string }> {
  const res = await fetch(`${API_BASE}/entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Create entity failed: ${res.status}`)
  return res.json()
}

export async function updateEntity(entityId: string, input: Partial<Omit<Entity, 'id'>>): Promise<{ updated: boolean; updated_at?: string }> {
  const res = await fetch(`${API_BASE}/entities/${entityId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Update entity failed: ${res.status}`)
  return res.json()
}

export async function deleteEntity(entityId: string): Promise<{ deleted: boolean }> {
  const res = await fetch(`${API_BASE}/entities/${entityId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete entity failed: ${res.status}`)
  return res.json()
}

export async function bindTagToEntity(entityId: string, input: Omit<EntityBinding, 'id' | 'entity_id' | 'tag_name' | 'tag_display_name' | 'node_name'>): Promise<{ id: string; created_at: string }> {
  const res = await fetch(`${API_BASE}/entities/${entityId}/bindings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Bind tag failed: ${res.status}`)
  return res.json()
}

export async function unbindTagFromEntity(entityId: string, bindingId: string): Promise<{ deleted: boolean }> {
  const res = await fetch(`${API_BASE}/entities/${entityId}/bindings/${bindingId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Unbind tag failed: ${res.status}`)
  return res.json()
}

export async function fetchEntityRealtime(entityId: string): Promise<EntityRealtime> {
  const res = await fetch(`${API_BASE}/entities/${entityId}/realtime`)
  if (!res.ok) throw new Error(`Fetch entity realtime failed: ${res.status}`)
  return res.json()
}

export async function fetchEntityHistory(entityId: string, range = '1h', page = 1, pageSize = 500): Promise<{ points: { ts: string; value: number | string | boolean | null; quality: number }[]; total: number; page: number; page_size: number }> {
  const res = await fetch(`${API_BASE}/entities/${entityId}/history?range=${range}&page=${page}&page_size=${pageSize}`)
  if (!res.ok) throw new Error(`Fetch entity history failed: ${res.status}`)
  return res.json()
}

export async function writeEntityValue(entityId: string, value: any): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/entities/${entityId}/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) throw new Error(`Write entity failed: ${res.status}`)
  return res.json()
}

