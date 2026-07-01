import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from './api'
import type { Language, MapCatalog, SavedMap, SIObject, User } from './types'

type GroupingSource = 'none' | 'tag' | 'attribute'
type HierarchyLevel = { id: string; name: string; object_type_ids: string[]; grouping: { source: GroupingSource; key: string } }
type BuilderMode = 'standard' | 'progressive' | 'hierarchy'
type Notice = { kind: 'success' | 'error'; text: string } | null

function emptyLevels(): HierarchyLevel[] {
  return [
    { id: crypto.randomUUID(), name: 'Niveau 1', object_type_ids: [], grouping: { source: 'none', key: '' } },
    { id: crypto.randomUUID(), name: 'Niveau 2', object_type_ids: [], grouping: { source: 'none', key: '' } }
  ]
}

function toggle(items: string[], id: string): string[] {
  return items.includes(id) ? items.filter((item) => item !== id) : [...items, id]
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}

function parseHierarchy(value: unknown): { enabled: boolean; levels: HierarchyLevel[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { enabled: false, levels: emptyLevels() }
  const raw = value as { enabled?: unknown; levels?: unknown }
  if (!Array.isArray(raw.levels)) return { enabled: false, levels: emptyLevels() }
  const levels = raw.levels.map((entry, index) => {
    const item = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {}
    const groupingRaw = item.grouping && typeof item.grouping === 'object' && !Array.isArray(item.grouping) ? item.grouping as Record<string, unknown> : {}
    const source: GroupingSource = groupingRaw.source === 'tag' || groupingRaw.source === 'attribute' ? groupingRaw.source : 'none'
    return {
      id: String(item.id || crypto.randomUUID()),
      name: String(item.name || `Niveau ${index + 1}`),
      object_type_ids: Array.isArray(item.object_type_ids) ? item.object_type_ids.map(String) : [],
      grouping: { source, key: source === 'none' ? '' : String(groupingRaw.key || '') }
    }
  })
  return { enabled: Boolean(raw.enabled) && levels.length >= 2, levels: levels.length >= 2 ? levels : emptyLevels() }
}

export default function SavedMapBuilder({ user, language = 'fr', maps, initialMapId = '', onSaved }: { user: User; language?: Language; maps: SavedMap[]; initialMapId?: string; onSaved: (map: SavedMap) => void }) {
  const navigate = useNavigate()
  const en = language === 'en'
  const [catalog, setCatalog] = useState<MapCatalog | null>(null)
  const [objects, setObjects] = useState<SIObject[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [targetId, setTargetId] = useState(initialMapId)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'all' | 'groups'>('private')
  const [groups, setGroups] = useState('')
  const [protection, setProtection] = useState<'public' | 'internal' | 'confidential' | 'restricted'>('internal')
  const [layout, setLayout] = useState('layers')
  const [rootIds, setRootIds] = useState<string[]>([])
  const [rootSearch, setRootSearch] = useState('')
  const [mode, setMode] = useState<BuilderMode>('standard')
  const [direction, setDirection] = useState<'upstream' | 'downstream' | 'both'>('both')
  const [depth, setDepth] = useState(2)
  const [objectTypeIds, setObjectTypeIds] = useState<string[]>([])
  const [relationTypeIds, setRelationTypeIds] = useState<string[]>([])
  const [objectTypeSearch, setObjectTypeSearch] = useState('')
  const [relationTypeSearch, setRelationTypeSearch] = useState('')
  const [levels, setLevels] = useState<HierarchyLevel[]>(emptyLevels)
  const [levelSearches, setLevelSearches] = useState<Record<string, string>>({})
  const [criticality, setCriticality] = useState('')
  const [tags, setTags] = useState('')

  const editableMaps = useMemo(() => maps.filter((item) => item.owner_sub === user.subject || user.roles.includes('admin')), [maps, user.roles, user.subject])
  const tagKeys = useMemo(() => [...new Set(objects.flatMap((item) => Object.keys(item.tags)))].sort((a, b) => a.localeCompare(b, 'fr')), [objects])
  const attributeKeys = useMemo(() => [...new Set(objects.flatMap((item) => Object.keys(item.attributes)))].sort((a, b) => a.localeCompare(b, 'fr')), [objects])
  const visibleRoots = useMemo(() => {
    const needle = rootSearch.trim().toLocaleLowerCase('fr')
    return objects.filter((item) => !needle || item.name.toLocaleLowerCase('fr').includes(needle) || (item.external_id ?? '').toLocaleLowerCase('fr').includes(needle)).slice(0, 250)
  }, [objects, rootSearch])
  const visibleObjectTypes = useMemo(() => {
    const needle = objectTypeSearch.trim().toLocaleLowerCase('fr')
    return catalog?.object_types.filter((item) => !needle || item.name.toLocaleLowerCase('fr').includes(needle) || item.code.toLocaleLowerCase('fr').includes(needle)) ?? []
  }, [catalog, objectTypeSearch])
  const visibleRelationTypes = useMemo(() => {
    const needle = relationTypeSearch.trim().toLocaleLowerCase('fr')
    return catalog?.relation_types.filter((item) => !needle || item.name.toLocaleLowerCase('fr').includes(needle) || item.code.toLocaleLowerCase('fr').includes(needle)) ?? []
  }, [catalog, relationTypeSearch])

  useEffect(() => {
    Promise.all([api<MapCatalog>('/api/map/catalog'), api<SIObject[]>('/api/objects?limit=2000')])
      .then(([catalogData, objectData]) => { setCatalog(catalogData); setObjects(objectData) })
      .catch((error) => setNotice({ kind: 'error', text: errorText(error) }))
      .finally(() => setLoading(false))
  }, [])

  function resetForm() {
    setTargetId(''); setName(''); setDescription(''); setVisibility('private'); setGroups(''); setProtection('internal'); setLayout('layers')
    setRootIds([]); setMode('standard'); setDirection('both'); setDepth(2); setObjectTypeIds([]); setRelationTypeIds([]); setLevels(emptyLevels()); setCriticality(''); setTags('')
  }

  function loadMap(item: SavedMap) {
    setTargetId(item.id)
    setName(item.name)
    setDescription(item.description ?? '')
    setVisibility(item.visibility)
    setGroups(item.group_names.join(', '))
    setProtection(item.protection_level)
    setLayout(item.layout_mode || 'layers')
    setRootIds(item.root_object_ids)
    setDirection(item.direction)
    setDepth(item.max_depth || 2)
    setObjectTypeIds(item.object_type_ids)
    setRelationTypeIds(item.relation_type_ids)
    const filters = item.filters ?? {}
    setCriticality(typeof filters.criticality === 'string' ? filters.criticality : '')
    setTags(Array.isArray(filters.tags) ? filters.tags.join(', ') : '')
    const hierarchy = parseHierarchy(filters.hierarchy)
    setLevels(hierarchy.levels)
    setMode(hierarchy.enabled ? 'hierarchy' : filters.progressive_exploration === true ? 'progressive' : 'standard')
  }

  useEffect(() => {
    if (!initialMapId || !maps.length) return
    const item = maps.find((entry) => entry.id === initialMapId)
    if (item) loadMap(item)
  // initialMapId is intentionally reapplied when the library finishes loading.
  }, [initialMapId, maps])

  function updateLevel(index: number, patch: Partial<HierarchyLevel>) {
    setLevels((current) => current.map((level, levelIndex) => levelIndex === index ? { ...level, ...patch } : level))
  }

  function updateGrouping(index: number, source: GroupingSource, key = '') {
    setLevels((current) => current.map((level, levelIndex) => levelIndex === index ? { ...level, grouping: { source, key: source === 'none' ? '' : key } } : level))
  }

  async function save() {
    if (!name.trim()) { setNotice({ kind: 'error', text: 'Le nom de la carte est obligatoire.' }); return }
    if (mode === 'hierarchy') {
      if (levels.length < 2 || levels.some((level) => level.object_type_ids.length === 0)) {
        setNotice({ kind: 'error', text: 'Chaque niveau de granularité doit contenir au moins un type d’objet.' }); return
      }
      if (levels.some((level) => level.grouping.source !== 'none' && !level.grouping.key.trim())) {
        setNotice({ kind: 'error', text: 'Renseigne la clé de chaque regroupement par étiquette ou information complémentaire.' }); return
      }
    }
    if (targetId && !window.confirm(`Remplacer la carte « ${editableMaps.find((item) => item.id === targetId)?.name ?? name} » ?`)) return
    setSaving(true)
    try {
      const hierarchyEnabled = mode === 'hierarchy'
      const effectiveTypeIds = hierarchyEnabled ? [...new Set(levels.flatMap((level) => level.object_type_ids))] : objectTypeIds
      const payload = {
        name: name.trim(), description: description.trim() || null, map_mode: 'dynamic', visibility,
        group_names: groups.split(',').map((value) => value.trim()).filter(Boolean), root_object_ids: rootIds,
        object_type_ids: effectiveTypeIds, relation_type_ids: relationTypeIds, direction,
        max_depth: mode === 'standard' ? depth : 0,
        filters: { q: '', criticality, tags: tags.split(',').map((value) => value.trim()).filter(Boolean), progressive_exploration: mode === 'progressive', hierarchy: { enabled: hierarchyEnabled, levels } },
        layout_mode: layout, camera: {}, positions: {}, protection_level: protection, snapshot: {}
      }
      const saved = await api<SavedMap>(targetId ? `/api/saved-maps/${targetId}` : '/api/saved-maps', { method: targetId ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      onSaved(saved)
      navigate(`/map?saved=${encodeURIComponent(saved.id)}`)
    } catch (error) {
      setNotice({ kind: 'error', text: errorText(error) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section className="panel saved-map-builder-loading"><div className="spinner" /><span>{en ? 'Loading the map builder…' : 'Chargement du constructeur de carte…'}</span></section>

  return <div className="saved-map-builder">
    {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    <section className="panel builder-intro">
      <div><p className="eyebrow">{en ? 'Full-page builder' : 'Constructeur pleine page'}</p><h2>{en ? 'Prepare, save, then visualize a map' : 'Préparer, enregistrer, puis visualiser une carte'}</h2><p>{en ? 'The same settings remain editable from the map afterwards.' : 'Les mêmes paramètres restent modifiables directement depuis la carte par la suite.'}</p></div>
      <div className="builder-target"><label>{en ? 'Destination' : 'Destination'}<select value={targetId} onChange={(event) => { const id = event.target.value; if (!id) resetForm(); else { const item = editableMaps.find((entry) => entry.id === id); if (item) loadMap(item) } }}><option value="">{en ? 'New saved map' : 'Nouvelle carte enregistrée'}</option>{editableMaps.map((item) => <option key={item.id} value={item.id}>{en ? 'Replace' : 'Remplacer'} — {item.name}</option>)}</select></label></div>
    </section>

    <div className="saved-map-builder-grid">
      <section className="panel builder-panel builder-general">
        <header><span>1</span><div><h3>{en ? 'Identity' : 'Identité de la carte'}</h3><p>{en ? 'Name, visibility and presentation.' : 'Nom, visibilité et présentation.'}</p></div></header>
        <label>{en ? 'Name' : 'Nom'}<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Infrastructure réseau" /></label>
        <label>{en ? 'Description' : 'Description'}<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="builder-two-columns"><label>{en ? 'Visibility' : 'Visibilité'}<select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="private">Privée</option><option value="all">Tous les utilisateurs</option><option value="groups">Groupes Keycloak</option></select></label><label>{en ? 'Protection' : 'Mention de protection'}<select value={protection} onChange={(event) => setProtection(event.target.value as typeof protection)}><option value="public">Public</option><option value="internal">Usage interne</option><option value="confidential">Confidentiel</option><option value="restricted">Diffusion restreinte</option></select></label></div>
        {visibility === 'groups' && <label>Groupes autorisés<input value={groups} onChange={(event) => setGroups(event.target.value)} placeholder="ATLAS-RSSI, ATLAS-DIRECTION" /></label>}
        <label>Disposition initiale<select value={layout} onChange={(event) => setLayout(event.target.value)}><option value="layers">Couches</option><option value="constellation">Constellation</option><option value="grid">Grille</option></select></label>
      </section>

      <section className="panel builder-panel builder-roots">
        <header><span>2</span><div><h3>Objets de départ</h3><p>Sans sélection, Atlas SI part de tous les objets correspondant aux critères.</p></div><b>{rootIds.length || 'Tous'}</b></header>
        <div className="builder-search"><span>⌕</span><input value={rootSearch} onChange={(event) => setRootSearch(event.target.value)} placeholder="Rechercher un objet…" /></div>
        <div className="builder-check-list roots">{visibleRoots.map((item) => <label key={item.id}><input type="checkbox" checked={rootIds.includes(item.id)} onChange={() => setRootIds(toggle(rootIds, item.id))} /><span><strong>{item.name}</strong><small>{catalog?.object_types.find((type) => type.id === item.object_type_id)?.name}{item.external_id ? ` · ${item.external_id}` : ''}</small></span></label>)}</div>
      </section>

      <section className="panel builder-panel builder-mode">
        <header><span>3</span><div><h3>Mode d’exploration</h3><p>Choisis une profondeur fixe, une ouverture progressive ou des bulles imbriquées.</p></div></header>
        <div className="builder-mode-options">
          <label className={mode === 'standard' ? 'active' : ''}><input type="radio" checked={mode === 'standard'} onChange={() => setMode('standard')} /><span><strong>Carte standard</strong><small>Affiche immédiatement la profondeur choisie.</small></span></label>
          <label className={mode === 'progressive' ? 'active' : ''}><input type="radio" checked={mode === 'progressive'} onChange={() => setMode('progressive')} /><span><strong>Exploration progressive</strong><small>Ouvre les voisins au double-clic.</small></span></label>
          <label className={mode === 'hierarchy' ? 'active' : ''}><input type="radio" checked={mode === 'hierarchy'} onChange={() => setMode('hierarchy')} /><span><strong>Exploration imbriquée</strong><small>Utilise des niveaux et des regroupements visuels.</small></span></label>
        </div>
        <div className="builder-two-columns"><label>Direction<select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="both">Amont et aval</option><option value="upstream">Amont uniquement</option><option value="downstream">Aval uniquement</option></select></label><label>Profondeur<select disabled={mode !== 'standard'} value={mode === 'standard' ? depth : 0} onChange={(event) => setDepth(Number(event.target.value))}>{Array.from({ length: (catalog?.max_recursion_depth ?? 10) + 1 }, (_, index) => <option key={index} value={index}>{index === 0 ? 'Sélection seule' : `${index} niveau${index > 1 ? 'x' : ''}`}</option>)}</select></label></div>
      </section>

      {mode !== 'hierarchy' && <section className="panel builder-panel builder-types">
        <header><span>4</span><div><h3>Types d’objets</h3><p>Aucun choix signifie que tous les types actifs sont autorisés.</p></div><b>{objectTypeIds.length || 'Tous'}</b></header>
        <div className="builder-search"><span>⌕</span><input value={objectTypeSearch} onChange={(event) => setObjectTypeSearch(event.target.value)} placeholder="Rechercher un type…" /></div>
        <div className="builder-check-list">{visibleObjectTypes.map((item) => <label key={item.id}><input type="checkbox" checked={objectTypeIds.includes(item.id)} onChange={() => setObjectTypeIds(toggle(objectTypeIds, item.id))} /><i style={{ background: item.color ?? '#64748b' }} /><span>{item.name}</span></label>)}</div>
      </section>}

      {mode === 'hierarchy' && <section className="panel builder-panel builder-hierarchy">
        <header><span>4</span><div><h3>Niveaux de granularité</h3><p>Les niveaux sont vides par défaut. Chaque liste possède sa propre recherche.</p></div><button type="button" className="button secondary" onClick={() => setLevels((current) => [...current, { id: crypto.randomUUID(), name: `Niveau ${current.length + 1}`, object_type_ids: [], grouping: { source: 'none', key: '' } }])}>＋ Niveau</button></header>
        <div className="builder-levels">{levels.map((level, index) => {
          const search = levelSearches[level.id] ?? ''
          const needle = search.trim().toLocaleLowerCase('fr')
          const levelTypes = catalog?.object_types.filter((item) => !needle || item.name.toLocaleLowerCase('fr').includes(needle) || item.code.toLocaleLowerCase('fr').includes(needle)) ?? []
          const keys = level.grouping.source === 'tag' ? tagKeys : attributeKeys
          return <article key={level.id} className="builder-level">
            <header><b>{index + 1}</b><input value={level.name} onChange={(event) => updateLevel(index, { name: event.target.value })} /><div><button disabled={index === 0} onClick={() => setLevels((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })}>↑</button><button disabled={index === levels.length - 1} onClick={() => setLevels((current) => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next })}>↓</button><button disabled={levels.length <= 2} onClick={() => setLevels((current) => current.filter((_, levelIndex) => levelIndex !== index))}>×</button></div></header>
            <div className="builder-search"><span>⌕</span><input value={search} onChange={(event) => setLevelSearches((current) => ({ ...current, [level.id]: event.target.value }))} placeholder="Rechercher un type d’objet…" /></div>
            <div className="builder-check-list level-types">{levelTypes.map((item) => <label key={item.id}><input type="checkbox" checked={level.object_type_ids.includes(item.id)} onChange={() => updateLevel(index, { object_type_ids: toggle(level.object_type_ids, item.id) })} /><i style={{ background: item.color ?? '#64748b' }} /><span>{item.name}</span></label>)}</div>
            <div className="builder-grouping"><label>Regrouper visuellement<select value={level.grouping.source} onChange={(event) => { const source = event.target.value as GroupingSource; updateGrouping(index, source, source === 'tag' ? tagKeys[0] ?? '' : source === 'attribute' ? attributeKeys[0] ?? '' : '') }}><option value="none">Aucun regroupement</option><option value="tag">Par étiquette</option><option value="attribute">Par information complémentaire</option></select></label>{level.grouping.source !== 'none' && <label>{level.grouping.source === 'tag' ? 'Clé d’étiquette' : 'Information complémentaire'}<input list={`builder-keys-${level.id}`} value={level.grouping.key} onChange={(event) => updateGrouping(index, level.grouping.source, event.target.value)} placeholder="Choisir ou saisir une clé…" /><datalist id={`builder-keys-${level.id}`}>{keys.map((key) => <option key={key} value={key} />)}</datalist></label>}</div>
          </article>
        })}</div>
      </section>}

      <section className="panel builder-panel builder-relations">
        <header><span>5</span><div><h3>Types de relations</h3><p>Aucun choix signifie que toutes les relations actives sont utilisées.</p></div><b>{relationTypeIds.length || 'Toutes'}</b></header>
        <div className="builder-search"><span>⌕</span><input value={relationTypeSearch} onChange={(event) => setRelationTypeSearch(event.target.value)} placeholder="Rechercher une relation…" /></div>
        <div className="builder-check-list">{visibleRelationTypes.map((item) => <label key={item.id}><input type="checkbox" checked={relationTypeIds.includes(item.id)} onChange={() => setRelationTypeIds(toggle(relationTypeIds, item.id))} /><i style={{ background: item.color ?? '#94a3b8' }} /><span>{item.name}</span></label>)}</div>
      </section>

      <section className="panel builder-panel builder-filters">
        <header><span>6</span><div><h3>Filtres complémentaires</h3><p>Ces filtres sont rejoués à chaque ouverture de la carte dynamique.</p></div></header>
        <label>Criticité<select value={criticality} onChange={(event) => setCriticality(event.target.value)}><option value="">Toutes</option><option value="critical">Critique</option><option value="high">Haute</option><option value="medium">Moyenne</option><option value="low">Faible</option><option value="unknown">Inconnue</option></select></label>
        <label>Étiquettes<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="network:DMZ, environnement:production" /><small>Format clé:valeur, séparé par des virgules.</small></label>
      </section>
    </div>

    <section className="panel builder-footer"><div><strong>{targetId ? 'La carte existante sera remplacée.' : 'Une nouvelle carte dynamique sera créée.'}</strong><span>Après l’enregistrement, Atlas SI ouvre automatiquement la visualisation.</span></div><div><button className="button secondary" onClick={resetForm}>Réinitialiser</button><button className="button primary" disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? 'Enregistrement…' : targetId ? 'Remplacer et visualiser' : 'Enregistrer et visualiser'}</button></div></section>
  </div>
}
