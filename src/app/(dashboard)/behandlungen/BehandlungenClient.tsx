'use client'

import { useState, useTransition } from 'react'
import Link from '@/components/ui/Link'
import { Pencil } from 'lucide-react'
import { deleteBehandlung } from './actions'
import StornoButton from '@/components/StornoButton'
import type { Behandlung } from './page'
import { fmtNum } from '@/lib/format'
import { MASSNAHMEN_ART_LABEL, artFilterOptionen, filterMassnahmen } from '@/lib/behandlungen/arten'

const WITTERUNG_LABEL: Record<string, string> = {
  sonnig: 'Sonnig', bewoelkt: 'Bewölkt',
  regnerisch: 'Regnerisch', wind: 'Wind',
}
const EINHEIT_LABEL: Record<string, string> = {
  kg_ha: 'kg/ha', l_ha: 'l/ha', g_hl: 'g/hl',
  ml_hl: 'ml/hl', kg: 'kg', l: 'l',
}
// Bezeichnungen aller Arten (lib/behandlungen/arten.ts, seit KAN-143 mit Laubschneiden)
const ART_LABEL: Record<string, string> = MASSNAHMEN_ART_LABEL

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatEuro(betrag: number) {
  return fmtNum(betrag, 2)
}

function WartezeitBadge({ datum }: { datum: string | null }) {
  if (!datum) return null
  const heute = new Date().toISOString().split('T')[0]
  const ok = datum <= heute
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ok ? 'bg-s112-ok-bg text-s112-ok-fg' : 'bg-s112-warn-bg text-s112-warn-fg'}`}>
      {formatDate(datum)}
    </span>
  )
}

/** Rieden einer Maßnahme: alphabetisch, nicht fett; ab vier Rieden kompakt mit „alle anzeigen“ (Rückmeldung 30.09.2026) */
function RiedenZelle({ rieden, flaecheHa }: { rieden: string[]; flaecheHa: number | null }) {
  if (rieden.length === 0) return <span className="text-s112-muted">–</span>
  const ha = flaecheHa != null ? ` · ${fmtNum(flaecheHa, { max: 4 })} ha` : ''
  if (rieden.length <= 3) {
    return (
      <div className="text-xs text-s112-text-1 leading-snug">
        {rieden.join(', ')}
        {ha && <span className="block text-s112-muted">{ha.slice(3)}</span>}
      </div>
    )
  }
  return (
    <details className="text-xs text-s112-text-1 leading-snug">
      <summary className="cursor-pointer text-s112-blue-700 hover:underline list-none">
        {rieden.length} Rieden{ha} <span className="text-s112-muted">– anzeigen</span>
      </summary>
      <ul className="mt-1 columns-2 gap-4">
        {rieden.map(r => <li key={r} className="break-inside-avoid">{r}</li>)}
      </ul>
    </details>
  )
}

// Behandlungen nach Datum gruppieren – chronologisch von oben (älteste) nach unten (jüngste), Rückmeldung 30.09.2026
function groupByDate(behandlungen: Behandlung[]) {
  const map = new Map<string, Behandlung[]>()
  for (const b of behandlungen) {
    const arr = map.get(b.datum) ?? []
    arr.push(b)
    map.set(b.datum, arr)
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
}

export default function BehandlungenClient({
  behandlungen, schreibOk,
}: {
  /** KAN-166: bearbeiten und löschen dürfen alle mit Schreibrecht Rieden (auch Mitarbeiter) */
  behandlungen: Behandlung[]; schreibOk: boolean
}) {
  const [pending] = useTransition()
  const [filter, setFilter] = useState('')
  const [artFilter, setArtFilter] = useState('')

  // Art-Auswahl (alle Maßnahmenarten, Lese nur, wenn solche Einträge da sind) und Filter: lib/behandlungen/arten.ts
  const artOptionen = artFilterOptionen(behandlungen)
  const gefiltert = filterMassnahmen(behandlungen, artFilter, filter)

  const grouped = groupByDate(gefiltert)

  if (behandlungen.length === 0) {
    return (
      <div className="card text-center py-16">
        <p className="text-s112-text-1 font-medium">Noch keine Maßnahmen erfasst</p>
        <p className="text-s112-muted text-sm mt-1 mb-6">Erste Spritzung aufzeichnen</p>
        <Link href="/behandlungen/neu"
          className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
          Neue Maßnahme
        </Link>
      </div>
    )
  }

  return (
    <div className={pending ? 'opacity-60 pointer-events-none' : ''}>
      {/* Filter: Freitext (Ried, Mittel, Art) und Art */}
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          aria-label="Filtern nach Ried, Mittel oder Art"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filtern nach Ried, Mittel, Art…"
          className="w-full max-w-sm border border-s112-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
        />
        <select
          aria-label="Art der Maßnahme"
          value={artFilter}
          onChange={e => setArtFilter(e.target.value)}
          className="border border-s112-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
        >
          <option value="">Alle Arten</option>
          {artOptionen.map(a => <option key={a} value={a}>{MASSNAHMEN_ART_LABEL[a]}</option>)}
        </select>
      </div>
      {gefiltert.length === 0 && (
        <p className="card text-center py-8 text-sm text-s112-muted">Keine Maßnahmen für diesen Filter.</p>
      )}

      {/* Gruppiert nach Datum */}
      <div className="space-y-4">
        {grouped.map(([datum, gruppe]) => (
          <div key={datum} className="card p-0 overflow-hidden">
            {/* Datums-Header */}
            <div className="bg-s112-bg border-b border-s112-border px-4 py-2 flex items-center gap-3">
              <span className="font-semibold text-s112-text text-sm">{formatDate(datum)}</span>
              {/* Anzahl der Maßnahmen an diesem Tag (bisher stand hier fälschlich „1 Ried“) */}
              <span className="text-xs text-s112-muted">{gruppe.length} {gruppe.length === 1 ? 'Maßnahme' : 'Maßnahmen'}</span>
            </div>

            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-s112-border text-xs font-medium text-s112-muted uppercase tracking-wide">
                  <th className="px-4 py-2 text-left w-[22%]">Maßnahme</th>
                  <th className="px-3 py-2 text-left w-[11%]">Menge</th>
                  <th className="px-3 py-2 text-left w-[8%]">BBCH</th>
                  <th className="px-3 py-2 text-left w-[9%]">Witterung</th>
                  <th className="px-3 py-2 text-left w-[11%]">Erntefrei ab</th>
                  <th className="px-3 py-2 text-left">Ried(en)</th>
                  <th className="px-3 py-2 text-right w-[8%]">Kosten</th>
                  {schreibOk && <th className="px-3 py-2 text-right w-[8%]">Aktionen</th>}
                </tr>
              </thead>
              <tbody>
                {gruppe.map(b => (
                  <tr key={b.id} className="border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/30 transition-colors">
                    {/* Maßnahme hervorgehoben: Mittel (bzw. Art) fett, Art als Kennzeichen */}
                    <td className="px-4 py-2.5 align-top">
                      <div className="font-semibold text-s112-text">{b.psm_name ?? ART_LABEL[b.art] ?? b.art}</div>
                      <span className="inline-block mt-0.5 text-[11px] text-s112-text-2 bg-[#F2F3F5] px-2 py-0.5 rounded-full">
                        {ART_LABEL[b.art] ?? b.art}
                      </span>
                      {/* KAN-87: Pflanzenschutz-Aufzeichnung über der Erfassungsfrist */}
                      {b.nacherfasst && (
                        <span className={`inline-block mt-0.5 ml-1 text-[11px] px-2 py-0.5 rounded-full ${b.erfassung_ampel === 'rot' ? 'bg-s112-err-bg text-s112-err-fg' : 'bg-s112-warn-bg text-s112-warn-fg'}`}
                          title="Erfasst nach Ablauf der Erfassungsfrist ab Anwendungsende">
                          {b.nacherfasst}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-s112-muted">
                      {b.aufwandmenge != null ? (
                        <span>{b.aufwandmenge} {b.aufwandmenge_einheit ? EINHEIT_LABEL[b.aufwandmenge_einheit] ?? b.aufwandmenge_einheit : ''}</span>
                      ) : '–'}
                    </td>
                    <td className="px-3 py-2.5 text-s112-muted text-xs">
                      {b.bbch_stadium ? `BBCH ${b.bbch_stadium}` : '–'}
                    </td>
                    <td className="px-3 py-2.5">
                      {b.witterung ? <span className="text-xs">{WITTERUNG_LABEL[b.witterung] ?? b.witterung}</span> : '–'}
                    </td>
                    <td className="px-3 py-2.5">
                      <WartezeitBadge datum={b.ernte_fruehesteins} />
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <RiedenZelle rieden={b.rieden} flaecheHa={b.flaeche_ha} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                      {b.kosten_betrag != null ? <span className="text-s112-text-1 font-medium">{formatEuro(b.kosten_betrag)} €</span> : <span className="text-s112-muted">–</span>}
                    </td>
                    {schreibOk && (
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/behandlungen/${b.id}/edit`}
                            title="Bearbeiten" aria-label="Bearbeiten"
                            className="text-s112-blue-700 hover:text-s112-blue-700/70"
                          >
                            <Pencil size={16} />
                          </Link>
                          <StornoButton modus="loeschen" action={grund => deleteBehandlung(b.id, grund)}
                            hinweis="Die Maßnahme wird samt Grundstücks-Zuordnung gelöscht; Grund und Benutzer stehen im Änderungsprotokoll." />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
