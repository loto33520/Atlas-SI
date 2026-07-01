import cytoscape, { Core, ElementDefinition } from 'cytoscape'
import dagre from 'cytoscape-dagre'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import type { ImpactAnalysis, ImpactScenario, RelationType, SIObject, User } from './types'

cytoscape.use(dagre)

type Notice = { kind: 'success' | 'error'; text: string } | null
type Direction = 'upstream' | 'downstream' | 'both'

const CRITICALITY_LABELS: Record<string, string> = {
  critical: 'Critique', high: 'Haute', medium: 'Moyenne', low: 'Faible', unknown: 'Inconnue'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function scoreClass(score: number): string {
  if (score >= 80) return 'critical'
  if (score >= 55) return 'high'
  if (score >= 30) return 'medium'
  return 'low'
}

function graphElements(result: ImpactAnalysis): ElementDefinition[] {
  const nodes: ElementDefinition[] = result.nodes.map((node) => ({
    data: {
      id: node.id,
      label: node.name,
      subtitle: `${node.object_type_name} · niveau ${node.depth}`,
      depth: node.depth,
      score: node.impact_score,
      criticality: node.criticality
    },
    classes: node.is_root ? 'impact-root' : `impact-depth-${Math.min(node.depth, 6)}`
  }))
  const edges: ElementDefinition[] = result.edges.map((edge) => ({
    data: {
      id: edge.id,
      source: edge.source_id,
      target: edge.target_id,
      label: edge.label || edge.relation_type_name
    },
    classes: edge.directed ? 'impact-directed' : ''
  }))
  return [...nodes, ...edges]
}

function ImpactGraph({ result, onSelect }: { result: ImpactAnalysis; onSelect: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<Core | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const cy = cytoscape({
      container: containerRef.current,
      elements: graphElements(result),
      minZoom: 0.2,
      maxZoom: 4.5,
      wheelSensitivity: 0.8,
      motionBlur: false,
      textureOnViewport: false,
      hideEdgesOnViewport: false,
      style: [
        {
          selector: 'node',
          style: {
            width: 48,
            height: 48,
            'background-color': '#ffffff',
            'border-width': 2,
            'border-color': '#6fa9cf',
            label: 'data(label)',
            color: '#36414d',
            'font-size': 10,
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-margin-y': 8,
            'text-wrap': 'ellipsis',
            'text-max-width': '125px',
            'text-outline-color': '#f8fafc',
            'text-outline-width': 3,
            'overlay-opacity': 0
          }
        },
        { selector: '.impact-root', style: { width: 60, height: 60, 'border-width': 4, 'border-color': '#d4ad42', 'background-color': '#fff8de' } },
        { selector: '.impact-depth-1', style: { 'border-color': '#5f95c4' } },
        { selector: '.impact-depth-2', style: { 'border-color': '#7fa8c7' } },
        { selector: '.impact-depth-3', style: { 'border-color': '#93a8b8' } },
        { selector: '.impact-depth-4, .impact-depth-5, .impact-depth-6', style: { 'border-color': '#a8b2bb' } },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': '#8295aa',
            'target-arrow-color': '#8295aa',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.7,
            'curve-style': 'bezier',
            'control-point-step-size': 48,
            opacity: 0.78,
            label: '',
            'overlay-opacity': 0
          }
        },
        { selector: 'edge:selected', style: { width: 3, 'line-color': '#d4ad42', 'target-arrow-color': '#d4ad42', label: 'data(label)', 'font-size': 9, 'text-background-color': '#fff', 'text-background-opacity': 0.95, 'text-background-padding': '3px' } },
        { selector: 'node:selected', style: { 'border-width': 4, 'border-color': '#d4ad42' } }
      ],
      layout: {
        name: 'dagre',
        rankDir: 'LR',
        align: 'UL',
        nodeSep: 86,
        edgeSep: 42,
        rankSep: 170,
        acyclicer: 'greedy',
        ranker: 'network-simplex',
        padding: 65,
        animate: false,
        fit: true
      } as cytoscape.LayoutOptions
    })
    cyRef.current = cy
    cy.on('tap', 'node', (event) => onSelect(event.target.id()))
    cy.fit(undefined, 65)
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [onSelect, result])

  return <div className="impact-graph" ref={containerRef} />
}

export default function AnalysisPage({ user }: { user: User }) {
  const canContribute = user.roles.includes('admin') || user.roles.includes('contributor')
  const [objects, setObjects] = useState<SIObject[]>([])
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([])
  const [scenarios, setScenarios] = useState<ImpactScenario[]>([])
  const [rootId, setRootId] = useState('')
  const [direction, setDirection] = useState<Direction>('both')
  const [maxDepth, setMaxDepth] = useState(3)
  const [relationTypeIds, setRelationTypeIds] = useState<string[]>([])
  const [excludedIds, setExcludedIds] = useState<string[]>([])
  const [result, setResult] = useState<ImpactAnalysis | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [scenarioName, setScenarioName] = useState('')
  const [scenarioDescription, setScenarioDescription] = useState('')

  const loadReference = useCallback(async () => {
    try {
      const [objectRows, relationRows, scenarioRows] = await Promise.all([
        api<SIObject[]>('/api/objects?limit=2000'),
        api<RelationType[]>('/api/relation-types'),
        api<ImpactScenario[]>('/api/analysis/scenarios')
      ])
      setObjects(objectRows)
      setRelationTypes(relationRows)
      setScenarios(scenarioRows)
      if (!rootId && objectRows.length) setRootId(objectRows[0].id)
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    }
  }, [rootId])

  useEffect(() => { void loadReference() }, [])

  const objectNames = useMemo(() => new Map(objects.map((item) => [item.id, item.name])), [objects])
  const selectedNode = result?.nodes.find((item) => item.id === selectedId) ?? null

  const runAnalysis = useCallback(async (overrideExcluded?: string[]) => {
    if (!rootId) return
    setLoading(true)
    setNotice(null)
    try {
      const nextExcluded = overrideExcluded ?? excludedIds
      const response = await api<ImpactAnalysis>('/api/analysis/impact', {
        method: 'POST',
        body: JSON.stringify({
          root_object_id: rootId,
          direction,
          max_depth: maxDepth,
          relation_type_ids: relationTypeIds,
          excluded_object_ids: nextExcluded
        })
      })
      setExcludedIds(nextExcluded)
      setResult(response)
      setSelectedId(rootId)
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [direction, excludedIds, maxDepth, relationTypeIds, rootId])

  function submit(event: FormEvent) {
    event.preventDefault()
    void runAnalysis()
  }

  function toggleRelationType(id: string) {
    setRelationTypeIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  function excludeAndRecalculate(id: string) {
    if (id === rootId) return
    const next = excludedIds.includes(id) ? excludedIds : [...excludedIds, id]
    void runAnalysis(next)
  }

  function restoreExcluded(id: string) {
    const next = excludedIds.filter((value) => value !== id)
    void runAnalysis(next)
  }

  async function saveScenario(event: FormEvent) {
    event.preventDefault()
    if (!result || !scenarioName.trim()) return
    try {
      await api<ImpactScenario>('/api/analysis/scenarios', {
        method: 'POST',
        body: JSON.stringify({
          name: scenarioName.trim(),
          description: scenarioDescription.trim() || null,
          analysis: {
            root_object_id: rootId,
            direction,
            max_depth: maxDepth,
            relation_type_ids: relationTypeIds,
            excluded_object_ids: excludedIds
          },
          result_snapshot: result
        })
      })
      setScenarioName('')
      setScenarioDescription('')
      setNotice({ kind: 'success', text: 'Scénario enregistré.' })
      await loadReference()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    }
  }

  function loadScenario(scenario: ImpactScenario) {
    setRootId(scenario.root_object_id)
    setDirection(scenario.direction)
    setMaxDepth(scenario.max_depth)
    setRelationTypeIds(scenario.relation_type_ids)
    setExcludedIds(scenario.excluded_object_ids)
    setResult(scenario.result_snapshot)
    setSelectedId(scenario.root_object_id)
    setNotice({ kind: 'success', text: `Scénario « ${scenario.name} » chargé.` })
  }

  async function deleteScenario(id: string) {
    try {
      await api(`/api/analysis/scenarios/${id}`, { method: 'DELETE' })
      setNotice({ kind: 'success', text: 'Scénario archivé.' })
      await loadReference()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    }
  }

  return (
    <div className="analysis-page">
      <div className="page-header">
        <div><h1>Analyse des dépendances et impacts</h1><p>Simule une indisponibilité ou un changement et visualise les éléments potentiellement concernés.</p></div>
      </div>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

      <form className="panel impact-form" onSubmit={submit}>
        <label>Objet de départ
          <select value={rootId} onChange={(event) => { setRootId(event.target.value); setExcludedIds([]) }} required>
            {objects.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.criticality}</option>)}
          </select>
        </label>
        <label>Sens du parcours
          <select value={direction} onChange={(event) => setDirection(event.target.value as Direction)}>
            <option value="both">Amont et aval</option>
            <option value="upstream">Amont — relations entrantes</option>
            <option value="downstream">Aval — relations sortantes</option>
          </select>
        </label>
        <label>Profondeur maximale
          <input type="number" min={1} max={10} value={maxDepth} onChange={(event) => setMaxDepth(Number(event.target.value))} />
        </label>
        <button className="button primary" type="submit" disabled={!rootId || loading}>{loading ? 'Calcul…' : 'Analyser l’impact'}</button>
        <details className="impact-relation-filter span-4">
          <summary>Limiter à certains types de relations ({relationTypeIds.length || 'tous'})</summary>
          <div>{relationTypes.map((item) => <label className="checkbox" key={item.id}><input type="checkbox" checked={relationTypeIds.includes(item.id)} onChange={() => toggleRelationType(item.id)} /> {item.name}</label>)}</div>
        </details>
      </form>

      {excludedIds.length > 0 && <div className="impact-exclusions"><strong>Éléments exclus de la simulation :</strong>{excludedIds.map((id) => <button key={id} onClick={() => restoreExcluded(id)}>{objectNames.get(id) ?? id} ×</button>)}</div>}

      {result && <>
        <div className="impact-metrics">
          <article><span>Éléments concernés</span><strong>{result.summary.total_nodes - 1}</strong></article>
          <article><span>Relations analysées</span><strong>{result.summary.total_edges}</strong></article>
          <article><span>Profondeur atteinte</span><strong>{result.summary.max_depth_reached}</strong></article>
          <article className={result.summary.has_cycles ? 'warning' : ''}><span>Cycles détectés</span><strong>{result.cycles.length}</strong></article>
        </div>

        <section className="impact-workspace">
          <div className="panel impact-map-panel">
            <header><div><h2>Carte d’impact</h2><p>Le nœud doré représente l’élément simulé.</p></div></header>
            <ImpactGraph result={result} onSelect={setSelectedId} />
          </div>
          <aside className="panel impact-detail-panel">
            {selectedNode ? <>
              <small>Niveau {selectedNode.depth}</small>
              <h2>{selectedNode.name}</h2>
              <p>{selectedNode.object_type_name}</p>
              <div className={`impact-score ${scoreClass(selectedNode.impact_score)}`}><span>Score d’impact</span><strong>{selectedNode.impact_score}</strong></div>
              <dl>
                <div><dt>Criticité</dt><dd>{CRITICALITY_LABELS[selectedNode.criticality] ?? selectedNode.criticality}</dd></div>
                <div><dt>Responsable</dt><dd>{selectedNode.owner_name || 'Non renseigné'}</dd></div>
                <div><dt>Chemins connus</dt><dd>{selectedNode.paths_count}</dd></div>
              </dl>
              {!selectedNode.is_root && <button className="button secondary wide" onClick={() => excludeAndRecalculate(selectedNode.id)}>Exclure et recalculer</button>}
            </> : <p>Sélectionne un élément sur la carte.</p>}
          </aside>
        </section>

        <section className="impact-grid">
          <article className="panel">
            <h2>Chemins d’impact</h2>
            <div className="impact-paths">{result.paths.length ? result.paths.map((path, index) => <div key={`${path.node_ids.join('-')}-${index}`}><span>Niveau {path.depth}</span><p>{path.node_ids.map((id) => objectNames.get(id) ?? result.nodes.find((node) => node.id === id)?.name ?? id).join(' → ')}</p></div>) : <p>Aucun chemin supplémentaire.</p>}</div>
          </article>
          <article className={`panel ${result.summary.has_cycles ? 'cycle-panel' : ''}`}>
            <h2>Cycles et dépendances circulaires</h2>
            {result.cycles.length ? result.cycles.map((cycle, index) => <p key={index}>{cycle.node_ids.map((id) => result.nodes.find((node) => node.id === id)?.name ?? id).join(' → ')}</p>) : <p>Aucun cycle détecté dans le périmètre analysé.</p>}
          </article>
        </section>

        {canContribute && <form className="panel scenario-save" onSubmit={saveScenario}>
          <div><h2>Enregistrer cette simulation</h2><p>Conserve les paramètres et un instantané du résultat pour comparaison ou audit.</p></div>
          <input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} placeholder="Nom du scénario" required />
          <input value={scenarioDescription} onChange={(event) => setScenarioDescription(event.target.value)} placeholder="Description facultative" />
          <button className="button primary" type="submit">Enregistrer</button>
        </form>}
      </>}

      <section className="panel scenario-list">
        <header><div><h2>Scénarios enregistrés</h2><p>{scenarios.length} scénario(s) disponible(s).</p></div></header>
        {scenarios.length === 0 ? <p>Aucun scénario enregistré.</p> : <div className="table-wrap"><table><thead><tr><th>Nom</th><th>Objet</th><th>Sens</th><th>Profondeur</th><th>Auteur</th><th>Date</th><th /></tr></thead><tbody>{scenarios.map((scenario) => <tr key={scenario.id}><td><strong>{scenario.name}</strong><small>{scenario.description}</small></td><td>{objectNames.get(scenario.root_object_id) ?? scenario.root_object_id}</td><td>{scenario.direction}</td><td>{scenario.max_depth}</td><td>{scenario.actor_username}</td><td>{formatDate(scenario.updated_at)}</td><td className="actions"><button className="link-button" onClick={() => loadScenario(scenario)}>Charger</button>{canContribute && <button className="link-button danger" onClick={() => void deleteScenario(scenario.id)}>Archiver</button>}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  )
}
