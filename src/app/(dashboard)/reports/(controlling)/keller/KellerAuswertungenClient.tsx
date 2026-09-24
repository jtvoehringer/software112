'use client'
import Link from '@/components/ui/Link'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvDatei, csvDateiname } from '@/lib/csv'
import { csvPfad } from '@/lib/behoerden/katalog'
import { zeitraumAnzeige } from '@/lib/behoerden/kellerbuch-hilfen'
import { SPALTEN_KELLER_BEHAELTER, SPALTEN_KELLER_CHARGEN, type KellerAuswertungen } from '@/lib/behoerden/keller-auswertungen'
import ZeitraumFormular from '@/app/(dashboard)/kellerbuch/_behoerden/ZeitraumFormular'
import { fehlendeKuerzelHinweise, formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum } from '@/lib/format'

// Keller-Auswertungen (Modul Controlling). Seit 24.09.2026 alle CSVs über den Baustein
// lib/csv: Umzüge → Meldung „keller-auswertungen“, Kellerbehandlungen → „keller-behandlungen-alle“
// (Server-CSV mit demselben Zeitraum), Behälter und Chargen als Listen-CSV im Browser.

const STATUS_FARBE: Record<string, string> = {
  ernte:         'bg-s112-warn-bg text-s112-warn-fg',
  gaerung:       'bg-s112-warn-bg text-s112-warn-fg',
  ausbau:        'bg-s112-blue-100 text-s112-blue-700',
  abfuellung:    'bg-[#F2F3F5] text-s112-text-1',
  abgeschlossen: 'bg-s112-ok-bg text-s112-ok-fg',
}

function fmtLiter(n: number) {
  return fmtNum(n, { max: 0 }) + ' L'
}

function datumAT(d: string) {
  return d ? d.split('-').reverse().join('.') : '–'
}

export default function KellerAuswertungenClient({ daten }: { daten: KellerAuswertungen }) {
  const {
    zeitraum, behaelter, chargen, behandlungen, behandlungTypen, umzuege,
    gesamtLiter, gesamtKapazitaet, gesamtAuslastung, schwundGesamt, abgefuelltLiter, warnungen,
  } = daten
  const zeitraumText = zeitraumAnzeige(zeitraum)

  return (
    <div className="max-w-5xl space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted print:hidden">
        <Link href="/reports" className="hover:text-s112-blue-700 transition-colors">Auswertungen</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Keller-Auswertungen</span>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-s112-text">Keller-Auswertungen</h1>
            <p className="text-sm text-s112-muted mt-0.5">Bewegungen: {zeitraumText} · Bestände: heute</p>
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 border border-s112-border text-s112-text-2 px-3 py-2 rounded-xl text-sm hover:bg-s112-bg transition-colors print:hidden"
          >
            Drucken
          </button>
        </div>
        <ZeitraumFormular von={zeitraum.von} bis={zeitraum.bis} zuruecksetzen="/reports/keller?von=" />
        {warnungen.length > 0 && (
          <ul className="text-xs text-s112-warn-fg list-disc pl-4 space-y-0.5">
            {warnungen.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>

      {/* KPI-Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card text-center p-4">
          <p className="text-2xl font-semibold text-s112-blue-700">{fmtNum(gesamtLiter, { max: 0 })}</p>
          <p className="text-xs text-s112-muted mt-1">Liter im Ausbau</p>
          {gesamtKapazitaet > 0 && (
            <p className="text-xs text-s112-tertiary mt-0.5">{Math.round(gesamtAuslastung)} % Auslastung</p>
          )}
        </div>
        <div className="card text-center p-4">
          <p className="text-2xl font-semibold text-s112-blue-700">{chargen.length}</p>
          <p className="text-xs text-s112-muted mt-1">Laufende Chargen</p>
        </div>
        <div className="card text-center p-4">
          <p className="text-2xl font-semibold text-s112-warn-fg">{fmtNum(schwundGesamt, { max: 0 })}</p>
          <p className="text-xs text-s112-muted mt-1">Liter Schwund im Zeitraum</p>
        </div>
        <div className="card text-center p-4">
          <p className="text-2xl font-semibold text-s112-text-1">{fmtNum(abgefuelltLiter, { max: 0 })}</p>
          <p className="text-xs text-s112-muted mt-1">Liter abgefüllt im Zeitraum</p>
        </div>
      </div>

      {/* Behälter-Auslastung */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-s112-text">Behälter-Auslastung</h2>
          <CsvExportKnopf label="Behälter als CSV" erzeugen={() => {
            const d = csvDatei(behaelter, SPALTEN_KELLER_BEHAELTER)
            return { text: d.text, zeilen: d.zeilen, warnungen: d.warnungen, dateiname: csvDateiname(['Behälter-Auslastung']).utf8 }
          }} />
        </div>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Behälter</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Standort</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Kapazität</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Inhalt</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2 w-40">Auslastung</th>
              </tr>
            </thead>
            <tbody>
              {behaelter.map((b, i) => {
                // fremd belegte Liter eines Partnerbetriebs zählen zur Auslastung (Kellergemeinschaft)
                const pct = b.auslastung
                return (
                  <tr key={b.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-s112-text">
                      <Link href={`/kellerbuch/behaelter/${b.id}/bewegungen`} className="flex items-center gap-2 hover:text-s112-blue-700">
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-s112-text-2 text-xs">{b.standort ?? '–'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-2 text-xs">
                      {b.kapazitaet ? fmtLiter(b.kapazitaet) : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-s112-blue-700">
                      {b.inhalt > 0 ? fmtLiter(b.inhalt) : <span className="text-s112-tertiary">–</span>}
                      {b.fremdLiter > 0 && <span className="block text-[11px] font-normal text-s112-warn-fg">belegt · {b.fremdBetrieb ?? 'Partner'}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {pct !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-s112-line rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${pct > 95 ? 'bg-s112-err' : pct > 80 ? 'bg-s112-warn' : 'bg-s112-teal'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-s112-text-2 w-9 text-right">{Math.round(pct)} %</span>
                        </div>
                      ) : (
                        <span className="text-xs text-s112-tertiary">–</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {behaelter.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-s112-muted italic">Keine aktiven Behälter</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Chargen im Ausbau */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-s112-text">Chargen im Ausbau</h2>
          <CsvExportKnopf label="Chargen als CSV" erzeugen={() => {
            const d = csvDatei(chargen, SPALTEN_KELLER_CHARGEN)
            const kuerzel = fehlendeKuerzelHinweise(chargen.map(c => c.rebsorte), { einheit: ['Charge', 'Chargen'], stammdaten: 'Charge' })
            return { text: d.text, zeilen: d.zeilen, warnungen: [...d.warnungen, ...kuerzel], dateiname: csvDateiname(['Chargen-im-Ausbau']).utf8 }
          }} />
        </div>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Charge</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">JG</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Behälter</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Liter</th>
              </tr>
            </thead>
            <tbody>
              {chargen.map((c, i) => (
                <tr key={c.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                  <td className="px-4 py-2.5 font-medium text-s112-text">
                    <Link href={`/kellerbuch/weinausbau/${c.id}`} className="hover:text-s112-blue-700">
                      {c.name}
                      {c.rebsorte && <span className="text-xs text-s112-muted ml-1">· {formatRebsorteMitKuerzel(c.rebsorte)}</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-s112-text-2 text-xs">{c.jahrgang ?? '–'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${(c.status && STATUS_FARBE[c.status]) || 'bg-[#F2F3F5] text-s112-text-2'}`}>{c.statusLabel ?? '–'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-s112-text-2 text-sm">
                    {c.behaelterId && c.behaelter ? (
                      <Link href={`/kellerbuch/behaelter/${c.behaelterId}/bewegungen`} className="hover:text-s112-blue-700">
                        {c.behaelter}
                      </Link>
                    ) : <span className="text-s112-warn-fg text-xs">kein Behälter</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-s112-blue-700">
                    {fmtLiter(c.liter)}
                  </td>
                </tr>
              ))}
              {chargen.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-s112-muted italic">Keine laufenden Chargen</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Kellerbehandlungen */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-s112-text">Kellerbehandlungen</h2>
            <span className="text-xs text-s112-muted">{zeitraumText} · {behandlungen.length} Einträge</span>
          </div>
          <CsvExportKnopf label="Kellerbehandlungen als CSV" href={csvPfad('keller-behandlungen-alle', { von: zeitraum.von, bis: zeitraum.bis })} />
        </div>

        {behandlungTypen.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {behandlungTypen.map(([typ, anzahl]) => (
              <span key={typ} className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-s112-blue-50 text-s112-blue-700 border border-s112-blue-100">
                {typ}<span className="font-semibold ml-0.5">{anzahl}×</span>
              </span>
            ))}
          </div>
        )}

        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Behandlung</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Behälter</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Menge</th>
              </tr>
            </thead>
            <tbody>
              {[...behandlungen].reverse().map((b, i) => (
                <tr key={b.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                  <td className="px-4 py-2.5 text-s112-text-2 whitespace-nowrap text-xs">
                    {datumAT(b.datum)}
                  </td>
                  <td className="px-4 py-2.5 text-s112-text">
                    {b.behandlung}
                    {b.charge && <span className="block text-xs text-s112-muted">Charge: {b.charge}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-s112-text-2">{b.gebinde ?? '–'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-1">
                    {b.menge !== null && b.einheit ? `${fmtNum(b.menge)} ${b.einheit}` : '–'}
                  </td>
                </tr>
              ))}
              {behandlungen.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-s112-muted italic">Keine Kellerbehandlungen im Zeitraum erfasst</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Umzüge & Filtrationen */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-s112-text">Umzüge & Filtrationen</h2>
            <span className="text-xs text-s112-muted">{zeitraumText} · {umzuege.length} Einträge</span>
          </div>
          <CsvExportKnopf label="Umzüge als CSV" href={csvPfad('keller-auswertungen', { von: zeitraum.von, bis: zeitraum.bis })} />
        </div>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Von</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Nach</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Brutto</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Schwund</th>
              </tr>
            </thead>
            <tbody>
              {umzuege.map((u, i) => {
                const isSchwund = u.typ === 'schwund'
                const vonName   = isSchwund ? (u.charge ?? u.vonGebinde ?? '–') : (u.vonGebinde ?? '–')
                const nachName  = isSchwund ? 'Schwund / Verlust' : (u.nachGebinde ?? '–')
                return (
                  <tr key={u.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 text-s112-text-2 whitespace-nowrap text-xs">
                      {datumAT(u.datum)}
                    </td>
                    <td className="px-4 py-2.5 text-s112-text-1">
                      {vonName}
                      {u.typ === 'filtration' && <span className="ml-1.5 text-[11px] text-s112-muted">Filtration</span>}
                    </td>
                    <td className="px-4 py-2.5 text-s112-text-1">
                      {nachName}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-s112-text-1">
                      {u.brutto ? fmtLiter(u.brutto) : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-warn-fg">
                      {u.schwund ? fmtLiter(u.schwund) : '–'}
                    </td>
                  </tr>
                )
              })}
              {umzuege.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-s112-muted italic">Keine Umzüge im Zeitraum erfasst</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  )
}
