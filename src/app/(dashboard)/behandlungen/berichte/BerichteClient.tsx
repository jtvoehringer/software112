'use client'

import { useState } from 'react'
import type { BehandlungReport } from './page'

type Tab = 'weingarten' | 'lage' | 'mittel' | 'cu'

const ART_LABEL: Record<string, string> = {
  spritzung: 'Spritzung', duengung: 'Düngung', bodenbearbeitung: 'Bodenbearbeitung',
  schnitt: 'Schnitt', laubarbeit: 'Laubarbeit', lese: 'Lese', sonstiges: 'Sonstiges',
}

function fmtDate(d: string | null) {
  if (!d) return '–'
  const [y, m, dd] = d.split('-')
  return `${dd}.${m}.${y}`
}
function fmtNum(n: number, dec = 3) {
  return n.toFixed(dec).replace(/\.?0+$/, '')
}
function fmtHa(n: number) {
  return n.toFixed(4).replace(/\.?0+$/, '') + ' ha'
}

// ─── Pro-Weingarten Tab ───────────────────────────────────────────────────────
function TabWeingarten({ behandlungen, jahr }: { behandlungen: BehandlungReport[]; jahr: string }) {
  const filtered = jahr === 'all' ? behandlungen : behandlungen.filter(b => b.datum.startsWith(jahr))

  // Alle Weingärten sammeln
  const wgMap = new Map<string, { name: string; lage: string | null; behandlungen: BehandlungReport[] }>()
  for (const b of filtered) {
    const wgIds = new Set(b.grundstuecke.map(g => g.weingarten_id))
    for (const wgId of wgIds) {
      const g0 = b.grundstuecke.find(g => g.weingarten_id === wgId)!
      if (!wgMap.has(wgId)) wgMap.set(wgId, { name: g0.weingarten_name, lage: g0.lage_name, behandlungen: [] })
      wgMap.get(wgId)!.behandlungen.push(b)
    }
  }
  const wgs = Array.from(wgMap.entries()).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'de'))

  if (wgs.length === 0) return <EmptyState />

  return (
    <div className="space-y-4">
      {wgs.map(([wgId, wg]) => (
        <div key={wgId} className="card">
          <div className="flex items-baseline gap-3 mb-3">
            <h3 className="font-semibold text-gray-900">{wg.name}</h3>
            {wg.lage && <span className="text-xs text-s112-muted">{wg.lage}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-s112-border">
                  <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Datum</th>
                  <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Art</th>
                  <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Mittel</th>
                  <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Menge gesamt</th>
                  <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Ant. Fläche</th>
                  <th className="text-right text-xs text-s112-muted font-semibold py-1.5">Ant. Menge</th>
                </tr>
              </thead>
              <tbody>
                {wg.behandlungen.map(b => {
                  const totalHa = b.grundstuecke.reduce((s, g) => s + g.flaeche_ha, 0)
                  const wgHa = b.grundstuecke.filter(g => g.weingarten_id === wgId).reduce((s, g) => s + g.flaeche_ha, 0)
                  const anteil = totalHa > 0 ? wgHa / totalHa : 0
                  const anteilMenge = b.menge_gesamt != null ? b.menge_gesamt * anteil : null

                  return (
                    <tr key={b.id} className="border-b border-s112-border/40 hover:bg-s112-bg/30">
                      <td className="py-2 pr-3 tabular-nums">{fmtDate(b.datum)}{b.datum_bis && b.datum_bis !== b.datum ? ` – ${fmtDate(b.datum_bis)}` : ''}</td>
                      <td className="py-2 pr-3">{ART_LABEL[b.art] ?? b.art}</td>
                      <td className="py-2 pr-3 text-gray-600">{b.psm_name ?? '–'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {b.menge_gesamt != null ? `${fmtNum(b.menge_gesamt, 2)} ${b.menge_einheit ?? ''}` : '–'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtHa(wgHa)}</td>
                      <td className="py-2 text-right tabular-nums font-medium text-s112-teal">
                        {anteilMenge != null ? `${fmtNum(anteilMenge, 3)} ${b.menge_einheit ?? ''}` : '–'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Pro-Lage Tab ─────────────────────────────────────────────────────────────
function TabLage({ behandlungen, jahr }: { behandlungen: BehandlungReport[]; jahr: string }) {
  const filtered = jahr === 'all' ? behandlungen : behandlungen.filter(b => b.datum.startsWith(jahr))

  const lageMap = new Map<string, { name: string; behandlungen: BehandlungReport[] }>()
  for (const b of filtered) {
    const lageIds = new Set(b.grundstuecke.map(g => g.lage_id ?? '_none'))
    for (const lId of lageIds) {
      const g0 = b.grundstuecke.find(g => (g.lage_id ?? '_none') === lId)!
      const lName = g0?.lage_name ?? 'Ohne Lage'
      if (!lageMap.has(lId)) lageMap.set(lId, { name: lName, behandlungen: [] })
      lageMap.get(lId)!.behandlungen.push(b)
    }
  }
  const lagen = Array.from(lageMap.entries()).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'de'))

  if (lagen.length === 0) return <EmptyState />

  return (
    <div className="space-y-4">
      {lagen.map(([lId, lage]) => (
        <div key={lId} className="card">
          <h3 className="font-semibold text-gray-900 mb-3">{lage.name}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-s112-border">
                  <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Datum</th>
                  <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Art</th>
                  <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Mittel</th>
                  <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Menge gesamt</th>
                  <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Ant. Fläche</th>
                  <th className="text-right text-xs text-s112-muted font-semibold py-1.5">Ant. Menge</th>
                </tr>
              </thead>
              <tbody>
                {lage.behandlungen.map(b => {
                  const totalHa = b.grundstuecke.reduce((s, g) => s + g.flaeche_ha, 0)
                  const lageHa = b.grundstuecke.filter(g => (g.lage_id ?? '_none') === lId).reduce((s, g) => s + g.flaeche_ha, 0)
                  const anteil = totalHa > 0 ? lageHa / totalHa : 0
                  const anteilMenge = b.menge_gesamt != null ? b.menge_gesamt * anteil : null

                  return (
                    <tr key={b.id} className="border-b border-s112-border/40 hover:bg-s112-bg/30">
                      <td className="py-2 pr-3 tabular-nums">{fmtDate(b.datum)}</td>
                      <td className="py-2 pr-3">{ART_LABEL[b.art] ?? b.art}</td>
                      <td className="py-2 pr-3 text-gray-600">{b.psm_name ?? '–'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {b.menge_gesamt != null ? `${fmtNum(b.menge_gesamt, 2)} ${b.menge_einheit ?? ''}` : '–'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtHa(lageHa)}</td>
                      <td className="py-2 text-right tabular-nums font-medium text-s112-teal">
                        {anteilMenge != null ? `${fmtNum(anteilMenge, 3)} ${b.menge_einheit ?? ''}` : '–'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Mittelverbrauch Tab ──────────────────────────────────────────────────────
function TabMittel({ behandlungen, jahr }: { behandlungen: BehandlungReport[]; jahr: string }) {
  const filtered = jahr === 'all' ? behandlungen : behandlungen.filter(b => b.datum.startsWith(jahr))

  const mittelMap = new Map<string, { name: string; einheit: string | null; menge: number; anwendungen: number; ha: number }>()
  for (const b of filtered) {
    if (!b.psm_name || b.menge_gesamt == null) continue
    const key = b.psm_name
    const totalHa = b.grundstuecke.reduce((s, g) => s + g.flaeche_ha, 0)
    const curr = mittelMap.get(key) ?? { name: b.psm_name, einheit: b.menge_einheit, menge: 0, anwendungen: 0, ha: 0 }
    curr.menge += b.menge_gesamt
    curr.anwendungen++
    curr.ha += totalHa
    mittelMap.set(key, curr)
  }
  const mittel = Array.from(mittelMap.values()).sort((a, b) => b.menge - a.menge)

  if (mittel.length === 0) return <EmptyState msg="Keine Mittel mit Mengenangaben im Zeitraum" />

  return (
    <div className="card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-s112-border">
              <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Mittel</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Anwendungen</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Behandelte ha (kum.)</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Verbrauch gesamt</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5">Ø pro ha</th>
            </tr>
          </thead>
          <tbody>
            {mittel.map(m => (
              <tr key={m.name} className="border-b border-s112-border/40 hover:bg-s112-bg/30">
                <td className="py-2.5 pr-3 font-medium">{m.name}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{m.anwendungen}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{fmtHa(m.ha)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums font-semibold">
                  {fmtNum(m.menge, 2)} {m.einheit ?? ''}
                </td>
                <td className="py-2.5 text-right tabular-nums text-s112-muted">
                  {m.ha > 0 ? `${fmtNum(m.menge / m.ha, 3)} ${m.einheit ?? ''}/ha` : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Cu-Bilanz Tab ────────────────────────────────────────────────────────────
const CU_LIMIT_G_HA = 4000 // 4 kg Cu/ha/Jahr EU-Bio-Limit

function TabCu({ behandlungen }: { behandlungen: BehandlungReport[] }) {
  // Nur kg-Mengen mit Cu-Gehalt sinnvoll vergleichbar
  const cuByYear = new Map<string, { cuG: number; ha: number; eintraege: { datum: string; name: string; pct: number; menge: number; cuG: number }[] }>()

  for (const b of behandlungen) {
    if (!b.cu_gehalt_pct || b.menge_gesamt == null || b.menge_einheit !== 'kg') continue
    const y = b.datum.slice(0, 4)
    const totalHa = b.grundstuecke.reduce((s, g) => s + g.flaeche_ha, 0)
    const cuG = b.menge_gesamt * 1000 * (b.cu_gehalt_pct / 100)
    const curr = cuByYear.get(y) ?? { cuG: 0, ha: 0, eintraege: [] }
    curr.cuG += cuG
    curr.ha += totalHa
    curr.eintraege.push({
      datum: b.datum,
      name:  b.psm_name ?? '–',
      pct:   b.cu_gehalt_pct,
      menge: b.menge_gesamt,
      cuG,
    })
    cuByYear.set(y, curr)
  }

  const jahre = Array.from(cuByYear.entries()).sort(([a], [b]) => b.localeCompare(a))

  if (jahre.length === 0) {
    return (
      <div className="card">
        <div className="text-center py-12 text-s112-muted">
          <p className="text-2xl mb-2">🔵</p>
          <p className="font-medium text-gray-600">Keine Cu-Bilanz verfügbar</p>
          <p className="text-sm mt-1">Erfassen Sie Behandlungen mit kupferhaltigen Mitteln (cu_gehalt_pct &gt; 0) und Menge in kg.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {jahre.map(([y, data]) => {
        // Pro ha bezogen auf Gesamtfläche (alle behandelten GST)
        // Besser: pro ha gesamtbetriebliche Fläche — hier nehmen wir die Summe behandelter ha
        const cuProHa = data.ha > 0 ? data.cuG / data.ha : 0
        const pct = Math.min(100, (cuProHa / CU_LIMIT_G_HA) * 100)
        const status = cuProHa > CU_LIMIT_G_HA ? 'red' : cuProHa > CU_LIMIT_G_HA * 0.8 ? 'amber' : 'green'
        const statusColor = status === 'red' ? 'bg-red-500' : status === 'amber' ? 'bg-amber-400' : 'bg-s112-teal'
        const badgeColor = status === 'red' ? 'bg-red-50 text-red-700 border-red-200' : status === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'

        return (
          <div key={y} className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900 tabular-nums">{y}</h3>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${badgeColor}`}>
                {(cuProHa / 1000).toFixed(3)} kg Cu/ha
              </span>
            </div>

            {/* Progress Bar */}
            <div>
              <div className="h-5 bg-gray-100 rounded-full overflow-hidden relative border border-s112-border">
                <div
                  className={`h-full rounded-full transition-all ${statusColor}`}
                  style={{ width: `${pct}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-gray-700">
                  {pct.toFixed(0)} % des EU-Bio-Limits (4 kg/ha/Jahr)
                </div>
              </div>
            </div>

            <p className="text-xs text-s112-muted">
              Gesamteintrag: {(data.cuG / 1000).toFixed(2)} kg Cu auf {fmtHa(data.ha)} (kumuliert behandelt)
            </p>

            {/* Eintragsdetails */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-s112-border">
                    <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Datum</th>
                    <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Mittel</th>
                    <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Cu-%</th>
                    <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Menge (kg)</th>
                    <th className="text-right text-xs text-s112-muted font-semibold py-1.5">Cu-Eintrag (g)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.eintraege.sort((a, b) => a.datum.localeCompare(b.datum)).map((e, i) => (
                    <tr key={i} className="border-b border-s112-border/40">
                      <td className="py-2 pr-3 tabular-nums">{fmtDate(e.datum)}</td>
                      <td className="py-2 pr-3">{e.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{e.pct} %</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(e.menge, 2)}</td>
                      <td className="py-2 text-right tabular-nums font-semibold text-blue-600">
                        {Math.round(e.cuG).toLocaleString('de-AT')} g
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Shared ───────────────────────────────────────────────────────────────────
function EmptyState({ msg = 'Keine Daten für den gewählten Zeitraum' }: { msg?: string }) {
  return (
    <div className="card text-center py-12 text-s112-muted">
      <p className="font-medium text-gray-600">{msg}</p>
    </div>
  )
}

function getJahre(behandlungen: BehandlungReport[]) {
  const set = new Set(behandlungen.map(b => b.datum.slice(0, 4)).filter(Boolean))
  return Array.from(set).sort().reverse()
}

// ─── Main Client Component ────────────────────────────────────────────────────
export default function BerichteClient({ behandlungen }: { behandlungen: BehandlungReport[] }) {
  const [tab, setTab] = useState<Tab>('weingarten')
  const [jahr, setJahr] = useState('all')
  const jahre = getJahre(behandlungen)

  const TABS: { id: Tab; label: string }[] = [
    { id: 'weingarten', label: 'Pro Weingarten' },
    { id: 'lage',       label: 'Pro Lage' },
    { id: 'mittel',     label: 'Mittelverbrauch' },
    { id: 'cu',         label: '🔵 Cu-Bilanz' },
  ]

  return (
    <div>
      {/* Tab Bar + Jahr-Filter */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 border-b border-s112-border w-full">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px
                ${tab === t.id
                  ? 'border-s112-teal text-s112-teal'
                  : 'border-transparent text-s112-muted hover:text-gray-700'}`}
            >
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          {tab !== 'cu' && (
            <div className="pb-1 self-center">
              <select
                value={jahr}
                onChange={e => setJahr(e.target.value)}
                className="border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
              >
                <option value="all">Alle Jahre</option>
                {jahre.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Tab Content */}
      {tab === 'weingarten' && <TabWeingarten behandlungen={behandlungen} jahr={jahr} />}
      {tab === 'lage'       && <TabLage       behandlungen={behandlungen} jahr={jahr} />}
      {tab === 'mittel'     && <TabMittel     behandlungen={behandlungen} jahr={jahr} />}
      {tab === 'cu'         && <TabCu         behandlungen={behandlungen} />}
    </div>
  )
}
