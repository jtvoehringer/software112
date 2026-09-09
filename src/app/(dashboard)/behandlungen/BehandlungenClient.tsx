'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Pencil, Trash2 } from 'lucide-react'
import { deleteBehandlung } from './actions'
import type { Behandlung } from './page'
import { fmtNum } from '@/lib/format'

const WITTERUNG_LABEL: Record<string, string> = {
  sonnig: 'Sonnig', bewoelkt: 'Bewölkt',
  regnerisch: 'Regnerisch', wind: 'Wind',
}
const EINHEIT_LABEL: Record<string, string> = {
  kg_ha: 'kg/ha', l_ha: 'l/ha', g_hl: 'g/hl',
  ml_hl: 'ml/hl', kg: 'kg', l: 'l',
}
const ART_LABEL: Record<string, string> = {
  spritzung: 'Spritzung', duengung: 'Düngung',
  bodenbearbeitung: 'Bodenbearbeitung', schnitt: 'Schnitt',
  laubarbeit: 'Laubarbeit', lese: 'Lese', sonstiges: 'Sonstiges',
}

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

// Behandlungen nach Datum gruppieren
function groupByDate(behandlungen: Behandlung[]) {
  const map = new Map<string, Behandlung[]>()
  for (const b of behandlungen) {
    const arr = map.get(b.datum) ?? []
    arr.push(b)
    map.set(b.datum, arr)
  }
  return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
}

export default function BehandlungenClient({
  behandlungen, adminOk,
}: {
  behandlungen: Behandlung[]; adminOk: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [filter, setFilter] = useState('')

  const gefiltert = filter
    ? behandlungen.filter(b =>
        b.weingarten_name?.toLowerCase().includes(filter.toLowerCase()) ||
        b.psm_name?.toLowerCase().includes(filter.toLowerCase()) ||
        b.weingarten_ried?.toLowerCase().includes(filter.toLowerCase())
      )
    : behandlungen

  const grouped = groupByDate(gefiltert)

  function handleDelete(id: string) {
    if (!confirm('Maßnahme löschen?')) return
    startTransition(() => deleteBehandlung(id))
  }

  if (behandlungen.length === 0) {
    return (
      <div className="card text-center py-16">
        <p className="text-s112-text-1 font-medium">Noch keine Maßnahmen erfasst</p>
        <p className="text-s112-muted text-sm mt-1 mb-6">Erste Spritzung aufzeichnen</p>
        <Link href="/behandlungen/neu"
          className="inline-flex items-center gap-2 bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
          Neue Maßnahme
        </Link>
      </div>
    )
  }

  return (
    <div className={pending ? 'opacity-60 pointer-events-none' : ''}>
      {/* Filter */}
      <div className="mb-4">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filtern nach Ried, Mittel…"
          className="w-full max-w-sm border border-s112-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
        />
      </div>

      {/* Gruppiert nach Datum */}
      <div className="space-y-4">
        {grouped.map(([datum, gruppe]) => (
          <div key={datum} className="card p-0 overflow-hidden">
            {/* Datums-Header */}
            <div className="bg-s112-bg border-b border-s112-border px-4 py-2 flex items-center gap-3">
              <span className="font-semibold text-s112-text text-sm">{formatDate(datum)}</span>
              <span className="text-xs text-s112-muted">{gruppe.length} {gruppe.length === 1 ? 'Ried' : 'Rieden'}</span>
              {gruppe[0].art && gruppe[0].art !== 'spritzung' && (
                <span className="text-xs text-s112-text-2 bg-[#F2F3F5] px-2 py-0.5 rounded-full">
                  {ART_LABEL[gruppe[0].art] ?? gruppe[0].art}
                </span>
              )}
              {gruppe[0].psm_name && (
                <span className="ml-auto text-xs font-medium text-s112-blue-700 bg-s112-teal/10 px-2 py-0.5 rounded-full">
                  {gruppe[0].psm_name}
                </span>
              )}
            </div>

            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-s112-border text-xs font-medium text-s112-muted uppercase tracking-wide">
                  <th className="px-4 py-2 text-left w-[32%]">Weingarten / Ried / Art</th>
                  <th className="px-3 py-2 text-left w-[15%]">Menge</th>
                  <th className="px-3 py-2 text-left w-[10%]">BBCH</th>
                  <th className="px-3 py-2 text-left w-[10%]">Witterung</th>
                  <th className="px-3 py-2 text-left w-[13%]">Erntefrei ab</th>
                  <th className="px-3 py-2 text-right w-[10%]">Kosten</th>
                  {adminOk && <th className="px-3 py-2 text-right w-[10%]">Aktionen</th>}
                </tr>
              </thead>
              <tbody>
                {gruppe.map(b => (
                  <tr key={b.id} className="border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-s112-text">{b.weingarten_name ?? '–'}</span>
                        {b.weingarten_ried && (
                          <span className="text-xs text-s112-muted">{b.weingarten_ried}</span>
                        )}
                        <span className="text-xs text-s112-text-2">
                          {ART_LABEL[b.art] ?? b.art}
                        </span>
                      </div>
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
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                      {b.kosten_betrag != null ? <span className="text-s112-text-1 font-medium">{formatEuro(b.kosten_betrag)} €</span> : <span className="text-s112-muted">–</span>}
                    </td>
                    {adminOk && (
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/behandlungen/${b.id}/edit`}
                            title="Bearbeiten" aria-label="Bearbeiten"
                            className="text-s112-blue-700 hover:text-s112-blue-700/70"
                          >
                            <Pencil size={16} />
                          </Link>
                          <button
                            onClick={() => handleDelete(b.id)}
                            title="Löschen" aria-label="Löschen"
                            className="text-s112-err hover:text-s112-err-fg"
                          >
                            <Trash2 size={16} />
                          </button>
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
