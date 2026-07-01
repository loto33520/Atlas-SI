import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { Language, ObjectType, SIObject, User, VersionCurrent, VersionObservation, VersionSummary } from './types'

type Notice = { kind: 'success' | 'error'; text: string } | null
type Mode = 'create' | 'new-version' | 'correct'

type ObservationForm = {
  object_id: string; observed_version: string; target_version: string; latest_version: string; support_end_date: string;
  exception_until: string; source: string; source_reference: string; notes: string
}

const emptyObservation: ObservationForm = { object_id: '', observed_version: '', target_version: '', latest_version: '', support_end_date: '', exception_until: '', source: 'manuel', source_reference: '', notes: '' }

function labels(language: Language) {
  const en = language === 'en'
  return {
    statuses: en ? { up_to_date: 'Up to date', update_available: 'Update available', unsupported: 'Unsupported', exception: 'Accepted exception', unknown: 'Unknown' } : { up_to_date: 'À jour', update_available: 'Mise à jour disponible', unsupported: 'Non supporté', exception: 'Exception acceptée', unknown: 'Information inconnue' },
    locale: en ? 'en-GB' : 'fr-FR', en
  }
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.' }
function dateInput(value: string | null) { return value ? value.slice(0, 10) : '' }

export default function VersionsPage({ user, language = 'fr' }: { user: User; language?: Language }) {
  const { statuses, locale, en } = labels(language)
  const canContribute = user.roles.includes('admin') || user.roles.includes('contributor')
  const [versions, setVersions] = useState<VersionCurrent[]>([])
  const [summary, setSummary] = useState<VersionSummary | null>(null)
  const [objects, setObjects] = useState<SIObject[]>([])
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([])
  const [history, setHistory] = useState<VersionObservation[]>([])
  const [selectedObjectId, setSelectedObjectId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [mode, setMode] = useState<Mode>('create')
  const [editingObservationId, setEditingObservationId] = useState<string | null>(null)
  const [observation, setObservation] = useState<ObservationForm>(emptyObservation)

  const formatDate = (value: string | null, withTime = false) => value ? new Intl.DateTimeFormat(locale, withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(new Date(value)) : '—'

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams(); if (query.trim()) params.set('q', query.trim()); if (statusFilter) params.set('status', statusFilter)
      const [versionRows, versionSummary, objectRows, typeRows] = await Promise.all([
        api<VersionCurrent[]>(`/api/versions/current?${params.toString()}`), api<VersionSummary>('/api/versions/summary'),
        api<SIObject[]>('/api/objects?include_inactive=false&limit=2000'), api<ObjectType[]>('/api/object-types')
      ])
      setVersions(versionRows); setSummary(versionSummary); setObjects(objectRows); setObjectTypes(typeRows)
    } catch (error) { setNotice({ kind: 'error', text: errorMessage(error) }) } finally { setLoading(false) }
  }, [query, statusFilter])
  useEffect(() => { void loadAll() }, [])
  const objectTypeById = useMemo(() => new Map(objectTypes.map((item) => [item.id, item.name])), [objectTypes])

  function formFrom(item: VersionObservation | VersionCurrent): ObservationForm {
    return {
      object_id: item.object_id, observed_version: item.observed_version ?? '', target_version: item.target_version ?? '', latest_version: item.latest_version ?? '',
      support_end_date: dateInput(item.support_end_date), exception_until: dateInput(item.exception_until), source: item.source || 'manuel',
      source_reference: item.source_reference ?? '', notes: item.notes ?? ''
    }
  }
  function openCreate() { setMode('create'); setEditingObservationId(null); setObservation(emptyObservation); setShowForm(true) }
  function openNewVersion(item: VersionCurrent) { setMode('new-version'); setEditingObservationId(null); setObservation(formFrom(item)); setShowForm(true) }
  function openCorrection(item: VersionObservation | VersionCurrent) { setMode('correct'); setEditingObservationId(item.id); setObservation(formFrom(item)); setShowForm(true) }

  async function submitObservation(event: FormEvent) {
    event.preventDefault()
    const payload = { ...observation, support_end_date: observation.support_end_date || null, exception_until: observation.exception_until || null, source_reference: observation.source_reference || null, notes: observation.notes || null }
    try {
      if (mode === 'correct' && editingObservationId) {
        const { object_id: _ignored, ...changes } = payload
        await api(`/api/versions/observations/${editingObservationId}`, { method: 'PATCH', body: JSON.stringify(changes) })
        setNotice({ kind: 'success', text: en ? 'Observation corrected.' : 'Observation corrigée.' })
      } else {
        await api('/api/versions/observations', { method: 'POST', body: JSON.stringify(payload) })
        setNotice({ kind: 'success', text: mode === 'new-version' ? (en ? 'New version observation recorded.' : 'Nouvelle version enregistrée.') : (en ? 'Version observation recorded.' : 'Observation de version enregistrée.') })
      }
      setShowForm(false); setObservation(emptyObservation); setEditingObservationId(null); await loadAll()
      if (selectedObjectId) await openHistory(selectedObjectId)
    } catch (error) { setNotice({ kind: 'error', text: errorMessage(error) }) }
  }

  async function openHistory(objectId: string) {
    try { setSelectedObjectId(objectId); setHistory(await api<VersionObservation[]>(`/api/versions/observations?object_id=${encodeURIComponent(objectId)}`)) }
    catch (error) { setNotice({ kind: 'error', text: errorMessage(error) }) }
  }

  const modalTitle = mode === 'correct' ? (en ? 'Correct an observation' : 'Corriger une observation') : mode === 'new-version' ? (en ? 'Record a new version' : 'Enregistrer une nouvelle version') : (en ? 'Record a version' : 'Enregistrer une version')
  return <div className="versions-page">
    <div className="page-header"><div><p className="eyebrow">{en ? 'Release 5' : 'Lot 5'}</p><h1>{en ? 'Versions and obsolescence' : 'Versions et obsolescence'}</h1><p>{en ? 'Manual tracking of installed versions, targets and support end dates.' : 'Suivi manuel des versions installées, des cibles et des dates de fin de support.'}</p></div><div className="page-actions">{canContribute && <button className="button primary" onClick={openCreate}>{en ? 'New observation' : 'Nouvelle observation'}</button>}</div></div>
    {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    <div className="version-metrics">{[
      [en ? 'Tracked items' : 'Éléments suivis', summary?.total ?? '—', 'neutral'], [en ? 'Up to date' : 'À jour', summary?.up_to_date ?? '—', 'ok'],
      [en ? 'Updates' : 'Mises à jour', summary?.update_available ?? '—', 'warning'], [en ? 'Unsupported' : 'Non supportés', summary?.unsupported ?? '—', 'danger'],
      [en ? 'Exceptions' : 'Exceptions', summary?.exceptions ?? '—', 'info'], [en ? 'Support ends < 90 d' : 'Fin de support < 90 j', summary?.expiring_within_90_days ?? '—', 'warning']
    ].map(([label, value, tone]) => <article className={`version-metric ${tone}`} key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <form className="version-filters panel" onSubmit={(e) => { e.preventDefault(); void loadAll() }}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={en ? 'Search an object or version…' : 'Rechercher un objet ou une version…'} /><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">{en ? 'All statuses' : 'Tous les états'}</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="button" type="submit">{en ? 'Apply' : 'Appliquer'}</button></form>
    <section className="panel table-panel">{loading ? <div className="empty-state">{en ? 'Loading…' : 'Chargement…'}</div> : versions.length === 0 ? <div className="empty-state">{en ? 'No version observation.' : 'Aucune version observée.'}</div> : <div className="table-wrap"><table><thead><tr><th>{en ? 'Object' : 'Objet'}</th><th>{en ? 'Observed version' : 'Version observée'}</th><th>{en ? 'Target / latest' : 'Cible / dernière'}</th><th>{en ? 'Support end' : 'Fin de support'}</th><th>{en ? 'Status' : 'État'}</th><th>{en ? 'Source' : 'Source'}</th><th>{en ? 'Observed' : 'Observation'}</th><th /></tr></thead><tbody>{versions.map((item) => <tr key={item.id}><td><strong>{item.object_name}</strong><small>{item.object_type_name} · {item.owner_name || (en ? 'no owner' : 'sans responsable')}</small></td><td>{item.observed_version || '—'}</td><td>{item.latest_version || item.target_version || '—'}</td><td>{formatDate(item.support_end_date)}</td><td><span className={`version-status ${item.compliance_status}`}>{statuses[item.compliance_status] ?? item.compliance_status}</span></td><td>{item.source}</td><td>{formatDate(item.observed_at, true)}</td><td className="actions">{canContribute && <button className="link-button" onClick={() => openNewVersion(item)}>{en ? 'Update' : 'Mettre à jour'}</button>}{canContribute && <button className="link-button" onClick={() => openCorrection(item)}>{en ? 'Correct' : 'Corriger'}</button>}<button className="link-button" onClick={() => void openHistory(item.object_id)}>{en ? 'History' : 'Historique'}</button></td></tr>)}</tbody></table></div>}</section>
    {selectedObjectId && <section className="panel version-history"><header><div><h2>{en ? 'History' : 'Historique'}</h2><p>{objects.find((item) => item.id === selectedObjectId)?.name}</p></div><button className="icon-button" onClick={() => { setSelectedObjectId(''); setHistory([]) }}>×</button></header>{history.map((item) => <article key={item.id}><span className={`version-status ${item.compliance_status}`}>{statuses[item.compliance_status]}</span><strong>{item.observed_version || (en ? 'Unknown version' : 'Version inconnue')}</strong><span>{en ? 'Target' : 'Cible'} : {item.latest_version || item.target_version || '—'}</span><span>{formatDate(item.observed_at, true)}</span><small>{item.source}{item.notes ? ` · ${item.notes}` : ''}</small>{canContribute && <button className="link-button" onClick={() => openCorrection(item)}>{en ? 'Correct this observation' : 'Corriger cette observation'}</button>}</article>)}</section>}
    {showForm && <div className="modal-backdrop"><form className="modal-card version-form" onSubmit={submitObservation}><header><div><p className="eyebrow">{mode === 'correct' ? (en ? 'Data correction' : 'Correction de saisie') : (en ? 'Manual observation' : 'Observation manuelle')}</p><h2>{modalTitle}</h2>{mode === 'new-version' && <p>{en ? 'The last values are pre-filled. Change only what is needed.' : 'Les dernières valeurs sont préremplies. Modifie uniquement ce qui change.'}</p>}{mode === 'correct' && <p>{en ? 'This edits the selected history entry without creating a new one.' : 'Cette action corrige la ligne d’historique sélectionnée sans en créer une nouvelle.'}</p>}</div><button type="button" className="icon-button" onClick={() => setShowForm(false)}>×</button></header><label className="span-2">{en ? 'Object' : 'Objet'}<select required disabled={mode !== 'create'} value={observation.object_id} onChange={(e) => setObservation({ ...observation, object_id: e.target.value })}><option value="">{en ? 'Choose an object' : 'Choisir un objet'}</option>{objects.map((item) => <option key={item.id} value={item.id}>{item.name} — {objectTypeById.get(item.object_type_id)}</option>)}</select></label>
      <label>{en ? 'Observed version' : 'Version observée'}<input value={observation.observed_version} onChange={(e) => setObservation({ ...observation, observed_version: e.target.value })} /></label><label>{en ? 'Target version' : 'Version cible'}<input value={observation.target_version} onChange={(e) => setObservation({ ...observation, target_version: e.target.value })} /></label><label>{en ? 'Latest known version' : 'Dernière version connue'}<input value={observation.latest_version} onChange={(e) => setObservation({ ...observation, latest_version: e.target.value })} /></label><label>{en ? 'Support end' : 'Fin de support'}<input type="date" value={observation.support_end_date} onChange={(e) => setObservation({ ...observation, support_end_date: e.target.value })} /></label><label>{en ? 'Exception until' : 'Exception jusqu’au'}<input type="date" value={observation.exception_until} onChange={(e) => setObservation({ ...observation, exception_until: e.target.value })} /></label><label>{en ? 'Source' : 'Source'}<input required value={observation.source} onChange={(e) => setObservation({ ...observation, source: e.target.value })} /></label><label className="span-2">{en ? 'Source reference' : 'Référence de la source'}<input value={observation.source_reference} onChange={(e) => setObservation({ ...observation, source_reference: e.target.value })} /></label><label className="span-2">{en ? 'Notes' : 'Notes'}<textarea value={observation.notes} onChange={(e) => setObservation({ ...observation, notes: e.target.value })} /></label><footer className="span-2"><button type="button" className="button" onClick={() => setShowForm(false)}>{en ? 'Cancel' : 'Annuler'}</button><button type="submit" className="button primary">{mode === 'correct' ? (en ? 'Save correction' : 'Enregistrer la correction') : (en ? 'Record' : 'Enregistrer')}</button></footer></form></div>}
  </div>
}
