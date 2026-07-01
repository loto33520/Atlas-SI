import { useEffect, useState } from 'react'
import { api } from './api'
import type { Language } from './types'

type Notice = { kind: 'success' | 'error'; text: string } | null
type AnssiTemplateGroup = {
  code: string
  name_fr: string
  name_en: string
  description_fr: string
  description_en: string
  object_type_codes: string[]
  relation_type_codes: string[]
  installed_object_types: number
  installed_relation_types: number
  status: 'not_installed' | 'partial' | 'installed'
}

type UninstallResult = {
  message: string
  preserved_shared: string[]
  preserved_customized: string[]
}

function getError(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}

export default function AnssiTemplatesPage({ language = 'fr' }: { language?: Language }) {
  const [groups, setGroups] = useState<AnssiTemplateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  async function reload() {
    const catalog = await api<{ groups: AnssiTemplateGroup[] }>('/api/features/templates/anssi')
    setGroups(catalog.groups)
  }

  useEffect(() => {
    reload().catch((error) => setNotice({ kind: 'error', text: getError(error) })).finally(() => setLoading(false))
  }, [])

  async function install(group: AnssiTemplateGroup) {
    const name = language === 'en' ? group.name_en : group.name_fr
    if (!window.confirm(language === 'en' ? `Install the missing items from “${name}”?` : `Installer les éléments manquants de « ${name} » ?`)) return
    setBusyCode(group.code)
    setNotice(null)
    try {
      const result = await api<{ message: string }>('/api/features/templates/anssi', {
        method: 'POST',
        body: JSON.stringify({ groups: [group.code] })
      })
      await reload()
      setNotice({ kind: 'success', text: result.message })
    } catch (error) {
      setNotice({ kind: 'error', text: getError(error) })
    } finally {
      setBusyCode(null)
    }
  }

  async function uninstall(group: AnssiTemplateGroup) {
    const name = language === 'en' ? group.name_en : group.name_fr
    const confirmation = language === 'en'
      ? `Remove the unused standard items from “${name}”? If one item is in use, nothing will be removed.`
      : `Retirer les éléments standards inutilisés de « ${name} » ? Si un seul élément est utilisé, aucune suppression ne sera effectuée.`
    if (!window.confirm(confirmation)) return
    setBusyCode(group.code)
    setNotice(null)
    try {
      const result = await api<UninstallResult>('/api/features/templates/anssi/uninstall', {
        method: 'POST',
        body: JSON.stringify({ groups: [group.code] })
      })
      await reload()
      const preserved = [...result.preserved_shared, ...result.preserved_customized]
      const suffix = preserved.length
        ? (language === 'en' ? ` Preserved: ${preserved.join(', ')}.` : ` Conservés : ${preserved.join(', ')}.`)
        : ''
      setNotice({ kind: 'success', text: `${result.message}${suffix}` })
    } catch (error) {
      setNotice({ kind: 'error', text: getError(error) })
    } finally {
      setBusyCode(null)
    }
  }

  return <>
    <div className="page-header">
      <div>
        <h1>{language === 'en' ? 'ANSSI templates' : 'Modèles ANSSI'}</h1>
        <p>{language === 'en' ? 'Install or safely remove the starter families used by your mapping.' : 'Installe ou retire en sécurité les familles de démarrage utiles à ta cartographie.'}</p>
      </div>
    </div>
    {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    <section className="panel anssi-safety-note">
      <div className="anssi-safety-icon">✓</div>
      <div>
        <strong>{language === 'en' ? 'Transactional removal' : 'Suppression transactionnelle'}</strong>
        <p>{language === 'en'
          ? 'Before removing a family, Atlas SI checks every object and relationship. If one type is in use, nothing is changed. Shared or customized elements are preserved.'
          : 'Avant de retirer une famille, Atlas SI contrôle tous les objets et toutes les relations. Si un type est utilisé, rien n’est modifié. Les éléments partagés ou personnalisés sont conservés.'}</p>
      </div>
    </section>
    {loading ? <section className="panel"><p>{language === 'en' ? 'Loading…' : 'Chargement…'}</p></section> : <div className="anssi-admin-grid">
      {groups.map((group) => {
        const name = language === 'en' ? group.name_en : group.name_fr
        const description = language === 'en' ? group.description_en : group.description_fr
        const installed = group.installed_object_types + group.installed_relation_types
        const total = group.object_type_codes.length + group.relation_type_codes.length
        const busy = busyCode === group.code
        const statusLabel = group.status === 'installed'
          ? (language === 'en' ? 'Installed' : 'Installée')
          : group.status === 'partial'
            ? (language === 'en' ? 'Partially installed' : 'Installation partielle')
            : (language === 'en' ? 'Not installed' : 'Non installée')
        return <article className={`panel anssi-admin-card ${group.status}`} key={group.code}>
          <header>
            <span className={`anssi-status ${group.status}`}>{statusLabel}</span>
            <span className="anssi-count">{installed}/{total}</span>
          </header>
          <h2>{name}</h2>
          <p>{description}</p>
          <dl>
            <div><dt>{language === 'en' ? 'Object types' : 'Types d’objets'}</dt><dd>{group.installed_object_types}/{group.object_type_codes.length}</dd></div>
            <div><dt>{language === 'en' ? 'Relationship types' : 'Types de relations'}</dt><dd>{group.installed_relation_types}/{group.relation_type_codes.length}</dd></div>
          </dl>
          <footer>
            {group.status !== 'installed' && <button className="button secondary" disabled={busy} onClick={() => void install(group)}>{busy ? '…' : language === 'en' ? 'Install missing items' : 'Installer les éléments manquants'}</button>}
            {group.status !== 'not_installed' && <button className="button danger-outline" disabled={busy} onClick={() => void uninstall(group)}>{busy ? '…' : language === 'en' ? 'Safely remove' : 'Retirer en sécurité'}</button>}
          </footer>
        </article>
      })}
    </div>}
  </>
}
