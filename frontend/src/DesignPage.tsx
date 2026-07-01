import { ChangeEvent, FormEvent, useEffect, useState, type CSSProperties } from 'react'
import { api } from './api'
import type { DesignSettings, Language } from './types'

const PRESETS = {
  atlas: { primary_color: '#2563EB', accent_color: '#D4AD42', sidebar_color: '#0F172A', background_color: '#F3F6FB', surface_color: '#FFFFFF' },
  ocean: { primary_color: '#087EA4', accent_color: '#22C55E', sidebar_color: '#103449', background_color: '#EFF8FB', surface_color: '#FFFFFF' },
  graphite: { primary_color: '#4B5563', accent_color: '#D4A72C', sidebar_color: '#20242A', background_color: '#F1F2F4', surface_color: '#FFFFFF' },
  rubis: { primary_color: '#B4232F', accent_color: '#D5A83E', sidebar_color: '#252A31', background_color: '#F5F5F4', surface_color: '#FFFFFF' }
}

type Props = {
  language: Language
  onDesignChanged: (settings: DesignSettings) => void
}

function errorText(error: unknown) { return error instanceof Error ? error.message : 'Erreur inattendue.' }

export default function DesignPage({ language, onDesignChanged }: Props) {
  const en = language === 'en'
  const [settings, setSettings] = useState<DesignSettings | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { api<DesignSettings>('/api/design/settings').then(setSettings).catch((e) => setNotice({ kind: 'error', text: errorText(e) })) }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!settings) return
    try {
      const updated = await api<DesignSettings>('/api/design/settings', {
        method: 'PUT',
        body: JSON.stringify({
          app_title: settings.app_title,
          app_subtitle: settings.app_subtitle,
          theme_mode: settings.theme_mode,
          primary_color: settings.primary_color,
          accent_color: settings.accent_color,
          sidebar_color: settings.sidebar_color,
          background_color: settings.background_color,
          surface_color: settings.surface_color,
          border_radius: settings.border_radius,
          default_language: settings.default_language,
          allow_user_language_choice: settings.allow_user_language_choice
        })
      })
      setSettings(updated); onDesignChanged(updated)
      setNotice({ kind: 'success', text: en ? 'Design settings saved.' : 'Paramètres de design enregistrés.' })
    } catch (error) { setNotice({ kind: 'error', text: errorText(error) }) }
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setNotice({ kind: 'error', text: en ? 'Use a PNG, JPEG or WebP image.' : 'Utilise une image PNG, JPEG ou WebP.' }); return
    }
    if (file.size > 1_500_000) {
      setNotice({ kind: 'error', text: en ? 'The logo must be smaller than 1.5 MB.' : 'Le logo doit être inférieur à 1,5 Mo.' }); return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file)
    })
    try {
      const updated = await api<DesignSettings>('/api/design/logo', { method: 'PUT', body: JSON.stringify({ data_url: dataUrl }) })
      setSettings(updated); onDesignChanged(updated)
      setNotice({ kind: 'success', text: en ? 'Logo updated.' : 'Logo mis à jour.' })
    } catch (error) { setNotice({ kind: 'error', text: errorText(error) }) }
  }

  async function removeLogo() {
    try {
      const updated = await api<DesignSettings>('/api/design/logo', { method: 'DELETE' })
      setSettings(updated); onDesignChanged(updated)
      setNotice({ kind: 'success', text: en ? 'Logo removed.' : 'Logo supprimé.' })
    } catch (error) { setNotice({ kind: 'error', text: errorText(error) }) }
  }

  if (!settings) return <div className="empty-state">{en ? 'Loading design settings…' : 'Chargement des paramètres de design…'}</div>

  const patch = (values: Partial<DesignSettings>) => setSettings({ ...settings, ...values })
  return <div className="design-admin-page">
    <div className="page-header"><div><p className="eyebrow">{en ? 'Administration' : 'Administration'}</p><h1>{en ? 'Design and languages' : 'Design et langues'}</h1><p>{en ? 'Customize the visual identity and the default interface language.' : 'Personnalise l’identité visuelle et la langue par défaut de l’interface.'}</p></div></div>
    {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    <div className="design-grid">
      <form className="panel form-panel design-form" onSubmit={save}>
        <h2>{en ? 'Visual identity' : 'Identité visuelle'}</h2>
        <label>{en ? 'Application name' : 'Nom de l’application'}<input value={settings.app_title} onChange={(e) => patch({ app_title: e.target.value })} /></label>
        <label>{en ? 'Subtitle' : 'Sous-titre'}<input value={settings.app_subtitle} onChange={(e) => patch({ app_subtitle: e.target.value })} /></label>
        <div className="design-logo-editor">
          <div className="design-logo-preview">{settings.logo_data_url ? <img src={settings.logo_data_url} alt="Logo" /> : <span>{settings.app_title.slice(0, 1).toUpperCase()}</span>}</div>
          <div><label className="button secondary file-button">{en ? 'Choose a logo' : 'Choisir un logo'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void uploadLogo(e)} /></label>{settings.logo_data_url && <button type="button" className="link-button danger" onClick={() => void removeLogo()}>{en ? 'Remove logo' : 'Supprimer le logo'}</button>}<small>PNG, JPEG ou WebP · 1,5 Mo max.</small></div>
        </div>
        <h2>{en ? 'Color theme' : 'Thème de couleurs'}</h2>
        <div className="theme-presets">{Object.entries(PRESETS).map(([name, values]) => <button type="button" key={name} onClick={() => patch(values)}><i style={{ background: values.primary_color }} /><i style={{ background: values.accent_color }} />{name}</button>)}</div>
        <div className="color-grid">
          <label>{en ? 'Primary' : 'Principale'}<input type="color" value={settings.primary_color} onChange={(e) => patch({ primary_color: e.target.value })} /></label>
          <label>{en ? 'Accent' : 'Accent'}<input type="color" value={settings.accent_color} onChange={(e) => patch({ accent_color: e.target.value })} /></label>
          <label>{en ? 'Sidebar' : 'Barre latérale'}<input type="color" value={settings.sidebar_color} onChange={(e) => patch({ sidebar_color: e.target.value })} /></label>
          <label>{en ? 'Background' : 'Arrière-plan'}<input type="color" value={settings.background_color} onChange={(e) => patch({ background_color: e.target.value })} /></label>
          <label>{en ? 'Panels' : 'Panneaux'}<input type="color" value={settings.surface_color} onChange={(e) => patch({ surface_color: e.target.value })} /></label>
        </div>
        <label>{en ? 'Corner radius' : 'Arrondi des angles'}<input type="range" min="0" max="30" value={settings.border_radius} onChange={(e) => patch({ border_radius: Number(e.target.value) })} /><span>{settings.border_radius}px</span></label>
        <label>{en ? 'Default appearance' : 'Apparence par défaut'}<select value={settings.theme_mode} onChange={(e) => patch({ theme_mode: e.target.value as DesignSettings['theme_mode'] })}><option value="light">{en ? 'Light' : 'Clair'}</option><option value="dark">{en ? 'Dark' : 'Sombre'}</option><option value="system">{en ? 'System preference' : 'Préférence du système'}</option></select></label>
        <h2>{en ? 'Languages' : 'Langues'}</h2>
        <label>{en ? 'Default language' : 'Langue par défaut'}<select value={settings.default_language} onChange={(e) => patch({ default_language: e.target.value as Language })}><option value="fr">Français</option><option value="en">English</option></select></label>
        <label className="checkbox"><input type="checkbox" checked={settings.allow_user_language_choice} onChange={(e) => patch({ allow_user_language_choice: e.target.checked })} />{en ? 'Allow each user to choose a language' : 'Autoriser chaque utilisateur à choisir sa langue'}</label>
        <div className="form-actions"><button className="button primary" type="submit">{en ? 'Save design' : 'Enregistrer le design'}</button></div>
      </form>
      <section className="panel design-preview" style={{ '--preview-primary': settings.primary_color, '--preview-accent': settings.accent_color, '--preview-sidebar': settings.sidebar_color, '--preview-bg': settings.background_color, '--preview-surface': settings.surface_color, '--preview-radius': `${settings.border_radius}px` } as CSSProperties}>
        <h2>{en ? 'Preview' : 'Aperçu'}</h2>
        <div className="preview-window"><aside>{settings.logo_data_url ? <img src={settings.logo_data_url} alt="" /> : <b>{settings.app_title.slice(0, 1)}</b>}<span>{settings.app_title}</span><nav><i /><i /><i className="active" /><i /></nav></aside><main><header><strong>{settings.app_subtitle}</strong><button /></header><div className="preview-cards"><article /><article /><article /></div><section /></main></div>
      </section>
    </div>
  </div>
}
