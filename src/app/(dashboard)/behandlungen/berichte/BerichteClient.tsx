'use client'

// Maßnahmen-Berichte – rechnet mit denselben Funktionen wie die Behördenmeldungen
// (lib/behoerden/psm.ts: mittelverbrauch(), lib/behoerden/cu.ts: cuBilanz()), damit Bildschirm,
// Ausdruck und CSV (Route /meldungen/<id>/csv) dieselben Zahlen zeigen.

import { useMemo, useState } from 'react'
import { ZAHL_LOCALE } from '@/lib/format'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import {
  ART_LABEL, OHNE_RIED, datumDe, mittelmenge, mittelverbrauch, mittelverbrauchHinweise, spritzbruehe,
  type PsmBehandlung, type WeingartenStamm,
} from '@/lib/behoerden/psm'
import { cuBilanz, CU_GRENZWERT_KG_HA_5J, CU_GRENZWERT_KG_HA_JAHR, CU_WARNSCHWELLE } from '@/lib/behoerden/cu'

type Tab = 'ried' | 'mittel' | 'cu'

function fmtNum(n: number, dec = 3) {
  return n.toLocaleString(ZAHL_LOCALE, { maximumFractionDigits: dec })
}
function fmtHa(n: number) {
  return n.toLocaleString(ZAHL_LOCALE, { maximumFractionDigits: 4 }) + ' ha'
}

function riedSchluessel(lageId: string | null) {
  return lageId ?? OHNE_RIED
}

// ─── Ried Tab ─────────────────────────────────────────────────────────────────
// Ersetzt die frühere getrennte "Pro Weingarten"/"Pro Ried"-Ansicht (beide Tabs
// waren identisch beschriftet "Pro Ried" und verwirrend). Ein Tab, gruppiert
// nach Ried (Lage), mit Auswahl "Alle Rieden" / einzelnes Ried sowie Art.
// Seit KAN-133 (26.09.2026) die Mittelmenge aus mittelmenge() statt „Menge gesamt“ – die ist bei
// Spritzungen die Spritzbrühe und steht nur als Zusatzzeile da (nie summiert); Anteil nach Fläche
// wie die CSV „psm-aufzeichnung“.
function TabRied({ behandlungen, jahr, ried, art }: { behandlungen: PsmBehandlung[]; jahr: string; ried: string; art: string }) {
  const filtered = behandlungen.filter(b =>
    (jahr === 'all' || String(b.jahr) === jahr) &&
    (art === 'all' || b.art === art)
  )

  const lageMap = new Map<string, { name: string; behandlungen: PsmBehandlung[] }>()
  for (const b of filtered) {
    const lageIds = new Set(b.grundstuecke.map(g => riedSchluessel(g.lageId)))
    for (const lId of lageIds) {
      const g0 = b.grundstuecke.find(g => riedSchluessel(g.lageId) === lId)
      const lName = lId === OHNE_RIED ? 'Ohne Ried' : (g0?.ried ?? 'Ohne Ried')
      if (!lageMap.has(lId)) lageMap.set(lId, { name: lName, behandlungen: [] })
      lageMap.get(lId)!.behandlungen.push(b)
    }
  }
  let lagen = Array.from(lageMap.entries()).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'de'))
  if (ried !== 'all') lagen = lagen.filter(([lId]) => lId === ried)

  if (lagen.length === 0) return <EmptyState />

  return (
    <div className="space-y-4">
      {lagen.map(([lId, lage]) => (
        <div key={lId} className="card">
          <h3 className="font-semibold text-s112-text mb-3">{lage.name}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-s112-border">
                  <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Datum</th>
                  <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Art</th>
                  <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Mittel</th>
                  <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Mittelmenge</th>
                  <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Ant. Fläche</th>
                  <th className="text-right text-xs text-s112-muted font-semibold py-1.5">Ant. Mittelmenge</th>
                </tr>
              </thead>
              <tbody>
                {lage.behandlungen.map(b => {
                  const mm = mittelmenge(b)
                  const bruehe = spritzbruehe(b)
                  const totalHa = b.grundstuecke.reduce((s, g) => s + (g.flaecheHa ?? 0), 0)
                  const lageHa = b.grundstuecke.filter(g => riedSchluessel(g.lageId) === lId).reduce((s, g) => s + (g.flaecheHa ?? 0), 0)
                  // ein einziger Ort trägt die ganze Menge (wie die CSV)
                  const anteil = b.grundstuecke.length <= 1 ? 1 : totalHa > 0 ? lageHa / totalHa : null
                  const anteilMenge = mm.menge !== null && anteil !== null ? mm.menge * anteil : null

                  return (
                    <tr key={b.id} className="border-b border-s112-border/40 hover:bg-s112-bg/30">
                      <td className="py-2 pr-3 tabular-nums">{datumDe(b.datum)}</td>
                      <td className="py-2 pr-3">{ART_LABEL[b.art] ?? b.art}</td>
                      <td className="py-2 pr-3 text-s112-text-2">{b.psm?.name ?? b.duengemittel?.name ?? '–'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" title={mm.basis ?? undefined}>
                        {mm.menge !== null ? `${fmtNum(mm.menge, 3)} ${mm.einheit}` : '–'}
                        {mm.menge === null && mm.grund !== 'art' && <span className="block text-xs text-s112-warn-fg">{mm.warnung}</span>}
                        {bruehe !== null && <span className="block text-xs text-s112-muted">Brühe {fmtNum(bruehe, 3)} l</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtHa(lageHa)}</td>
                      <td className="py-2 text-right tabular-nums font-medium text-s112-blue-700">
                        {anteilMenge !== null ? `${fmtNum(anteilMenge, 3)} ${mm.einheit}` : '–'}
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
// Je Saison × Mittel × Einheit (mittelverbrauch() aus lib/behoerden/psm.ts, wie die CSV
// „psm-mittelverbrauch“) – „Max. Anw.“ gilt je Saison, kg und l werden nicht addiert.
// Mittelmenge nur aus dem Aufwand (KAN-133), Hinweise wie in der CSV (mittelverbrauchHinweise()).
function TabMittel({ behandlungen, jahr }: { behandlungen: PsmBehandlung[]; jahr: string }) {
  const filtered = jahr === 'all' ? behandlungen : behandlungen.filter(b => String(b.jahr) === jahr)
  const mittel = mittelverbrauch(filtered)
  const hinweise = mittelverbrauchHinweise(filtered)
  const mitJahr = jahr === 'all'

  if (mittel.length === 0) {
    return (
      <div className="space-y-2">
        <EmptyState msg="Keine Spritzungen mit Mittelmenge (Aufwand) im Zeitraum" />
        <HinweisListe hinweise={hinweise} />
      </div>
    )
  }

  return (
    <div className="card space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-s112-border">
              {mitJahr && <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Saison</th>}
              <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Mittel</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Anwendungen</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Max. Anw.</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Mittelmenge</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Ø pro ha</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Grenzwert/ha</th>
              <th className="text-right text-xs text-s112-muted font-semibold py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {mittel.map(m => {
              const ok = !m.aufwandUeber && !m.anwendungenUeber
              return (
                <tr key={`${m.jahr}|${m.mittel}|${m.einheit}`} className="border-b border-s112-border/40 hover:bg-s112-bg/30">
                  {mitJahr && <td className="py-2.5 pr-3 tabular-nums text-s112-muted">{m.jahr}</td>}
                  <td className="py-2.5 pr-3 font-medium">{m.mittel}</td>
                  <td className={`py-2.5 pr-3 text-right tabular-nums font-semibold ${m.anwendungenUeber ? 'text-s112-err-fg' : ''}`}>
                    {m.anwendungen}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-s112-muted">
                    {m.maxAnwendungen ?? '–'}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {fmtNum(m.mittelmenge, 3)} {m.einheit}
                  </td>
                  <td className={`py-2.5 pr-3 text-right tabular-nums font-semibold ${m.aufwandUeber ? 'text-s112-err-fg' : ''}`}>
                    {m.aufwandJeHa != null ? `${fmtNum(m.aufwandJeHa, 3)} ${m.einheit}/ha` : '–'}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-s112-muted">
                    {m.maxAufwandKgHa != null ? `${fmtNum(m.maxAufwandKgHa, 3)} kg/ha` : '–'}
                  </td>
                  <td className="py-2.5 text-right">
                    {!ok
                      ? <span className="text-xs bg-s112-err-bg text-s112-err-fg border border-s112-err/30 px-2 py-0.5 rounded-full" title={m.status}>Grenzwert</span>
                      : m.aufwandNichtVergleichbar
                        ? <span className="text-xs bg-s112-warn-bg text-s112-warn-fg border border-s112-warn/30 px-2 py-0.5 rounded-full" title={m.status}>nicht vergleichbar</span>
                        : <span className="text-xs bg-s112-ok-bg text-s112-ok-fg border border-s112-ok/30 px-2 py-0.5 rounded-full">OK</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <HinweisListe hinweise={hinweise} />
    </div>
  )
}

// ─── Cu-Bilanz Tab ────────────────────────────────────────────────────────────
// cuBilanz() aus lib/behoerden/cu.ts – dieselbe Rechnung wie /reports/cu-bilanz und die CSV-Dateien
// „cu-bilanz“/„cu-bilanz-behandlungen“. Cu je ha des Betriebs = Σ Cu / Fläche der WI-Grundstücke der
// aktiven Weingärten (bis 24.09.2026 hier: / Summe der behandelten Flächen aller Anwendungen – bei
// n Spritzungen nur ein n-tel des tatsächlichen Eintrags). EU-Bio: 4 kg Cu/ha/Jahr, AT (ÖPUL): 20 kg Cu/ha in 5 Jahren.
function TabCu({ behandlungen, weingaerten }: { behandlungen: PsmBehandlung[]; weingaerten: WeingartenStamm[] }) {
  const bilanz = useMemo(() => cuBilanz(behandlungen, weingaerten), [behandlungen, weingaerten])
  const jahre = bilanz.jahre

  if (jahre.length === 0) {
    return (
      <div className="card">
        <div className="text-center py-12 text-s112-muted">
          <p className="font-medium text-s112-text-2">Keine Cu-Daten vorhanden</p>
          <p className="text-sm mt-1 max-w-sm mx-auto">
            Erfassen Sie Maßnahmen mit kupferhaltigen Mitteln. Der Cu-Gehalt muss in den
            PSM-Stammdaten (Betriebsmittel, Feld &quot;cu_gehalt_pct&quot;) hinterlegt und die Aufwandmenge (z. B. kg/ha) erfasst sein –
            die Mittelmenge ergibt sich aus Aufwand × Fläche, nicht aus der Spritzbrühe.
          </p>
        </div>
        <HinweisListe hinweise={bilanz.warnungen} />
      </div>
    )
  }

  const aktuell = jahre[0]
  const cu5JahreKg = jahre.filter(j => j.jahr > aktuell.jahr - 5).reduce((s, j) => s + j.cuKg, 0)
  const anteil5J = aktuell.cuKgHa5J !== null ? Math.min(100, aktuell.cuKgHa5J / CU_GRENZWERT_KG_HA_5J * 100) : 0

  return (
    <div className="space-y-4">

      {/* 5-Jahres-Übersicht */}
      {jahre.length > 1 && (
        <div className="card bg-s112-blue-50 border-s112-blue-100">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-s112-blue-700">5-Jahres-Bilanz (AT-Grenzwert)</h3>
            <span className="text-xs text-s112-blue-700 font-medium">Limit: {CU_GRENZWERT_KG_HA_5J} kg Cu/ha über 5 Jahre</span>
          </div>
          <div className="h-4 bg-s112-blue-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${(aktuell.cuKgHa5J ?? 0) > CU_GRENZWERT_KG_HA_5J ? 'bg-s112-err' : 'bg-s112-teal'}`}
              style={{ width: `${anteil5J}%` }}
            />
          </div>
          <p className="text-xs text-s112-blue-700 mt-1.5">
            {aktuell.jahr - 4}–{aktuell.jahr}: <strong>{fmtNum(cu5JahreKg, 2)} kg Cu</strong>
            {' '}· {aktuell.cuKgHa5J !== null ? fmtNum(aktuell.cuKgHa5J, 3) : '–'} kg Cu/ha (Betriebsfläche {fmtHa(bilanz.gesamtHa)})
            {aktuell.cuKgHa7J !== null && <> · 7 Jahre: {fmtNum(aktuell.cuKgHa7J, 3)} kg Cu/ha</>}
          </p>
        </div>
      )}

      {jahre.map(j => {
        const cuProHa = j.cuKgHa ?? 0
        const pct = Math.min(100, (cuProHa / CU_GRENZWERT_KG_HA_JAHR) * 100)
        // ohne Betriebsfläche (keine WI-Grundstücke) kein Status – neutral statt grün
        const status = j.status === 'ueber' ? 'red' : j.status === 'warnung' ? 'amber' : j.status === 'ok' ? 'green' : 'none'
        const barColor = status === 'red' ? 'bg-s112-err' : status === 'amber' ? 'bg-s112-warn' : 'bg-s112-teal'
        const badgeColor = status === 'red'   ? 'bg-s112-err-bg text-s112-err-fg border-s112-err/30'
                         : status === 'amber' ? 'bg-s112-warn-bg text-s112-warn-fg border-s112-warn/30'
                         : status === 'green' ? 'bg-s112-ok-bg text-s112-ok-fg border-s112-ok/30'
                         : 'bg-s112-bg text-s112-text-2 border-s112-border'

        return (
          <div key={j.jahr} className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-s112-text tabular-nums">{j.jahr}</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-s112-muted">EU-Bio: {CU_GRENZWERT_KG_HA_JAHR} kg/ha/Jahr</span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${badgeColor}`}>
                  {j.cuKgHa !== null ? fmtNum(j.cuKgHa, 3) : '–'} kg Cu/ha
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div>
              <div className="h-6 bg-[#F2F3F5] rounded-lg overflow-hidden relative border border-s112-border">
                <div className={`h-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                {/* Marker bei 80% */}
                <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-s112-warn/50 opacity-60" style={{ left: `${CU_WARNSCHWELLE * 100}%` }} />
                <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-s112-text-1 mix-blend-multiply">
                  {pct.toLocaleString(ZAHL_LOCALE, { maximumFractionDigits: 1 })} % des Grenzwerts
                </div>
              </div>
              <div className="flex justify-between text-xs text-s112-muted mt-1">
                <span>0</span>
                <span className="text-s112-warn-fg">Warnschwelle {CU_WARNSCHWELLE * 100} %</span>
                <span className="font-medium">{CU_GRENZWERT_KG_HA_JAHR} kg/ha</span>
              </div>
            </div>

            <p className="text-xs text-s112-muted">
              Gesamteintrag: <strong>{fmtNum(j.cuKg, 3)} kg Cu</strong>
              {' '}auf <strong>{fmtHa(j.gesamtHa)}</strong> (Grundstücke mit Nutzart WI der aktiven Weingärten)
            </p>

            {/* Je Weingarten */}
            {j.weingaerten.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-s112-border">
                      <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Weingarten</th>
                      <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Fläche</th>
                      <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Cu-Eintrag</th>
                      <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Cu/ha</th>
                      <th className="text-right text-xs text-s112-muted font-semibold py-1.5">5 J. Cu/ha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {j.weingaerten.map(w => (
                      <tr key={w.weingartenId} className="border-b border-s112-border/40">
                        <td className="py-1.5 pr-3">{w.weingarten}{w.ried ? <span className="text-s112-muted"> · {w.ried}</span> : null}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{w.flaecheHa !== null ? fmtHa(w.flaecheHa) : '–'}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtNum(w.cuKg, 3)} kg</td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${w.cuKgHa !== null && w.cuKgHa > CU_GRENZWERT_KG_HA_JAHR ? 'text-s112-err-fg' : ''}`}>
                          {w.cuKgHa !== null ? `${fmtNum(w.cuKgHa, 3)} kg` : '–'}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-s112-muted">{w.cuKgHa5J !== null ? `${fmtNum(w.cuKgHa5J, 3)} kg` : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Eintragsdetails */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-s112-border">
                    <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Datum</th>
                    <th className="text-left text-xs text-s112-muted font-semibold py-1.5 pr-3">Mittel</th>
                    <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Cu-%</th>
                    <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Mittelmenge</th>
                    <th className="text-right text-xs text-s112-muted font-semibold py-1.5 pr-3">Cu-Eintrag</th>
                    <th className="text-right text-xs text-s112-muted font-semibold py-1.5">Anw. / Max.</th>
                  </tr>
                </thead>
                <tbody>
                  {j.behandlungen.map(e => {
                    const anwOk = !e.maxAnwendungen || e.anwendungenImJahr <= e.maxAnwendungen
                    return (
                      <tr key={e.behandlungId} className="border-b border-s112-border/40">
                        <td className="py-2 pr-3 tabular-nums">{datumDe(e.datum)}</td>
                        <td className="py-2 pr-3">{e.mittel}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(e.cuGehaltPct, 3)} %</td>
                        <td className="py-2 pr-3 text-right tabular-nums" title={e.mengeBasis}>
                          {fmtNum(e.mengeKg, 3)} kg
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-semibold text-s112-blue-700">
                          {fmtNum(e.cuKg, 3)} kg
                        </td>
                        <td className={`py-2 text-right tabular-nums text-xs ${!anwOk ? 'text-s112-err-fg font-semibold' : 'text-s112-muted'}`}>
                          {e.maxAnwendungen ? `${e.anwendungenImJahr} / ${e.maxAnwendungen}` : `${e.anwendungenImJahr} / –`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-s112-border bg-s112-bg/40">
                    <td colSpan={4} className="py-2 pr-3 text-xs font-semibold text-s112-text-2">Summe {j.jahr}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold text-s112-blue-700">
                      {fmtNum(j.cuKg, 3)} kg Cu
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      })}

      <HinweisListe hinweise={bilanz.warnungen} />
    </div>
  )
}

// ─── Shared ───────────────────────────────────────────────────────────────────
function EmptyState({ msg = 'Keine Daten für den gewählten Zeitraum' }: { msg?: string }) {
  return (
    <div className="card text-center py-12 text-s112-muted">
      <p className="font-medium text-s112-text-2">{msg}</p>
    </div>
  )
}

function HinweisListe({ hinweise }: { hinweise: string[] }) {
  if (hinweise.length === 0) return null
  return (
    <ul className="text-xs text-s112-warn-fg list-disc pl-4 space-y-0.5">
      {hinweise.map((w, i) => <li key={i}>{w}</li>)}
    </ul>
  )
}

function getJahre(behandlungen: PsmBehandlung[]) {
  const set = new Set(behandlungen.map(b => b.jahr).filter(j => j > 0).map(String))
  return Array.from(set).sort().reverse()
}

function getRieden(behandlungen: PsmBehandlung[]) {
  const map = new Map<string, string>()
  for (const b of behandlungen) {
    for (const g of b.grundstuecke) {
      const key = riedSchluessel(g.lageId)
      if (!map.has(key)) map.set(key, key === OHNE_RIED ? 'Ohne Ried' : (g.ried ?? 'Ohne Ried'))
    }
  }
  return Array.from(map.entries()).sort(([, a], [, b]) => a.localeCompare(b, 'de'))
}

const ohneAlle = (v: string) => (v === 'all' ? null : v)

// ─── Main Client Component ────────────────────────────────────────────────────
export default function BerichteClient({ behandlungen, weingaerten, betriebName, csvErlaubt }: {
  behandlungen: PsmBehandlung[]
  weingaerten: WeingartenStamm[]
  betriebName: string | null
  csvErlaubt: boolean
}) {
  const [tab, setTab] = useState<Tab>('ried')
  const [jahr, setJahr] = useState('all')
  const [ried, setRied] = useState('all')
  const [art, setArt] = useState('all')
  const jahre = getJahre(behandlungen)
  const rieden = getRieden(behandlungen)

  const TABS: { id: Tab; label: string }[] = [
    { id: 'ried',   label: 'Ried' },
    { id: 'mittel', label: 'Mittelverbrauch' },
    { id: 'cu',     label: 'Cu-Bilanz' },
  ]

  const TAB_TITLES: Record<Tab, string> = {
    ried:   'Mittelverteilung pro Ried',
    mittel: 'Mittelverbrauch & Grenzwerte',
    cu:     'Cu-Bilanz',
  }

  const heute = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  // Tab „Cu-Bilanz“ zeigt immer alle Jahre (der Jahr-Filter gilt dort nicht)
  const jahrLabel = tab === 'cu' || jahr === 'all' ? 'Alle Jahre' : jahr
  const filterLabel = tab === 'ried'
    ? [ried !== 'all' ? (rieden.find(([id]) => id === ried)?.[1] ?? null) : null, art !== 'all' ? (ART_LABEL[art] ?? art) : null].filter(Boolean).join(' · ')
    : ''

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
                  ? 'border-s112-teal text-s112-blue-700'
                  : 'border-transparent text-s112-muted hover:text-s112-text-1'}`}
            >
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          {tab === 'ried' && (
            <div className="pb-1 self-center flex gap-2">
              <select
                aria-label="Ried"
                value={ried}
                onChange={e => setRied(e.target.value)}
                className="border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
              >
                <option value="all">Alle Rieden</option>
                {rieden.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <select
                aria-label="Maßnahmenart"
                value={art}
                onChange={e => setArt(e.target.value)}
                className="border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
              >
                <option value="all">Alle Arten</option>
                {Object.entries(ART_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          )}
          {tab !== 'cu' && (
            <div className="pb-1 self-center">
              <select
                aria-label="Jahr"
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
              className="inline-flex items-center gap-1.5 border border-s112-border text-s112-text-2 px-3 py-1 rounded-lg text-sm hover:bg-s112-bg transition-colors"
              title="Als PDF speichern oder drucken"
            >
              Drucken / PDF
            </button>
          </div>
          {/* CSV-Export direkt neben „Drucken / PDF“ (Behördenmeldungen über /meldungen/<id>/csv – gleiche Filter wie die Ansicht) */}
          {csvErlaubt && (
            <div className="pb-1 self-start flex items-start gap-2 print:hidden" data-print="hide">
              {tab === 'ried' && (
                <CsvExportKnopf
                  label="Pflanzenschutz-Aufzeichnung als CSV"
                  href={csvPfad('psm-aufzeichnung', { jahr: ohneAlle(jahr), art: ohneAlle(art), ried: ohneAlle(ried) })}
                />
              )}
              {tab === 'mittel' && (
                <CsvExportKnopf label="Mittelverbrauch als CSV" href={csvPfad('psm-mittelverbrauch', { jahr: ohneAlle(jahr) })} />
              )}
              {tab === 'cu' && (
                <>
                  <CsvExportKnopf label="Kupfer je Weingarten als CSV" href={csvPfad('cu-bilanz')} />
                  <CsvExportKnopf label="Kupfer-Einzelbehandlungen als CSV" href={csvPfad('cu-bilanz-behandlungen')} />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Print-Header (nur beim Drucken sichtbar) */}
      <div className="hidden print:block mb-6 pb-4 border-b-2 border-s112-line-str">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs text-s112-text-2 font-semibold tracking-widest uppercase">{betriebName ?? 'software:112'}</p>
            <h1 className="text-2xl font-semibold text-s112-text mt-0.5">{TAB_TITLES[tab]}</h1>
            <p className="text-sm text-s112-text-2 mt-1">Zeitraum: {jahrLabel}{filterLabel ? ` · ${filterLabel}` : ''}</p>
          </div>
          <p className="text-sm text-s112-tertiary">Erstellt: {heute}</p>
        </div>
      </div>

      {/* Tab Content */}
      {tab === 'ried'   && <TabRied   behandlungen={behandlungen} jahr={jahr} ried={ried} art={art} />}
      {tab === 'mittel' && <TabMittel behandlungen={behandlungen} jahr={jahr} />}
      {tab === 'cu'     && <TabCu     behandlungen={behandlungen} weingaerten={weingaerten} />}
    </div>
  )
}
