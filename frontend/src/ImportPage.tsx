import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { ImportAnalyse, ImportJob, ImportJobSummary } from './types'

type Notice = { kind: 'success' | 'error'; text: string } | null
type EntityKind = 'objects' | 'relations'
type SourceFormat = 'csv' | 'json'
type DuplicateMode = 'skip' | 'update' | 'error'

const OBJECT_FIELDS: Array<[string, string, boolean]> = [
  ['external_id', 'Identifiant externe', false],
  ['type_code', 'Type d’objet', true],
  ['name', 'Nom', true],
  ['description', 'Description', false],
  ['status', 'État', false],
  ['criticality', 'Criticité', false],
  ['owner_name', 'Responsable', false],
  ['tags', 'Étiquettes', false],
  ['attributes', 'Informations complémentaires', false],
  ['active', 'Actif', false]
]

const RELATION_FIELDS: Array<[string, string, boolean]> = [
  ['relation_type_code', 'Type de relation', true],
  ['source_ref', 'Référence source', true],
  ['source_type_code', 'Type de la source', false],
  ['target_ref', 'Référence cible', true],
  ['target_type_code', 'Type de la cible', false],
  ['label', 'Libellé', false],
  ['attributes', 'Informations complémentaires', false],
  ['active', 'Actif', false]
]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function statusLabel(value: string): string {
  return ({ preview: 'Aperçu', applied: 'Appliqué', rolled_back: 'Annulé', failed: 'Échec' } as Record<string, string>)[value] ?? value
}

function toEntityKind(value: string): EntityKind {
  return value === 'relations' ? 'relations' : 'objects'
}

export default function ImportPage() {
  const [entityKind, setEntityKind] = useState<EntityKind>('objects')
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>('csv')
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>('skip')
  const [filename, setFilename] = useState('')
  const [content, setContent] = useState('')
  const [analyse, setAnalyse] = useState<ImportAnalyse | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [job, setJob] = useState<ImportJob | null>(null)
  const [history, setHistory] = useState<ImportJobSummary[]>([])
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)

  const fields = entityKind === 'objects' ? OBJECT_FIELDS : RELATION_FIELDS
  const canPreview = useMemo(() => content.trim().length > 0 && analyse !== null, [analyse, content])

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api<ImportJobSummary[]>('/api/imports'))
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    }
  }, [])

  useEffect(() => { void loadHistory() }, [loadHistory])

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const format: SourceFormat = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv'
    setSourceFormat(format)
    setFilename(file.name)
    setContent(await file.text())
    setAnalyse(null)
    setJob(null)
    setMapping({})
    setNotice(null)
  }

  async function analyseFile() {
    setBusy(true)
    setNotice(null)
    try {
      const result = await api<ImportAnalyse>('/api/imports/analyse', {
        method: 'POST',
        body: JSON.stringify({ entity_kind: entityKind, source_format: sourceFormat, content, filename: filename || null })
      })
      setAnalyse(result)
      setMapping(result.suggested_mapping)
      setJob(null)
      setNotice({ kind: 'success', text: `${result.row_count} ligne(s) détectée(s). Vérifie la correspondance des colonnes.` })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function buildPreview() {
    setBusy(true)
    setNotice(null)
    try {
      const result = await api<ImportJob>('/api/imports/preview', {
        method: 'POST',
        body: JSON.stringify({
          entity_kind: entityKind,
          source_format: sourceFormat,
          content,
          filename: filename || null,
          duplicate_mode: duplicateMode,
          mapping
        })
      })
      setJob(result)
      setNotice({
        kind: Number(result.summary.errors ?? 0) > 0 ? 'error' : 'success',
        text: Number(result.summary.errors ?? 0) > 0
          ? `Aperçu créé avec ${result.summary.errors} erreur(s).`
          : 'Aperçu validé. Tu peux appliquer l’import.'
      })
      await loadHistory()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function applyJob() {
    if (!job || !window.confirm(`Appliquer cet import de ${job.summary.rows ?? 0} ligne(s) ?`)) return
    setBusy(true)
    try {
      const result = await api<ImportJob>(`/api/imports/${job.id}/apply`, { method: 'POST' })
      setJob(result)
      setNotice({ kind: 'success', text: `${result.summary.applied ?? 0} modification(s) appliquée(s).` })
      await loadHistory()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function viewJob(id: string) {
    setBusy(true)
    try {
      setJob(await api<ImportJob>(`/api/imports/${id}`))
      window.scrollTo({ top: 420, behavior: 'smooth' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function rollbackJob(target: ImportJob | ImportJobSummary) {
    if (!window.confirm('Annuler cet import ? Les créations seront archivées et les mises à jour restaurées.')) return
    setBusy(true)
    try {
      const result = await api<ImportJob>(`/api/imports/${target.id}/rollback`, { method: 'POST' })
      if (job?.id === target.id) setJob(result)
      setNotice({ kind: 'success', text: 'Import annulé.' })
      await loadHistory()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  function resetFile() {
    setFilename('')
    setContent('')
    setAnalyse(null)
    setMapping({})
    setJob(null)
    setNotice(null)
  }

  const safeEntityKind = toEntityKind(entityKind)

  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">Lot 3</p><h1>Imports CSV et JSON</h1><p>Prévisualise, contrôle les doublons, applique puis annule un import si nécessaire.</p></div>
        <div className="header-actions">
          <a className="button secondary" href={`/api/imports/template/${safeEntityKind}`}>Télécharger le modèle CSV</a>
        </div>
      </header>

      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

      <div className="import-layout">
        <section className="panel import-wizard">
          <div className="import-steps"><span className={content ? 'done' : 'active'}>1. Fichier</span><span className={analyse ? 'done' : content ? 'active' : ''}>2. Colonnes</span><span className={job ? 'done' : analyse ? 'active' : ''}>3. Aperçu</span><span className={job?.status === 'applied' ? 'done' : job ? 'active' : ''}>4. Application</span></div>

          <div className="form-row">
            <label>Contenu à importer<select value={entityKind} onChange={(event) => { setEntityKind(toEntityKind(event.target.value)); resetFile() }}><option value="objects">Objets du SI</option><option value="relations">Relations</option></select></label>
            <label>Gestion des doublons<select value={duplicateMode} onChange={(event) => setDuplicateMode(event.target.value as DuplicateMode)}><option value="skip">Ignorer les existants</option><option value="update">Mettre à jour les existants</option><option value="error">Bloquer sur les doublons</option></select></label>
          </div>

          <label className="import-dropzone">
            <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => void chooseFile(event)} />
            <strong>{filename || 'Choisir un fichier CSV ou JSON'}</strong>
            <span>{content ? `${Math.ceil(content.length / 1024)} Ko chargés` : 'Le fichier est analysé dans le navigateur puis transmis à Atlas SI.'}</span>
          </label>

          {content && !analyse && <div className="form-actions"><button className="button secondary" onClick={resetFile}>Changer de fichier</button><button className="button primary" disabled={busy} onClick={() => void analyseFile()}>{busy ? 'Analyse…' : 'Analyser le fichier'}</button></div>}

          {analyse && <>
            <div className="import-mapping-header"><div><h2>Correspondance des colonnes</h2><p>{analyse.row_count} ligne(s), {analyse.columns.length} colonne(s). Les champs marqués * sont obligatoires.</p></div><button className="link-button" onClick={resetFile}>Changer de fichier</button></div>
            <div className="mapping-grid">
              {fields.map(([key, label, required]) => <label key={key}>{label}{required ? ' *' : ''}<select value={mapping[key] ?? ''} onChange={(event) => setMapping({ ...mapping, [key]: event.target.value })}><option value="">Ne pas importer</option>{analyse.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>)}
            </div>
            <div className="sample-table"><h3>Exemple de données</h3><div className="table-wrap"><table><thead><tr>{analyse.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{analyse.sample.slice(0, 3).map((row, index) => <tr key={index}>{analyse.columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div></div>
            <div className="form-actions"><button className="button primary" disabled={!canPreview || busy} onClick={() => void buildPreview()}>{busy ? 'Préparation…' : 'Créer l’aperçu'}</button></div>
          </>}
        </section>

        <aside className="panel import-help">
          <h2>Formats acceptés</h2>
          <p><strong>Étiquettes :</strong> JSON ou paires séparées par des points-virgules.</p>
          <code>environnement=production;site=siege</code>
          <p><strong>Informations :</strong> même syntaxe, avec conversion automatique des nombres et booléens.</p>
          <code>version=8.4;port=443;sauvegarde=true</code>
          {entityKind === 'relations' && <p>Les références source et cible recherchent d’abord l’identifiant externe, puis le nom exact. Le type permet de lever une ambiguïté.</p>}
        </aside>
      </div>

      {job && <section className="panel import-preview">
        <div className="import-preview-header"><div><p className="eyebrow">Aperçu #{job.id.slice(0, 8)}</p><h2>Résultat du contrôle</h2></div><span className={`import-status ${job.status}`}>{statusLabel(job.status)}</span></div>
        <div className="metric-grid compact">
          {[['Lignes', job.summary.rows], ['Créations', job.summary.create], ['Mises à jour', job.summary.update], ['Ignorées', job.summary.skip], ['Erreurs', job.summary.errors]].map(([label, value]) => <article className="metric-card" key={label}><span>{label}</span><strong>{String(value ?? 0)}</strong></article>)}
        </div>
        <div className="table-wrap"><table><thead><tr><th>Ligne</th><th>Action</th><th>Identité</th><th>Message</th></tr></thead><tbody>{job.preview_rows.slice(0, 300).map((row) => <tr key={`${row.row_number}-${row.identity}`} className={row.status === 'error' ? 'import-error-row' : ''}><td>{row.row_number}</td><td><span className={`import-action ${row.action}`}>{row.action}</span></td><td><code>{row.identity}</code></td><td>{row.message || 'Prêt'}</td></tr>)}</tbody></table></div>
        {job.preview_rows.length > 300 && <p className="muted-copy">Aperçu limité aux 300 premières lignes dans l’interface.</p>}
        <div className="form-actions">
          {job.status === 'preview' && <button className="button primary" disabled={busy || Number(job.summary.errors ?? 0) > 0} onClick={() => void applyJob()}>Appliquer l’import</button>}
          {job.status === 'applied' && <button className="button danger" disabled={busy} onClick={() => void rollbackJob(job)}>Annuler cet import</button>}
        </div>
      </section>}

      <section className="panel table-panel">
        <div className="import-preview-header"><div><p className="eyebrow">Traçabilité</p><h2>Historique des imports</h2></div><button className="link-button" onClick={() => void loadHistory()}>Actualiser</button></div>
        {history.length === 0 ? <p className="muted-copy">Aucun import enregistré.</p> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Fichier</th><th>Contenu</th><th>Auteur</th><th>Résultat</th><th></th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{formatDate(item.created_at)}</td><td>{item.filename || 'Sans nom'}</td><td>{item.entity_kind === 'objects' ? 'Objets' : 'Relations'}</td><td>{item.actor_username}</td><td><span className={`import-status ${item.status}`}>{statusLabel(item.status)}</span></td><td className="actions"><button className="link-button" onClick={() => void viewJob(item.id)}>Consulter</button>{item.status === 'applied' && <button className="link-button danger" onClick={() => void rollbackJob(item)}>Annuler</button>}</td></tr>)}</tbody></table></div>}
      </section>
    </>
  )
}
