import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from './api'
import type { Language, SavedMap, User } from './types'
import SavedMapBuilder from './SavedMapBuilder'

type Notice = { kind: 'success' | 'error'; text: string } | null

type EditForm = {
  name: string
  description: string
  visibility: 'private' | 'all' | 'groups'
  group_names: string
  protection_level: 'public' | 'internal' | 'confidential' | 'restricted'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}

function formatDate(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default function SavedMapsPage({ user, language = 'fr' }: { user: User; language?: Language }) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const builderOpen = searchParams.get('mode') === 'builder'
  const builderMapId = searchParams.get('edit') ?? ''
  const [maps, setMaps] = useState<SavedMap[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'all' | 'dynamic' | 'snapshot'>('all')
  const [editing, setEditing] = useState<SavedMap | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setMaps(await api<SavedMap[]>('/api/saved-maps'))
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(language === 'en' ? 'en' : 'fr')
    return maps.filter((item) => {
      if (mode !== 'all' && item.map_mode !== mode) return false
      if (!needle) return true
      return [item.name, item.description ?? '', item.owner_username].some((value) => value.toLocaleLowerCase(language === 'en' ? 'en' : 'fr').includes(needle))
    })
  }, [language, maps, mode, query])

  function canEdit(item: SavedMap): boolean {
    return item.owner_sub === user.subject || user.roles.includes('admin')
  }

  function openEdit(item: SavedMap) {
    setEditing(item)
    setEditForm({
      name: item.name,
      description: item.description ?? '',
      visibility: item.visibility,
      group_names: item.group_names.join(', '),
      protection_level: item.protection_level
    })
  }

  async function saveEdit() {
    if (!editing || !editForm || editForm.name.trim().length < 2) return
    setSaving(true)
    try {
      const updated = await api<SavedMap>(`/api/saved-maps/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editForm.name.trim(),
          description: editForm.description.trim() || null,
          visibility: editForm.visibility,
          group_names: editForm.group_names.split(',').map((value) => value.trim()).filter(Boolean),
          protection_level: editForm.protection_level
        })
      })
      setMaps((current) => current.map((item) => item.id === updated.id ? updated : item).sort((a, b) => a.name.localeCompare(b.name, language === 'en' ? 'en' : 'fr')))
      setEditing(null)
      setEditForm(null)
      setNotice({ kind: 'success', text: language === 'en' ? 'Saved map updated.' : 'Carte enregistrée mise à jour.' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function archive(item: SavedMap) {
    if (!window.confirm(language === 'en' ? `Archive “${item.name}”?` : `Archiver la carte « ${item.name} » ?`)) return
    try {
      await api(`/api/saved-maps/${item.id}`, { method: 'DELETE' })
      setMaps((current) => current.filter((value) => value.id !== item.id))
      setNotice({ kind: 'success', text: language === 'en' ? 'Saved map archived.' : 'Carte archivée.' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    }
  }

  return <>
    <div className="page-header saved-maps-header">
      <div><p className="eyebrow">{language === 'en' ? 'Map library' : 'Bibliothèque cartographique'}</p><h1>{language === 'en' ? 'Saved maps' : 'Cartes enregistrées'}</h1><p>{language === 'en' ? 'Build a map on a full page, save it, then open the interactive visualization.' : 'Construis une carte sur une page complète, enregistre-la, puis ouvre sa visualisation interactive.'}</p></div>
      <div className="saved-maps-header-actions"><button className={`button ${builderOpen ? 'secondary' : 'primary'}`} onClick={() => setSearchParams(builderOpen ? {} : { mode: 'builder' })}>{builderOpen ? (language === 'en' ? 'Back to library' : 'Revenir à la bibliothèque') : (language === 'en' ? 'Build a map' : 'Construire une carte')}</button>{!builderOpen && <button className="button secondary" onClick={() => navigate('/map')}>{language === 'en' ? 'Open free map' : 'Ouvrir la carte libre'}</button>}</div>
    </div>
    {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    {builderOpen ? <SavedMapBuilder user={user} language={language} maps={maps} initialMapId={builderMapId} onSaved={(saved) => setMaps((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved])} /> : <>
    <section className="panel saved-maps-toolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={language === 'en' ? 'Search by name, description or owner…' : 'Rechercher par nom, description ou propriétaire…'} />
      <div className="saved-maps-mode" role="group" aria-label={language === 'en' ? 'Map mode' : 'Mode de carte'}>
        <button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>{language === 'en' ? 'All' : 'Toutes'}</button>
        <button className={mode === 'dynamic' ? 'active' : ''} onClick={() => setMode('dynamic')}>{language === 'en' ? 'Dynamic' : 'Dynamiques'}</button>
        <button className={mode === 'snapshot' ? 'active' : ''} onClick={() => setMode('snapshot')}>{language === 'en' ? 'Snapshots' : 'Instantanés'}</button>
      </div>
    </section>
    {loading ? <section className="panel saved-maps-empty"><div className="spinner" /><span>{language === 'en' ? 'Loading maps…' : 'Chargement des cartes…'}</span></section> : filtered.length === 0 ? <section className="panel saved-maps-empty"><strong>{language === 'en' ? 'No saved maps' : 'Aucune carte enregistrée'}</strong><span>{language === 'en' ? 'Create a selection in the map, then save it.' : 'Construis une sélection dans la cartographie, puis enregistre-la.'}</span></section> : <div className="saved-maps-grid">
      {filtered.map((item) => {
        const roots = item.root_object_ids.length
        const objectTypes = item.object_type_ids.length
        const relationTypes = item.relation_type_ids.length
        return <article className="panel saved-map-card" key={item.id}>
          <header><div><span className={`saved-map-mode ${item.map_mode}`}>{item.map_mode === 'snapshot' ? (language === 'en' ? 'Snapshot' : 'Instantané') : (language === 'en' ? 'Dynamic' : 'Dynamique')}</span><h2>{item.name}</h2></div><span className={`saved-map-protection ${item.protection_level}`}>{item.protection_level}</span></header>
          <p>{item.description || (language === 'en' ? 'No description.' : 'Aucune description.')}</p>
          <dl><div><dt>{language === 'en' ? 'Starting objects' : 'Objets de départ'}</dt><dd>{roots || (language === 'en' ? 'All' : 'Tous')}</dd></div><div><dt>{language === 'en' ? 'Object types' : 'Types d’objets'}</dt><dd>{objectTypes || (language === 'en' ? 'All' : 'Tous')}</dd></div><div><dt>{language === 'en' ? 'Relationship types' : 'Types de relations'}</dt><dd>{relationTypes || (language === 'en' ? 'All' : 'Tous')}</dd></div><div><dt>{language === 'en' ? 'Depth' : 'Profondeur'}</dt><dd>{item.max_depth}</dd></div></dl>
          <footer><div><strong>{item.owner_username}</strong><small>{language === 'en' ? 'Updated' : 'Mise à jour'} {formatDate(item.updated_at, language)}</small></div><div className="saved-map-actions"><button className="button primary" onClick={() => navigate(`/map?saved=${encodeURIComponent(item.id)}`)}>{language === 'en' ? 'Open' : 'Ouvrir'}</button>{canEdit(item) && <button className="button secondary" onClick={() => setSearchParams({ mode: 'builder', edit: item.id })}>{language === 'en' ? 'Configure' : 'Configurer'}</button>}{canEdit(item) && <button className="button secondary" onClick={() => openEdit(item)}>{language === 'en' ? 'Properties' : 'Propriétés'}</button>}{canEdit(item) && <button className="link-button danger" onClick={() => void archive(item)}>{language === 'en' ? 'Archive' : 'Archiver'}</button>}</div></footer>
        </article>
      })}
    </div>}
    </>}

    {editing && editForm && <div className="saved-map-modal"><section className="panel saved-map-edit-dialog"><header><div><small>{language === 'en' ? 'Saved map' : 'Carte enregistrée'}</small><h2>{language === 'en' ? 'Edit properties' : 'Modifier les propriétés'}</h2></div><button onClick={() => { setEditing(null); setEditForm(null) }}>×</button></header><label>{language === 'en' ? 'Name' : 'Nom'}<input autoFocus value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></label><label>{language === 'en' ? 'Description' : 'Description'}<textarea value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} /></label><div className="form-row"><label>{language === 'en' ? 'Visibility' : 'Visibilité'}<select value={editForm.visibility} onChange={(event) => setEditForm({ ...editForm, visibility: event.target.value as EditForm['visibility'] })}><option value="private">{language === 'en' ? 'Private' : 'Privée'}</option><option value="all">{language === 'en' ? 'All users' : 'Tous les utilisateurs'}</option><option value="groups">{language === 'en' ? 'Keycloak groups' : 'Groupes Keycloak'}</option></select></label><label>{language === 'en' ? 'Protection' : 'Mention de protection'}<select value={editForm.protection_level} onChange={(event) => setEditForm({ ...editForm, protection_level: event.target.value as EditForm['protection_level'] })}><option value="public">Public</option><option value="internal">{language === 'en' ? 'Internal' : 'Usage interne'}</option><option value="confidential">{language === 'en' ? 'Confidential' : 'Confidentiel'}</option><option value="restricted">{language === 'en' ? 'Restricted' : 'Diffusion restreinte'}</option></select></label></div>{editForm.visibility === 'groups' && <label>{language === 'en' ? 'Allowed groups' : 'Groupes autorisés'}<input value={editForm.group_names} onChange={(event) => setEditForm({ ...editForm, group_names: event.target.value })} placeholder="ATLAS-RSSI, ATLAS-DIRECTION" /></label>}<div className="form-actions"><button className="button secondary" onClick={() => { setEditing(null); setEditForm(null) }}>{language === 'en' ? 'Cancel' : 'Annuler'}</button><button className="button primary" disabled={saving || editForm.name.trim().length < 2} onClick={() => void saveEdit()}>{saving ? '…' : language === 'en' ? 'Save' : 'Enregistrer'}</button></div></section></div>}
  </>
}
