import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { Language, QualityIssue, QualitySummary } from './types'

export default function QualityPage({ language, canExport }: { language: Language; canExport: boolean }) {
  const en = language === 'en'
  const [issues, setIssues] = useState<QualityIssue[]>([])
  const [summary, setSummary] = useState<QualitySummary | null>(null)
  const [filter, setFilter] = useState('')
  const [staleDays, setStaleDays] = useState(365)
  const [error, setError] = useState('')

  async function load() {
    try {
      const [i, s] = await Promise.all([
        api<QualityIssue[]>(`/api/quality/issues?stale_days=${staleDays}`),
        api<QualitySummary>(`/api/quality/summary?stale_days=${staleDays}`)
      ])
      setIssues(i); setSummary(s); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur inattendue') }
  }
  useEffect(() => { void load() }, [staleDays])
  const visible = useMemo(() => issues.filter((i) => !filter || i.severity === filter || i.code === filter), [issues, filter])
  const labels: Record<string, [string, string]> = {
    missing_owner: ['Responsable manquant', 'Missing owner'], isolated_object: ['Objet isolé', 'Isolated object'],
    application_without_process: ['Application sans processus', 'Application without process'], server_without_site: ['Serveur sans site', 'Server without site'],
    stale_object: ['Objet non revu', 'Stale object'], unsupported_version: ['Version non supportée', 'Unsupported version']
  }
  return <div>
    <div className="page-header"><div><p className="eyebrow">{en ? 'Release 6' : 'Lot 6'}</p><h1>{en ? 'Quality and audit' : 'Qualité et audit'}</h1><p>{en ? 'Identify incomplete or stale information and prepare audit exports.' : 'Identifie les informations incomplètes ou anciennes et prépare les exports d’audit.'}</p></div><div className="page-actions">{canExport && <><a className="button secondary" href={`/api/quality/export.csv?stale_days=${staleDays}`}>{en ? 'Export issues' : 'Exporter les anomalies'}</a><a className="button secondary" href="/api/quality/audit-export.csv">{en ? 'Export history' : 'Exporter l’historique'}</a></>}</div></div>
    {error && <div className="notice error">{error}</div>}
    <div className="quality-score-grid"><article className="quality-score"><span>{en ? 'Quality score' : 'Indice de qualité'}</span><strong>{summary?.score ?? '—'}<small>/100</small></strong><div><i style={{ width: `${summary?.score ?? 0}%` }} /></div></article>{[[en ? 'Critical' : 'Critiques', summary?.critical, 'danger'], [en ? 'Warnings' : 'Alertes', summary?.warning, 'warning'], [en ? 'Information' : 'Informations', summary?.information, 'info'], [en ? 'Total issues' : 'Anomalies totales', summary?.total_issues, 'neutral']].map(([label, value, tone]) => <article className={`version-metric ${tone}`} key={String(label)}><span>{label}</span><strong>{value ?? '—'}</strong></article>)}</div>
    <section className="panel quality-toolbar"><label>{en ? 'Review threshold' : 'Délai de révision'}<select value={staleDays} onChange={(e) => setStaleDays(Number(e.target.value))}><option value="180">180 {en ? 'days' : 'jours'}</option><option value="365">365 {en ? 'days' : 'jours'}</option><option value="730">730 {en ? 'days' : 'jours'}</option></select></label><label>{en ? 'Filter' : 'Filtre'}<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">{en ? 'All issues' : 'Toutes les anomalies'}</option><option value="critical">{en ? 'Critical' : 'Critiques'}</option><option value="warning">{en ? 'Warnings' : 'Alertes'}</option><option value="information">Information</option>{Object.entries(labels).map(([code, label]) => <option value={code} key={code}>{label[en ? 1 : 0]}</option>)}</select></label></section>
    <section className="panel table-panel full-panel"><div className="table-toolbar"><div><h2>{en ? 'Detected issues' : 'Anomalies détectées'}</h2><span>{visible.length}</span></div></div>{visible.length === 0 ? <div className="empty-state">{en ? 'No issue for the selected scope.' : 'Aucune anomalie pour le périmètre sélectionné.'}</div> : <div className="table-wrap"><table><thead><tr><th>{en ? 'Severity' : 'Sévérité'}</th><th>{en ? 'Control' : 'Contrôle'}</th><th>{en ? 'Object' : 'Objet'}</th><th>{en ? 'Finding' : 'Constat'}</th></tr></thead><tbody>{visible.map((item, index) => <tr key={`${item.code}-${item.object_id}-${index}`}><td><span className={`quality-severity ${item.severity}`}>{item.severity}</span></td><td>{labels[item.code]?.[en ? 1 : 0] ?? item.code}</td><td><strong>{item.object_name ?? '—'}</strong><small>{item.object_type ?? ''}</small></td><td>{en ? item.message_en : item.message_fr}</td></tr>)}</tbody></table></div>}</section>
  </div>
}
