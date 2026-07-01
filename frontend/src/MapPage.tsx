import cytoscape, { Core, EdgeSingular, ElementDefinition, EventObjectNode, NodeSingular } from 'cytoscape'
import edgehandles from 'cytoscape-edgehandles'
import dagre from 'cytoscape-dagre'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from './api'
import type { DesignSettings, Language, MapCatalog, MapEdge, MapGraph, MapNode, RelationType, SavedMap, SIObject, User, VersionObservation } from './types'

cytoscape.use(edgehandles)
cytoscape.use(dagre)

type Notice = { kind: 'success' | 'error'; text: string } | null
type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null
type LayoutMode = 'layers' | 'constellation' | 'grid'
type MapTheme = 'dark' | 'light'
type NodeAppearance = 'icons' | 'minimal'
type GroupingSource = 'type' | 'tag' | 'attribute'
type GroupFocus = { source: GroupingSource; key: string; value: string } | null
type HierarchyGroupingSource = 'none' | 'tag' | 'attribute'
type HierarchyGrouping = { source: HierarchyGroupingSource; key: string }
type HierarchyLevel = { id: string; name: string; object_type_ids: string[]; grouping: HierarchyGrouping }
type HierarchyConfig = { enabled: boolean; levels: HierarchyLevel[] }
type QuickObjectForm = {
  object_type_id: string
  name: string
  description: string
  owner_name: string
  criticality: string
  tags: string
  attributes: Record<string, string>
  startLinkMode: boolean
}

const VERSION_STATUS_LABELS: Record<string, string> = {
  up_to_date: 'À jour',
  update_available: 'Mise à jour disponible',
  unsupported: 'Non supporté',
  exception: 'Exception acceptée',
  unknown: 'Information inconnue'
}

const VIEW_OPTIONS = [
  { value: 'all', label: 'Ensemble', short: 'Tout' },
  { value: 'process', label: 'Processus', short: 'Métier' },
  { value: 'application', label: 'Applications', short: 'Apps' },
  { value: 'infrastructure', label: 'Infrastructure', short: 'Infra' },
  { value: 'data', label: 'Données', short: 'Data' },
  { value: 'administration', label: 'Administration du SI', short: 'Admin' },
  { value: 'ecosystem', label: 'Écosystème', short: 'Éco' }
]

const TYPE_ORDER: Record<string, string[]> = {
  all: ['process', 'application', 'data', 'database', 'software', 'server', 'network', 'site'],
  process: ['process', 'application', 'data'],
  application: ['application', 'data', 'database', 'software', 'server'],
  infrastructure: ['site', 'building', 'room', 'rack', 'physical_server', 'server', 'storage', 'network', 'network_zone', 'vlan', 'subnet', 'firewall', 'telecom_link', 'software', 'database'],
  data: ['process', 'application', 'data', 'database'],
  administration: ['admin_profile', 'privileged_account', 'bastion', 'admin_workstation', 'server', 'application'],
  ecosystem: ['organisation', 'supplier', 'saas_service', 'contract', 'application', 'data']
}

const TYPE_ACCENTS: Record<string, string> = {
  process: '#63a9cf',
  application: '#5ea8d6',
  data: '#79a9c2',
  database: '#5f99c8',
  software: '#78a8ca',
  server: '#5ca2d3',
  network: '#78a7d0',
  site: '#92adc1'
}

const TYPE_ICONS: Record<string, string> = {
  process: '<circle cx="27" cy="28" r="5"/><circle cx="69" cy="28" r="5"/><circle cx="48" cy="68" r="5"/><path d="M32 30h18c10 0 14 6 14 14v2M64 33v10c0 10-6 18-16 20M43 63c-8-2-13-8-13-17v-8"/>',
  application: '<rect x="24" y="25" width="48" height="43" rx="7"/><path d="M24 38h48M34 31h1M43 31h1"/>',
  data: '<path d="M27 31c0-7 9-12 21-12s21 5 21 12-9 12-21 12-21-5-21-12Z"/><path d="M27 31v17c0 7 9 12 21 12s21-5 21-12V31M27 48v17c0 7 9 12 21 12s21-5 21-12V48"/>',
  database: '<ellipse cx="48" cy="28" rx="22" ry="10"/><path d="M26 28v20c0 6 10 10 22 10s22-4 22-10V28M26 48v18c0 6 10 10 22 10s22-4 22-10V48"/>',
  software: '<path d="m39 31-13 17 13 17M57 31l13 17-13 17M53 25 43 71"/>',
  server: '<rect x="25" y="20" width="46" height="17" rx="4"/><rect x="25" y="40" width="46" height="17" rx="4"/><rect x="25" y="60" width="46" height="17" rx="4"/><path d="M33 29h1M33 49h1M33 69h1M42 29h18M42 49h18M42 69h18"/>',
  network: '<circle cx="48" cy="24" r="7"/><circle cx="25" cy="68" r="7"/><circle cx="71" cy="68" r="7"/><circle cx="48" cy="51" r="6"/><path d="m48 31v14M43 55 30 64M53 55l13 9"/>',
  site: '<path d="M25 76V28l23-10 23 10v48M36 76V38h24v38M42 46h4M52 46h4M42 56h4M52 56h4M45 76V66h6v10"/>'
}

const EMPTY_GRAPH: MapGraph = {
  view: 'all', nodes: [], edges: [], legends: [], available_tags: [], total_nodes: 0, total_edges: 0, truncated: false
}

const MAP_WHEEL_SENSITIVITY = Number(import.meta.env.VITE_MAP_WHEEL_SENSITIVITY || '0.85')
const MAP_MIN_ZOOM = Number(import.meta.env.VITE_MAP_MIN_ZOOM || '0.12')
const MAP_MAX_ZOOM = Number(import.meta.env.VITE_MAP_MAX_ZOOM || '4.8')
const MAP_DEFAULT_THEME = ((import.meta.env.VITE_MAP_DEFAULT_THEME || 'light').toLowerCase() === 'dark' ? 'dark' : 'light') as MapTheme


function hierarchyLevelIndex(node: MapNode, levels: HierarchyLevel[]): number {
  return levels.findIndex((level) => level.object_type_ids.includes(node.object_type_id))
}

function hierarchyTypeIds(levels: HierarchyLevel[]): string[] {
  return [...new Set(levels.flatMap((level) => level.object_type_ids))]
}

function emptyHierarchyGrouping(): HierarchyGrouping {
  return { source: 'none', key: '' }
}

function defaultHierarchyLevels(_catalog: MapCatalog | null): HierarchyLevel[] {
  return [
    { id: 'level-1', name: 'Niveau 1', object_type_ids: [], grouping: emptyHierarchyGrouping() },
    { id: 'level-2', name: 'Niveau 2', object_type_ids: [], grouping: emptyHierarchyGrouping() }
  ]
}

function parseHierarchyConfig(value: unknown, catalog: MapCatalog | null): HierarchyConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { enabled: false, levels: defaultHierarchyLevels(catalog) }
  const raw = value as { enabled?: unknown; levels?: unknown }
  const allowedIds = new Set(catalog?.object_types.filter((item) => item.active).map((item) => item.id) ?? [])
  const levels = Array.isArray(raw.levels) ? raw.levels.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const level = item as { id?: unknown; name?: unknown; object_type_ids?: unknown; grouping?: unknown }
    const objectTypeIds = Array.isArray(level.object_type_ids) ? level.object_type_ids.map(String).filter((id) => allowedIds.has(id)) : []
    const rawGrouping = level.grouping && typeof level.grouping === 'object' && !Array.isArray(level.grouping)
      ? level.grouping as { source?: unknown; key?: unknown }
      : null
    const source = rawGrouping?.source === 'tag' || rawGrouping?.source === 'attribute' ? rawGrouping.source : 'none'
    return {
      id: String(level.id ?? `level-${index + 1}`),
      name: String(level.name ?? `Niveau ${index + 1}`),
      object_type_ids: objectTypeIds,
      grouping: { source, key: source === 'none' ? '' : String(rawGrouping?.key ?? '') }
    }
  }).filter((item): item is HierarchyLevel => Boolean(item)) : []
  const validLevels = levels.length >= 2 ? levels : defaultHierarchyLevels(catalog)
  const complete = validLevels.every((level) => level.object_type_ids.length > 0 && (level.grouping.source === 'none' || Boolean(level.grouping.key)))
  return { enabled: Boolean(raw.enabled) && complete, levels: validLevels }
}

function hierarchyValueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
  if (Array.isArray(value)) return value.map((item) => hierarchyValueText(item)).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function hierarchyGroupingValue(node: MapNode, grouping: HierarchyGrouping): string {
  if (grouping.source === 'tag') return String(node.tags[grouping.key] ?? '').trim() || 'Non renseigné'
  if (grouping.source === 'attribute') return hierarchyValueText(node.attributes[grouping.key]).trim() || 'Non renseigné'
  return ''
}

function hierarchyGroupId(level: HierarchyLevel, parentId: string | undefined, value: string): string {
  const raw = `${level.id}|${parentId ?? 'root'}|${level.grouping.source}|${level.grouping.key}|${value}`
  let hash = 2166136261
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `hierarchy-group-${(hash >>> 0).toString(36)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] ?? char))
}

function parseAttributeEditor(value: string): Record<string, unknown> {
  const attributes: Record<string, unknown> = {}
  for (const part of value.split(';').map((item) => item.trim()).filter(Boolean)) {
    const separator = part.includes('=') ? '=' : part.includes(':') ? ':' : ''
    if (!separator) throw new Error(`Information invalide : ${part}. Utilise clé=valeur.`)
    const [rawKey, ...rest] = part.split(separator)
    const key = rawKey.trim()
    if (!key) throw new Error(`Information invalide : ${part}. La clé est vide.`)
    attributes[key] = rest.join(separator).trim()
  }
  return attributes
}

function formatAttributeEditor(attributes: Record<string, unknown>): string {
  return Object.entries(attributes).map(([key, value]) => `${key}=${hierarchyValueText(value)}`).join('; ')
}

function mergeGraph(current: MapGraph, added: MapGraph): MapGraph {
  const nodes = new Map(current.nodes.map((node) => [node.id, node]))
  const edges = new Map(current.edges.map((edge) => [edge.id, edge]))
  added.nodes.forEach((node) => nodes.set(node.id, node))
  added.edges.forEach((edge) => edges.set(edge.id, edge))

  const legends = new Map(current.legends.map((item) => [item.code, item]))
  added.legends.forEach((item) => legends.set(item.code, item))
  const tagValues = new Map<string, Set<string>>()
  for (const item of [...current.available_tags, ...added.available_tags]) {
    const values = tagValues.get(item.key) ?? new Set<string>()
    item.values.forEach((value) => values.add(value))
    tagValues.set(item.key, values)
  }
  return {
    ...current,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    legends: [...legends.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    available_tags: [...tagValues.entries()].map(([key, values]) => ({ key, values: [...values].sort() })),
    total_nodes: nodes.size,
    total_edges: edges.size,
    truncated: current.truncated || added.truncated
  }
}

function graphWithStoredPositions(graph: MapGraph, positions: Record<string, unknown>): MapGraph {
  if (!positions || typeof positions !== 'object') return graph
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const value = positions[node.id]
      if (!value || typeof value !== 'object' || Array.isArray(value)) return node
      const position = value as { x?: unknown; y?: unknown }
      return typeof position.x === 'number' && typeof position.y === 'number' ? { ...node, x: position.x, y: position.y } : node
    })
  }
}

function svgNodeBadge(typeCode: string, theme: MapTheme, appearance: NodeAppearance): string {
  const accent = TYPE_ACCENTS[typeCode] ?? '#72808e'
  const fill = theme === 'dark' ? '#171c22' : '#ffffff'
  const inner = theme === 'dark' ? '#242b34' : '#eef1f4'
  const icon = appearance === 'icons' ? (TYPE_ICONS[typeCode] ?? '') : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="43" fill="${fill}" stroke="${inner}" stroke-width="5"/><circle cx="48" cy="48" r="39" fill="none" stroke="${accent}" stroke-width="2.5" opacity=".92"/><g fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${icon}</g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function initialPositions(nodes: MapNode[], view: string, mode: LayoutMode): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>()
  const saved = nodes.filter((node) => node.x !== null && node.y !== null)
  if (saved.length / Math.max(nodes.length, 1) >= 0.7) {
    nodes.forEach((node) => result.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 }))
    return result
  }

  if (mode === 'grid') {
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length * 1.4)))
    nodes.forEach((node, index) => result.set(node.id, { x: (index % columns) * 155, y: Math.floor(index / columns) * 130 }))
    return result
  }

  const groups = new Map<string, MapNode[]>()
  nodes.forEach((node) => groups.set(node.object_type_code, [...(groups.get(node.object_type_code) ?? []), node]))
  const orderedCodes = [...(TYPE_ORDER[view] ?? TYPE_ORDER.all).filter((code) => groups.has(code)), ...[...groups.keys()].filter((code) => !(TYPE_ORDER[view] ?? TYPE_ORDER.all).includes(code))]

  if (mode === 'constellation') {
    const orbit = Math.max(250, orderedCodes.length * 85)
    orderedCodes.forEach((code, groupIndex) => {
      const group = groups.get(code) ?? []
      const angle = (Math.PI * 2 * groupIndex) / Math.max(orderedCodes.length, 1) - Math.PI / 2
      const centerX = Math.cos(angle) * orbit
      const centerY = Math.sin(angle) * orbit
      const localRadius = Math.max(70, Math.sqrt(group.length) * 58)
      group.forEach((node, index) => {
        const localAngle = (Math.PI * 2 * index) / Math.max(group.length, 1) + angle
        const ring = group.length <= 1 ? 0 : localRadius * (0.72 + (index % 3) * 0.14)
        result.set(node.id, { x: centerX + Math.cos(localAngle) * ring, y: centerY + Math.sin(localAngle) * ring })
      })
    })
    return result
  }

  const xGap = 270
  orderedCodes.forEach((code, columnIndex) => {
    const group = groups.get(code) ?? []
    const rowGap = group.length > 12 ? 92 : 120
    const startY = -((group.length - 1) * rowGap) / 2
    group.forEach((node, index) => {
      const offset = index % 2 === 0 ? -15 : 15
      result.set(node.id, { x: columnIndex * xGap, y: startY + index * rowGap + offset })
    })
  })
  return result
}

function elementsFromGraph(
  graph: MapGraph,
  view: string,
  mode: LayoutMode,
  theme: MapTheme,
  appearance: NodeAppearance,
  hierarchy: HierarchyConfig,
  hierarchyParents: Record<string, string>,
  expandedHierarchyNodes: Set<string>
): ElementDefinition[] {
  const positions = initialPositions(graph.nodes, view, mode)
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id))
  const directChildCounts = new Map<string, number>()
  for (const [childId, parentId] of Object.entries(hierarchyParents)) {
    if (graphNodeIds.has(childId) && graphNodeIds.has(parentId)) directChildCounts.set(parentId, (directChildCounts.get(parentId) ?? 0) + 1)
  }

  const virtualGroups = new Map<string, {
    id: string
    parent?: string
    label: string
    value: string
    key: string
    source: HierarchyGroupingSource
    count: number
    accent: string
  }>()

  const nodes: ElementDefinition[] = graph.nodes.map((node) => {
    const levelIndex = hierarchy.enabled ? hierarchyLevelIndex(node, hierarchy.levels) : -1
    const level = levelIndex >= 0 ? hierarchy.levels[levelIndex] : null
    const hasNextLevel = levelIndex >= 0 && levelIndex < hierarchy.levels.length - 1
    const childCount = directChildCounts.get(node.id) ?? 0
    const expanded = expandedHierarchyNodes.has(node.id) && childCount > 0
    const hierarchyParent = hierarchyParents[node.id]
    let parent = hierarchyParent && graphNodeIds.has(hierarchyParent) ? hierarchyParent : undefined

    if (hierarchy.enabled && level && level.grouping.source !== 'none' && level.grouping.key) {
      const value = hierarchyGroupingValue(node, level.grouping)
      const groupId = hierarchyGroupId(level, parent, value)
      const existing = virtualGroups.get(groupId)
      if (existing) existing.count += 1
      else virtualGroups.set(groupId, {
        id: groupId,
        parent,
        label: `${level.grouping.key} : ${value}`,
        value,
        key: level.grouping.key,
        source: level.grouping.source,
        count: 1,
        accent: node.color || TYPE_ACCENTS[node.object_type_code] || '#72808e'
      })
      parent = groupId
    }

    return {
      group: 'nodes',
      data: {
        id: node.id,
        parent,
        label: expanded ? `${node.name}
${childCount} élément${childCount > 1 ? 's' : ''}` : hasNextLevel ? `${node.name}  ＋` : node.name,
        rawLabel: node.name,
        accent: TYPE_ACCENTS[node.object_type_code] ?? node.color ?? '#72808e',
        avatar: svgNodeBadge(node.object_type_code, theme, appearance),
        typeCode: node.object_type_code,
        typeName: node.object_type_name,
        criticality: node.criticality,
        status: node.status,
        hierarchyLevel: levelIndex,
        hasNextLevel,
        childCount
      },
      position: positions.get(node.id),
      classes: `map-node criticality-${node.criticality}${hasNextLevel ? ' hierarchy-expandable' : ''}${expanded ? ' hierarchy-expanded' : ''}`
    }
  })

  const groupElements: ElementDefinition[] = [...virtualGroups.values()].map((group) => ({
    group: 'nodes',
    data: {
      id: group.id,
      parent: group.parent,
      label: `${group.label}
${group.count} élément${group.count > 1 ? 's' : ''}`,
      rawLabel: group.label,
      accent: group.accent,
      groupKey: group.key,
      groupValue: group.value,
      groupSource: group.source,
      childCount: group.count
    },
    classes: 'hierarchy-group'
  }))

  const edges: ElementDefinition[] = graph.edges.map((edge) => ({
    group: 'edges',
    data: {
      id: edge.id,
      source: edge.source_id,
      target: edge.target_id,
      label: edge.label || edge.relation_type_name,
      color: edge.color || '#94a3b8',
      accent: edge.color || '#94a3b8'
    },
    classes: edge.directed ? 'map-edge directed' : 'map-edge'
  }))
  return [...groupElements, ...nodes, ...edges]
}

function graphStyle(theme: MapTheme): cytoscape.StylesheetJson {
  const isDark = theme === 'dark'
  return [
    {
      selector: 'node.map-node',
      style: {
        width: 52,
        height: 52,
        'background-color': 'transparent',
        'background-image': 'data(avatar)',
        'background-fit': 'cover',
        'background-opacity': 0,
        label: 'data(label)',
        color: isDark ? '#d8dee8' : '#3a3f44',
        'font-size': 10.5,
        'font-weight': 600,
        'text-valign': 'bottom',
        'text-margin-y': 9,
        'text-wrap': 'ellipsis',
        'text-max-width': '128px',
        'text-outline-color': isDark ? '#0e1217' : '#f4f6f8',
        'text-outline-width': 3,
        'border-width': 0,
        opacity: 0.98,
        'overlay-opacity': 0,
        'transition-property': 'opacity, border-width',
        'transition-duration': 90
      }
    },
    {
      selector: 'node.map-node:parent',
      style: {
        shape: 'roundrectangle',
        'background-image': 'none',
        'background-color': isDark ? '#202a35' : '#f4f6f8',
        'background-opacity': isDark ? 0.62 : 0.78,
        'border-width': 2.2,
        'border-color': 'data(accent)',
        'border-opacity': 0.9,
        padding: '34px',
        'min-width': '150px',
        'min-height': '112px',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 20,
        'font-size': 11.5,
        'font-weight': 700,
        'text-wrap': 'wrap',
        'text-max-width': '190px',
        'text-outline-width': 0,
        'overlay-opacity': 0
      }
    },
    {
      selector: 'node.hierarchy-group',
      style: {
        shape: 'roundrectangle',
        'background-image': 'none',
        'background-color': isDark ? '#151c24' : '#eef3f7',
        'background-opacity': isDark ? 0.72 : 0.9,
        'border-width': 1.8,
        'border-style': 'dashed',
        'border-color': 'data(accent)',
        'border-opacity': 0.9,
        padding: '26px',
        'min-width': '132px',
        'min-height': '90px',
        label: 'data(label)',
        color: isDark ? '#d8dee8' : '#34404b',
        'font-size': 10.5,
        'font-weight': 700,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 15,
        'text-wrap': 'wrap',
        'text-max-width': '170px',
        'text-outline-width': 0,
        'overlay-opacity': 0
      }
    },
    { selector: 'node.hierarchy-expandable:childless', style: { 'border-width': 1.6, 'border-color': '#d4a937' } },
    { selector: 'node.criticality-critical', style: { 'border-color': '#e0b756', 'border-width': 2.6 } },
    { selector: 'node.criticality-high', style: { 'border-color': '#d8c47a', 'border-width': 2 } },
    {
      selector: 'edge.map-edge',
      style: {
        width: 1.35,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'curve-style': 'bezier',
        'control-point-step-size': 44,
        opacity: isDark ? 0.58 : 0.78,
        'arrow-scale': 0.7,
        'target-arrow-shape': 'none',
        label: '',
        color: isDark ? '#d6dce4' : '#3b4652',
        'font-size': 9,
        'text-background-color': isDark ? '#171c22' : '#fff',
        'text-background-opacity': 0.94,
        'text-background-padding': '3px',
        'text-border-opacity': 0,
        'text-rotation': 'autorotate',
        'transition-property': 'opacity, width, line-color',
        'transition-duration': 80
      }
    },
    { selector: 'edge.directed', style: { 'target-arrow-shape': 'triangle' } },
    { selector: '.zoom-far', style: { label: '', width: 34, height: 34 } },
    { selector: 'edge.zoom-far', style: { opacity: 0.45, width: 1.05, 'target-arrow-shape': 'none' } },
    { selector: '.zoom-mid', style: { 'font-size': 10 } },
    { selector: 'edge.zoom-mid', style: { opacity: 0.62 } },
    { selector: '.is-dimmed', style: { opacity: 0.12 } },
    { selector: 'edge.is-dimmed', style: { opacity: 0.08 } },
    { selector: 'node.is-neighbor', style: { opacity: 1 } },
    { selector: 'edge.is-active', style: { opacity: 1, width: 2.35, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', label: 'data(label)' } },
    { selector: 'node.is-focus', style: { 'border-width': 2.6, 'border-color': '#e0b756' } },
    { selector: 'node.is-hovered', style: { 'border-width': 2, 'border-color': '#e0b756' } },
    { selector: 'edge.is-selected', style: { opacity: 1, width: 3.2, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', label: 'data(label)' } }
  ]
}

function useDebouncedPositionSave(cyRef: React.MutableRefObject<Core | null>, view: string, setNotice: (value: Notice) => void) {
  const timer = useRef<number | null>(null)
  return useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      const cy = cyRef.current
      if (!cy) return
      const positions = cy.nodes('.map-node').map((node) => ({ object_id: node.id(), x: node.position('x'), y: node.position('y') }))
      try {
        await api('/api/map/positions', { method: 'PUT', body: JSON.stringify({ view_key: view, positions }) })
      } catch (error) {
        setNotice({ kind: 'error', text: `Positions non enregistrées : ${errorMessage(error)}` })
      }
    }, 850)
  }, [cyRef, setNotice, view])
}

export default function MapPage({ user, design, language = 'fr', enabledFeatures = [] }: { user: User; design?: DesignSettings; language?: Language; enabledFeatures?: string[] }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<Core | null>(null)
  const graphRef = useRef<MapGraph>(EMPTY_GRAPH)
  const singleTapTimer = useRef<number | null>(null)
  const doubleTapGuard = useRef(0)
  const pendingFocus = useRef<string | null>(null)
  const pendingCamera = useRef<{ zoom?: number; pan?: { x: number; y: number } } | null>(null)
  const zoomBand = useRef('')
  const edgeHandlesRef = useRef<any>(null)
  const requestedSavedMapRef = useRef<string | null>(null)
  const hierarchyRef = useRef<HierarchyConfig>({ enabled: false, levels: [] })
  const hierarchyParentsRef = useRef<Record<string, string>>({})
  const expandedHierarchyNodesRef = useRef<Set<string>>(new Set())
  const catalogRef = useRef<MapCatalog | null>(null)
  const selectedRelationTypeIdsRef = useRef<string[]>([])
  const directionRef = useRef<'upstream' | 'downstream' | 'both'>('both')
  const queryRef = useRef('')
  const criticalityRef = useRef('')
  const tagsRef = useRef('')
  const canEdit = user.roles.includes('admin') || user.roles.includes('contributor')
  const savedMapsEnabled = enabledFeatures.includes('saved_maps')
  const versionDetailsEnabled = enabledFeatures.includes('map_version_details')
  const governanceEnabled = enabledFeatures.includes('governance')
  const [graph, setGraph] = useState<MapGraph>(EMPTY_GRAPH)
  const [view, setView] = useState('all')
  const [catalog, setCatalog] = useState<MapCatalog | null>(null)
  const [allObjects, setAllObjects] = useState<SIObject[]>([])
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([])
  const [selectedRelationTypeIds, setSelectedRelationTypeIds] = useState<string[]>([])
  const [rootObjectIds, setRootObjectIds] = useState<string[]>([])
  const [rootSearch, setRootSearch] = useState('')
  const [direction, setDirection] = useState<'upstream' | 'downstream' | 'both'>('both')
  const [recursionDepth, setRecursionDepth] = useState(2)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [progressiveExploration, setProgressiveExploration] = useState(false)
  const [hierarchyEnabled, setHierarchyEnabled] = useState(false)
  const [hierarchyLevels, setHierarchyLevels] = useState<HierarchyLevel[]>([])
  const [hierarchySearches, setHierarchySearches] = useState<Record<string, string>>({})
  const [hierarchyParents, setHierarchyParents] = useState<Record<string, string>>({})
  const [expandedHierarchyNodes, setExpandedHierarchyNodes] = useState<Set<string>>(new Set())
  const [savedMaps, setSavedMaps] = useState<SavedMap[]>([])
  const [activeSavedMapId, setActiveSavedMapId] = useState<string | null>(null)
  const [saveMapOpen, setSaveMapOpen] = useState(false)
  const [saveMapTargetId, setSaveMapTargetId] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [saveMapName, setSaveMapName] = useState('')
  const [saveMapDescription, setSaveMapDescription] = useState('')
  const [saveMapMode, setSaveMapMode] = useState<'dynamic' | 'snapshot'>('dynamic')
  const [saveMapVisibility, setSaveMapVisibility] = useState<'private' | 'all' | 'groups'>('private')
  const [saveMapGroups, setSaveMapGroups] = useState('')
  const [saveMapProtection, setSaveMapProtection] = useState<'public' | 'internal' | 'confidential' | 'restricted'>('internal')
  const [query, setQuery] = useState('')
  const [criticality, setCriticality] = useState('')
  const [tags, setTags] = useState('')
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('layers')
  const [theme, setTheme] = useState<MapTheme>(() => {
    const stored = localStorage.getItem('atlas-map-theme')
    if (stored === 'dark' || stored === 'light') return stored
    return MAP_DEFAULT_THEME
  })
  const [nodeAppearance, setNodeAppearance] = useState<NodeAppearance>(() => (localStorage.getItem('atlas-node-appearance') === 'minimal' ? 'minimal' : 'icons'))
  const [loading, setLoading] = useState(true)
  const [expandingId, setExpandingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [groupingOpen, setGroupingOpen] = useState(false)
  const [groupingSource, setGroupingSource] = useState<GroupingSource>('type')
  const [groupingKey, setGroupingKey] = useState('')
  const [groupFocus, setGroupFocus] = useState<GroupFocus>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<VersionObservation | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [linkMode, setLinkMode] = useState(false)
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([])
  const [pendingLink, setPendingLink] = useState<{ sourceId: string; targetId: string } | null>(null)
  const [relationTypeId, setRelationTypeId] = useState('')
  const [relationLabel, setRelationLabel] = useState('')
  const [relationAttributes, setRelationAttributes] = useState('')
  const [relationTypeSearch, setRelationTypeSearch] = useState('')
  const [savingLink, setSavingLink] = useState(false)
  const [relationEditOpen, setRelationEditOpen] = useState(false)
  const [relationEditTypeId, setRelationEditTypeId] = useState('')
  const [relationEditLabel, setRelationEditLabel] = useState('')
  const [relationEditAttributes, setRelationEditAttributes] = useState('')
  const [relationEditSaving, setRelationEditSaving] = useState(false)
  const [quickObjectOpen, setQuickObjectOpen] = useState(false)
  const [quickObjectSaving, setQuickObjectSaving] = useState(false)
  const [quickObject, setQuickObject] = useState<QuickObjectForm>({ object_type_id: '', name: '', description: '', owner_name: '', criticality: 'unknown', tags: '', attributes: {}, startLinkMode: true })

  graphRef.current = graph
  hierarchyRef.current = { enabled: hierarchyEnabled, levels: hierarchyLevels }
  hierarchyParentsRef.current = hierarchyParents
  expandedHierarchyNodesRef.current = expandedHierarchyNodes
  catalogRef.current = catalog
  selectedRelationTypeIdsRef.current = selectedRelationTypeIds
  directionRef.current = direction
  queryRef.current = query
  criticalityRef.current = criticality
  tagsRef.current = tags
  const selectedNode = useMemo<MapNode | null>(() => selection?.kind === 'node' ? graph.nodes.find((item) => item.id === selection.id) ?? null : null, [graph.nodes, selection])
  const selectedEdge = useMemo<MapEdge | null>(() => selection?.kind === 'edge' ? graph.edges.find((item) => item.id === selection.id) ?? null : null, [graph.edges, selection])
  const selectedHierarchyLevel = selectedNode && hierarchyEnabled ? hierarchyLevelIndex(selectedNode, hierarchyLevels) : -1
  const selectedHierarchyExpanded = Boolean(selectedNode && expandedHierarchyNodes.has(selectedNode.id))
  const selectedHierarchyLastLevel = selectedHierarchyLevel >= 0 && selectedHierarchyLevel === hierarchyLevels.length - 1
  const editableSavedMaps = useMemo(() => savedMaps.filter((item) => item.owner_sub === user.subject || user.roles.includes('admin')), [savedMaps, user.roles, user.subject])
  const selectedHierarchyAction = selectedHierarchyExpanded
    ? 'Replier cette bulle'
    : selectedHierarchyLastLevel
      ? 'Dernier niveau atteint'
      : 'Ouvrir le niveau suivant'
  const quickObjectType = useMemo(() => catalog?.object_types.find((item) => item.id === quickObject.object_type_id) ?? null, [catalog?.object_types, quickObject.object_type_id])
  const quickObjectFields = useMemo(() => {
    const fields = quickObjectType?.schema?.fields
    return Array.isArray(fields) ? fields.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : []
  }, [quickObjectType])
  const availableAttributeKeys = useMemo(() => [...new Set(graph.nodes.flatMap((node) => Object.keys(node.attributes)))].sort((a, b) => a.localeCompare(b, 'fr')), [graph.nodes])
  const availableTagKeys = useMemo(() => graph.available_tags.map((item) => item.key).sort((a, b) => a.localeCompare(b, 'fr')), [graph.available_tags])
  const hierarchyTagKeys = useMemo(() => [...new Set(allObjects.flatMap((item) => Object.keys(item.tags)))].sort((a, b) => a.localeCompare(b, 'fr')), [allObjects])
  const hierarchyAttributeKeys = useMemo(() => [...new Set(allObjects.flatMap((item) => Object.keys(item.attributes)))].sort((a, b) => a.localeCompare(b, 'fr')), [allObjects])
  const visibleRootObjects = useMemo(() => {
    const needle = rootSearch.trim().toLocaleLowerCase('fr')
    if (!needle) return allObjects
    return allObjects.filter((item) => item.name.toLocaleLowerCase('fr').includes(needle) || (item.external_id ?? '').toLocaleLowerCase('fr').includes(needle))
  }, [allObjects, rootSearch])
  const visibleSelectionRelationTypes = useMemo(() => {
    const needle = relationTypeSearch.trim().toLocaleLowerCase('fr')
    return catalog?.relation_types.filter((item) => !needle || item.name.toLocaleLowerCase('fr').includes(needle) || item.code.toLocaleLowerCase('fr').includes(needle)) ?? []
  }, [catalog?.relation_types, relationTypeSearch])

  const groupingEntries = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of graph.nodes) {
      let value = ''
      if (groupingSource === 'type') value = node.object_type_name
      else if (groupingSource === 'tag') value = String(node.tags[groupingKey] ?? '')
      else value = formatPropertyValue(node.attributes[groupingKey])
      const label = value.trim() || 'Non renseigné'
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'fr'))
  }, [graph.nodes, groupingKey, groupingSource])

  useEffect(() => {
    let cancelled = false
    setSelectedVersion(null)
    if (!selectedNode || !versionDetailsEnabled) return () => { cancelled = true }
    setVersionLoading(true)
    void api<VersionObservation[]>(`/api/versions/observations?object_id=${encodeURIComponent(selectedNode.id)}&limit=1`)
      .then((rows) => { if (!cancelled) setSelectedVersion(rows[0] ?? null) })
      .catch(() => { if (!cancelled) setSelectedVersion(null) })
      .finally(() => { if (!cancelled) setVersionLoading(false) })
    return () => { cancelled = true }
  }, [selectedNode?.id, versionDetailsEnabled])
  const nodeName = useCallback((id: string) => graph.nodes.find((node) => node.id === id)?.name ?? id, [graph.nodes])
  const positionViewKey = activeSavedMapId ? `saved-${activeSavedMapId}` : `custom-${view}`
  const savePositions = useDebouncedPositionSave(cyRef, positionViewKey, setNotice)

  const performQuery = useCallback(async (overrides: Partial<{
    rootObjectIds: string[]
    selectedTypeIds: string[]
    selectedRelationTypeIds: string[]
    direction: 'upstream' | 'downstream' | 'both'
    recursionDepth: number
    query: string
    criticality: string
    tags: string
    positionViewKey: string
  }> = {}) => {
    setLoading(true)
    setNotice(null)
    try {
      const effectiveRoots = overrides.rootObjectIds ?? rootObjectIds
      const configuredHierarchy = hierarchyRef.current
      const effectiveTypes = overrides.selectedTypeIds ?? (configuredHierarchy.enabled && configuredHierarchy.levels[0]?.object_type_ids.length ? configuredHierarchy.levels[0].object_type_ids : selectedTypeIds)
      const effectiveRelations = overrides.selectedRelationTypeIds ?? selectedRelationTypeIds
      const effectiveDirection = overrides.direction ?? direction
      const effectiveDepth = overrides.recursionDepth ?? (configuredHierarchy.enabled || progressiveExploration ? 0 : recursionDepth)
      const effectiveQuery = overrides.query ?? query
      const effectiveCriticality = overrides.criticality ?? criticality
      const effectiveTags = overrides.tags ?? tags
      const result = await api<MapGraph>('/api/map/query', {
        method: 'POST',
        body: JSON.stringify({
          root_object_ids: effectiveRoots,
          object_type_ids: effectiveTypes,
          relation_type_ids: effectiveRelations,
          direction: effectiveDirection,
          max_depth: effectiveDepth,
          q: effectiveQuery.trim() || null,
          criticalities: effectiveCriticality ? [effectiveCriticality] : [],
          statuses: [],
          tags: effectiveTags.split(',').map((value) => value.trim()).filter(Boolean),
          limit: catalog?.max_displayed_nodes ?? 1200,
          position_view_key: overrides.positionViewKey ?? (activeSavedMapId ? `saved-${activeSavedMapId}` : `custom-${view}`)
        })
      })
      hierarchyParentsRef.current = {}
      expandedHierarchyNodesRef.current = new Set()
      setHierarchyParents({})
      setExpandedHierarchyNodes(new Set())
      setGraph(result)
      setGroupFocus(null)
      setSelection(null)
      setDetailsOpen(false)
      return result
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
      return null
    } finally {
      setLoading(false)
    }
  }, [activeSavedMapId, catalog?.max_displayed_nodes, criticality, direction, progressiveExploration, query, recursionDepth, rootObjectIds, selectedRelationTypeIds, selectedTypeIds, tags, view])

  const loadGraph = useCallback(async () => { await performQuery() }, [performQuery])


  const loadMapConfiguration = useCallback(async () => {
    try {
      const [catalogValue, objectValues] = await Promise.all([
        api<MapCatalog>('/api/map/catalog'),
        api<SIObject[]>('/api/objects?limit=2000')
      ])
      setCatalog(catalogValue)
      setHierarchyLevels((current) => current.length ? current : defaultHierarchyLevels(catalogValue))
      setAllObjects(objectValues.filter((item) => item.active))
      setQuickObject((current) => ({ ...current, object_type_id: current.object_type_id || catalogValue.object_types.find((item) => item.active)?.id || '' }))
      if (savedMapsEnabled) setSavedMaps(await api<SavedMap[]>('/api/saved-maps'))
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    }
  }, [savedMapsEnabled])

  useEffect(() => { void loadMapConfiguration() }, [loadMapConfiguration])
  useEffect(() => { if (catalog && !searchParams.get('saved')) void loadGraph() }, [catalog])
  useEffect(() => {
    const requested = searchParams.get('saved')
    if (!catalog || !requested || requestedSavedMapRef.current === requested) return
    requestedSavedMapRef.current = requested
    void api<SavedMap>(`/api/saved-maps/${encodeURIComponent(requested)}`).then((item) => applySavedMap(item)).catch((error) => {
      setNotice({ kind: 'error', text: errorMessage(error) })
      setSearchParams({}, { replace: true })
    })
  }, [catalog, searchParams, setSearchParams])


  useEffect(() => {
    if (!canEdit) return
    api<RelationType[]>('/api/relation-types').then(setRelationTypes).catch((error) => setNotice({ kind: 'error', text: errorMessage(error) }))
  }, [canEdit])

  const expandNode = useCallback(async (id: string) => {
    const hierarchy = hierarchyRef.current
    if (hierarchy.enabled) {
      const expanded = expandedHierarchyNodesRef.current
      if (expanded.has(id)) {
        const parents = hierarchyParentsRef.current
        const descendants = new Set<string>()
        const collect = (parentId: string) => {
          for (const [childId, currentParentId] of Object.entries(parents)) {
            if (currentParentId === parentId && !descendants.has(childId)) {
              descendants.add(childId)
              collect(childId)
            }
          }
        }
        collect(id)
        const nextParents = Object.fromEntries(Object.entries(parents).filter(([childId]) => !descendants.has(childId)))
        const nextExpanded = new Set([...expanded].filter((nodeId) => nodeId !== id && !descendants.has(nodeId)))
        hierarchyParentsRef.current = nextParents
        expandedHierarchyNodesRef.current = nextExpanded
        setHierarchyParents(nextParents)
        setExpandedHierarchyNodes(nextExpanded)
        setGraph((current) => {
          const nodes = current.nodes.filter((node) => !descendants.has(node.id))
          const nodeIds = new Set(nodes.map((node) => node.id))
          const edges = current.edges.filter((edge) => nodeIds.has(edge.source_id) && nodeIds.has(edge.target_id))
          return { ...current, nodes, edges, total_nodes: nodes.length, total_edges: edges.length }
        })
        setSelection((current) => current?.kind === 'node' && descendants.has(current.id) ? { kind: 'node', id } : current)
        pendingFocus.current = id
        return
      }

      const currentNode = graphRef.current.nodes.find((node) => node.id === id)
      if (!currentNode) return
      const levelIndex = hierarchyLevelIndex(currentNode, hierarchy.levels)
      if (levelIndex < 0 || levelIndex >= hierarchy.levels.length - 1) {
        setNotice({ kind: 'success', text: 'Cet objet correspond au dernier niveau de granularité de la carte.' })
        return
      }
      const nextTypeIds = hierarchy.levels[levelIndex + 1].object_type_ids
      if (!nextTypeIds.length) {
        setNotice({ kind: 'error', text: 'Le niveau suivant ne contient aucun type d’objet.' })
        return
      }

      setExpandingId(id)
      try {
        const result = await api<MapGraph>('/api/map/query', {
          method: 'POST',
          body: JSON.stringify({
            root_object_ids: [id],
            object_type_ids: nextTypeIds,
            relation_type_ids: selectedRelationTypeIdsRef.current,
            direction: directionRef.current,
            max_depth: 1,
            q: queryRef.current.trim() || null,
            criticalities: criticalityRef.current ? [criticalityRef.current] : [],
            statuses: [],
            tags: tagsRef.current.split(',').map((value) => value.trim()).filter(Boolean),
            limit: catalogRef.current?.max_displayed_nodes ?? 1200,
            position_view_key: 'hierarchy-expansion'
          })
        })
        const children = result.nodes.filter((node) => node.id !== id && nextTypeIds.includes(node.object_type_id))
        if (!children.length) {
          setNotice({ kind: 'success', text: `Aucun objet du niveau « ${hierarchy.levels[levelIndex + 1].name} » n’est relié à ${currentNode.name}.` })
          return
        }
        const parentPosition = cyRef.current?.$id(id).position() ?? { x: currentNode.x ?? 0, y: currentNode.y ?? 0 }
        const radius = Math.max(88, Math.sqrt(children.length) * 62)
        const positionedChildren = children.map((node, index) => {
          const angle = (Math.PI * 2 * index) / Math.max(children.length, 1) - Math.PI / 2
          return { ...node, x: parentPosition.x + Math.cos(angle) * radius, y: parentPosition.y + Math.sin(angle) * radius }
        })
        const childIds = new Set(positionedChildren.map((node) => node.id))
        const addedGraph: MapGraph = {
          ...result,
          nodes: positionedChildren,
          edges: result.edges.filter((edge) => (edge.source_id === id && childIds.has(edge.target_id)) || (edge.target_id === id && childIds.has(edge.source_id))),
          total_nodes: positionedChildren.length,
          total_edges: result.edges.length
        }
        const nextParents = { ...hierarchyParentsRef.current }
        for (const child of positionedChildren) {
          if (!nextParents[child.id]) nextParents[child.id] = id
        }
        const nextExpanded = new Set(expandedHierarchyNodesRef.current)
        nextExpanded.add(id)
        hierarchyParentsRef.current = nextParents
        expandedHierarchyNodesRef.current = nextExpanded
        setHierarchyParents(nextParents)
        setExpandedHierarchyNodes(nextExpanded)
        pendingFocus.current = id
        setGraph((current) => mergeGraph(current, addedGraph))
      } catch (error) {
        setNotice({ kind: 'error', text: errorMessage(error) })
      } finally {
        setExpandingId(null)
      }
      return
    }

    setExpandingId(id)
    try {
      const added = await api<MapGraph>(`/api/map/neighborhood/${id}?depth=1&direction=both`)
      pendingFocus.current = id
      setGraph((current) => mergeGraph(current, added))
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setExpandingId(null)
    }
  }, [])

  const applySemanticZoom = useCallback((cy: Core) => {
    const zoom = cy.zoom()
    const band = zoom < 0.34 ? 'far' : zoom < 0.68 ? 'mid' : 'near'
    if (zoomBand.current === band) return
    zoomBand.current = band
    cy.batch(() => {
      cy.elements().removeClass('zoom-far zoom-mid')
      if (band === 'far') cy.elements().addClass('zoom-far')
      if (band === 'mid') cy.elements().addClass('zoom-mid')
    })
  }, [])

  const applyNodeFocus = useCallback((cy: Core, id: string | null) => {
    cy.batch(() => {
      cy.elements().removeClass('is-dimmed is-focus is-neighbor is-active is-selected')
      if (!id) return
      const node = cy.$id(id)
      if (!node.length) return
      const connectedEdges = node.connectedEdges()
      const neighbors = connectedEdges.connectedNodes().union(node)
      // Dans une carte imbriquée, rendre transparent un conteneur parent rend
      // également tous ses descendants transparents. On conserve donc la branche
      // composée complète (ancêtres, descendants et frères du même conteneur).
      const ancestors = node.ancestors()
      const branchNodes = node
        .union(node.descendants())
        .union(ancestors)
        .union(ancestors.descendants())
        .union(neighbors)
      const branchIds = new Set(branchNodes.map((item) => item.id()))
      const branchEdges = cy.edges().filter((edge) => branchIds.has(edge.source().id()) && branchIds.has(edge.target().id()))
      cy.elements().not(branchNodes.union(branchEdges)).addClass('is-dimmed')
      node.addClass('is-focus')
      neighbors.not(node).addClass('is-neighbor')
      connectedEdges.addClass('is-active')
    })
  }, [])

  const revealElements = useCallback((cy: Core, elements: cytoscape.CollectionReturnValue, drawer = true) => {
    if (!elements.length) return
    cy.stop()
    cy.animate(
      { fit: { eles: elements, padding: elements.nodes().length <= 2 ? 210 : 150 } },
      {
        duration: 240,
        easing: 'ease-out-cubic',
        complete: () => {
          if (cy.zoom() > Math.min(1.6, MAP_MAX_ZOOM)) cy.zoom(Math.min(1.6, MAP_MAX_ZOOM))
          if (drawer) {
            const offset = Math.min(150, (containerRef.current?.clientWidth ?? 900) * 0.15)
            const pan = cy.pan()
            cy.animate({ pan: { x: pan.x - offset, y: pan.y } }, { duration: 130, easing: 'ease-out-cubic' })
          }
        }
      }
    )
  }, [])

  const revealNode = useCallback((cy: Core, id: string) => {
    const node = cy.$id(id)
    if (!node.length) return
    revealElements(cy, node.closedNeighborhood(), true)
  }, [revealElements])

  function formatPropertyValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'Non renseigné'
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  function formatVersionDate(value: string | null): string {
    if (!value) return '—'
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(new Date(value))
  }

  useEffect(() => {
    if (!containerRef.current || cyRef.current) return
    let cy: Core
    const options = {
      container: containerRef.current,
      elements: [],
      style: graphStyle(theme),
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      wheelSensitivity: MAP_WHEEL_SENSITIVITY,
      boxSelectionEnabled: false,
      autoungrabify: false,
      hideEdgesOnViewport: false,
      hideLabelsOnViewport: true,
      textureOnViewport: false,
      motionBlur: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      renderer: { name: 'canvas' },
      layout: { name: 'preset' }
    }
    cy = cytoscape(options as cytoscape.CytoscapeOptions)
    cyRef.current = cy

    if (canEdit) {
      edgeHandlesRef.current = (cy as any).edgehandles({
        canConnect: (sourceNode: NodeSingular, targetNode: NodeSingular) => sourceNode.id() !== targetNode.id(),
        edgeParams: () => ({ data: { id: `preview-${Date.now()}` }, classes: 'eh-preview' }),
        hoverDelay: 80,
        snap: true,
        snapThreshold: 45,
        snapFrequency: 30,
        noEdgeEventsInDraw: true,
        disableBrowserGestures: true
      })
      edgeHandlesRef.current.disable()
      cy.on('ehcomplete', (_event, sourceNode: NodeSingular, targetNode: NodeSingular, addedEdge: EdgeSingular) => {
        addedEdge.remove()
        setPendingLink({ sourceId: sourceNode.id(), targetId: targetNode.id() })
        setRelationTypeId('')
        setRelationLabel('')
        setRelationAttributes('')
        setLinkMode(false)
      })
    }

    cy.on('tap', 'node.map-node', (event: EventObjectNode) => {
      if (Date.now() - doubleTapGuard.current < 700) return
      const nodeId = (event.target as NodeSingular).id()
      const scheduledAt = Date.now()
      if (singleTapTimer.current) window.clearTimeout(singleTapTimer.current)
      singleTapTimer.current = window.setTimeout(() => {
        if (doubleTapGuard.current >= scheduledAt) {
          singleTapTimer.current = null
          return
        }
        setGroupFocus(null)
        setSelection({ kind: 'node', id: nodeId })
        setDetailsOpen(true)
        applyNodeFocus(cy, nodeId)
        revealNode(cy, nodeId)
        singleTapTimer.current = null
      }, 320)
    })
    cy.on('dbltap', 'node.map-node', (event: EventObjectNode) => {
      doubleTapGuard.current = Date.now()
      if (singleTapTimer.current) window.clearTimeout(singleTapTimer.current)
      singleTapTimer.current = null
      const nodeId = (event.target as NodeSingular).id()
      setGroupFocus(null)
      setSelection({ kind: 'node', id: nodeId })
      setDetailsOpen(false)
      applyNodeFocus(cy, null)
      void expandNode(nodeId)
    })
    cy.on('tap', 'edge.map-edge', (event) => {
      const edge = event.target as EdgeSingular
      setGroupFocus(null)
      setSelection({ kind: 'edge', id: edge.id() })
      setDetailsOpen(true)
      cy.batch(() => {
        cy.elements().removeClass('is-dimmed is-focus is-neighbor is-active is-selected')
        const endpoints = edge.connectedNodes()
        const ancestors = endpoints.ancestors()
        const branchNodes = endpoints
          .union(endpoints.descendants())
          .union(ancestors)
          .union(ancestors.descendants())
        const branchIds = new Set(branchNodes.map((item) => item.id()))
        const branchEdges = cy.edges().filter((item) => branchIds.has(item.source().id()) && branchIds.has(item.target().id()))
        cy.elements().not(branchNodes.union(branchEdges)).addClass('is-dimmed')
        edge.addClass('is-selected')
      })
      revealElements(cy, edge.connectedNodes().union(edge), true)
    })
    cy.on('tap', (event) => {
      if (event.target === cy) {
        setGroupFocus(null)
        setSelection(null)
        setDetailsOpen(false)
        applyNodeFocus(cy, null)
      }
    })
    cy.on('dragfree', 'node.map-node', savePositions)
    let zoomTimer = 0
    cy.on('zoom', () => {
      window.clearTimeout(zoomTimer)
      zoomTimer = window.setTimeout(() => applySemanticZoom(cy), 85)
    })
    return () => {
      window.clearTimeout(zoomTimer)
      if (singleTapTimer.current) window.clearTimeout(singleTapTimer.current)
      singleTapTimer.current = null
      edgeHandlesRef.current?.destroy?.()
      edgeHandlesRef.current = null
      cy.destroy()
      cyRef.current = null
    }
  }, [applyNodeFocus, applySemanticZoom, canEdit, expandNode, revealElements, revealNode, savePositions])

  useEffect(() => {
    const handles = edgeHandlesRef.current
    if (!handles) return
    if (linkMode) {
      handles.enable()
      handles.enableDrawMode()
    } else {
      handles.disableDrawMode()
      handles.disable()
    }
  }, [linkMode])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy || loading) return
    const hadElements = cy.elements().length > 0
    const camera = { zoom: cy.zoom(), pan: cy.pan() }
    cy.batch(() => {
      cy.elements().remove()
      cy.add(elementsFromGraph(graph, view, layoutMode, theme, nodeAppearance, { enabled: hierarchyEnabled, levels: hierarchyLevels }, hierarchyParents, expandedHierarchyNodes))
    })
    cy.style(graphStyle(theme))
    if (hierarchyEnabled && Object.keys(hierarchyParents).length > 0) {
      // Les positions calculées lors de l'ouverture d'une bulle sont conservées.
      // Un algorithme de force sur des nœuds composés peut projeter les enfants très loin du parent.
      cy.layout({ name: 'preset', fit: false }).run()
    } else if (layoutMode === 'layers' && graph.nodes.length > 1) {
      cy.layout({
        name: 'dagre',
        rankDir: 'LR',
        align: 'UL',
        nodeSep: 78,
        edgeSep: 34,
        rankSep: 180,
        acyclicer: 'greedy',
        ranker: 'network-simplex',
        padding: 70,
        animate: false,
        fit: false
      } as cytoscape.LayoutOptions).run()
    } else {
      cy.layout({ name: 'preset', fit: false }).run()
    }
    applySemanticZoom(cy)

    const target = pendingFocus.current
    if (target && cy.$id(target).length) {
      pendingFocus.current = null
      applyNodeFocus(cy, target)
      revealNode(cy, target)
    } else if (hadElements) {
      cy.zoom(camera.zoom)
      cy.pan(camera.pan)
    } else if (graph.nodes.length) {
      cy.fit(undefined, 90)
      cy.zoom(Math.min(cy.zoom(), 1.08))
    }
    if (pendingCamera.current) {
      const camera = pendingCamera.current
      pendingCamera.current = null
      window.setTimeout(() => {
        if (typeof camera.zoom === 'number') cy.zoom(Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, camera.zoom)))
        if (camera.pan && typeof camera.pan.x === 'number' && typeof camera.pan.y === 'number') cy.pan(camera.pan)
      }, 30)
    }
  }, [applyNodeFocus, applySemanticZoom, expandedHierarchyNodes, graph, hierarchyEnabled, hierarchyLevels, hierarchyParents, layoutMode, loading, nodeAppearance, revealNode, theme, view])

  function setMapTheme(value: MapTheme) {
    setTheme(value)
    localStorage.setItem('atlas-map-theme', value)
  }

  function setAppearance(value: NodeAppearance) {
    setNodeAppearance(value)
    localStorage.setItem('atlas-node-appearance', value)
  }

  function fitGraph() {
    const cy = cyRef.current
    if (!cy || !cy.elements().length) return
    cy.animate({ fit: { eles: cy.elements(), padding: 80 }, duration: 260, easing: 'ease-out-cubic' })
  }

  function zoomBy(factor: number) {
    const cy = cyRef.current
    const container = containerRef.current
    if (!cy || !container) return
    const level = Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, cy.zoom() * factor))
    cy.animate({ zoom: { level, renderedPosition: { x: container.clientWidth / 2, y: container.clientHeight / 2 } }, duration: 120, easing: 'ease-out-cubic' })
  }

  function changeLayout(mode: LayoutMode) {
    setLayoutMode(mode)
    const cy = cyRef.current
    if (cy) window.setTimeout(() => fitGraph(), 40)
  }

  async function resetPositions() {
    try {
      await api(`/api/map/positions/${encodeURIComponent(positionViewKey)}`, { method: 'DELETE' })
      setGraph((current) => ({ ...current, nodes: current.nodes.map((node) => ({ ...node, x: null, y: null })) }))
      setNotice({ kind: 'success', text: 'Disposition personnelle réinitialisée.' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    }
  }

  const compatibleRelationTypes = useMemo(() => {
    if (!pendingLink) return []
    const source = graph.nodes.find((node) => node.id === pendingLink.sourceId)
    const target = graph.nodes.find((node) => node.id === pendingLink.targetId)
    if (!source || !target) return []
    return relationTypes.filter((type) => type.active &&
      (!type.source_type_id || type.source_type_id === source.object_type_id) &&
      (!type.target_type_id || type.target_type_id === target.object_type_id))
  }, [graph.nodes, pendingLink, relationTypes])

  const editableRelationTypes = useMemo(() => {
    if (!selectedEdge) return []
    const source = graph.nodes.find((node) => node.id === selectedEdge.source_id)
    const target = graph.nodes.find((node) => node.id === selectedEdge.target_id)
    if (!source || !target) return []
    return relationTypes.filter((type) => type.active &&
      (!type.source_type_id || type.source_type_id === source.object_type_id) &&
      (!type.target_type_id || type.target_type_id === target.object_type_id))
  }, [graph.nodes, relationTypes, selectedEdge])

  useEffect(() => {
    if (pendingLink && !relationTypeId && compatibleRelationTypes.length === 1) {
      setRelationTypeId(compatibleRelationTypes[0].id)
    }
  }, [compatibleRelationTypes, pendingLink, relationTypeId])

  async function createGraphicalRelation() {
    if (!pendingLink || !relationTypeId) return
    setSavingLink(true)
    try {
      const attributes = parseAttributeEditor(relationAttributes)
      await api('/api/relations', {
        method: 'POST',
        body: JSON.stringify({
          relation_type_id: relationTypeId,
          source_id: pendingLink.sourceId,
          target_id: pendingLink.targetId,
          label: relationLabel,
          attributes,
          active: true
        })
      })
      setPendingLink(null)
      setNotice({ kind: 'success', text: 'Relation créée depuis la cartographie.' })
      await loadGraph()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setSavingLink(false)
    }
  }

  function openRelationEditor() {
    if (!selectedEdge) return
    setRelationEditTypeId(selectedEdge.relation_type_id)
    setRelationEditLabel(selectedEdge.label || '')
    setRelationEditAttributes(formatAttributeEditor(selectedEdge.attributes))
    setRelationEditOpen(true)
  }

  async function updateSelectedRelation() {
    if (!selectedEdge || !relationEditTypeId) return
    setRelationEditSaving(true)
    try {
      const attributes = parseAttributeEditor(relationEditAttributes)
      await api(`/api/relations/${selectedEdge.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ relation_type_id: relationEditTypeId, label: relationEditLabel, attributes })
      })
      const relationType = relationTypes.find((item) => item.id === relationEditTypeId)
      if (!relationType) throw new Error('Le type de relation sélectionné est introuvable.')
      setGraph((current) => ({
        ...current,
        edges: current.edges.map((edge) => edge.id === selectedEdge.id ? {
          ...edge,
          relation_type_id: relationType.id,
          relation_type_code: relationType.code,
          relation_type_name: relationType.name,
          label: relationEditLabel,
          color: relationType.color || '#94a3b8',
          directed: relationType.directed,
          attributes
        } : edge)
      }))
      setRelationEditOpen(false)
      setNotice({ kind: 'success', text: 'Relation modifiée depuis la cartographie.' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setRelationEditSaving(false)
    }
  }

  async function archiveSelectedRelation() {
    if (!selectedEdge) return
    if (!window.confirm(`Supprimer la relation « ${selectedEdge.relation_type_name} » entre « ${nodeName(selectedEdge.source_id)} » et « ${nodeName(selectedEdge.target_id)} » ?`)) return
    setRelationEditSaving(true)
    try {
      await api(`/api/relations/${selectedEdge.id}`, { method: 'DELETE' })
      setGraph((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== selectedEdge.id), total_edges: Math.max(0, current.total_edges - 1) }))
      setRelationEditOpen(false)
      setDetailsOpen(false)
      setSelection(null)
      if (cyRef.current) applyNodeFocus(cyRef.current, null)
      setNotice({ kind: 'success', text: 'Relation supprimée de la cartographie.' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setRelationEditSaving(false)
    }
  }

  function focusNode(id: string) {
    const cy = cyRef.current
    if (!cy) return
    const node = cy.$id(id)
    applyNodeFocus(cy, id)
    revealElements(cy, node.closedNeighborhood(), true)
  }

  function toggleValue(values: string[], value: string): string[] {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
  }

  function groupingValue(node: MapNode, source = groupingSource, key = groupingKey): string {
    if (source === 'type') return node.object_type_name
    if (source === 'tag') return String(node.tags[key] ?? '').trim() || 'Non renseigné'
    return formatPropertyValue(node.attributes[key])
  }

  function focusGroupingValue(value: string) {
    const cy = cyRef.current
    if (!cy) return
    const ids = new Set(graph.nodes.filter((node) => groupingValue(node) === value).map((node) => node.id))
    const nodes = cy.nodes('.map-node').filter((node) => ids.has(node.id()))
    cy.batch(() => {
      cy.elements().removeClass('is-dimmed is-focus is-neighbor is-active is-selected')
      const ancestors = nodes.ancestors()
      const contextIds = new Set(nodes.union(ancestors).map((item) => item.id()))
      // Les conteneurs restent opaques afin de ne jamais éclaircir leurs enfants.
      cy.nodes('.map-node').filter((node) => !node.isParent() && !contextIds.has(node.id())).addClass('is-dimmed')
      cy.edges().filter((edge) => !ids.has(edge.source().id()) || !ids.has(edge.target().id())).addClass('is-dimmed')
      nodes.addClass('is-neighbor')
    })
    setGroupFocus({ source: groupingSource, key: groupingKey, value })
    revealElements(cy, nodes, false)
  }

  function clearGroupingFocus() {
    const cy = cyRef.current
    cy?.elements().removeClass('is-dimmed is-focus is-neighbor is-active is-selected')
    setGroupFocus(null)
    if (cy) fitGraph()
  }

  function parseQuickTags(value: string): Record<string, string> {
    const result: Record<string, string> = {}
    for (const part of value.split(',').map((item) => item.trim()).filter(Boolean)) {
      const separator = part.includes(':') ? ':' : part.includes('=') ? '=' : ''
      if (!separator) throw new Error(`Étiquette invalide : ${part}. Utilise clé:valeur.`)
      const [rawKey, ...rest] = part.split(separator)
      const key = rawKey.trim().toLowerCase()
      const tagValue = rest.join(separator).trim()
      if (!key || !tagValue) throw new Error(`Étiquette invalide : ${part}. Utilise clé:valeur.`)
      result[key] = tagValue
    }
    return result
  }

  async function createQuickObject() {
    if (!quickObject.object_type_id || !quickObject.name.trim()) return
    setQuickObjectSaving(true)
    try {
      const attributes: Record<string, unknown> = {}
      for (const field of quickObjectFields) {
        const key = String(field.key ?? '').trim()
        if (!key) continue
        const rawValue = quickObject.attributes[key] ?? ''
        if (!rawValue && Boolean(field.required)) throw new Error(`Le champ « ${String(field.label ?? key)} » est obligatoire.`)
        if (!rawValue) continue
        const fieldType = String(field.type ?? 'text')
        attributes[key] = fieldType === 'number' ? Number(rawValue) : fieldType === 'boolean' ? rawValue === 'true' : rawValue
      }
      const created = await api<SIObject>('/api/objects', {
        method: 'POST',
        body: JSON.stringify({
          object_type_id: quickObject.object_type_id,
          name: quickObject.name.trim(),
          description: quickObject.description.trim() || null,
          owner_name: quickObject.owner_name.trim() || null,
          criticality: quickObject.criticality,
          tags: parseQuickTags(quickObject.tags),
          attributes
        })
      })
      const added = await api<MapGraph>(`/api/map/neighborhood/${created.id}?depth=0&direction=both&limit=1`)
      pendingFocus.current = created.id
      setGraph((current) => mergeGraph(current, added))
      setAllObjects((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name, 'fr')))
      setSelection({ kind: 'node', id: created.id })
      setDetailsOpen(true)
      setQuickObjectOpen(false)
      setQuickObject((current) => ({ object_type_id: current.object_type_id, name: '', description: '', owner_name: '', criticality: 'unknown', tags: '', attributes: {}, startLinkMode: current.startLinkMode }))
      if (quickObject.startLinkMode) setLinkMode(true)
      setNotice({ kind: 'success', text: quickObject.startLinkMode ? 'Objet créé. Fais maintenant glisser sa poignée vers l’objet à relier.' : 'Objet créé depuis la cartographie.' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setQuickObjectSaving(false)
    }
  }

  function setHierarchyMode(enabled: boolean) {
    const levels = hierarchyLevels.length >= 2 ? hierarchyLevels : defaultHierarchyLevels(catalog)
    hierarchyRef.current = { enabled, levels }
    hierarchyParentsRef.current = {}
    expandedHierarchyNodesRef.current = new Set()
    setHierarchyLevels(levels)
    setHierarchyEnabled(enabled)
    setHierarchyParents({})
    setExpandedHierarchyNodes(new Set())
    if (enabled) setProgressiveExploration(false)
  }

  function toggleHierarchyType(levelIndex: number, typeId: string) {
    setHierarchyLevels((current) => current.map((level, index) => {
      if (index === levelIndex) {
        const selected = level.object_type_ids.includes(typeId)
        return { ...level, object_type_ids: selected ? level.object_type_ids.filter((id) => id !== typeId) : [...level.object_type_ids, typeId] }
      }
      return level.object_type_ids.includes(typeId) ? { ...level, object_type_ids: level.object_type_ids.filter((id) => id !== typeId) } : level
    }))
  }

  function updateHierarchyGrouping(levelIndex: number, source: HierarchyGroupingSource, key = '') {
    setHierarchyLevels((current) => current.map((level, index) => index === levelIndex
      ? { ...level, grouping: { source, key: source === 'none' ? '' : key } }
      : level))
  }

  function addHierarchyLevel() {
    setHierarchyLevels((current) => [...current, { id: `level-${Date.now()}`, name: `Niveau ${current.length + 1}`, object_type_ids: [], grouping: emptyHierarchyGrouping() }])
  }

  function moveHierarchyLevel(index: number, offset: number) {
    setHierarchyLevels((current) => {
      const target = index + offset
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  function removeHierarchyLevel(index: number) {
    setHierarchyLevels((current) => current.length <= 2 ? current : current.filter((_, currentIndex) => currentIndex !== index))
  }

  function resetSelection() {
    setRootObjectIds([])
    setRootSearch('')
    setSelectedTypeIds([])
    setSelectedRelationTypeIds([])
    setDirection('both')
    setRecursionDepth(2)
    setProgressiveExploration(false)
    const levels = defaultHierarchyLevels(catalog)
    hierarchyRef.current = { enabled: false, levels }
    hierarchyParentsRef.current = {}
    expandedHierarchyNodesRef.current = new Set()
    setHierarchyEnabled(false)
    setHierarchyLevels(levels)
    setHierarchyParents({})
    setExpandedHierarchyNodes(new Set())
  }

  function displaySelection() {
    if (hierarchyEnabled) {
      if (hierarchyLevels.length < 2 || hierarchyLevels.some((level) => level.object_type_ids.length === 0)) {
        setNotice({ kind: 'error', text: 'L’exploration imbriquée nécessite au moins deux niveaux, chacun avec au moins un type d’objet.' })
        return
      }
      const incompleteGrouping = hierarchyLevels.find((level) => level.grouping.source !== 'none' && !level.grouping.key)
      if (incompleteGrouping) {
        setNotice({ kind: 'error', text: `Choisis la clé de regroupement du niveau « ${incompleteGrouping.name} ».` })
        return
      }
      const allTypeIds = hierarchyTypeIds(hierarchyLevels)
      setSelectedTypeIds(allTypeIds)
      hierarchyRef.current = { enabled: true, levels: hierarchyLevels }
    } else {
      hierarchyRef.current = { enabled: false, levels: hierarchyLevels }
    }
    setView('custom')
    setActiveSavedMapId(null)
    requestedSavedMapRef.current = null
    setSearchParams({}, { replace: true })
    void loadGraph()
    setScopeOpen(false)
  }

  function applyPreset(value: string) {
    if (!catalog) return
    const codes = value === 'all' ? null : (TYPE_ORDER[value] ?? [])
    const ids = codes ? catalog.object_types.filter((item) => codes.includes(item.code)).map((item) => item.id) : []
    setView(value)
    setSelectedTypeIds(ids)
    setRootObjectIds([])
    setActiveSavedMapId(null)
    setProgressiveExploration(false)
    hierarchyRef.current = { enabled: false, levels: hierarchyLevels }
    hierarchyParentsRef.current = {}
    expandedHierarchyNodesRef.current = new Set()
    setHierarchyEnabled(false)
    setHierarchyParents({})
    setExpandedHierarchyNodes(new Set())
    requestedSavedMapRef.current = null
    setSearchParams({}, { replace: true })
    void performQuery({ selectedTypeIds: ids, rootObjectIds: [], positionViewKey: `preset-${value}` })
  }

  async function applySavedMap(item: SavedMap) {
    setSavedMaps((current) => current.some((value) => value.id === item.id) ? current : [...current, item].sort((a, b) => a.name.localeCompare(b.name, 'fr')))
    setActiveSavedMapId(item.id)
    setView('custom')
    if (searchParams.get('saved') !== item.id) setSearchParams({ saved: item.id }, { replace: true })
    setRootObjectIds(item.root_object_ids)
    setSelectedTypeIds(item.object_type_ids)
    setSelectedRelationTypeIds(item.relation_type_ids)
    setDirection(item.direction)
    setRecursionDepth(item.max_depth)
    const filters = item.filters ?? {}
    const hierarchy = parseHierarchyConfig(filters.hierarchy, catalog)
    const progressive = !hierarchy.enabled && (filters.progressive_exploration === true || (item.max_depth === 0 && item.root_object_ids.length > 0))
    hierarchyRef.current = hierarchy
    hierarchyParentsRef.current = {}
    expandedHierarchyNodesRef.current = new Set()
    setHierarchyEnabled(hierarchy.enabled)
    setHierarchyLevels(hierarchy.levels)
    setHierarchyParents({})
    setExpandedHierarchyNodes(new Set())
    setProgressiveExploration(progressive)
    setQuery(typeof filters.q === 'string' ? filters.q : '')
    setCriticality(typeof filters.criticality === 'string' ? filters.criticality : '')
    setTags(Array.isArray(filters.tags) ? filters.tags.join(', ') : '')
    const cameraPan = item.camera?.pan
    pendingCamera.current = {
      zoom: typeof item.camera?.zoom === 'number' ? item.camera.zoom : undefined,
      pan: cameraPan && typeof cameraPan === 'object' && !Array.isArray(cameraPan) && typeof (cameraPan as { x?: unknown }).x === 'number' && typeof (cameraPan as { y?: unknown }).y === 'number'
        ? { x: (cameraPan as { x: number }).x, y: (cameraPan as { y: number }).y }
        : undefined
    }
    if (item.layout_mode === 'layers' || item.layout_mode === 'constellation' || item.layout_mode === 'grid') setLayoutMode(item.layout_mode)
    if (item.map_mode === 'snapshot' && item.snapshot && typeof item.snapshot === 'object' && 'graph' in item.snapshot) {
      const snapshot = item.snapshot as { graph: MapGraph; hierarchy_parents?: unknown; expanded_node_ids?: unknown }
      if (hierarchy.enabled) {
        const graphIds = new Set(snapshot.graph.nodes.map((node) => node.id))
        const parents = snapshot.hierarchy_parents && typeof snapshot.hierarchy_parents === 'object' && !Array.isArray(snapshot.hierarchy_parents)
          ? Object.fromEntries(Object.entries(snapshot.hierarchy_parents as Record<string, unknown>).filter(([childId, parentId]) => graphIds.has(childId) && typeof parentId === 'string' && graphIds.has(parentId)).map(([childId, parentId]) => [childId, String(parentId)]))
          : {}
        const expandedIds = Array.isArray(snapshot.expanded_node_ids) ? snapshot.expanded_node_ids.map(String).filter((id) => graphIds.has(id)) : []
        const expandedSet = new Set(expandedIds)
        hierarchyParentsRef.current = parents
        expandedHierarchyNodesRef.current = expandedSet
        setHierarchyParents(parents)
        setExpandedHierarchyNodes(expandedSet)
      }
      setGraph(graphWithStoredPositions(snapshot.graph, item.positions))
      setSelection(null)
      setDetailsOpen(false)
      return
    }
    const result = await performQuery({
      rootObjectIds: item.root_object_ids,
      selectedTypeIds: hierarchy.enabled ? hierarchy.levels[0]?.object_type_ids ?? item.object_type_ids : item.object_type_ids,
      selectedRelationTypeIds: item.relation_type_ids,
      direction: item.direction,
      recursionDepth: hierarchy.enabled || progressive ? 0 : item.max_depth,
      query: typeof filters.q === 'string' ? filters.q : '',
      criticality: typeof filters.criticality === 'string' ? filters.criticality : '',
      tags: Array.isArray(filters.tags) ? filters.tags.join(', ') : '',
      positionViewKey: `saved-${item.id}`
    })
    if (result) setGraph(graphWithStoredPositions(result, item.positions))
  }

  async function saveCurrentMap() {
    if (!saveMapName.trim()) return
    const cy = cyRef.current
    const positions: Record<string, { x: number; y: number }> = {}
    cy?.nodes('.map-node').forEach((node) => { positions[node.id()] = { x: node.position('x'), y: node.position('y') } })
    const camera = cy ? { zoom: cy.zoom(), pan: cy.pan() } : {}
    const effectiveObjectTypeIds = hierarchyEnabled ? hierarchyTypeIds(hierarchyLevels) : selectedTypeIds
    const savedFilters = {
      q: query.trim(),
      criticality,
      tags: tags.split(',').map((value) => value.trim()).filter(Boolean),
      progressive_exploration: progressiveExploration,
      hierarchy: { enabled: hierarchyEnabled, levels: hierarchyLevels }
    }
    const savedSnapshot = saveMapMode === 'snapshot' ? { graph, hierarchy_parents: hierarchyParents, expanded_node_ids: [...expandedHierarchyNodes] } : {}
    const payload = {
      name: saveMapName.trim(),
      description: saveMapDescription.trim() || null,
      map_mode: saveMapMode,
      visibility: saveMapVisibility,
      group_names: saveMapGroups.split(',').map((value) => value.trim()).filter(Boolean),
      root_object_ids: rootObjectIds,
      object_type_ids: effectiveObjectTypeIds,
      relation_type_ids: selectedRelationTypeIds,
      direction,
      max_depth: hierarchyEnabled || progressiveExploration ? 0 : recursionDepth,
      filters: savedFilters,
      layout_mode: layoutMode,
      camera,
      positions,
      protection_level: saveMapProtection,
      snapshot: savedSnapshot
    }
    try {
      const replacing = Boolean(saveMapTargetId)
      if (replacing && !window.confirm(`Remplacer la carte « ${editableSavedMaps.find((item) => item.id === saveMapTargetId)?.name ?? saveMapName} » avec la sélection et la disposition actuelles ?`)) return
      const saved = await api<SavedMap>(replacing ? `/api/saved-maps/${saveMapTargetId}` : '/api/saved-maps', {
        method: replacing ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      })
      setSavedMaps((current) => replacing
        ? current.map((item) => item.id === saved.id ? saved : item).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        : [...current, saved].sort((a, b) => a.name.localeCompare(b.name, 'fr')))
      setActiveSavedMapId(saved.id)
      requestedSavedMapRef.current = saved.id
      setSearchParams({ saved: saved.id }, { replace: true })
      if (Object.keys(positions).length > 0) {
        await api('/api/map/positions', {
          method: 'PUT',
          body: JSON.stringify({ view_key: `saved-${saved.id}`, positions: Object.entries(positions).map(([object_id, position]) => ({ object_id, ...position })) })
        })
      }
      setSaveMapOpen(false)
      setSaveMapTargetId('')
      setSaveMapName('')
      setSaveMapDescription('')
      setNotice({ kind: 'success', text: replacing ? 'Carte existante remplacée.' : 'Carte enregistrée.' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    }
  }

  async function updateCurrentMap() {
    if (!activeSavedMapId) return
    const item = savedMaps.find((value) => value.id === activeSavedMapId)
    if (!item) {
      setNotice({ kind: 'error', text: 'La carte active ne figure plus dans la bibliothèque.' })
      return
    }
    const cy = cyRef.current
    const positions: Record<string, { x: number; y: number }> = {}
    cy?.nodes('.map-node').forEach((node) => { positions[node.id()] = { x: node.position('x'), y: node.position('y') } })
    const camera = cy ? { zoom: cy.zoom(), pan: cy.pan() } : {}
    const effectiveObjectTypeIds = hierarchyEnabled ? hierarchyTypeIds(hierarchyLevels) : selectedTypeIds
    const savedFilters = {
      q: query.trim(),
      criticality,
      tags: tags.split(',').map((value) => value.trim()).filter(Boolean),
      progressive_exploration: progressiveExploration,
      hierarchy: { enabled: hierarchyEnabled, levels: hierarchyLevels }
    }
    const savedSnapshot = item.map_mode === 'snapshot' ? { graph, hierarchy_parents: hierarchyParents, expanded_node_ids: [...expandedHierarchyNodes] } : {}
    try {
      const updated = await api<SavedMap>(`/api/saved-maps/${activeSavedMapId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          root_object_ids: rootObjectIds,
          object_type_ids: effectiveObjectTypeIds,
          relation_type_ids: selectedRelationTypeIds,
          direction,
          max_depth: hierarchyEnabled || progressiveExploration ? 0 : recursionDepth,
          filters: savedFilters,
          layout_mode: layoutMode,
          camera,
          positions,
          snapshot: savedSnapshot
        })
      })
      if (Object.keys(positions).length > 0) {
        await api('/api/map/positions', {
          method: 'PUT',
          body: JSON.stringify({ view_key: `saved-${activeSavedMapId}`, positions: Object.entries(positions).map(([object_id, position]) => ({ object_id, ...position })) })
        })
      }
      setSavedMaps((current) => current.map((value) => value.id === updated.id ? updated : value))
      setNotice({ kind: 'success', text: 'Carte enregistrée mise à jour avec la sélection et la disposition actuelles.' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    }
  }

  async function archiveSavedMap(item: SavedMap) {
    if (!window.confirm(`Archiver la carte « ${item.name} » ?`)) return
    try {
      await api(`/api/saved-maps/${item.id}`, { method: 'DELETE' })
      setSavedMaps((current) => current.filter((value) => value.id !== item.id))
      if (activeSavedMapId === item.id) setActiveSavedMapId(null)
      setNotice({ kind: 'success', text: 'Carte archivée.' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    }
  }


  function exportMapPng() {
    const cy = cyRef.current
    if (!cy || graph.nodes.length === 0) {
      setNotice({ kind: 'error', text: 'La carte ne contient aucun objet à exporter.' })
      return
    }
    const dataUrl = cy.png({ full: true, scale: 2.5, bg: theme === 'dark' ? '#0c111b' : '#ffffff' })
    const link = document.createElement('a')
    const activeName = savedMaps.find((item) => item.id === activeSavedMapId)?.name ?? 'cartographie-si'
    link.download = `${activeName.toLocaleLowerCase('fr').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'cartographie-si'}.png`
    link.href = dataUrl
    link.click()
    setExportOpen(false)
  }

  async function exportMapA3() {
    const cy = cyRef.current
    if (!cy || graph.nodes.length === 0) {
      setNotice({ kind: 'error', text: 'La carte ne contient aucun objet à exporter.' })
      return
    }
    try {
      const { jsPDF } = await import('jspdf')
      const mapImage = cy.png({ full: true, scale: 2.4, bg: theme === 'dark' ? '#0c111b' : '#ffffff' })
      const activeMap = savedMaps.find((item) => item.id === activeSavedMapId)
      const title = activeMap?.name || 'Cartographie du système d’information'
      const subtitle = activeMap?.description || design?.app_subtitle || 'Atlas SI'
      const generatedAt = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date())
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 12
      const primary = design?.primary_color || '#2563eb'
      const protection = (activeMap?.protection_level || 'internal').replace('internal', 'Usage interne').replace('restricted', 'Diffusion restreinte').replace('confidential', 'Confidentiel').replace('public', 'Public')

      const drawLogo = (x: number, y: number, size: number) => {
        if (design?.logo_data_url) {
          try {
            const format = design.logo_data_url.startsWith('data:image/jpeg') ? 'JPEG' : design.logo_data_url.startsWith('data:image/webp') ? 'WEBP' : 'PNG'
            pdf.addImage(design.logo_data_url, format, x, y, size, size, undefined, 'FAST')
            return
          } catch {
            // Le cartouche de secours ci-dessous garantit un export même si le logo est invalide.
          }
        }
        pdf.setFillColor(primary)
        pdf.roundedRect(x, y, size, size, 3, 3, 'F')
        pdf.setTextColor('#ffffff')
        pdf.setFontSize(size * 0.82)
        pdf.setFont('helvetica', 'bold')
        pdf.text((design?.app_title || 'A').slice(0, 1).toUpperCase(), x + size / 2, y + size * 0.68, { align: 'center' })
      }

      const drawPageHeader = (sectionTitle: string, sectionSubtitle: string) => {
        pdf.setFillColor(primary)
        pdf.rect(0, 0, pageWidth, 4, 'F')
        drawLogo(margin, 9, 16)
        pdf.setTextColor('#263548')
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(10.5)
        pdf.text(design?.app_title || 'Atlas SI', margin + 21, 14.5)
        pdf.setTextColor('#718096')
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(7)
        pdf.text(design?.app_subtitle || '', margin + 21, 19.5)
        pdf.setTextColor('#1f2937')
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(16)
        pdf.text(sectionTitle, 82, 14.5)
        pdf.setTextColor('#64748b')
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(7.5)
        pdf.text(pdf.splitTextToSize(sectionSubtitle, 245), 82, 20)
        pdf.setTextColor('#64748b')
        pdf.setFontSize(7)
        pdf.text(generatedAt, pageWidth - margin, 14, { align: 'right' })
        pdf.setDrawColor('#d7dde5')
        pdf.line(margin, 30, pageWidth - margin, 30)
      }

      const drawProtectionFooter = () => {
        pdf.setDrawColor('#cbd5e1')
        pdf.roundedRect(pageWidth - margin - 48, pageHeight - 13, 48, 7, 2, 2, 'S')
        pdf.setTextColor('#475569')
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(6.5)
        pdf.text(protection.toUpperCase(), pageWidth - margin - 24, pageHeight - 8.7, { align: 'center' })
        pdf.setTextColor('#94a3b8')
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(6.2)
        pdf.text('Export Atlas SI · A3 paysage', margin, pageHeight - 8.5)
      }

      // Page 1 : carte visuelle.
      drawPageHeader(title, subtitle)
      pdf.setFontSize(8)
      pdf.setTextColor('#64748b')
      pdf.text(`${graph.nodes.length} objets · ${graph.edges.length} relations`, pageWidth - margin, 22, { align: 'right' })

      const image = new Image()
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 })
        image.onerror = reject
        image.src = mapImage
      })
      const frameX = margin
      const frameY = 36
      const frameWidth = pageWidth - margin * 2
      const frameHeight = 180
      pdf.setDrawColor('#d7dde5')
      pdf.roundedRect(frameX, frameY, frameWidth, frameHeight, 3, 3, 'S')
      const scale = Math.min((frameWidth - 8) / dimensions.width, (frameHeight - 8) / dimensions.height)
      const imageWidth = dimensions.width * scale
      const imageHeight = dimensions.height * scale
      pdf.addImage(mapImage, 'PNG', frameX + (frameWidth - imageWidth) / 2, frameY + (frameHeight - imageHeight) / 2, imageWidth, imageHeight, undefined, 'FAST')

      const relationLegend = [...new Map(graph.edges.map((edge) => [edge.relation_type_id, {
        name: edge.relation_type_name,
        color: edge.color || '#94a3b8',
        count: graph.edges.filter((item) => item.relation_type_id === edge.relation_type_id).length
      }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      const legendColumnWidth = 96
      const drawLegend = (heading: string, entries: Array<{ name: string; color?: string | null; count: number }>, y: number, maxItems: number) => {
        pdf.setTextColor('#263548')
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(7.2)
        pdf.text(heading, margin, y)
        const shown = entries.slice(0, maxItems)
        shown.forEach((item, index) => {
          const column = index % 4
          const row = Math.floor(index / 4)
          const x = margin + column * legendColumnWidth
          const itemY = y + 6 + row * 5.2
          pdf.setFillColor(item.color || '#64748b')
          pdf.circle(x + 1.5, itemY - 1.1, 1.35, 'F')
          pdf.setTextColor('#334155')
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(6.8)
          pdf.text(pdf.splitTextToSize(`${item.name} (${item.count})`, legendColumnWidth - 8)[0], x + 5, itemY)
        })
        if (entries.length > maxItems) {
          const rows = Math.ceil(shown.length / 4)
          pdf.setTextColor('#64748b')
          pdf.setFontSize(6.3)
          pdf.text(`+ ${entries.length - maxItems} autre(s) type(s)`, margin, y + 7 + rows * 5.2)
        }
      }
      pdf.setDrawColor('#d7dde5')
      pdf.line(margin, 221, pageWidth - margin, 221)
      drawLegend('Types d’objets', graph.legends, 227, 24)
      drawLegend('Types de relations', relationLegend, 264, 16)
      drawProtectionFooter()

      type PdfColumn = { title: string; width: number }
      type PdfRow = { values: string[]; color?: string }
      const tableWidth = pageWidth - margin * 2
      const drawTablePage = (sectionTitle: string, sectionSubtitle: string, columns: PdfColumn[], rows: PdfRow[]) => {
        const totalColumnWidth = columns.reduce((sum, column) => sum + column.width, 0)
        const widthScale = tableWidth / totalColumnWidth
        const widths = columns.map((column) => column.width * widthScale)
        const headerHeight = 9
        let y = 36

        const startPage = () => {
          drawPageHeader(sectionTitle, sectionSubtitle)
          y = 36
          pdf.setFillColor('#eef2f6')
          pdf.setDrawColor('#d7dde5')
          pdf.rect(margin, y, tableWidth, headerHeight, 'FD')
          let x = margin
          columns.forEach((column, index) => {
            pdf.setTextColor('#334155')
            pdf.setFont('helvetica', 'bold')
            pdf.setFontSize(7.1)
            pdf.text(column.title, x + 2.2, y + 5.8)
            x += widths[index]
            if (index < columns.length - 1) pdf.line(x, y, x, y + headerHeight)
          })
          y += headerHeight
        }

        pdf.addPage('a3', 'landscape')
        startPage()
        rows.forEach((row, rowIndex) => {
          const lineSets = row.values.map((value, index) => pdf.splitTextToSize(value || '—', Math.max(8, widths[index] - 4)) as string[])
          const maxLines = Math.max(1, ...lineSets.map((lines) => lines.length))
          const rowHeight = Math.max(8, maxLines * 3.45 + 3)
          if (y + rowHeight > pageHeight - 18) {
            drawProtectionFooter()
            pdf.addPage('a3', 'landscape')
            startPage()
          }
          if (rowIndex % 2 === 1) {
            pdf.setFillColor('#fafbfd')
            pdf.rect(margin, y, tableWidth, rowHeight, 'F')
          }
          pdf.setDrawColor('#e2e7ed')
          pdf.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight)
          if (row.color) {
            pdf.setFillColor(row.color)
            pdf.rect(margin, y, 1.5, rowHeight, 'F')
          }
          let x = margin
          lineSets.forEach((lines, index) => {
            pdf.setTextColor(index === 0 ? '#263548' : '#526170')
            pdf.setFont('helvetica', index === 0 ? 'bold' : 'normal')
            pdf.setFontSize(6.7)
            pdf.text(lines, x + 2.2, y + 4.8)
            x += widths[index]
            if (index < columns.length - 1) pdf.line(x, y, x, y + rowHeight)
          })
          y += rowHeight
        })
        drawProtectionFooter()
      }

      const objectRows: PdfRow[] = [...graph.nodes]
        .sort((a, b) => a.object_type_name.localeCompare(b.object_type_name, 'fr') || a.name.localeCompare(b.name, 'fr'))
        .map((node) => ({
          color: node.color,
          values: [
            node.external_id ? `${node.name}\n${node.external_id}` : node.name,
            node.object_type_name,
            `${node.status || '—'}
Protection : ${node.protection_level || '—'}`,
            node.criticality || '—',
            node.owner_name || 'Non renseigné',
            node.description || '—',
            Object.entries(node.tags).map(([key, value]) => `${key}: ${value}`).join(' · ') || '—',
            Object.entries(node.attributes).map(([key, value]) => `${key}: ${hierarchyValueText(value)}`).join(' · ') || '—'
          ]
        }))
      drawTablePage(
        `${title} — inventaire des objets`,
        `${graph.nodes.length} objets affichés. Les étiquettes et informations complémentaires correspondent à l’état de la carte au moment de l’export.`,
        [
          { title: 'Objet / identifiant', width: 76 },
          { title: 'Type', width: 48 },
          { title: 'État / protection', width: 38 },
          { title: 'Criticité', width: 24 },
          { title: 'Responsable', width: 42 },
          { title: 'Description', width: 68 },
          { title: 'Étiquettes', width: 62 },
          { title: 'Informations complémentaires', width: 78 }
        ],
        objectRows
      )

      const relationRows: PdfRow[] = [...graph.edges]
        .sort((a, b) => nodeName(a.source_id).localeCompare(nodeName(b.source_id), 'fr') || a.relation_type_name.localeCompare(b.relation_type_name, 'fr'))
        .map((edge) => ({
          color: edge.color,
          values: [
            `${nodeName(edge.source_id)}
${graph.nodes.find((node) => node.id === edge.source_id)?.object_type_name || 'Type inconnu'}`,
            edge.relation_type_name,
            `${nodeName(edge.target_id)}
${graph.nodes.find((node) => node.id === edge.target_id)?.object_type_name || 'Type inconnu'}`,
            edge.directed ? 'Orientée' : 'Non orientée',
            edge.label || '—',
            Object.entries(edge.attributes).map(([key, value]) => `${key}: ${hierarchyValueText(value)}`).join(' · ') || '—'
          ]
        }))
      drawTablePage(
        `${title} — inventaire des relations`,
        `${graph.edges.length} relations affichées. La barre colorée de chaque ligne reprend la couleur du type de relation.`,
        [
          { title: 'Source', width: 72 },
          { title: 'Type de relation', width: 58 },
          { title: 'Cible', width: 72 },
          { title: 'Sens', width: 31 },
          { title: 'Libellé', width: 55 },
          { title: 'Informations complémentaires', width: 96 }
        ],
        relationRows
      )

      const totalPages = pdf.getNumberOfPages()
      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        pdf.setPage(pageNumber)
        pdf.setTextColor('#94a3b8')
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(6.2)
        pdf.text(`Page ${pageNumber} / ${totalPages}`, pageWidth / 2, pageHeight - 8.5, { align: 'center' })
      }

      const slug = title.toLocaleLowerCase('fr').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'cartographie-si'
      pdf.save(`${slug}-a3.pdf`)
      setExportOpen(false)
      setNotice({ kind: 'success', text: 'Export PDF A3 généré avec les annexes objets et relations.' })
    } catch (error) {
      setNotice({ kind: 'error', text: `Impossible de générer le PDF A3 : ${errorMessage(error)}` })
    }
  }

  return (
    <div className={`map-modern-page map-theme-${theme}`}>
      <header className="map-modern-header">
        <div>
          <p className="eyebrow">Cartographie dynamique</p>
          <h1>Vision du système d’information</h1>
        </div>
        <div className="map-modern-stats"><span><strong>{graph.nodes.length}</strong> objets</span><i /><span><strong>{graph.edges.length}</strong> relations</span></div>
      </header>

      {notice && <div className={`notice map-modern-notice ${notice.kind}`}>{notice.text}</div>}

      <section className="map-modern-shell">
        <div className="map-modern-canvas" ref={containerRef} aria-label="Cartographie interactive du SI" />
        <div className="map-grid-overlay" aria-hidden="true" />

        <aside className="map-side-nav">
          <div className="map-side-brand">
            {design?.logo_data_url ? <span className="cube custom"><img src={design.logo_data_url} alt="" /></span> : <span className="cube">◫</span>}
            <div><strong>{design?.app_title ?? 'Atlas SI'}</strong><small>{language === 'en' ? 'Mapping' : 'Cartographie'}</small></div>
          </div>
          <div className="map-side-group">
            <small>Vues</small>
            {VIEW_OPTIONS.map((item) => <button key={item.value} className={view === item.value ? 'active' : ''} onClick={() => applyPreset(item.value)}>{item.label}</button>)}
          </div>
          <div className="map-side-guide"><small>Exploration</small><p>{hierarchyEnabled ? 'Double-clique sur une bulle pour ouvrir le niveau suivant ou la replier.' : 'Sélectionne un point de départ puis double-clique sur un objet pour ouvrir son voisinage.'}</p></div>
        </aside>

        <div className="map-floating-top">
          <div className="map-view-switcher" role="tablist" aria-label="Type de cartographie">
            {VIEW_OPTIONS.map((item) => <button key={item.value} className={view === item.value ? 'active' : ''} onClick={() => applyPreset(item.value)} title={item.label}>{item.short}</button>)}
          </div>
          <div className="map-search-box">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un objet, un responsable…" onKeyDown={(event) => { if (event.key === 'Enter') void loadGraph() }} />
            {query && <button onClick={() => setQuery('')} aria-label="Effacer la recherche">×</button>}
          </div>
          <div className="map-top-actions">
            <button title="Choisir les objets de départ, les types et la profondeur" className={`map-filter-button ${rootObjectIds.length || selectedTypeIds.length || selectedRelationTypeIds.length ? 'has-filter' : ''}`} onClick={() => setScopeOpen((value) => !value)}><span>⌘</span> Sélection{rootObjectIds.length || selectedTypeIds.length || selectedRelationTypeIds.length ? <b /> : null}</button>
            <button title="Filtrer les objets affichés" className={`map-filter-button ${criticality || tags ? 'has-filter' : ''}`} onClick={() => setFiltersOpen((value) => !value)}><span>≡</span> Filtres{criticality || tags ? <b /> : null}</button>
            <button title="Mettre en évidence les objets par type, étiquette ou information" className={`map-filter-button ${groupFocus ? 'has-filter' : ''}`} onClick={() => setGroupingOpen((value) => !value)}><span>◫</span> Regrouper{groupFocus ? <b /> : null}</button>
            {canEdit && <button title="Créer un objet directement dans la carte" className="map-filter-button" onClick={() => setQuickObjectOpen(true)}><span>＋</span> Objet</button>}
            {savedMapsEnabled && activeSavedMapId && <button title="Remplacer la sélection et la disposition de la carte active" className="map-filter-button map-save-button" onClick={() => void updateCurrentMap()}><span>↻</span> Mettre à jour</button>}
            {savedMapsEnabled && <button title={activeSavedMapId ? 'Enregistrer cette vue comme une nouvelle carte' : 'Enregistrer cette vue'} className="map-filter-button map-save-button" onClick={() => { setSaveMapTargetId(''); setSaveMapOpen(true) }}><span>☆</span> {activeSavedMapId ? 'Enregistrer sous' : 'Enregistrer'}</button>}
            <button title="Exporter la cartographie" className="map-filter-button" onClick={() => setExportOpen((value) => !value)}><span>⇩</span> Exporter</button>
          </div>
        </div>

        <div className="map-floating-controls">
          <button onClick={() => zoomBy(1.55)} title="Zoom avant">＋</button>
          <button onClick={() => zoomBy(0.64)} title="Zoom arrière">−</button>
          <button onClick={fitGraph} title="Tout afficher">⌗</button>
          <span />
          {canEdit && <button className={linkMode ? 'active link-mode' : ''} onClick={() => setLinkMode((value) => !value)} title={linkMode ? 'Quitter le mode liaison' : 'Créer une relation par glisser-déposer'}>↗</button>}
          <button className={nodeAppearance === 'icons' ? 'active' : ''} onClick={() => setAppearance(nodeAppearance === 'icons' ? 'minimal' : 'icons')} title={nodeAppearance === 'icons' ? 'Afficher des cercles sans icône' : 'Afficher les icônes'}>◎</button>
          <button className={theme === 'dark' ? 'active' : ''} onClick={() => setMapTheme(theme === 'dark' ? 'light' : 'dark')} title="Changer le fond">◐</button>
        </div>

        <div className="map-layout-switcher">
          <span>Disposition</span>
          <button className={layoutMode === 'layers' ? 'active' : ''} onClick={() => changeLayout('layers')}>Couches</button>
          <button className={layoutMode === 'constellation' ? 'active' : ''} onClick={() => changeLayout('constellation')}>Constellation</button>
          <button className={layoutMode === 'grid' ? 'active' : ''} onClick={() => changeLayout('grid')}>Grille</button>
        </div>

        <aside className={`map-filter-drawer map-export-drawer ${exportOpen ? 'open' : ''}`}>
          <div className="map-drawer-heading"><div><small>Diffusion et audit</small><h2>Exporter la cartographie</h2></div><button onClick={() => setExportOpen(false)}>×</button></div>
          <p className="map-export-intro">Le PDF A3 paysage reprend l’identité définie dans « Design et langues » et ajoute des annexes détaillées exploitables pour une revue ou un dossier ANSSI.</p>
          <button className="map-export-choice" onClick={exportMapA3}><strong>PDF A3 paysage détaillé</strong><small>Carte visuelle, légendes, inventaire des objets et inventaire des relations.</small></button>
          <button className="map-export-choice" onClick={exportMapPng}><strong>Image PNG haute définition</strong><small>Image complète de la carte, adaptée à un rapport ou une présentation.</small></button>
          {activeSavedMapId && <a className="map-export-choice" href={`/api/saved-maps/${activeSavedMapId}/export?format=json`}><strong>Configuration JSON</strong><small>Paramètres de la carte pour archivage technique ou réimport ultérieur.</small></a>}
        </aside>

        <aside className={`map-filter-drawer map-scope-drawer ${scopeOpen ? 'open' : ''}`}>
          <div className="map-drawer-heading"><div><small>Construction</small><h2>Sélection de la carte</h2></div><button onClick={() => setScopeOpen(false)}>×</button></div>
          <section className="map-selection-section"><header><div><strong>Objets de départ</strong><small>Sans sélection, tous les objets correspondant aux critères sont affichés.</small></div><span>{rootObjectIds.length || 'Tous'}</span></header><div className="map-object-search"><span>⌕</span><input value={rootSearch} onChange={(event) => setRootSearch(event.target.value)} placeholder="Rechercher un objet…" /></div><div className="map-object-picker">{visibleRootObjects.length === 0 ? <p>Aucun objet ne correspond.</p> : visibleRootObjects.map((item) => <label key={item.id}><input type="checkbox" checked={rootObjectIds.includes(item.id)} onChange={() => setRootObjectIds(toggleValue(rootObjectIds, item.id))} /><span><strong>{item.name}</strong><small>{catalog?.object_types.find((type) => type.id === item.object_type_id)?.name}{item.external_id ? ` · ${item.external_id}` : ''}</small></span></label>)}</div></section>
          <div className="map-exploration-modes">
            <label className="map-progressive-toggle"><input type="checkbox" checked={progressiveExploration} onChange={(event) => { setProgressiveExploration(event.target.checked); if (event.target.checked) setHierarchyMode(false) }} /><span><strong>Exploration progressive simple</strong><small>Affiche les points de départ puis ajoute leurs voisins sans créer de conteneurs.</small></span></label>
            <label className="map-progressive-toggle hierarchy"><input type="checkbox" checked={hierarchyEnabled} onChange={(event) => setHierarchyMode(event.target.checked)} /><span><strong>Exploration imbriquée</strong><small>Ouvre des bulles par niveaux : site, équipements, serveurs, applications…</small></span></label>
          </div>
          {hierarchyEnabled && <section className="map-hierarchy-builder">
            <header><div><strong>Niveaux de granularité</strong><small>Commence par une configuration vide. Choisis les types de chaque niveau puis, si nécessaire, sépare-les par étiquette ou information complémentaire.</small></div><button type="button" onClick={addHierarchyLevel}>＋ Niveau</button></header>
            <div className="map-hierarchy-levels">
              {hierarchyLevels.map((level, levelIndex) => {
                const groupingKeys = level.grouping.source === 'tag' ? hierarchyTagKeys : hierarchyAttributeKeys
                const selectedTypeNames = catalog?.object_types.filter((item) => level.object_type_ids.includes(item.id)).map((item) => item.name) ?? []
                const levelSearch = hierarchySearches[level.id] ?? ''
                const visibleLevelTypes = catalog?.object_types.filter((item) => item.active && (!levelSearch.trim() || item.name.toLocaleLowerCase('fr').includes(levelSearch.trim().toLocaleLowerCase('fr')) || item.code.toLocaleLowerCase('fr').includes(levelSearch.trim().toLocaleLowerCase('fr')))) ?? []
                return <article className="map-hierarchy-level" key={level.id}>
                  <header><span className="map-level-number">{levelIndex + 1}</span><input aria-label={`Nom du niveau ${levelIndex + 1}`} value={level.name} onChange={(event) => setHierarchyLevels((current) => current.map((item, index) => index === levelIndex ? { ...item, name: event.target.value } : item))} /><div><button type="button" disabled={levelIndex === 0} onClick={() => moveHierarchyLevel(levelIndex, -1)} title="Monter">↑</button><button type="button" disabled={levelIndex === hierarchyLevels.length - 1} onClick={() => moveHierarchyLevel(levelIndex, 1)} title="Descendre">↓</button><button type="button" disabled={hierarchyLevels.length <= 2} onClick={() => removeHierarchyLevel(levelIndex)} title="Supprimer">×</button></div></header>
                  <details open><summary>Types de ce niveau <span>{level.object_type_ids.length}</span></summary>
                    {selectedTypeNames.length > 0 && <div className="map-selected-type-names">{selectedTypeNames.map((name) => <span key={name}>{name}</span>)}</div>}
                    <div className="map-hierarchy-search"><span>⌕</span><input value={levelSearch} onChange={(event) => setHierarchySearches((current) => ({ ...current, [level.id]: event.target.value }))} placeholder="Rechercher un type d’objet…" /></div>
                    <div className="map-check-list hierarchy-types">{visibleLevelTypes.length === 0 ? <p className="map-check-empty">Aucun type ne correspond.</p> : visibleLevelTypes.map((item) => <label key={item.id} title={item.name}><input type="checkbox" checked={level.object_type_ids.includes(item.id)} onChange={() => toggleHierarchyType(levelIndex, item.id)} /><i style={{ background: item.color ?? '#64748b' }} /><span className="map-check-label">{item.name}</span></label>)}</div>
                  </details>
                  <div className="map-level-grouping">
                    <label>Regrouper visuellement<select value={level.grouping.source} onChange={(event) => { const source = event.target.value as HierarchyGroupingSource; const keys = source === 'tag' ? hierarchyTagKeys : source === 'attribute' ? hierarchyAttributeKeys : []; updateHierarchyGrouping(levelIndex, source, keys[0] ?? '') }}><option value="none">Aucun regroupement</option><option value="tag">Par étiquette</option><option value="attribute">Par information complémentaire</option></select></label>
                    {level.grouping.source !== 'none' && <label>{level.grouping.source === 'tag' ? 'Clé d’étiquette' : 'Information'}<input list={`hierarchy-grouping-keys-${level.id}`} value={level.grouping.key} onChange={(event) => updateHierarchyGrouping(levelIndex, level.grouping.source, event.target.value)} placeholder="Choisir ou saisir une clé…" /><datalist id={`hierarchy-grouping-keys-${level.id}`}>{groupingKeys.map((key) => <option key={key} value={key} />)}</datalist></label>}
                    {level.grouping.source !== 'none' && level.grouping.key && <small>Les objets de ce niveau seront placés dans une bulle par valeur de « {level.grouping.key} » ; les valeurs absentes iront dans « Non renseigné ».</small>}
                  </div>
                </article>
              })}
            </div>
            <p>Les regroupements font partie de la carte enregistrée. Exemple : niveau Serveurs regroupé par l’étiquette <code>network</code> pour obtenir les bulles LAN, DMZ et VOIP.</p>
          </section>}
          <div className="map-scope-row"><label>Direction<select value={direction} onChange={(event) => setDirection(event.target.value as 'upstream' | 'downstream' | 'both')}><option value="both">Amont et aval</option><option value="upstream">Amont uniquement</option><option value="downstream">Aval uniquement</option></select></label><label>Profondeur<select disabled={progressiveExploration || hierarchyEnabled} value={progressiveExploration || hierarchyEnabled ? 0 : recursionDepth} onChange={(event) => setRecursionDepth(Number(event.target.value))}>{Array.from({ length: (catalog?.max_recursion_depth ?? 10) + 1 }, (_, index) => <option key={index} value={index}>{index === 0 ? '0 — sélection seule' : `${index} niveau${index > 1 ? 'x' : ''}`}</option>)}</select></label></div>
          {!hierarchyEnabled && <details className="map-type-picker" open><summary>Types d’objets <span>{selectedTypeIds.length || catalog?.object_types.length || 0}</span></summary><div className="map-check-list"><label><input type="checkbox" checked={selectedTypeIds.length === 0} onChange={() => setSelectedTypeIds([])} /><span>Tous les types</span></label>{catalog?.object_types.map((item) => <label key={item.id} title={item.name}><input type="checkbox" checked={selectedTypeIds.includes(item.id)} onChange={() => setSelectedTypeIds(toggleValue(selectedTypeIds, item.id))} /><i style={{ background: item.color ?? '#64748b' }} /><span>{item.name}</span></label>)}</div></details>}
          <details className="map-type-picker"><summary>Types de relations <span>{selectedRelationTypeIds.length || catalog?.relation_types.length || 0}</span></summary><div className="map-hierarchy-search map-relation-type-search"><span>⌕</span><input value={relationTypeSearch} onChange={(event) => setRelationTypeSearch(event.target.value)} placeholder="Rechercher un type de relation…" /></div><div className="map-check-list"><label><input type="checkbox" checked={selectedRelationTypeIds.length === 0} onChange={() => setSelectedRelationTypeIds([])} /><span>Toutes les relations</span></label>{visibleSelectionRelationTypes.length === 0 ? <p className="map-check-empty">Aucun type de relation ne correspond.</p> : visibleSelectionRelationTypes.map((item) => <label key={item.id} title={item.name}><input type="checkbox" checked={selectedRelationTypeIds.includes(item.id)} onChange={() => setSelectedRelationTypeIds(toggleValue(selectedRelationTypeIds, item.id))} /><i style={{ background: item.color ?? '#94a3b8' }} /><span>{item.name}</span></label>)}</div></details>
          <div className="map-drawer-actions"><button onClick={resetSelection}>Réinitialiser</button><button className="primary" onClick={displaySelection}>Afficher la sélection</button></div>
          <p className="map-scope-help">{hierarchyEnabled ? 'La carte enregistrera les niveaux, les types et les regroupements choisis. Double-clique sur un objet pour ouvrir ou replier le niveau suivant.' : 'Le mode progressif simple ouvre un niveau supplémentaire sans créer de regroupement visuel.'}</p>
        </aside>

        <aside className={`map-filter-drawer ${filtersOpen ? 'open' : ''}`}>
          <div className="map-drawer-heading"><div><small>Affichage</small><h2>Filtres de la carte</h2></div><button onClick={() => setFiltersOpen(false)}>×</button></div>
          <label>Criticité<select value={criticality} onChange={(event) => setCriticality(event.target.value)}><option value="">Toutes les criticités</option><option value="critical">Critique</option><option value="high">Haute</option><option value="medium">Moyenne</option><option value="low">Faible</option><option value="unknown">Inconnue</option></select></label>
          <label>Étiquettes clé:valeur<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="site:siege, environnement:production" /></label>
          {graph.available_tags.length > 0 && <div className="map-filter-suggestions"><small>Étiquettes disponibles</small>{graph.available_tags.slice(0, 8).map((item) => <button key={item.key} onClick={() => setTags((value) => value ? `${value}, ${item.key}:${item.values[0] ?? ''}` : `${item.key}:${item.values[0] ?? ''}`)}>{item.key}<span>{item.values.length}</span></button>)}</div>}
          <div className="map-drawer-actions"><button onClick={() => { setCriticality(''); setTags('') }}>Effacer</button><button className="primary" onClick={() => { void loadGraph(); setFiltersOpen(false) }}>Appliquer</button></div>
          <button className="map-reset-layout" onClick={() => void resetPositions()}>Réinitialiser mes positions</button>
        </aside>

        <aside className={`map-filter-drawer map-grouping-drawer ${groupingOpen ? 'open' : ''}`}>
          <div className="map-drawer-heading"><div><small>Lecture</small><h2>Regrouper et explorer</h2></div><button onClick={() => setGroupingOpen(false)}>×</button></div>
          <p className="map-grouping-intro">Mets en évidence une famille d’objets sans modifier la sélection enregistrée.</p>
          <label>Regrouper par<select value={groupingSource} onChange={(event) => { const source = event.target.value as GroupingSource; setGroupingSource(source); setGroupingKey(source === 'tag' ? availableTagKeys[0] ?? '' : source === 'attribute' ? availableAttributeKeys[0] ?? '' : ''); setGroupFocus(null) }}><option value="type">Type d’objet</option><option value="tag">Étiquette</option><option value="attribute">Information complémentaire</option></select></label>
          {groupingSource === 'tag' && <label>Étiquette<select value={groupingKey} onChange={(event) => { setGroupingKey(event.target.value); setGroupFocus(null) }}><option value="">Sélectionner…</option>{availableTagKeys.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>}
          {groupingSource === 'attribute' && <label>Information<select value={groupingKey} onChange={(event) => { setGroupingKey(event.target.value); setGroupFocus(null) }}><option value="">Sélectionner…</option>{availableAttributeKeys.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>}
          {(groupingSource === 'type' || groupingKey) && <div className="map-group-list">{groupingEntries.length === 0 ? <p>Aucun regroupement disponible.</p> : groupingEntries.map((entry) => <button key={entry.value} className={groupFocus?.source === groupingSource && groupFocus.key === groupingKey && groupFocus.value === entry.value ? 'active' : ''} onClick={() => focusGroupingValue(entry.value)}><span>{entry.value}</span><b>{entry.count}</b></button>)}</div>}
          <div className="map-drawer-actions"><button disabled={!groupFocus} onClick={clearGroupingFocus}>Tout réafficher</button><button className="primary" onClick={() => setGroupingOpen(false)}>Fermer</button></div>
          <p className="map-scope-help">Les regroupements par étiquette ou information complémentaire sont calculés directement à partir des objets actuellement affichés.</p>
        </aside>

        {linkMode && <div className="map-link-mode-banner"><strong>Mode liaison</strong><span>Fais glisser depuis un objet vers sa cible.</span><button onClick={() => setLinkMode(false)}>Quitter</button></div>}

        {pendingLink && <aside className="map-relation-creator">
          <div className="map-drawer-heading"><div><small>Nouvelle relation</small><h2>{nodeName(pendingLink.sourceId)} → {nodeName(pendingLink.targetId)}</h2></div><button onClick={() => setPendingLink(null)}>×</button></div>
          {compatibleRelationTypes.length === 0 ? <p className="notice error">Aucun type de relation compatible avec ces deux objets.</p> : <>
            <label>Type de relation<select value={relationTypeId} onChange={(event) => setRelationTypeId(event.target.value)}><option value="">Sélectionner…</option>{compatibleRelationTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
            <label>Libellé<input value={relationLabel} onChange={(event) => setRelationLabel(event.target.value)} placeholder="Production, HTTPS, synchronisation…" /></label>
            <label>Informations complémentaires<input value={relationAttributes} onChange={(event) => setRelationAttributes(event.target.value)} placeholder="port=443;protocole=https" /></label>
            <div className="map-drawer-actions"><button onClick={() => setPendingLink(null)}>Annuler</button><button className="primary" disabled={!relationTypeId || savingLink} onClick={() => void createGraphicalRelation()}>{savingLink ? 'Création…' : 'Créer la relation'}</button></div>
          </>}
        </aside>}

        {relationEditOpen && selectedEdge && <div className="map-modal-backdrop"><section className="map-save-dialog map-relation-edit-dialog">
          <div className="map-drawer-heading"><div><small>Modification rapide</small><h2>Modifier la relation</h2></div><button onClick={() => setRelationEditOpen(false)}>×</button></div>
          <div className="map-modern-flow edit"><strong>{nodeName(selectedEdge.source_id)}</strong><span>→</span><strong>{nodeName(selectedEdge.target_id)}</strong></div>
          {editableRelationTypes.length === 0 ? <p className="notice error">Aucun type de relation actif n’est compatible avec ces deux objets.</p> : <>
            <label>Type de relation<select autoFocus value={relationEditTypeId} onChange={(event) => setRelationEditTypeId(event.target.value)}>{editableRelationTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
            <label>Libellé<input value={relationEditLabel} onChange={(event) => setRelationEditLabel(event.target.value)} placeholder="Production, HTTPS, synchronisation…" /></label>
            <label>Informations complémentaires<input value={relationEditAttributes} onChange={(event) => setRelationEditAttributes(event.target.value)} placeholder="port=443; protocole=https" /><small className="map-field-help">Format : clé=valeur, séparé par des points-virgules.</small></label>
          </>}
          <div className="map-drawer-actions split"><button className="danger" disabled={relationEditSaving} onClick={() => void archiveSelectedRelation()}>Supprimer</button><span /><button onClick={() => setRelationEditOpen(false)}>Annuler</button><button className="primary" disabled={!relationEditTypeId || relationEditSaving || editableRelationTypes.length === 0} onClick={() => void updateSelectedRelation()}>{relationEditSaving ? 'Enregistrement…' : 'Enregistrer'}</button></div>
        </section></div>}

        {quickObjectOpen && <div className="map-modal-backdrop"><section className="map-save-dialog map-quick-object-dialog"><div className="map-drawer-heading"><div><small>Création rapide</small><h2>Ajouter un objet à la carte</h2></div><button onClick={() => setQuickObjectOpen(false)}>×</button></div><div className="map-scope-row"><label>Type<select autoFocus value={quickObject.object_type_id} onChange={(event) => setQuickObject({ ...quickObject, object_type_id: event.target.value, attributes: {} })}><option value="">Sélectionner…</option>{catalog?.object_types.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Nom<input value={quickObject.name} onChange={(event) => setQuickObject({ ...quickObject, name: event.target.value })} placeholder="Nom de l’objet" /></label></div><div className="map-scope-row"><label>Criticité<select value={quickObject.criticality} onChange={(event) => setQuickObject({ ...quickObject, criticality: event.target.value })}><option value="unknown">Non définie</option><option value="low">Faible</option><option value="medium">Moyenne</option><option value="high">Haute</option><option value="critical">Critique</option></select></label><label>Responsable<input value={quickObject.owner_name} onChange={(event) => setQuickObject({ ...quickObject, owner_name: event.target.value })} /></label></div><label>Description<textarea value={quickObject.description} onChange={(event) => setQuickObject({ ...quickObject, description: event.target.value })} /></label><label>Étiquettes <small>Format clé:valeur, séparées par des virgules.</small><input value={quickObject.tags} onChange={(event) => setQuickObject({ ...quickObject, tags: event.target.value })} placeholder="site:bordeaux, environnement:production" /></label>{quickObjectFields.length > 0 && <fieldset className="map-quick-fields"><legend>Informations du type</legend><div className="map-scope-row">{quickObjectFields.map((field) => { const key = String(field.key ?? ''); const label = String(field.label ?? key); const fieldType = String(field.type ?? 'text'); const options = Array.isArray(field.options) ? field.options.map(String) : []; const value = quickObject.attributes[key] ?? ''; return <label key={key}>{label}{Boolean(field.required) ? ' *' : ''}{fieldType === 'boolean' ? <select value={value} onChange={(event) => setQuickObject({ ...quickObject, attributes: { ...quickObject.attributes, [key]: event.target.value } })}><option value="">Non renseigné</option><option value="true">Oui</option><option value="false">Non</option></select> : fieldType === 'select' ? <select value={value} onChange={(event) => setQuickObject({ ...quickObject, attributes: { ...quickObject.attributes, [key]: event.target.value } })}><option value="">Sélectionner…</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input type={fieldType === 'number' ? 'number' : fieldType === 'date' ? 'date' : 'text'} value={value} onChange={(event) => setQuickObject({ ...quickObject, attributes: { ...quickObject.attributes, [key]: event.target.value } })} />}{field.help ? <small>{String(field.help)}</small> : null}</label> })}</div></fieldset>}<label className="map-progressive-toggle compact"><input type="checkbox" checked={quickObject.startLinkMode} onChange={(event) => setQuickObject({ ...quickObject, startLinkMode: event.target.checked })} /><span><strong>Créer puis relier</strong><small>Active automatiquement le glisser-déposer après la création.</small></span></label><div className="map-drawer-actions"><button onClick={() => setQuickObjectOpen(false)}>Annuler</button><button className="primary" disabled={quickObjectSaving || !quickObject.object_type_id || !quickObject.name.trim()} onClick={() => void createQuickObject()}>{quickObjectSaving ? 'Création…' : 'Créer l’objet'}</button></div></section></div>}

        {saveMapOpen && <div className="map-modal-backdrop"><section className="map-save-dialog">
          <div className="map-drawer-heading"><div><small>{saveMapTargetId ? 'Remplacement' : 'Nouvelle carte'}</small><h2>{saveMapTargetId ? 'Remplacer une carte enregistrée' : 'Enregistrer cette vue'}</h2></div><button onClick={() => setSaveMapOpen(false)}>×</button></div>
          {editableSavedMaps.length > 0 && <label>Destination<select value={saveMapTargetId} onChange={(event) => {
            const targetId = event.target.value
            setSaveMapTargetId(targetId)
            const target = editableSavedMaps.find((item) => item.id === targetId)
            if (target) {
              setSaveMapName(target.name)
              setSaveMapDescription(target.description ?? '')
              setSaveMapMode(target.map_mode)
              setSaveMapVisibility(target.visibility)
              setSaveMapGroups(target.group_names.join(', '))
              setSaveMapProtection(target.protection_level)
            }
          }}><option value="">Créer une nouvelle carte</option>{editableSavedMaps.map((item) => <option key={item.id} value={item.id}>Remplacer — {item.name}</option>)}</select><small className="map-field-help">Le remplacement est explicite et demande une confirmation avant l’enregistrement.</small></label>}
          <label>Nom<input autoFocus value={saveMapName} onChange={(event) => setSaveMapName(event.target.value)} placeholder="Infrastructure physique" /></label>
          <label>Description<textarea value={saveMapDescription} onChange={(event) => setSaveMapDescription(event.target.value)} /></label>
          <div className="map-scope-row"><label>Mode<select value={saveMapMode} onChange={(event) => setSaveMapMode(event.target.value as 'dynamic' | 'snapshot')}><option value="dynamic">Dynamique — recalculée à l’ouverture</option><option value="snapshot">Instantané — résultat figé</option></select></label><label>Visibilité<select value={saveMapVisibility} onChange={(event) => setSaveMapVisibility(event.target.value as 'private' | 'all' | 'groups')}><option value="private">Privée</option><option value="all">Tous les utilisateurs</option><option value="groups">Groupes Keycloak</option></select></label></div>
          {saveMapVisibility === 'groups' && <label>Groupes autorisés<input value={saveMapGroups} onChange={(event) => setSaveMapGroups(event.target.value)} placeholder="ATLAS-RSSI, ATLAS-DIRECTION" /></label>}
          <label>Mention de protection<select value={saveMapProtection} onChange={(event) => setSaveMapProtection(event.target.value as 'public' | 'internal' | 'confidential' | 'restricted')}><option value="public">Public</option><option value="internal">Usage interne</option><option value="confidential">Confidentiel</option><option value="restricted">Diffusion restreinte</option></select></label>
          <div className="map-save-summary"><span>{graph.nodes.length} objets</span><span>{graph.edges.length} relations</span><span>{hierarchyEnabled ? `${hierarchyLevels.length} niveaux imbriqués` : progressiveExploration ? 'Exploration progressive' : `Profondeur ${recursionDepth}`}</span></div>
          <div className="map-drawer-actions"><button onClick={() => setSaveMapOpen(false)}>Annuler</button><button className="primary" disabled={!saveMapName.trim()} onClick={() => void saveCurrentMap()}>{saveMapTargetId ? 'Remplacer la carte' : 'Enregistrer'}</button></div>
        </section></div>}

        <aside className={`map-detail-drawer ${detailsOpen ? 'open' : ''}`}>
          <button className="map-detail-close" onClick={() => { setDetailsOpen(false); setSelection(null); if (cyRef.current) applyNodeFocus(cyRef.current, null) }}>×</button>
          {selectedNode ? <>
            <div className="map-modern-detail-head"><div className="map-modern-avatar" style={{ backgroundImage: `url(${svgNodeBadge(selectedNode.object_type_code, theme, nodeAppearance)})` }} /><div><small>{selectedNode.object_type_name}</small><h2>{selectedNode.name}</h2><span className={`criticality ${selectedNode.criticality}`}>{selectedNode.criticality}</span></div></div>
            <div className="map-modern-actions"><button onClick={() => focusNode(selectedNode.id)}>Centrer</button><button className="primary" disabled={expandingId === selectedNode.id || (hierarchyEnabled && selectedHierarchyLastLevel)} onClick={() => void expandNode(selectedNode.id)}>{expandingId === selectedNode.id ? 'Ouverture…' : hierarchyEnabled ? selectedHierarchyAction : 'Ouvrir les dépendances'}</button></div>
            <dl className="map-modern-properties"><div><dt>État</dt><dd>{selectedNode.status}</dd></div><div><dt>Responsable</dt><dd>{selectedNode.owner_name || 'Non renseigné'}</dd></div><div><dt>Identifiant</dt><dd>{selectedNode.external_id || '—'}</dd></div></dl>
            {versionDetailsEnabled && <div className="map-modern-section map-version-section"><h3>Version et obsolescence</h3>{versionLoading ? <p className="muted-copy">Chargement…</p> : selectedVersion ? <><div className={`map-version-status ${selectedVersion.compliance_status}`}>{VERSION_STATUS_LABELS[selectedVersion.compliance_status] ?? selectedVersion.compliance_status}</div><dl className="map-attribute-list"><div><dt>Version observée</dt><dd>{selectedVersion.observed_version || 'Non renseignée'}</dd></div><div><dt>Version cible</dt><dd>{selectedVersion.target_version || '—'}</dd></div><div><dt>Dernière connue</dt><dd>{selectedVersion.latest_version || '—'}</dd></div><div><dt>Fin de support</dt><dd>{formatVersionDate(selectedVersion.support_end_date)}</dd></div><div><dt>Observation</dt><dd>{formatVersionDate(selectedVersion.observed_at)}</dd></div><div><dt>Source</dt><dd>{selectedVersion.source}</dd></div></dl>{selectedVersion.notes && <p className="map-version-notes">{selectedVersion.notes}</p>}</> : <p className="muted-copy">Aucune version renseignée pour cet objet.</p>}</div>}
            {governanceEnabled && <div className="map-modern-section"><h3>Gouvernance</h3><dl className="map-attribute-list"><div><dt>Validation</dt><dd>{selectedNode.review_status}</dd></div><div><dt>Confiance</dt><dd>{selectedNode.confidence_level}</dd></div><div><dt>Responsable donnée</dt><dd>{selectedNode.data_owner_name || '—'}</dd></div><div><dt>Prochaine revue</dt><dd>{formatVersionDate(selectedNode.next_review_at)}</dd></div><div><dt>Protection</dt><dd>{selectedNode.protection_level}</dd></div></dl></div>}
            {selectedNode.description && <div className="map-modern-section"><h3>Description</h3><p>{selectedNode.description}</p></div>}
            <div className="map-modern-section"><h3>Étiquettes</h3>{Object.keys(selectedNode.tags).length ? <div className="map-modern-tags">{Object.entries(selectedNode.tags).map(([key, value]) => <span key={key}><b>{key}</b>{value}</span>)}</div> : <p className="muted-copy">Aucune étiquette.</p>}</div>
            <div className="map-modern-section"><h3>Informations complémentaires</h3>{Object.keys(selectedNode.attributes).length ? <dl className="map-attribute-list">{Object.entries(selectedNode.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{formatPropertyValue(value)}</dd></div>)}</dl> : <p className="muted-copy">Aucune information complémentaire.</p>}</div>
          </> : selectedEdge ? <>
            <div className="map-modern-detail-head relation"><div className="map-modern-avatar relation" style={{ borderColor: selectedEdge.color, color: selectedEdge.color }}>↗</div><div><small>Relation</small><h2><i className="map-relation-color" style={{ background: selectedEdge.color }} />{selectedEdge.relation_type_name}</h2></div></div>
            <div className="map-modern-flow"><strong>{nodeName(selectedEdge.source_id)}</strong><span style={{ color: selectedEdge.color }}>→</span><strong>{nodeName(selectedEdge.target_id)}</strong></div>
            {canEdit && <div className="map-modern-actions"><button className="primary" onClick={openRelationEditor}>Modifier</button><button className="danger" onClick={() => void archiveSelectedRelation()}>Supprimer</button></div>}
            {selectedEdge.label && <div className="map-modern-section"><h3>Libellé</h3><p>{selectedEdge.label}</p></div>}
            <div className="map-modern-section"><h3>Informations complémentaires</h3>{Object.keys(selectedEdge.attributes).length ? <dl className="map-attribute-list">{Object.entries(selectedEdge.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{formatPropertyValue(value)}</dd></div>)}</dl> : <p className="muted-copy">Aucune information complémentaire.</p>}</div>
          </> : null}
        </aside>

        <div className="map-modern-legend">{graph.legends.map((item) => <span key={item.code}><i style={{ background: TYPE_ACCENTS[item.code] ?? '#72808e' }} />{item.name}<b>{graph.nodes.filter((node) => node.object_type_code === item.code).length}</b></span>)}</div>
        <div className="map-modern-hint">Clic : détails · Double-clic : ouvrir/replier · ＋ Objet : créer · ↗ : relier · Molette : zoom</div>

        {loading && <div className="map-modern-loading"><div className="spinner" /><span>Construction de la carte…</span></div>}
        {!loading && graph.nodes.length === 0 && <div className="map-modern-empty"><strong>Aucun objet dans cette vue</strong><span>Modifie les filtres ou ajoute des objets au référentiel.</span></div>}
        {graph.truncated && <div className="map-modern-warning">Affichage limité : utilise les filtres pour préciser le périmètre.</div>}
      </section>
    </div>
  )
}
