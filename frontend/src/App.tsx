import { FormEvent, lazy, ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api, ApiError, setCurrentUser } from './api'
import { tr } from './i18n'
import type {
  AuditEvent,
  AuthConfig,
  Dashboard,
  DesignSettings,
  FeatureSettings,
  Language,
  ObjectType,
  RelationType,
  SIObject,
  SIRelation,
  User
} from './types'

const MapPage = lazy(() => import('./MapPage'))
const ImportPage = lazy(() => import('./ImportPage'))
const AnalysisPage = lazy(() => import('./AnalysisPage'))
const VersionsPage = lazy(() => import('./VersionsPage'))
const DesignPage = lazy(() => import('./DesignPage'))
const QualityPage = lazy(() => import('./QualityPage'))
const FeaturePage = lazy(() => import('./FeaturePage'))
const SavedMapsPage = lazy(() => import('./SavedMapsPage'))
const AnssiTemplatesPage = lazy(() => import('./AnssiTemplatesPage'))

type Notice = { kind: 'success' | 'error'; text: string } | null

const DEFAULT_DESIGN: DesignSettings = { app_title: 'Atlas SI', app_subtitle: 'Cartographie du système d’information', logo_data_url: null, theme_mode: 'light', primary_color: '#2563EB', accent_color: '#D4AD42', sidebar_color: '#0F172A', background_color: '#F3F6FB', surface_color: '#FFFFFF', border_radius: 14, default_language: 'fr', allow_user_language_choice: true, updated_at: null }

function applyDesign(settings: DesignSettings) {
  const root = document.documentElement
  root.style.setProperty('--primary', settings.primary_color)
  root.style.setProperty('--accent', settings.accent_color)
  root.style.setProperty('--sidebar', settings.sidebar_color)
  root.style.setProperty('--app-bg', settings.background_color)
  root.style.setProperty('--surface', settings.surface_color)
  root.style.setProperty('--radius', `${settings.border_radius}px`)
  const dark = settings.theme_mode === 'dark' || (settings.theme_mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.dataset.theme = dark ? 'dark' : 'light'
  document.title = settings.app_title
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function parseJson<T extends Record<string, unknown>>(value: string, label: string): T {
  const text = value.trim()
  if (!text) return {} as T
  const parsed = JSON.parse(text)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} doit contenir un objet JSON.`)
  }
  return parsed as T
}

function getError(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Une erreur inattendue est survenue.'
}


type KeyValuePair = { id: string; key: string; value: string }
let pairSequence = 0

function createPair(key = '', value = ''): KeyValuePair {
  pairSequence += 1
  return { id: `kv-${pairSequence}`, key, value }
}

function recordToPairs(value: Record<string, unknown>): KeyValuePair[] {
  return Object.entries(value).map(([key, item]) => createPair(
    key,
    typeof item === 'string' ? item : JSON.stringify(item)
  ))
}

function parseFlexibleValue(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.parse(trimmed) } catch { return value }
  }
  return value
}

function pairsToRecord(pairs: KeyValuePair[], label: string, stringsOnly = false): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const pair of pairs) {
    const key = pair.key.trim()
    const value = pair.value.trim()
    if (!key && !value) continue
    if (!key) throw new Error(`${label} : une clé est manquante.`)
    if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error(`${label} : la clé « ${key} » est présente plusieurs fois.`)
    result[key] = stringsOnly ? pair.value : parseFlexibleValue(pair.value)
  }
  return result
}

function KeyValueEditor({
  title, help, pairs, onChange, keyPlaceholder = 'clé', valuePlaceholder = 'valeur'
}: {
  title: string
  help: string
  pairs: KeyValuePair[]
  onChange: (pairs: KeyValuePair[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  function update(id: string, field: 'key' | 'value', value: string) {
    onChange(pairs.map((pair) => pair.id === id ? { ...pair, [field]: value } : pair))
  }

  return (
    <section className="key-value-editor span-2">
      <header>
        <div><strong>{title}</strong><small>{help}</small></div>
        <button type="button" onClick={() => onChange([...pairs, createPair()])}>＋ Ajouter</button>
      </header>
      {pairs.length === 0 ? (
        <button type="button" className="key-value-empty" onClick={() => onChange([createPair()])}>Aucune valeur — cliquer pour en ajouter</button>
      ) : (
        <div className="key-value-rows">
          {pairs.map((pair) => (
            <div className="key-value-row" key={pair.id}>
              <input aria-label={`${title} - clé`} value={pair.key} onChange={(event) => update(pair.id, 'key', event.target.value)} placeholder={keyPlaceholder} />
              <span>=</span>
              <input aria-label={`${title} - valeur`} value={pair.value} onChange={(event) => update(pair.id, 'value', event.target.value)} placeholder={valuePlaceholder} />
              <button type="button" aria-label="Supprimer cette ligne" onClick={() => onChange(pairs.filter((item) => item.id !== pair.id))}>×</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null
  return <div className={`notice ${notice.kind}`}>{notice.text}</div>
}

type SchemaFieldDefinition = {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'date' | 'select'
  required?: boolean
  help?: string
  options?: string[]
}

function schemaFields(schema: Record<string, unknown>): SchemaFieldDefinition[] {
  const value = schema.fields
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => ({
      key: String(item.key ?? '').trim(),
      label: String(item.label ?? item.key ?? '').trim(),
      type: (['text', 'number', 'boolean', 'date', 'select'].includes(String(item.type)) ? String(item.type) : 'text') as SchemaFieldDefinition['type'],
      required: Boolean(item.required),
      help: item.help ? String(item.help) : '',
      options: Array.isArray(item.options) ? item.options.map(String) : []
    }))
    .filter((item) => item.key && item.label)
}

function SchemaBuilder({ schema, onChange }: { schema: string; onChange: (value: string) => void }) {
  let parsed: Record<string, unknown> = {}
  try { parsed = parseJson<Record<string, unknown>>(schema, 'Le schéma') } catch { parsed = {} }
  const fields = schemaFields(parsed)
  const update = (next: SchemaFieldDefinition[]) => onChange(JSON.stringify({ ...parsed, fields: next }, null, 2))
  return <div className="schema-builder">
    <header><div><strong>Champs du formulaire</strong><small>Ces champs apparaîtront automatiquement lors de la création d’un objet de ce type.</small></div><button type="button" onClick={() => update([...fields, { key: '', label: '', type: 'text', required: false, help: '', options: [] }])}>+ Ajouter</button></header>
    {fields.length === 0 ? <p className="muted-copy">Aucun champ spécifique. Les informations complémentaires restent disponibles.</p> : fields.map((field, index) => <div className="schema-field-row" key={`${field.key}-${index}`}>
      <input value={field.key} onChange={(event) => update(fields.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} placeholder="version" />
      <input value={field.label} onChange={(event) => update(fields.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} placeholder="Version installée" />
      <select value={field.type} onChange={(event) => update(fields.map((item, i) => i === index ? { ...item, type: event.target.value as SchemaFieldDefinition['type'] } : item))}><option value="text">Texte</option><option value="number">Nombre</option><option value="boolean">Oui / Non</option><option value="date">Date</option><option value="select">Liste</option></select>
      <input value={(field.options ?? []).join(', ')} onChange={(event) => update(fields.map((item, i) => i === index ? { ...item, options: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } : item))} placeholder="Options séparées par ," disabled={field.type !== 'select'} />
      <label className="checkbox compact"><input type="checkbox" checked={Boolean(field.required)} onChange={(event) => update(fields.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))} /> Obligatoire</label>
      <button type="button" className="link-button danger" onClick={() => update(fields.filter((_, i) => i !== index))}>Retirer</button>
    </div>)}
    <details><summary>JSON avancé</summary><textarea className="code-input" value={schema} onChange={(event) => onChange(event.target.value)} /></details>
  </div>
}

function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>
}

function JsonPreview({ value }: { value: unknown }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>
}

function BrandVisual({ design, small = false }: { design: DesignSettings; small?: boolean }) {
  return design.logo_data_url ? <div className={`brand-logo ${small ? 'small' : ''}`}><img src={design.logo_data_url} alt={design.app_title} /></div> : <div className={`brand-mark ${small ? 'small' : ''}`}>{design.app_title.slice(0, 1).toUpperCase()}</div>
}

function LoginScreen({
  error,
  design,
  language,
  authConfig,
  onLanguage,
  onAuthenticated
}: {
  error?: string
  design: DesignSettings
  language: Language
  authConfig: AuthConfig
  onLanguage: (language: Language) => void
  onAuthenticated: (user: User) => void
}) {
  const [username, setUsername] = useState(authConfig.local_username_hint ?? 'admin')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState('')

  async function submitLocal(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setLocalError('')
    try {
      const current = await api<User>('/api/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
      setCurrentUser(current)
      onAuthenticated(current)
    } catch (err) {
      setLocalError(getError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <BrandVisual design={design} />
        <p className="eyebrow">{tr(language, 'loginEyebrow')}</p>
        <h1>{design.app_title}</h1>
        <p className="login-intro">{design.app_subtitle || tr(language, 'loginIntro')}</p>
        {(error || localError) && <div className="notice error">{localError || error}</div>}
        {authConfig.mode === 'local' ? (
          <form className="local-login-form" onSubmit={submitLocal}>
            <p className="login-mode-label">{tr(language, 'localAuthentication')}</p>
            <label>
              {tr(language, 'username')}
              <input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label>
              {tr(language, 'password')}
              <input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <button className="button primary wide" type="submit" disabled={submitting}>
              {submitting ? tr(language, 'loading') : tr(language, 'localLoginButton')}
            </button>
          </form>
        ) : (
          <a className="button primary wide" href="/api/auth/login">{tr(language, 'loginButton')}</a>
        )}
        {design.allow_user_language_choice && <div className="login-language"><button type="button" className={language === 'fr' ? 'active' : ''} onClick={() => onLanguage('fr')}>FR</button><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => onLanguage('en')}>EN</button></div>}
      </section>
    </main>
  )
}

function Shell({ user, onLogout, design, language, onLanguage, onDesignChanged, features, onFeaturesChanged }: { user: User; onLogout: () => Promise<void>; design: DesignSettings; language: Language; onLanguage: (language: Language) => void; onDesignChanged: (settings: DesignSettings) => void; features: FeatureSettings; onFeaturesChanged: (settings: FeatureSettings) => void }) {
  const canAdmin = user.roles.includes('admin')
  const canContribute = canAdmin || user.roles.includes('contributor')
  const canAudit = user.roles.includes('admin') || user.roles.includes('auditor')
  const enabled = new Set(features.enabled_features)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandVisual design={design} small />
          <div><strong>{design.app_title}</strong><span>{design.app_subtitle}</span></div>
        </div>
        <nav>
          <NavLink to="/" end>{tr(language, 'dashboard')}</NavLink>
          {enabled.has('map') && <NavLink to="/map">{tr(language, 'map')}</NavLink>}
          {enabled.has('saved_maps') && <NavLink to="/saved-maps">{tr(language, 'savedMaps')}</NavLink>}
          {enabled.has('impact_analysis') && <NavLink to="/analysis">{tr(language, 'analysis')}</NavLink>}
          {enabled.has('versions') && <NavLink to="/versions">{tr(language, 'versions')}</NavLink>}
          <NavLink to="/objects">{tr(language, 'objects')}</NavLink>
          <NavLink to="/relations">{tr(language, 'relations')}</NavLink>
          {canContribute && enabled.has('imports') && <NavLink to="/imports">{tr(language, 'imports')}</NavLink>}
          {enabled.has('quality') && <NavLink to="/quality">{tr(language, 'quality')}</NavLink>}
          {canAdmin && <div className="nav-section">{tr(language, 'administration')}</div>}
          {canAdmin && <NavLink to="/object-types">{tr(language, 'objectTypes')}</NavLink>}
          {canAdmin && <NavLink to="/relation-types">{tr(language, 'relationTypes')}</NavLink>}
          {canAdmin && <NavLink to="/design">{tr(language, 'design')}</NavLink>}
          {canAdmin && <NavLink to="/features">{language === 'en' ? 'Features' : 'Fonctionnalités'}</NavLink>}
          {canAdmin && enabled.has('anssi_templates') && <NavLink to="/anssi-templates">{language === 'en' ? 'ANSSI templates' : 'Modèles ANSSI'}</NavLink>}
          {canAudit && enabled.has('audit') && <NavLink to="/audit">{tr(language, 'audit')}</NavLink>}
        </nav>
        <div className="sidebar-user">
          <div className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</div>
          <div className="user-copy"><strong>{user.display_name}</strong><span>{user.roles.join(' · ')}</span></div>
          {design.allow_user_language_choice && <select className="language-select" aria-label={tr(language, 'language')} value={language} onChange={(event) => onLanguage(event.target.value as Language)}><option value="fr">FR</option><option value="en">EN</option></select>}
          <button className="icon-button" onClick={() => void onLogout()} title={tr(language, 'logout')}>↪</button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage user={user} language={language} />} />
          <Route path="/map" element={enabled.has('map') ? <Suspense fallback={<div className="map-route-loading"><div className="spinner" /><span>{tr(language, 'loading')}</span></div>}><MapPage user={user} design={design} language={language} enabledFeatures={features.enabled_features} /></Suspense> : <Navigate to="/" replace />} />
          <Route path="/saved-maps" element={enabled.has('saved_maps') ? <Suspense fallback={<div className="map-route-loading"><div className="spinner" /><span>{tr(language, 'loading')}</span></div>}><SavedMapsPage user={user} language={language} /></Suspense> : <Navigate to="/" replace />} />
          <Route path="/analysis" element={enabled.has('impact_analysis') ? <Suspense fallback={<div className="map-route-loading"><div className="spinner" /><span>{tr(language, 'loading')}</span></div>}><AnalysisPage user={user} /></Suspense> : <Navigate to="/" replace />} />
          <Route path="/versions" element={enabled.has('versions') ? <Suspense fallback={<div className="map-route-loading"><div className="spinner" /><span>{tr(language, 'loading')}</span></div>}><VersionsPage user={user} language={language} /></Suspense> : <Navigate to="/" replace />} />
          <Route path="/objects" element={<ObjectsPage user={user} governanceEnabled={enabled.has('governance')} />} />
          <Route path="/relations" element={<RelationsPage user={user} />} />
          <Route path="/imports" element={canContribute && enabled.has('imports') ? <Suspense fallback={<div className="map-route-loading"><div className="spinner" /><span>{tr(language, 'loading')}</span></div>}><ImportPage /></Suspense> : <Navigate to="/" replace />} />
          <Route path="/quality" element={enabled.has('quality') ? <Suspense fallback={<div className="map-route-loading"><div className="spinner" /><span>{tr(language, 'loading')}</span></div>}><QualityPage language={language} canExport={canAudit} /></Suspense> : <Navigate to="/" replace />} />
          <Route path="/object-types" element={canAdmin ? <ObjectTypesPage /> : <Navigate to="/" replace />} />
          <Route path="/relation-types" element={canAdmin ? <RelationTypesPage /> : <Navigate to="/" replace />} />
          <Route path="/design" element={canAdmin ? <Suspense fallback={<div className="map-route-loading"><div className="spinner" /><span>{tr(language, 'loading')}</span></div>}><DesignPage language={language} onDesignChanged={onDesignChanged} /></Suspense> : <Navigate to="/" replace />} />
          <Route path="/features" element={canAdmin ? <Suspense fallback={<div className="map-route-loading"><div className="spinner" /><span>{tr(language, 'loading')}</span></div>}><FeaturePage language={language} onChanged={onFeaturesChanged} /></Suspense> : <Navigate to="/" replace />} />
          <Route path="/anssi-templates" element={canAdmin && enabled.has('anssi_templates') ? <Suspense fallback={<div className="map-route-loading"><div className="spinner" /><span>{tr(language, 'loading')}</span></div>}><AnssiTemplatesPage language={language} /></Suspense> : <Navigate to="/" replace />} />
          <Route path="/audit" element={canAudit && enabled.has('audit') ? <AuditPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function DashboardPage({ user, language }: { user: User; language: Language }) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<Dashboard>('/api/dashboard').then(setData).catch((err) => setError(getError(err)))
  }, [])

  return (
    <>
      <PageHeader
        title={tr(language, 'dashboard')}
        subtitle={`${tr(language, 'welcome')} ${user.display_name}. ${tr(language, 'dashboardSubtitle')}`}
      />
      {error && <div className="notice error">{error}</div>}
      <div className="metric-grid">
        {[
          ['Types d’objets', data?.object_types ?? '—'],
          ['Types de relations', data?.relation_types ?? '—'],
          ['Objets actifs', data?.objects ?? '—'],
          ['Relations actives', data?.relations ?? '—'],
          ['Modifications sur 7 jours', data?.recent_audit_events ?? '—']
        ].map(([label, value]) => (
          <article className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <section className="panel intro-panel">
        <div>
          <p className="eyebrow">{tr(language, 'lot6')}</p>
          <h2>{tr(language, 'dashboardTitle')}</h2>
          <p>
            Les objets et relations du référentiel alimentent des vues immersives processus, applicative, infrastructure, données et globale.
            Le niveau de détail s’adapte au zoom, le module d’analyse calcule les impacts et le suivi des versions met en évidence les mises à jour, fins de support et exceptions.
          </p>
        </div>
        <div className="role-list">
          <span className="badge">Session serveur</span>
          <span className="badge">Authentification locale ou Keycloak</span>
          <span className="badge">Historique complet</span>
          <span className="badge">Archivage logique</span>
          <span className="badge">Cartes interactives</span>
          <span className="badge">Filtres clé:valeur</span>
          <span className="badge">Analyse d’impact</span>
          <span className="badge">Scénarios enregistrés</span>
          <span className="badge">Suivi des versions</span>
          <span className="badge">Design personnalisable</span><span className="badge">Français / English</span><span className="badge">Contrôles qualité</span>
        </div>
      </section>
    </>
  )
}

const emptyObjectTypeForm = {
  code: '', name: '', description: '', icon: '', color: '#2563EB', schema: '{}', active: true
}

function ObjectTypesPage() {
  const [items, setItems] = useState<ObjectType[]>([])
  const [form, setForm] = useState(emptyObjectTypeForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active')
  const [typeSearch, setTypeSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await api<ObjectType[]>('/api/object-types?include_inactive=true'))
    } catch (error) {
      setNotice({ kind: 'error', text: getError(error) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const visibleItems = useMemo(() => {
    const needle = typeSearch.trim().toLocaleLowerCase('fr')
    return items.filter((item) => {
      if (statusFilter === 'active' && !item.active) return false
      if (statusFilter === 'archived' && item.active) return false
      return !needle || item.name.toLocaleLowerCase('fr').includes(needle) || item.code.toLocaleLowerCase('fr').includes(needle)
    })
  }, [items, statusFilter, typeSearch])

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      const payload = { ...form, schema: parseJson(form.schema, 'Le schéma') }
      if (editingId) {
        await api(`/api/object-types/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api('/api/object-types', { method: 'POST', body: JSON.stringify(payload) })
      }
      setNotice({ kind: 'success', text: editingId ? 'Type d’objet modifié.' : 'Type d’objet créé.' })
      setForm(emptyObjectTypeForm)
      setEditingId(null)
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: getError(error) })
    }
  }

  function edit(item: ObjectType) {
    setEditingId(item.id)
    setForm({
      code: item.code,
      name: item.name,
      description: item.description ?? '',
      icon: item.icon ?? '',
      color: item.color ?? '#2563EB',
      schema: JSON.stringify(item.schema, null, 2),
      active: item.active
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function archive(item: ObjectType) {
    if (!window.confirm(`Archiver le type « ${item.name} » ?`)) return
    try {
      await api(`/api/object-types/${item.id}`, { method: 'DELETE' })
      setNotice({ kind: 'success', text: 'Type d’objet archivé.' })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: getError(error) })
    }
  }

  return (
    <>
      <PageHeader title="Types d’objets" subtitle="Définis les familles d’éléments disponibles dans le référentiel." />
      <NoticeBox notice={notice} />
      <div className="two-column">
        <form className="panel form-panel" onSubmit={(event) => void submit(event)}>
          <h2>{editingId ? 'Modifier le type' : 'Nouveau type'}</h2>
          <label>Code<input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="application" /></label>
          <label>Nom<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Application" /></label>
          <label>Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div className="form-row">
            <label>Icône<input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="app-window" /></label>
            <label>Couleur<input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></label>
          </div>
          <SchemaBuilder schema={form.schema} onChange={(schema) => setForm({ ...form, schema })} />
          <label className="checkbox"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Actif</label>
          <div className="form-actions">
            {editingId && <button type="button" className="button secondary" onClick={() => { setEditingId(null); setForm(emptyObjectTypeForm) }}>Annuler</button>}
            <button className="button primary" type="submit">{editingId ? 'Enregistrer' : 'Créer'}</button>
          </div>
        </form>
        <section className="panel table-panel">
          <div className="table-toolbar object-type-toolbar">
            <div><h2>Types enregistrés</h2><span>{visibleItems.length} affiché(s) sur {items.length}</span></div>
            <div className="object-type-filters">
              <input className="search-input" value={typeSearch} onChange={(event) => setTypeSearch(event.target.value)} placeholder="Rechercher un type…" />
              <select aria-label="Filtrer les types" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'active' | 'archived' | 'all')}>
                <option value="active">Actifs uniquement</option>
                <option value="archived">Archivés uniquement</option>
                <option value="all">Tous les types</option>
              </select>
            </div>
          </div>
          {loading ? <p>Chargement…</p> : visibleItems.length === 0 ? <EmptyState text="Aucun type d’objet pour ce filtre." /> : (
            <div className="table-wrap"><table><thead><tr><th>Type</th><th>Code</th><th>Objets rattachés</th><th>État</th><th></th></tr></thead><tbody>
              {visibleItems.map((item) => <tr key={item.id} className={!item.active ? 'muted-row' : ''}>
                <td><span className="color-dot" style={{ background: item.color ?? '#64748b' }} /> <strong>{item.name}</strong></td>
                <td><code>{item.code}</code></td>
                <td><strong>{item.active_object_count ?? 0} actif(s)</strong><small>{item.object_count ?? 0} au total</small></td>
                <td>{item.active ? <span className="status active">Actif</span> : <span className="status archived">Archivé</span>}</td>
                <td className="actions"><button className="link-button" onClick={() => edit(item)}>Modifier</button>{item.active && <button className="link-button danger" onClick={() => void archive(item)}>Archiver</button>}</td>
              </tr>)}
            </tbody></table></div>
          )}
        </section>
      </div>
    </>
  )
}

const emptyRelationTypeForm = {
  code: '', name: '', description: '', source_type_id: '', target_type_id: '', directed: true, color: '#2563EB', active: true
}

function RelationTypesPage() {
  const [items, setItems] = useState<RelationType[]>([])
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([])
  const [form, setForm] = useState(emptyRelationTypeForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const load = useCallback(async () => {
    try {
      const [relations, types] = await Promise.all([
        api<RelationType[]>('/api/relation-types?include_inactive=true'),
        api<ObjectType[]>('/api/object-types?include_inactive=true')
      ])
      setItems(relations)
      setObjectTypes(types)
    } catch (error) {
      setNotice({ kind: 'error', text: getError(error) })
    }
  }, [])

  useEffect(() => { void load() }, [load])
  const typeName = useCallback((id: string | null) => objectTypes.find((item) => item.id === id)?.name ?? 'Tous', [objectTypes])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const payload = {
      ...form,
      source_type_id: form.source_type_id || null,
      target_type_id: form.target_type_id || null
    }
    try {
      if (editingId) await api(`/api/relation-types/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      else await api('/api/relation-types', { method: 'POST', body: JSON.stringify(payload) })
      setNotice({ kind: 'success', text: editingId ? 'Type de relation modifié.' : 'Type de relation créé.' })
      setEditingId(null)
      setForm(emptyRelationTypeForm)
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: getError(error) })
    }
  }

  function edit(item: RelationType) {
    setEditingId(item.id)
    setForm({
      code: item.code, name: item.name, description: item.description ?? '',
      source_type_id: item.source_type_id ?? '', target_type_id: item.target_type_id ?? '',
      directed: item.directed, color: item.color ?? '#2563EB', active: item.active
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function archive(item: RelationType) {
    if (!window.confirm(`Archiver le type de relation « ${item.name} » ?`)) return
    try {
      await api(`/api/relation-types/${item.id}`, { method: 'DELETE' })
      setNotice({ kind: 'success', text: 'Type de relation archivé.' })
      await load()
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }) }
  }

  return (
    <>
      <PageHeader title="Types de relations" subtitle="Définis le vocabulaire utilisé pour relier les composantes du SI." />
      <NoticeBox notice={notice} />
      <div className="two-column">
        <form className="panel form-panel" onSubmit={(event) => void submit(event)}>
          <h2>{editingId ? 'Modifier le type' : 'Nouveau type de relation'}</h2>
          <label>Code<input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="hosted_on" /></label>
          <label>Nom<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Hébergé sur" /></label>
          <label>Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div className="form-row">
            <label>Type source<select value={form.source_type_id} onChange={(e) => setForm({ ...form, source_type_id: e.target.value })}><option value="">Tous</option>{objectTypes.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label>Type cible<select value={form.target_type_id} onChange={(e) => setForm({ ...form, target_type_id: e.target.value })}><option value="">Tous</option>{objectTypes.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          </div>
          <div className="form-row">
            <label>Couleur<input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></label>
            <label className="checkbox"><input type="checkbox" checked={form.directed} onChange={(e) => setForm({ ...form, directed: e.target.checked })} /> Relation orientée</label>
          </div>
          <label className="checkbox"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Actif</label>
          <div className="form-actions">{editingId && <button type="button" className="button secondary" onClick={() => { setEditingId(null); setForm(emptyRelationTypeForm) }}>Annuler</button>}<button className="button primary" type="submit">{editingId ? 'Enregistrer' : 'Créer'}</button></div>
        </form>
        <section className="panel table-panel">
          <h2>Relations disponibles</h2>
          <div className="table-wrap"><table><thead><tr><th>Relation</th><th>Contraintes</th><th>État</th><th></th></tr></thead><tbody>
            {items.map((item) => <tr key={item.id} className={!item.active ? 'muted-row' : ''}>
              <td><span className="color-dot" style={{ background: item.color ?? '#64748b' }} /> <strong>{item.name}</strong><small>{item.code}</small></td>
              <td>{typeName(item.source_type_id)} → {typeName(item.target_type_id)}</td>
              <td>{item.active ? <span className="status active">Actif</span> : <span className="status archived">Archivé</span>}</td>
              <td className="actions"><button className="link-button" onClick={() => edit(item)}>Modifier</button>{item.active && <button className="link-button danger" onClick={() => void archive(item)}>Archiver</button>}</td>
            </tr>)}
          </tbody></table></div>
        </section>
      </div>
    </>
  )
}

const emptyObjectForm = {
  external_id: '', object_type_id: '', name: '', description: '', status: 'active', criticality: 'unknown',
  owner_name: '', data_owner_name: '', review_status: 'draft', confidence_level: 'unknown', last_reviewed_at: '', next_review_at: '', review_frequency_days: '', protection_level: 'internal', tags: [] as KeyValuePair[], attributes: [] as KeyValuePair[], active: true
}

function ObjectsPage({ user, governanceEnabled = false }: { user: User; governanceEnabled?: boolean }) {
  const canWrite = user.roles.includes('admin') || user.roles.includes('contributor')
  const [items, setItems] = useState<SIObject[]>([])
  const [types, setTypes] = useState<ObjectType[]>([])
  const [form, setForm] = useState(emptyObjectForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const [objects, objectTypes] = await Promise.all([
        api<SIObject[]>('/api/objects?include_inactive=true&limit=2000'),
        api<ObjectType[]>('/api/object-types?include_inactive=true')
      ])
      setItems(objects)
      setTypes(objectTypes)
      setForm((current) => current.object_type_id || !objectTypes.length ? current : { ...current, object_type_id: objectTypes.find((t) => t.active)?.id ?? '' })
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }) }
  }, [])

  useEffect(() => { void load() }, [load])
  const typeName = useCallback((id: string) => types.find((item) => item.id === id)?.name ?? 'Type inconnu', [types])
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => [item.name, item.external_id, item.owner_name, typeName(item.object_type_id)].some((value) => value?.toLowerCase().includes(needle)))
  }, [items, search, typeName])
  const selectedType = types.find((item) => item.id === form.object_type_id)
  const configuredFields = schemaFields(selectedType?.schema ?? {})
  const configuredKeys = new Set(configuredFields.map((field) => field.key))
  const extraAttributes = form.attributes.filter((pair) => !configuredKeys.has(pair.key))

  function attributeValue(key: string): string {
    return form.attributes.find((pair) => pair.key === key)?.value ?? ''
  }

  function setAttributeValue(key: string, value: string) {
    const existing = form.attributes.find((pair) => pair.key === key)
    const attributes = existing
      ? form.attributes.map((pair) => pair.id === existing.id ? { ...pair, value } : pair)
      : [...form.attributes, createPair(key, value)]
    setForm({ ...form, attributes })
  }

  function setExtraAttributes(next: KeyValuePair[]) {
    const configured = form.attributes.filter((pair) => configuredKeys.has(pair.key))
    setForm({ ...form, attributes: [...configured, ...next] })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      const tags = pairsToRecord(form.tags, 'Les étiquettes', true)
      const stringTags = Object.fromEntries(Object.entries(tags).map(([key, value]) => [key, String(value)]))
      const payload = {
        ...form,
        external_id: form.external_id || null,
        description: form.description || null,
        owner_name: form.owner_name || null,
        data_owner_name: form.data_owner_name || null,
        last_reviewed_at: form.last_reviewed_at || null,
        next_review_at: form.next_review_at || null,
        review_frequency_days: form.review_frequency_days ? Number(form.review_frequency_days) : null,
        tags: stringTags,
        attributes: pairsToRecord(form.attributes, 'Les informations complémentaires')
      }
      if (editingId) await api(`/api/objects/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      else await api('/api/objects', { method: 'POST', body: JSON.stringify(payload) })
      setNotice({ kind: 'success', text: editingId ? 'Objet modifié.' : 'Objet créé.' })
      setEditingId(null)
      setForm({ ...emptyObjectForm, object_type_id: types.find((t) => t.active)?.id ?? '' })
      await load()
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }) }
  }

  function edit(item: SIObject) {
    setEditingId(item.id)
    setForm({
      external_id: item.external_id ?? '', object_type_id: item.object_type_id, name: item.name,
      description: item.description ?? '', status: item.status, criticality: item.criticality,
      owner_name: item.owner_name ?? '', data_owner_name: item.data_owner_name ?? '', review_status: item.review_status, confidence_level: item.confidence_level, last_reviewed_at: item.last_reviewed_at ? item.last_reviewed_at.slice(0, 10) : '', next_review_at: item.next_review_at ?? '', review_frequency_days: item.review_frequency_days ? String(item.review_frequency_days) : '', protection_level: item.protection_level, tags: recordToPairs(item.tags),
      attributes: recordToPairs(item.attributes), active: item.active
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function archive(item: SIObject) {
    if (!window.confirm(`Archiver « ${item.name} » et ses relations ?`)) return
    try {
      await api(`/api/objects/${item.id}`, { method: 'DELETE' })
      setNotice({ kind: 'success', text: 'Objet archivé.' })
      await load()
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }) }
  }

  return (
    <>
      <PageHeader title="Objets du SI" subtitle="Inventorie les processus, applications, serveurs, données et autres composantes." />
      <NoticeBox notice={notice} />
      {canWrite && <form className="panel form-panel horizontal-form object-form" onSubmit={(event) => void submit(event)}>
        <div className="form-title"><h2>{editingId ? 'Modifier un objet' : 'Ajouter un objet'}</h2><p>Les étiquettes seront utilisées comme filtres dans la cartographie.</p></div>
        <div className="form-grid">
          <label>Type<select required value={form.object_type_id} onChange={(e) => setForm({ ...form, object_type_id: e.target.value })}><option value="">Sélectionner</option>{types.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Nom<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Identifiant externe<input value={form.external_id} onChange={(e) => setForm({ ...form, external_id: e.target.value })} placeholder="CMDB-0001" /></label>
          <label>Responsable<input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} /></label>
          <label>État<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Actif</option><option value="project">Projet</option><option value="maintenance">Maintenance</option><option value="obsolete">Obsolète</option><option value="retired">Retiré</option></select></label>
          <label>Criticité<select value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })}><option value="unknown">Non définie</option><option value="low">Faible</option><option value="medium">Moyenne</option><option value="high">Haute</option><option value="critical">Critique</option></select></label>
          <label className="span-2">Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          {governanceEnabled && <fieldset className="dynamic-fields governance-fields span-2"><legend>Gouvernance et revue</legend><div className="form-grid"><label>Responsable de la donnée<input value={form.data_owner_name} onChange={(e) => setForm({ ...form, data_owner_name: e.target.value })} /></label><label>Statut de validation<select value={form.review_status} onChange={(e) => setForm({ ...form, review_status: e.target.value })}><option value="draft">Brouillon</option><option value="validated">Validé</option><option value="outdated">À revoir</option></select></label><label>Niveau de confiance<select value={form.confidence_level} onChange={(e) => setForm({ ...form, confidence_level: e.target.value })}><option value="unknown">Inconnu</option><option value="estimated">Estimé</option><option value="confirmed">Confirmé</option></select></label><label>Mention de protection<select value={form.protection_level} onChange={(e) => setForm({ ...form, protection_level: e.target.value })}><option value="public">Public</option><option value="internal">Usage interne</option><option value="confidential">Confidentiel</option><option value="restricted">Diffusion restreinte</option></select></label><label>Dernière revue<input type="date" value={form.last_reviewed_at} onChange={(e) => setForm({ ...form, last_reviewed_at: e.target.value })} /></label><label>Prochaine revue<input type="date" value={form.next_review_at} onChange={(e) => setForm({ ...form, next_review_at: e.target.value })} /></label><label>Fréquence de revue (jours)<input type="number" min="1" max="3650" value={form.review_frequency_days} onChange={(e) => setForm({ ...form, review_frequency_days: e.target.value })} /></label></div></fieldset>}
          {configuredFields.length > 0 && <fieldset className="dynamic-fields span-2"><legend>Informations demandées pour ce type</legend><div className="form-grid">{configuredFields.map((field) => <label key={field.key}>{field.label}{field.required ? ' *' : ''}{field.type === 'boolean' ? <select required={field.required} value={attributeValue(field.key)} onChange={(event) => setAttributeValue(field.key, event.target.value)}><option value="">Non renseigné</option><option value="true">Oui</option><option value="false">Non</option></select> : field.type === 'select' ? <select required={field.required} value={attributeValue(field.key)} onChange={(event) => setAttributeValue(field.key, event.target.value)}><option value="">Sélectionner…</option>{(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input required={field.required} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={attributeValue(field.key)} onChange={(event) => setAttributeValue(field.key, event.target.value)} />}{field.help && <small>{field.help}</small>}</label>)}</div></fieldset>}
          <KeyValueEditor
            title="Étiquettes"
            help="Servent à filtrer la cartographie, par exemple environnement = production."
            pairs={form.tags}
            onChange={(tags) => setForm({ ...form, tags })}
            keyPlaceholder="environnement"
            valuePlaceholder="production"
          />
          <KeyValueEditor
            title="Informations complémentaires"
            help="Champs propres à cet objet, par exemple version = 8.4.2 ou sauvegarde = quotidienne."
            pairs={extraAttributes}
            onChange={setExtraAttributes}
            keyPlaceholder="version"
            valuePlaceholder="8.4.2"
          />
        </div>
        <div className="form-actions">{editingId && <button type="button" className="button secondary" onClick={() => { setEditingId(null); setForm({ ...emptyObjectForm, object_type_id: types.find((t) => t.active)?.id ?? '' }) }}>Annuler</button>}<button className="button primary" type="submit">{editingId ? 'Enregistrer' : 'Ajouter'}</button></div>
      </form>}
      <section className="panel table-panel full-panel">
        <div className="table-toolbar"><div><h2>Inventaire</h2><span>{filtered.length} objet(s)</span></div><input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" /></div>
        {filtered.length === 0 ? <EmptyState text="Aucun objet ne correspond à la recherche." /> : <div className="table-wrap"><table><thead><tr><th>Objet</th><th>Type</th><th>État</th><th>Criticité</th><th>Responsable</th><th>Étiquettes</th><th></th></tr></thead><tbody>
          {filtered.map((item) => <tr key={item.id} className={!item.active ? 'muted-row' : ''}>
            <td><strong>{item.name}</strong>{item.external_id && <small>{item.external_id}</small>}</td><td>{typeName(item.object_type_id)}</td><td><span className={`status ${item.active ? 'active' : 'archived'}`}>{item.active ? item.status : 'Archivé'}</span></td><td><span className={`criticality ${item.criticality}`}>{item.criticality}</span></td><td>{item.owner_name || '—'}</td><td><div className="tags">{Object.entries(item.tags).slice(0, 3).map(([key, value]) => <span key={key}>{key}:{value}</span>)}</div></td><td className="actions">{canWrite && <button className="link-button" onClick={() => edit(item)}>Modifier</button>}{canWrite && item.active && <button className="link-button danger" onClick={() => void archive(item)}>Archiver</button>}</td>
          </tr>)}
        </tbody></table></div>}
      </section>
    </>
  )
}

const emptyRelationForm = { relation_type_id: '', source_id: '', target_id: '', label: '', attributes: [] as KeyValuePair[], active: true }

function RelationsPage({ user }: { user: User }) {
  const canWrite = user.roles.includes('admin') || user.roles.includes('contributor')
  const [items, setItems] = useState<SIRelation[]>([])
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([])
  const [objects, setObjects] = useState<SIObject[]>([])
  const [form, setForm] = useState(emptyRelationForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const load = useCallback(async () => {
    try {
      const [relations, types, objectList] = await Promise.all([
        api<SIRelation[]>('/api/relations?include_inactive=true&limit=5000'),
        api<RelationType[]>('/api/relation-types?include_inactive=true'),
        api<SIObject[]>('/api/objects?include_inactive=true&limit=2000')
      ])
      setItems(relations); setRelationTypes(types); setObjects(objectList)
      setForm((current) => ({
        ...current,
        relation_type_id: current.relation_type_id || types.find((t) => t.active)?.id || '',
        source_id: current.source_id || objectList.find((o) => o.active)?.id || ''
      }))
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }) }
  }, [])

  useEffect(() => { void load() }, [load])
  const objectName = useCallback((id: string) => objects.find((item) => item.id === id)?.name ?? 'Objet inconnu', [objects])
  const relationName = useCallback((id: string) => relationTypes.find((item) => item.id === id)?.name ?? 'Relation inconnue', [relationTypes])

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      const payload = { ...form, attributes: pairsToRecord(form.attributes, 'Les informations complémentaires') }
      if (editingId) await api(`/api/relations/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      else await api('/api/relations', { method: 'POST', body: JSON.stringify(payload) })
      setNotice({ kind: 'success', text: editingId ? 'Relation modifiée.' : 'Relation créée.' })
      setEditingId(null); setForm(emptyRelationForm); await load()
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }) }
  }

  function edit(item: SIRelation) {
    setEditingId(item.id)
    setForm({ relation_type_id: item.relation_type_id, source_id: item.source_id, target_id: item.target_id, label: item.label, attributes: recordToPairs(item.attributes), active: item.active })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function archive(item: SIRelation) {
    if (!window.confirm('Archiver cette relation ?')) return
    try { await api(`/api/relations/${item.id}`, { method: 'DELETE' }); setNotice({ kind: 'success', text: 'Relation archivée.' }); await load() }
    catch (error) { setNotice({ kind: 'error', text: getError(error) }) }
  }

  return (
    <>
      <PageHeader title="Relations" subtitle="Relie les objets afin de constituer progressivement le graphe du SI." />
      <NoticeBox notice={notice} />
      {canWrite && <form className="panel form-panel horizontal-form" onSubmit={(event) => void submit(event)}>
        <div className="form-title"><h2>{editingId ? 'Modifier la relation' : 'Créer une relation'}</h2><p>Les contraintes de type sont vérifiées par l’API.</p></div>
        <div className="form-grid relation-grid">
          <label>Type de relation<select required value={form.relation_type_id} onChange={(e) => setForm({ ...form, relation_type_id: e.target.value })}><option value="">Sélectionner</option>{relationTypes.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Source<select required value={form.source_id} onChange={(e) => setForm({ ...form, source_id: e.target.value })}><option value="">Sélectionner</option>{objects.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Cible<select required value={form.target_id} onChange={(e) => setForm({ ...form, target_id: e.target.value })}><option value="">Sélectionner</option>{objects.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Libellé complémentaire<input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          <KeyValueEditor
            title="Informations complémentaires"
            help="Facultatif : protocole, port, fréquence, niveau de service ou autre précision sur le lien."
            pairs={form.attributes}
            onChange={(attributes) => setForm({ ...form, attributes })}
            keyPlaceholder="protocole"
            valuePlaceholder="HTTPS"
          />
        </div>
        <div className="form-actions">{editingId && <button type="button" className="button secondary" onClick={() => { setEditingId(null); setForm(emptyRelationForm) }}>Annuler</button>}<button className="button primary" type="submit">{editingId ? 'Enregistrer' : 'Relier'}</button></div>
      </form>}
      <section className="panel table-panel full-panel"><div className="table-toolbar"><div><h2>Dépendances enregistrées</h2><span>{items.length} relation(s)</span></div></div>
        {items.length === 0 ? <EmptyState text="Aucune relation enregistrée." /> : <div className="table-wrap"><table><thead><tr><th>Source</th><th>Relation</th><th>Cible</th><th>État</th><th></th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id} className={!item.active ? 'muted-row' : ''}><td><strong>{objectName(item.source_id)}</strong></td><td><span className="relation-pill">{relationName(item.relation_type_id)}</span>{item.label && <small>{item.label}</small>}</td><td><strong>{objectName(item.target_id)}</strong></td><td>{item.active ? <span className="status active">Active</span> : <span className="status archived">Archivée</span>}</td><td className="actions">{canWrite && <button className="link-button" onClick={() => edit(item)}>Modifier</button>}{canWrite && item.active && <button className="link-button danger" onClick={() => void archive(item)}>Archiver</button>}</td></tr>)}
        </tbody></table></div>}
      </section>
    </>
  )
}

function AuditPage() {
  const [items, setItems] = useState<AuditEvent[]>([])
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    api<AuditEvent[]>('/api/audit-events?limit=500').then(setItems).catch((error) => setNotice({ kind: 'error', text: getError(error) }))
  }, [])

  return (
    <>
      <PageHeader title="Historique" subtitle="Chaque opération d’administration est tracée avec son auteur et les valeurs avant/après." />
      <NoticeBox notice={notice} />
      <section className="panel table-panel full-panel">
        {items.length === 0 ? <EmptyState text="Aucun événement d’historique." /> : <div className="audit-list">
          {items.map((item) => <details key={item.id} className="audit-item">
            <summary><span className={`audit-action ${item.action}`}>{item.action}</span><strong>{item.entity_type}</strong><code>{item.entity_id.slice(0, 12)}</code><span>{item.actor_username}</span><time>{formatDate(item.created_at)}</time></summary>
            <div className="audit-details"><div><h3>Avant</h3><JsonPreview value={item.before} /></div><div><h3>Après</h3><JsonPreview value={item.after} /></div></div>
            <small>Requête : {item.request_id ?? '—'} · Adresse : {item.source_ip ?? '—'}</small>
          </details>)}
        </div>}
      </section>
    </>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [authConfig, setAuthConfig] = useState<AuthConfig | undefined>(undefined)
  const [error, setError] = useState('')
  const [design, setDesign] = useState<DesignSettings>(DEFAULT_DESIGN)
  const [language, setLanguageState] = useState<Language>(() => (localStorage.getItem('atlas-language') === 'en' ? 'en' : 'fr'))
  const [features, setFeatures] = useState<FeatureSettings | null>(null)

  useEffect(() => {
    api<AuthConfig>('/api/auth/config')
      .then(setAuthConfig)
      .catch((err: unknown) => { setError(getError(err)); setAuthConfig({ mode: 'keycloak', local_username_hint: null }) })
    api<DesignSettings>('/api/design/settings').then((settings) => {
      setDesign(settings); applyDesign(settings)
      const stored = localStorage.getItem('atlas-language')
      const selected = settings.allow_user_language_choice && (stored === 'fr' || stored === 'en') ? stored : settings.default_language
      setLanguageState(selected); document.documentElement.lang = selected
    }).catch(() => applyDesign(DEFAULT_DESIGN))
    api<User>('/api/auth/me')
      .then(async (current) => {
        setCurrentUser(current); setUser(current)
        try { setFeatures(await api<FeatureSettings>('/api/features')) } catch { setFeatures({ enabled_features: ['map'], options: {}, features: [], updated_at: null }) }
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) { setCurrentUser(null); setUser(null) }
        else { setError(getError(err)); setUser(null) }
      })
  }, [])

  function setLanguage(language: Language) {
    setLanguageState(language); localStorage.setItem('atlas-language', language); document.documentElement.lang = language
  }
  function designChanged(settings: DesignSettings) { setDesign(settings); applyDesign(settings) }

  async function authenticated(current: User) {
    setCurrentUser(current); setUser(current)
    try { setFeatures(await api<FeatureSettings>('/api/features')) } catch { setFeatures({ enabled_features: ['map'], options: {}, features: [], updated_at: null }) }
  }

  async function logout() {
    try {
      const response = await api<{ logout_url: string }>('/api/auth/logout', { method: 'POST' })
      setCurrentUser(null); setFeatures(null); window.location.assign(response.logout_url)
    } catch (err) { setError(getError(err)) }
  }

  if (user === undefined || authConfig === undefined || (user && features === null)) return <main className="loading-page"><div className="spinner" /><span>{tr(language, 'loading')}</span></main>
  if (!user) return <LoginScreen error={error} design={design} language={language} authConfig={authConfig} onLanguage={setLanguage} onAuthenticated={(current) => void authenticated(current)} />
  return <Shell user={user} onLogout={logout} design={design} language={language} onLanguage={setLanguage} onDesignChanged={designChanged} features={features!} onFeaturesChanged={setFeatures} />
}
