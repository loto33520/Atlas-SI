import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { FeatureSettings, Language } from './types'

type Notice = { kind: 'success' | 'error'; text: string } | null
const CATEGORY_LABELS: Record<string, { fr: string; en: string }> = {
  cartography: { fr: 'Cartographie', en: 'Mapping' },
  analysis: { fr: 'Analyse', en: 'Analysis' },
  lifecycle: { fr: 'Cycle de vie', en: 'Lifecycle' },
  data: { fr: 'Alimentation des données', en: 'Data loading' },
  governance: { fr: 'Gouvernance', en: 'Governance' },
  templates: { fr: 'Modèles', en: 'Templates' }
}

const MATURITY_LABELS: Record<number, { fr: string; en: string }> = {
  1: { fr: 'Niveau 1 — Essentiel', en: 'Level 1 — Essential' },
  2: { fr: 'Niveau 2 — Maîtrisé', en: 'Level 2 — Managed' },
  3: { fr: 'Niveau 3 — Gouverné', en: 'Level 3 — Governed' }
}

function getError(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}

export default function FeaturePage({ language = 'fr', onChanged }: { language?: Language; onChanged: (settings: FeatureSettings) => void }) {
  const [settings, setSettings] = useState<FeatureSettings | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<Notice>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api<FeatureSettings>('/api/features').then((value) => {
      setSettings(value)
      setSelected(new Set(value.enabled_features))
    }).catch((error) => setNotice({ kind: 'error', text: getError(error) }))
  }, [])

  const grouped = useMemo(() => {
    const result = new Map<string, NonNullable<FeatureSettings['features']>>()
    for (const feature of settings?.features ?? []) {
      const list = result.get(feature.category) ?? []
      list.push(feature)
      result.set(feature.category, list)
    }
    return [...result.entries()]
  }, [settings])

  function toggle(code: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setNotice(null)
    try {
      const updated = await api<FeatureSettings>('/api/features', {
        method: 'PUT',
        body: JSON.stringify({ enabled_features: [...selected], options: settings?.options ?? {} })
      })
      setSettings(updated)
      setSelected(new Set(updated.enabled_features))
      onChanged(updated)
      setNotice({ kind: 'success', text: language === 'en' ? 'Functional profile saved.' : 'Profil fonctionnel enregistré.' })
    } catch (error) {
      setNotice({ kind: 'error', text: getError(error) })
    } finally {
      setSaving(false)
    }
  }



  if (!settings) return <div className="panel"><p>{language === 'en' ? 'Loading…' : 'Chargement…'}</p></div>

  return <>
    <div className="page-header">
      <div>
        <h1>{language === 'en' ? 'Features and maturity' : 'Fonctionnalités et maturité'}</h1>
        <p>{language === 'en' ? 'Build a profile tailored to the organisation. Dependencies are enabled automatically.' : 'Compose un profil adapté à la structure. Les dépendances nécessaires sont activées automatiquement.'}</p>
      </div>
      <div className="page-actions"><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? '…' : language === 'en' ? 'Save profile' : 'Enregistrer le profil'}</button></div>
    </div>
    {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    <section className="panel feature-intro">
      <div><strong>{language === 'en' ? 'Modular by design' : 'Modulaire par conception'}</strong><p>{language === 'en' ? 'Core inventory and administration remain available. Optional modules can be shown or hidden without deleting data.' : 'Le référentiel et l’administration restent disponibles. Les modules optionnels peuvent être affichés ou masqués sans supprimer leurs données.'}</p></div>
      <div className="maturity-scale"><span className="maturity m1">1</span><span className="maturity m2">2</span><span className="maturity m3">3</span></div>
    </section>
    <div className="feature-category-grid">
      {grouped.map(([category, features]) => <section className="panel feature-category" key={category}>
        <header><div><p className="eyebrow">{CATEGORY_LABELS[category]?.[language] ?? category}</p><h2>{features.length} {language === 'en' ? 'feature(s)' : 'fonctionnalité(s)'}</h2></div></header>
        <div className="feature-list">
          {features.map((feature) => {
            const enabled = selected.has(feature.code)
            const name = language === 'en' ? feature.name_en : feature.name_fr
            const description = language === 'en' ? feature.description_en : feature.description_fr
            const maturity = MATURITY_LABELS[feature.maturity_level]?.[language]
            return <article className={`feature-card ${enabled ? 'enabled' : ''}`} key={feature.code} title={description}>
              <label className="feature-toggle">
                <input type="checkbox" checked={enabled} onChange={() => toggle(feature.code)} />
                <span className="feature-switch" />
              </label>
              <div className="feature-copy">
                <div className="feature-title-row"><strong>{name}</strong><span className={`maturity maturity-${feature.maturity_level}`} title={maturity}>M{feature.maturity_level}</span></div>
                <p>{description}</p>
                {feature.dependencies.length > 0 && <small>{language === 'en' ? 'Requires' : 'Nécessite'} : {feature.dependencies.join(', ')}</small>}
              </div>
            </article>
          })}
        </div>
      </section>)}
    </div>

  </>
}
