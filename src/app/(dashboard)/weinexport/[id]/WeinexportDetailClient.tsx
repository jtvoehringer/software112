'use client'
import { useState } from 'react'
import Link from '@/components/ui/Link'
import EmcsPanel from './EmcsPanel'
import { fmtNum } from '@/lib/format'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const STATUS_LABEL: Record<string,string> = {
  entwurf:'Entwurf', bestaetigt:'Bestätigt', versendet:'Versendet', abgeschlossen:'Abgeschlossen'
}
const STATUS_COLOR: Record<string,string> = {
  entwurf:'bg-[#F2F3F5] text-s112-text-2', bestaetigt:'bg-s112-blue-100 text-s112-blue-700',
  versendet:'bg-s112-warn-bg text-s112-warn-fg', abgeschlossen:'bg-s112-ok-bg text-s112-ok-fg'
}
const DOK_LABEL: Record<string,string> = {
  v1v2:'V1/V2 Begleitdokument', eur1:'EUR.1 Ursprungszeugnis',
  cmr:'CMR Frachtbrief', certificate_of_origin:'Certificate of Origin',
  phytosanitaer:'Phytosanitäres Zertifikat', lieferschein:'Lieferschein',
  rechnung:'Exportrechnung',
}
const DOK_STATUS_LABEL: Record<string,string> = {
  ausstehend:'Ausstehend', beantragt:'Beantragt',
  ausgestellt:'Ausgestellt', nicht_erforderlich:'Nicht erforderlich',
}
const DOK_STATUS_COLOR: Record<string,string> = {
  ausstehend:'bg-[#F2F3F5] text-s112-text-2', beantragt:'bg-s112-warn-bg text-s112-warn-fg',
  ausgestellt:'bg-s112-ok-bg text-s112-ok-fg', nicht_erforderlich:'bg-s112-bg text-s112-tertiary',
}

interface Props { auftrag: R; positionen: R[]; dokumente: R[] }

export default function WeinexportDetailClient({ auftrag, positionen, dokumente: initDok }: Props) {
  const [status, setStatus]       = useState(auftrag.status)
  const [dokumente, setDokumente] = useState(initDok)
  const [saving, setSaving]       = useState(false)

  const importeur = auftrag.firmen?.name
    ?? [auftrag.kontakte?.vorname, auftrag.kontakte?.nachname].filter(Boolean).join(' ')
    ?? '–'

  const gesamtEUR = positionen.reduce((s: number, p: R) =>
    s + (parseFloat(p.menge)||0) * (parseFloat(p.preis_eur)||0), 0)

  async function updateStatus(newStatus: string) {
    setSaving(true)
    await fetch(`/api/weinexport/${auftrag.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    setStatus(newStatus); setSaving(false)
  }

  async function updateDokStatus(dokId: string, newStatus: string) {
    await fetch(`/api/weinexport/${auftrag.id}/dokument`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: dokId, status: newStatus }),
    })
    setDokumente(d => d.map(dok => dok.id === dokId ? { ...dok, status: newStatus } : dok))
  }

  const ausgestellt = dokumente.filter(d => d.status === 'ausgestellt').length
  const gesamt      = dokumente.filter(d => d.status !== 'nicht_erforderlich').length

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-s112-muted mb-1">
            <Link href="/weinexport" className="hover:text-s112-blue-700 transition-colors">Weinexport</Link>
            <span>/</span>
            <span className="text-s112-text-1 font-medium">{auftrag.referenz ?? 'Exportauftrag'}</span>
          </div>
          <h1 className="text-2xl font-semibold text-s112-text mt-1">
             {auftrag.referenz ?? 'Exportauftrag'}
          </h1>
          <p className="text-sm text-s112-muted mt-0.5">{importeur}</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={status} onChange={e => updateStatus(e.target.value)} disabled={saving}
            className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            {Object.entries(STATUS_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[status]}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Linke Spalte: Auftragsdaten + Positionen */}
        <div className="col-span-2 space-y-5">
          {/* Auftragsdaten */}
          <div className="bg-white rounded-xl border border-s112-border p-5">
            <h2 className="font-semibold text-s112-text mb-4">Auftragsdaten</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><dt className="text-xs text-s112-muted">Importeur</dt><dd className="font-medium">{importeur}</dd></div>
              <div><dt className="text-xs text-s112-muted">Incoterms</dt><dd>{auftrag.incoterms ?? '–'}</dd></div>
              <div><dt className="text-xs text-s112-muted">Datum</dt><dd>{auftrag.datum ? new Date(auftrag.datum).toLocaleDateString('de-AT') : '–'}</dd></div>
              <div><dt className="text-xs text-s112-muted">Lieferdatum</dt><dd>{auftrag.lieferdatum ? new Date(auftrag.lieferdatum).toLocaleDateString('de-AT') : '–'}</dd></div>
              <div><dt className="text-xs text-s112-muted">Transportart</dt><dd>{auftrag.transport_art ?? '–'}</dd></div>
              <div><dt className="text-xs text-s112-muted">Destination</dt><dd>{[auftrag.destination_stadt, auftrag.destination_land].filter(Boolean).join(', ') || '–'}</dd></div>
              <div><dt className="text-xs text-s112-muted">EORI Importeur</dt><dd className="font-mono text-xs">{auftrag.eori_kunde ?? '–'}</dd></div>
              <div><dt className="text-xs text-s112-muted">Versicherungswert</dt><dd>{auftrag.versicherungswert ? `EUR ${fmtNum(parseFloat(auftrag.versicherungswert), 2)}` : '–'}</dd></div>
            </dl>
            {auftrag.notizen && (
              <div className="mt-4 p-3 bg-s112-bg rounded-lg text-sm text-s112-text-1">
                <span className="text-xs font-medium text-s112-muted block mb-1">Notizen</span>
                {auftrag.notizen}
              </div>
            )}
          </div>

          {/* Positionen */}
          <div className="bg-white rounded-xl border border-s112-border p-5">
            <h2 className="font-semibold text-s112-text mb-4">Weinpositionen</h2>
            {positionen.length === 0 ? (
              <p className="text-sm text-s112-muted">Keine Positionen erfasst.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-s112-muted border-b border-s112-border">
                  <tr>
                    <th className="pb-2 text-left">Bezeichnung</th>
                    <th className="pb-2 text-right">Menge</th>
                    <th className="pb-2 text-right">€/Einheit</th>
                    <th className="pb-2 text-right">Gesamt</th>
                    <th className="pb-2 text-left pl-3">TARIC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-s112-border/30">
                  {positionen.map((p: R) => (
                    <tr key={p.id}>
                      <td className="py-2">{p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–'}</td>
                      <td className="py-2 text-right">{p.menge} {p.einheit}</td>
                      <td className="py-2 text-right">{fmtNum(parseFloat(p.preis_eur), 2)}</td>
                      <td className="py-2 text-right font-medium">
                        {(parseFloat(p.menge) * parseFloat(p.preis_eur)).toFixed(2)}
                      </td>
                      <td className="py-2 text-left pl-3 font-mono text-xs text-s112-muted">{p.taric_code}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-s112-border font-semibold">
                    <td colSpan={3} className="pt-2 text-right text-xs uppercase tracking-wide text-s112-muted">Gesamtwert EUR</td>
                    <td className="pt-2 text-right">{fmtNum(gesamtEUR, 2)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Rechte Spalte: Dokumenten-Checkliste */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-s112-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-s112-text">Dokumente</h2>
              <span className="text-xs text-s112-muted">{ausgestellt}/{gesamt}</span>
            </div>
            <p className="text-[11px] text-s112-muted mt-1">Nur 'Ausgestellt' zählt zum Fortschritt</p>
            {/* Progress Bar */}
            <div className="w-full bg-[#F2F3F5] rounded-full h-1.5 mb-4">
              <div className="bg-s112-teal h-1.5 rounded-full transition-all"
                style={{ width: gesamt > 0 ? `${(ausgestellt/gesamt)*100}%` : '0%' }} />
            </div>

            <div className="space-y-3">
              {dokumente.map((dok: R) => (
                <div key={dok.id} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-s112-text truncate">
                      {DOK_LABEL[dok.dokument_art] ?? dok.dokument_art}
                    </p>
                    <select value={dok.status}
                      onChange={e => updateDokStatus(dok.id, e.target.value)}
                      className="mt-1 w-full border border-s112-border rounded px-1.5 py-1 text-[11px] focus:outline-none">
                      {Object.entries(DOK_STATUS_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  {(dok.dokument_art === 'v1v2' || dok.dokument_art === 'eur1' ||
                    dok.dokument_art === 'cmr' || dok.dokument_art === 'lieferschein' ||
                    dok.dokument_art === 'rechnung' || dok.dokument_art === 'certificate_of_origin') && (
                    <a href={`/api/weinexport/${auftrag.id}/dokument/${dok.dokument_art}`}
                      target="_blank" rel="noopener noreferrer"
                      className="mt-5 text-[11px] text-s112-blue-700 border border-s112-teal/30 px-2 py-1 rounded hover:bg-s112-teal/5 flex-shrink-0">
                      PDF
                    </a>
                  )}
                </div>
              ))}
            </div>

            {/* Fehlende Dokumente hinzufügen */}
            <div className="mt-4 pt-4 border-t border-s112-border">
              <p className="text-[11px] text-s112-muted mb-2">Weiteres Dokument</p>
              <div className="flex gap-1">
                <select id="add-dok-select" className="flex-1 border border-s112-border rounded px-1.5 py-1 text-[11px] focus:outline-none">
                  {Object.entries(DOK_LABEL)
                    .filter(([v]) => !dokumente.some(d => d.dokument_art === v))
                    .map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button onClick={async () => {
                  const sel = (document.getElementById('add-dok-select') as HTMLSelectElement)?.value
                  if (!sel) return
                  const r = await fetch(`/api/weinexport/${auftrag.id}/dokument`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dokument_art: sel }),
                  })
                  const d = await r.json()
                  if (d.id) setDokumente(prev => [...prev, { id: d.id, dokument_art: sel, status: 'ausstehend' }])
                }} className="text-[11px] bg-s112-teal text-white px-2 py-1 rounded hover:bg-opacity-90">+</button>
              </div>
            </div>
          </div>
          <EmcsPanel auftragId={auftrag.id} initialArc={auftrag.emcs_arc_nummer ?? ''} initialStatus={auftrag.emcs_status ?? ''} />
        </div>
      </div>
    </div>
  )
}
