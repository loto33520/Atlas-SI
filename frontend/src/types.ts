export type AuthConfig = {
  mode: 'local' | 'keycloak'
  local_username_hint: string | null
}

export type User = {
  subject: string
  username: string
  email: string | null
  display_name: string
  roles: string[]
  groups: string[]
  csrf_token: string
}

export type ObjectType = {
  id: string
  code: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  schema: Record<string, unknown>
  active: boolean
  object_count: number
  active_object_count: number
  created_at: string
  updated_at: string
}

export type RelationType = {
  id: string
  code: string
  name: string
  description: string | null
  source_type_id: string | null
  target_type_id: string | null
  directed: boolean
  color: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export type SIObject = {
  id: string
  external_id: string | null
  object_type_id: string
  name: string
  description: string | null
  status: string
  criticality: string
  owner_name: string | null
  data_owner_name: string | null
  review_status: 'draft' | 'validated' | 'outdated'
  confidence_level: 'unknown' | 'estimated' | 'confirmed'
  last_reviewed_at: string | null
  next_review_at: string | null
  review_frequency_days: number | null
  protection_level: 'public' | 'internal' | 'confidential' | 'restricted'
  tags: Record<string, string>
  attributes: Record<string, unknown>
  active: boolean
  created_at: string
  updated_at: string
}

export type SIRelation = {
  id: string
  relation_type_id: string
  source_id: string
  target_id: string
  label: string
  attributes: Record<string, unknown>
  active: boolean
  created_at: string
  updated_at: string
}

export type AuditEvent = {
  id: string
  created_at: string
  actor_username: string
  actor_email: string | null
  action: string
  entity_type: string
  entity_id: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  request_id: string | null
  source_ip: string | null
}

export type Dashboard = {
  object_types: number
  relation_types: number
  objects: number
  relations: number
  recent_audit_events: number
}

export type MapNode = {
  id: string
  external_id: string | null
  name: string
  description: string | null
  status: string
  criticality: string
  owner_name: string | null
  data_owner_name: string | null
  review_status: 'draft' | 'validated' | 'outdated'
  confidence_level: 'unknown' | 'estimated' | 'confirmed'
  last_reviewed_at: string | null
  next_review_at: string | null
  review_frequency_days: number | null
  protection_level: 'public' | 'internal' | 'confidential' | 'restricted'
  tags: Record<string, string>
  attributes: Record<string, unknown>
  object_type_id: string
  object_type_code: string
  object_type_name: string
  color: string
  icon: string | null
  x: number | null
  y: number | null
}

export type MapEdge = {
  id: string
  source_id: string
  target_id: string
  relation_type_id: string
  relation_type_code: string
  relation_type_name: string
  label: string
  color: string
  directed: boolean
  attributes: Record<string, unknown>
}

export type MapGraph = {
  view: string
  nodes: MapNode[]
  edges: MapEdge[]
  legends: Array<{ id: string; code: string; name: string; color: string; icon: string | null; count: number }>
  available_tags: Array<{ key: string; values: string[] }>
  total_nodes: number
  total_edges: number
  truncated: boolean
}

export type ImportAnalyse = {
  columns: string[]
  sample: Array<Record<string, unknown>>
  suggested_mapping: Record<string, string>
  row_count: number
}

export type ImportPreviewRow = {
  row_number: number
  status: string
  action: string
  identity: string
  message: string | null
  data: Record<string, unknown>
}

export type ImportJob = {
  id: string
  entity_kind: 'objects' | 'relations'
  source_format: 'csv' | 'json'
  filename: string | null
  status: 'preview' | 'applied' | 'rolled_back' | 'failed'
  duplicate_mode: 'skip' | 'update' | 'error'
  actor_sub: string
  actor_username: string
  mapping: Record<string, string>
  summary: Record<string, number | string>
  preview_rows: ImportPreviewRow[]
  changes: Array<Record<string, unknown>>
  applied_at: string | null
  rolled_back_at: string | null
  created_at: string
  updated_at: string
}

export type ImportJobSummary = Omit<ImportJob, 'mapping' | 'preview_rows' | 'changes'>

export type ImpactNode = {
  id: string
  name: string
  object_type_code: string
  object_type_name: string
  criticality: string
  owner_name: string | null
  depth: number
  paths_count: number
  impact_score: number
  is_root: boolean
}

export type ImpactEdge = {
  id: string
  source_id: string
  target_id: string
  relation_type_id: string
  relation_type_name: string
  label: string
  directed: boolean
}

export type ImpactPath = {
  node_ids: string[]
  relation_ids: string[]
  depth: number
}

export type ImpactCycle = {
  node_ids: string[]
  relation_ids: string[]
}

export type ImpactAnalysis = {
  root_object_id: string
  direction: 'upstream' | 'downstream' | 'both'
  max_depth: number
  nodes: ImpactNode[]
  edges: ImpactEdge[]
  paths: ImpactPath[]
  cycles: ImpactCycle[]
  summary: {
    total_nodes: number
    total_edges: number
    max_depth_reached: number
    by_type: Record<string, number>
    by_criticality: Record<string, number>
    owners: string[]
    has_cycles: boolean
  }
}

export type ImpactScenario = {
  id: string
  name: string
  description: string | null
  root_object_id: string
  direction: 'upstream' | 'downstream' | 'both'
  max_depth: number
  relation_type_ids: string[]
  excluded_object_ids: string[]
  result_snapshot: ImpactAnalysis
  actor_sub: string
  actor_username: string
  active: boolean
  created_at: string
  updated_at: string
}

export type VersionObservation = {
  id: string
  object_id: string
  observed_version: string | null
  target_version: string | null
  latest_version: string | null
  support_end_date: string | null
  observed_at: string
  source: string
  source_reference: string | null
  compliance_status: 'up_to_date' | 'update_available' | 'unsupported' | 'exception' | 'unknown'
  exception_until: string | null
  notes: string | null
  details: Record<string, unknown>
  connector_run_id: string | null
  actor_sub: string
  actor_username: string
  active: boolean
  created_at: string
  updated_at: string
}

export type VersionCurrent = VersionObservation & {
  object_name: string
  object_type_name: string
  owner_name: string | null
  criticality: string
}

export type VersionSummary = {
  total: number
  by_status: Record<string, number>
  unsupported: number
  update_available: number
  up_to_date: number
  unknown: number
  exceptions: number
  expiring_within_90_days: number
}

export type Connector = {
  id: string
  name: string
  description: string | null
  connector_type: 'http_versions'
  url: string
  source_format: 'json' | 'csv'
  mapping: Record<string, string>
  headers: Record<string, string>
  schedule_minutes: number
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  last_status: string | null
  last_message: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export type ConnectorRun = {
  id: string
  connector_id: string
  started_at: string
  finished_at: string | null
  status: string
  triggered_by: string
  actor_sub: string
  actor_username: string
  summary: Record<string, number | boolean | string>
  message: string | null
}

export type Language = 'fr' | 'en'

export type DesignSettings = {
  app_title: string
  app_subtitle: string
  logo_data_url: string | null
  theme_mode: 'light' | 'dark' | 'system'
  primary_color: string
  accent_color: string
  sidebar_color: string
  background_color: string
  surface_color: string
  border_radius: number
  default_language: Language
  allow_user_language_choice: boolean
  updated_at: string | null
}

export type QualityIssue = {
  code: string
  severity: 'critical' | 'warning' | 'information'
  object_id: string | null
  object_name: string | null
  object_type: string | null
  message_fr: string
  message_en: string
}

export type QualitySummary = {
  score: number
  total_issues: number
  critical: number
  warning: number
  information: number
  by_code: Record<string, number>
}

export type FeatureDefinition = {
  code: string
  name_fr: string
  name_en: string
  description_fr: string
  description_en: string
  maturity_level: number
  category: string
  dependencies: string[]
  toggleable: boolean
  enabled: boolean
}

export type FeatureSettings = {
  enabled_features: string[]
  options: Record<string, unknown>
  features: FeatureDefinition[]
  updated_at: string | null
}

export type MapCatalog = {
  object_types: ObjectType[]
  relation_types: RelationType[]
  max_recursion_depth: number
  max_displayed_nodes: number
}

export type MapQuery = {
  root_object_ids: string[]
  object_type_ids: string[]
  relation_type_ids: string[]
  direction: 'upstream' | 'downstream' | 'both'
  max_depth: number
  q?: string
  criticalities: string[]
  statuses: string[]
  tags: string[]
  limit: number
  position_view_key: string
}

export type SavedMap = {
  id: string
  name: string
  description: string | null
  map_mode: 'dynamic' | 'snapshot'
  visibility: 'private' | 'all' | 'groups'
  group_names: string[]
  owner_sub: string
  owner_username: string
  root_object_ids: string[]
  object_type_ids: string[]
  relation_type_ids: string[]
  direction: 'upstream' | 'downstream' | 'both'
  max_depth: number
  filters: Record<string, unknown>
  layout_mode: string
  camera: Record<string, unknown>
  positions: Record<string, unknown>
  protection_level: 'public' | 'internal' | 'confidential' | 'restricted'
  snapshot: Record<string, unknown>
  active: boolean
  created_at: string
  updated_at: string
}
