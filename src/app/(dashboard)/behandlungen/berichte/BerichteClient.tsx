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

  const mittelMap = new Map<string, {
    name: string; einheit: string | null; menge: number; anwendungen: number; ha: number
    max_aufwand_kg_ha: number | null; max_anwendungen: number | null
  }>()
  for (const b of filtered) {
    if (!b.psm_name || b.menge_gesamt == null) continue
    const key = b.psm_name
    const totalHa = b.grundstuecke.reduce((s, g) => s + g.flaeche_ha, 0)
    const curr = mittelMap.get(key) ?? {
      name: b.psm_name, einheit: b.menge_einheit, menge: 0, anwendungen: 0, ha: 0,
      max_aufwand_kg_ha: b.max_aufwand_kg_ha, max_anwendungen: b.max_anwendungen,
    }
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
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Max. Anw.</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Ø pro ha</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Grenzwert/ha</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {mittel.map(m => {
              const aufwandProHa = m.ha > 0 ? m.menge / m.ha : null
              const aufwandOk = !m.max_aufwand_kg_ha || !aufwandProHa || aufwandProHa <= m.max_aufwand_kg_ha
              const anwOk = !m.max_anwendungen || m.anwendungen <= m.max_anwendungen
              const ok = aufwandOk && anwOk

              return (
                <tr key={m.name} className="border-b border-s112-border/40 hover:bg-s112-bg/30">
                  <td className="py-2.5 pr-3 font-medium">{m.name}</td>
                  <td className={`py-2.5 pr-3 text-right tabular-nums font-semibold ${!anwOk ? 'text-red-600' : ''}`}>
                    {m.anwendungen}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-s112-muted">
                    {m.max_anwendungen ?? '–'}
                  </td>
                  <td className={`py-2.5 pr-3 text-right tabular-nums font-semibold ${!aufwandOk ? 'text-red-600' : ''}`}>
                    {aufwandProHa != null ? `${fmtNum(aufwandProHa, 3)} ${m.einheit ?? ''}/ha` : '–'}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-s112-muted">
                    {m.max_aufwand_kg_ha != null ? `${m.max_aufwand_kg_ha} kg/ha` : '–'}
                  </td>
                  <td className="py-2.5 text-right">
                    {ok
                      ? <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">✓ OK</span>
                      : <span className="text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full">⚠ Grenzwert</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Cu-Bilanz Tab ────────────────────────────────────────────────────────────
// EU-Bio-Grenzwert: 4 kg Cu/ha/Jahr (Verordnung EU 2018/848)
// AT-Grenzwert auf 5-Jahres-Basis: max. 20 kg/ha in 5 Jahren (≈ 4 kg/ha/Jahr Durchschnitt)
const CU_LIMIT_G_HA_JAHR = 4000       // 4 kg Cu/ha/Jahr
const CU_LIMIT_G_HA_5JAHRE = 20000    // 20 kg Cu/ha über 5 Jahre

type CuEintrag = {
  datum: string; name: string; pct: number
  menge: number; einheit: string; cuG: number
  max_anwendungen: number | null; wartezeit_tage: number | null
}

function TabCu({ behandlungen }: { behandlungen: BehandlungReport[] }) {
  const cuByYear = new Map<string, { cuG: number; ha: number; eintraege: CuEintrag[] }>()

  for (const b of behandlungen) {
    // Cu-Gehalt: direktes Feld ODER Fallback aus wirkstoffgehalt_pct (bereits im Server aufgelöst)
    const cuPct = b.cu_gehalt_pct
    if (!cuPct || cuPct <= 0 || b.menge_gesamt == null) continue

    // Umrechnung in kg (nur kg und l sinnvoll; g/ml ignorieren da zu kleine Mengen)
    let mengeKg = 0
    if (b.menge_einheit === 'kg' || b.menge_einheit == null) {
      mengeKg = b.menge_gesamt
    } else if (b.menge_einheit === 'l') {
      mengeKg = b.menge_gesamt  // Näherung: Dichte ≈ 1 kg/l für wässrige Lösungen
    } else {
      continue  // g/ml: keine sinnvolle Cu-Berechnung ohne Verdünnung
    }

    const y = b.datum.slice(0, 4)
    const totalHa = b.grundstuecke.reduce((s, g) => s + g.flaeche_ha, 0)
    const cuG = mengeKg * 1000 * (cuPct / 100)
    const curr = cuByYear.get(y) ?? { cuG: 0, ha: 0, eintraege: [] }
    curr.cuG += cuG
    curr.ha += totalHa
    curr.eintraege.push({
      datum:           b.datum,
      name:            b.psm_name ?? '–',
      pct:             cuPct,
      menge:           b.menge_gesamt,
      einheit:         b.menge_einheit ?? 'kg',
      cuG,
      max_anwendungen: b.max_anwendungen,
      wartezeit_tage:  b.wartezeit_tage,
    })
    cuByYear.set(y, curr)
  }

  const jahre = Array.from(cuByYear.entries()).sort(([a], [b]) => b.localeCompare(a))

  // 5-Jahres-Summe
  const cu5JahreG = Array.from(cuByYear.values()).reduce((s, d) => s + d.cuG, 0)
  const cu5JahreHa = cuByYear.size > 0
    ? Array.from(cuByYear.values()).reduce((s, d) => s + d.ha, 0) / cuByYear.size
    : 0

  if (jahre.length === 0) {
    return (
      <div className="card">
        <div className="text-center py-12 text-s112-muted">
          <p className="text-3xl mb-2">🔵</p>
          <p className="font-medium text-gray-600">Keine Cu-Daten vorhanden</p>
          <p className="text-sm mt-1 max-w-sm mx-auto">
            Erfassen Sie Behandlungen mit kupferhaltigen Mitteln. Der Cu-Gehalt muss im
            PSM-Stammdatum (Feld &quot;cu_gehalt_pct&quot;) hinterlegt sein und die Menge in kg oder l angegeben werden.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* 5-Jahres-Übersicht */}
      {jahre.length > 1 && (
        <div className="card bg-blue-50 border-blue-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-blue-900">5-Jahres-Bilanz (AT-Grenzwert)</h3>
            <span className="text-xs text-blue-600 font-medium">Limit: 20 kg Cu/ha über 5 Jahre</span>
          </div>
          <div className="h-4 bg-blue-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${cu5JahreG / Math.max(cu5JahreHa, 0.001) > CU_LIMIT_G_HA_5JAHRE ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${Math.min(100, (cu5JahreG / Math.max(cu5JahreHa, 0.001)) / CU_LIMIT_G_HA_5JAHRE * 100)}%` }}
            />
          </div>
          <p className="text-xs text-blue-700 mt-1.5">
            Gesamteintrag: <strong>{(cu5JahreG / 1000).toFixed(2)} kg Cu</strong> über {jahre.length} Jahre
            · Ø {cu5JahreHa > 0 ? ((cu5JahreG / cu5JahreHa) / 1000).toFixed(3) : '–'} kg Cu/ha
          </p>
        </div>
      )}

      {jahre.map(([y, data]) => {
        const cuProHa = data.ha > 0 ? data.cuG / data.ha : 0
        const pct = Math.min(100, (cuProHa / CU_LIMIT_G_HA_JAHR) * 100)
        const status = cuProHa > CU_LIMIT_G_HA_JAHR ? 'red'
                     : cuProHa > CU_LIMIT_G_HA_JAHR * 0.8 ? 'amber'
                     : 'green'
        const barColor = status === 'red' ? 'bg-red-500' : status === 'amber' ? 'bg-amber-400' : 'bg-s112-teal'
        const badgeColor = status === 'red'   ? 'bg-red-50 text-red-700 border-red-200'
                         : status === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-200'
                         : 'bg-green-50 text-green-700 border-green-200'

        // Anwendungsanzahl je PSM in diesem Jahr
        const anwByPsm = new Map<string, number>()
        data.eintraege.forEach(e => anwByPsm.set(e.name, (anwByPsm.get(e.name) ?? 0) + 1))

        return (
          <div key={y} className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900 tabular-nums">{y}</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-s112-muted">EU-Bio: 4 kg/ha/Jahr</span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${badgeColor}`}>
                  {(cuProHa / 1000).toFixed(3)} kg Cu/ha
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div>
              <div className="h-6 bg-gray-100 rounded-lg overflow-hidden relative border border-s112-border">
                <div className={`h-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                {/* Marker bei 80% */}
                <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-amber-400 opacity-60" style={{ left: '80%' }} />
                <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-gray-700 mix-blend-multiply">
                  {pct.toFixed(1)} % des Grenzwerts
                </div>
              </div>
              <div className="flex justify-between text-xs text-s112-muted mt-1">
                <span>0</span>
                <span className="text-amber-600">Warnschwelle 80 %</span>
                <span className="font-medium">4 kg/ha</span>
              </div>
            </div>

            <p className="text-xs text-s112-muted">
              Gesamteintrag: <strong>{(data.cuG / 1000).toFixed(2)} kg Cu</strong>
              {' '}auf <strong>{fmtHa(data.ha)}</strong> (Summe behandelter Flächen)
            </p>

            {/* Eintragsdetails */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-s112-border">
                    <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Datum</th>
                    <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Mittel</th>
                    <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Cu-%</th>
                    <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Menge</th>
                    <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Cu-Eintrag</th>
                    <th className="text-right text-xs text-s112-muted font-semibold py-1.5">Anw. / Max.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.eintraege.sort((a, b) => a.datum.localeCompare(b.datum)).map((e, i) => {
                    const anwBisher = anwByPsm.get(e.name) ?? 1
                    const anwOk = !e.max_anwendungen || anwBisher <= e.max_anwendungen
                    return (
                      <tr key={i} className="border-b border-s112-border/40">
                        <td className="py-2 pr-3 tabular-nums">{fmtDate(e.datum)}</td>
                        <td className="py-2 pr-3">{e.name}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{e.pct} %</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {fmtNum(e.menge, 2)} {e.einheit}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-semibold text-blue-600">
                          {(e.cuG / 1000).toFixed(3)} kg
                        </td>
                        <td className={`py-2 text-right tabular-nums text-xs ${!anwOk ? 'text-red-600 font-semibold' : 'text-s112-muted'}`}>
                          {e.max_anwendungen ? `${anwBisher} / ${e.max_anwendungen}` : `${anwBisher} / –`}
                          {!anwOk && ' ⚠'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-s112-border bg-s112-bg/40">
                    <td colSpan={4} className="py-2 pr-3 text-xs font-semibold text-gray-600">Summe {y}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-bold text-blue-700">
                      {(data.cuG / 1000).toFixed(3)} kg Cu
                    </td>
                    <td />
                  </tr>
                </tfoot>
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

  const TAB_TITLES: Record<Tab, string> = {
    weingarten: 'Mittelverteilung pro Weingarten',
    lage:       'Mittelverteilung pro Lage',
    mittel:     'Mittelverbrauch & Grenzwerte',
    cu:         'Cu-Bilanz',
  }

  const heute = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const jahrLabel = jahr === 'all' ? 'Alle Jahre' : jahr

  return (
    <div>
      {/* Tab Bar + Jahr-Filter + Print-Button */}
      <div className="flex items-center justify-between mb-4" data-print="hide">
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
          <div className="pb-1 self-center ml-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 border border-s112-border text-gray-600 px-3 py-1 rounded-lg text-sm hover:bg-s112-bg transition-colors"
              title="Als PDF speichern oder drucken"
            >
              🖨 Drucken / PDF
            </button>
          </div>
        </div>
      </div>

      {/* Print-Header (nur beim Drucken sichtbar) */}
      <div className="hidden print:block mb-6 pb-4 border-b-2 border-gray-300">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs text-gray-500 font-semibold tracking-widest uppercase">software:112 – Gebeshuber Weinbau</p>
            <h1 className="text-2xl font-bold text-gray-900 mt-0.5">{TAB_TITLES[tab]}</h1>
            <p className="text-sm text-gray-500 mt-1">Zeitraum: {jahrLabel}</p>
          </div>
          <p className="text-sm text-gray-400">Erstellt: {heute}</p>
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
