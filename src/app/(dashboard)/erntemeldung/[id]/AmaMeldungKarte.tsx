'use client'

// AMA-Erntemeldung des Jahrgangs (KAN-148 C2, 30.09.2026): Meldung aus den Lesedaten aufbauen, als eingereicht
// markieren, AMA-Rückmeldung erfassen und nach dem Einreichen nur noch als Korrekturmeldung (neue Version) ändern.
// Status, Datum und Versionen setzen die RPCs s112_ama_* – eine eingereichte Version bleibt unverändert.

import { useState, useTransition } from 'react'
import { amaKorrekturAnlegen, amaStatusSetzen, createOrUpdateAMAMeldung } from '../actions'
import type { AMAMeldung, AMAVersion } from './page'
import { fmtHa, fmtNum, fmtProzent } from '@/lib/format'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fehlerText } from '@/lib/fehler'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { AMA_OFFEN, AMA_STATUS_LABEL, type AmaZielStatus } from '@/lib/behoerden/amaMeldung'

const AMA_STATUS_CLS: Record<string, string> = {
  entwurf:     'bg-[#F2F3F5] text-s112-text-2',
  bereit:      'bg-s112-blue-100 text-s112-blue-700',
  eingereicht: 'bg-s112-warn-bg text-s112-warn-fg',
  bestaetigt:  'bg-s112-ok-bg text-s112-ok-fg',
  abgelehnt:   'bg-s112-err-bg text-s112-err-fg',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-xs px-2 py-1 rounded-full font-medium ${AMA_STATUS_CLS[status] ?? 'bg-[#F2F3F5] text-s112-text-2'}`}>
      {AMA_STATUS_LABEL[status] ?? status}
    </span>
  )
}

function datumDe(d: string | null | undefined): string {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' })
}

/** KAN-37 B: Download der beim Einreichen gespeicherten Datei (byte-gleich, mit SHA-256) */
function AbgabeKnopf({ version, csvErlaubt }: { version: AMAVersion; csvErlaubt: boolean }) {
  if (AMA_OFFEN.includes(version.status)) return null
  if (!version.abgabe) {
    return <span className="text-xs text-s112-muted">Keine gespeicherte Datei (vor dem 02.10.2026 eingereicht)</span>
  }
  if (!csvErlaubt) return null
  return (
    <span className="inline-flex flex-col gap-0.5">
      <CsvExportKnopf label="Abgegebene Datei (CSV)" href={csvPfad('erntemeldung', { abgabe: version.abgabe.id })} />
      <span className="text-[11px] text-s112-muted font-mono" title={version.abgabe.csv_sha256}>SHA-256 {version.abgabe.csv_sha256.slice(0, 16)}…</span>
    </span>
  )
}

function heuteIso(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' })
}

const knopfNeben = 'text-sm bg-s112-bg border border-s112-border hover:border-s112-teal text-s112-text-1 hover:text-s112-blue-700 px-4 py-2 rounded-lg transition-colors'
const knopfHaupt = 'bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50 transition-colors'

export default function AmaMeldungKarte({ jahrgangId, jahrgang, amaMeldung, stichtagHinweis, anzahlParzellen, csvErlaubt }: {
  jahrgangId: string; jahrgang: number | string
  /** neueste Version der Meldung (mit allen Versionen) */
  amaMeldung: AMAMeldung | null
  stichtagHinweis: string | null; anzahlParzellen: number; csvErlaubt: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  // offener Dialog: Einreichen bzw. AMA-Rückmeldung
  const [dialog, setDialog] = useState<'einreichen' | 'rueckmeldung' | null>(null)
  const [datum, setDatum] = useState(heuteIso())
  const [referenz, setReferenz] = useState('')
  const [rueckStatus, setRueckStatus] = useState<AmaZielStatus>('bestaetigt')

  const offen = amaMeldung ? AMA_OFFEN.includes(amaMeldung.status) : false
  const aeltere = (amaMeldung?.versionen ?? []).filter(v => v.id !== amaMeldung?.id)

  function ausfuehren(aktion: () => Promise<unknown>, meldung: string) {
    setFehler(null)
    startTransition(async () => {
      try {
        await aktion()
        setDialog(null)
      } catch (err) {
        setFehler(fehlerText(err, meldung))
      }
    })
  }

  function neuBerechnen() {
    if (!confirm('AMA-Meldung aus aktuellen Lesedaten aufbauen?')) return
    ausfuehren(() => createOrUpdateAMAMeldung(jahrgangId), 'Die AMA-Meldung konnte nicht aufgebaut werden.')
  }

  function dialogOeffnen(art: 'einreichen' | 'rueckmeldung') {
    setDatum(heuteIso())
    setReferenz(amaMeldung?.ama_referenznr ?? '')
    setRueckStatus('bestaetigt')
    setFehler(null)
    setDialog(art)
  }

  function statusSpeichern() {
    if (!amaMeldung) return
    const ziel: AmaZielStatus = dialog === 'einreichen' ? 'eingereicht' : rueckStatus
    ausfuehren(() => amaStatusSetzen(amaMeldung.id, jahrgangId, ziel, datum, referenz),
      'Der Status der AMA-Meldung konnte nicht gesetzt werden.')
  }

  function korrektur() {
    if (!amaMeldung) return
    if (!confirm(`Korrekturmeldung anlegen? Es entsteht Version ${amaMeldung.version + 1} als Entwurf; Version ${amaMeldung.version} bleibt unverändert erhalten.`)) return
    ausfuehren(() => amaKorrekturAnlegen(amaMeldung.id, jahrgangId), 'Die Korrekturmeldung konnte nicht angelegt werden.')
  }

  const fehlerBox = fehler && (
    <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-3 py-2 text-xs mb-3" data-print="hide">
      {fehler}
    </div>
  )

  return (
    <div className={`card ${pending ? 'opacity-60 pointer-events-none' : ''}`}>
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="text-base font-semibold text-s112-text">
          AMA Erntemeldung
          {amaMeldung && amaMeldung.version > 1 && <span className="ml-2 text-xs font-normal text-s112-muted">Korrektur · Version {amaMeldung.version}</span>}
        </h2>
        {amaMeldung && <StatusBadge status={amaMeldung.status} />}
      </div>

      {stichtagHinweis && (
        <p role="note" className="mb-3 rounded-lg border border-s112-warn/30 bg-s112-warn-bg px-3 py-2 text-xs text-s112-warn-fg">
          {stichtagHinweis}
        </p>
      )}

      {amaMeldung ? (
        <div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-s112-bg rounded-xl p-3">
              <p className="text-lg font-semibold text-s112-text">{(amaMeldung.gesamtmenge_kg == null ? undefined : fmtNum(amaMeldung.gesamtmenge_kg))} kg</p>
              <p className="text-xs text-s112-muted">Gesamtmenge</p>
            </div>
            <div className="bg-s112-bg rounded-xl p-3">
              <p className="text-lg font-semibold text-s112-text">{fmtProzent(amaMeldung.gesamtmenge_hl)} hl</p>
              <p className="text-xs text-s112-muted">Most (≈)</p>
            </div>
          </div>

          {(amaMeldung.eingereicht_am || amaMeldung.ama_referenznr) && (
            <dl className="grid grid-cols-3 gap-2 text-xs mb-4">
              <div><dt className="text-s112-muted">Eingereicht am</dt><dd className="text-s112-text-1">{datumDe(amaMeldung.eingereicht_am)}</dd></div>
              <div><dt className="text-s112-muted">AMA-Rückmeldung</dt><dd className="text-s112-text-1">{datumDe(amaMeldung.bestaetigt_am)}</dd></div>
              <div><dt className="text-s112-muted">Referenznummer</dt><dd className="text-s112-text-1">{amaMeldung.ama_referenznr ?? '–'}</dd></div>
            </dl>
          )}

          {amaMeldung.positionen.length > 0 && (
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="border-b border-s112-border text-xs text-s112-text-2">
                  <th className="text-left pb-1 font-semibold">Rebsorte</th>
                  <th className="text-right pb-1 font-semibold">Fläche (ha)</th>
                  <th className="text-right pb-1 font-semibold">Menge (kg)</th>
                </tr>
              </thead>
              <tbody>
                {amaMeldung.positionen.map((pos, i) => (
                  <tr key={i} className="border-b border-s112-border/40 last:border-0">
                    <td className="py-1.5">{formatRebsorteMitKuerzel(pos.rebsorte_name)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtHa(pos.flaeche_ha)}</td>
                    <td className="py-1.5 text-right tabular-nums">{(pos.menge_kg == null ? undefined : fmtNum(pos.menge_kg)) ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {amaMeldung.abweichungen.length > 0 && (
            <div role="note" className="mb-3 rounded-lg border border-s112-warn/30 bg-s112-warn-bg px-3 py-2 text-xs text-s112-warn-fg">
              <p className="font-semibold">
                {offen ? 'Die Lesedaten haben sich seit der Berechnung geändert – bitte „Neu berechnen“.'
                  : `Die Lesedaten weichen von der ${AMA_STATUS_LABEL[amaMeldung.status]?.toLowerCase() ?? ''} Meldung ab – bitte eine Korrekturmeldung anlegen.`}
              </p>
              <ul className="mt-1 list-disc pl-4">
                {amaMeldung.abweichungen.map(a => (
                  <li key={a.rebsorte}>
                    {formatRebsorteMitKuerzel(a.rebsorte)}: gemeldet {fmtNum(a.gemeldetKg)} kg, Lesedaten {fmtNum(a.aktuellKg)} kg
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!offen && (
            <p role="note" className="mb-3 text-xs text-s112-muted" data-print="hide">
              Die Meldung ist {AMA_STATUS_LABEL[amaMeldung.status]?.toLowerCase() ?? amaMeldung.status} und bleibt unverändert.
              Änderungen an den Lesedaten gehen als Korrekturmeldung (neue Version) an die AMA.
            </p>
          )}

          {fehlerBox}

          {amaMeldung.n8n_fehler && (
            <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-3 py-2 text-xs mb-3">
              Fehler: {amaMeldung.n8n_fehler}
            </div>
          )}

          {dialog && (
            <div className="mb-3 rounded-xl border border-s112-border bg-s112-bg p-3 space-y-3" data-print="hide">
              <p className="text-sm font-semibold text-s112-text">
                {dialog === 'einreichen' ? 'Als bei der AMA eingereicht markieren' : 'Rückmeldung der AMA erfassen'}
              </p>
              <div className="flex flex-wrap gap-3 items-end">
                {dialog === 'rueckmeldung' && (
                  <label className="text-xs text-s112-text-2">
                    Ergebnis
                    <select value={rueckStatus} onChange={e => setRueckStatus(e.target.value as AmaZielStatus)}
                      className="mt-1 block border border-s112-border rounded-lg px-2 py-1.5 text-sm bg-white">
                      <option value="bestaetigt">Bestätigt</option>
                      <option value="abgelehnt">Abgelehnt</option>
                    </select>
                  </label>
                )}
                <label className="text-xs text-s112-text-2">
                  {dialog === 'einreichen' ? 'Eingereicht am' : 'Rückmeldung vom'}
                  <input type="date" value={datum} max={heuteIso()} onChange={e => setDatum(e.target.value)}
                    className="mt-1 block border border-s112-border rounded-lg px-2 py-1.5 text-sm bg-white" />
                </label>
                <label className="text-xs text-s112-text-2">
                  Referenznummer (optional)
                  <input type="text" value={referenz} maxLength={80} onChange={e => setReferenz(e.target.value)}
                    className="mt-1 block border border-s112-border rounded-lg px-2 py-1.5 text-sm bg-white" />
                </label>
              </div>
              {dialog === 'einreichen' && (
                <p className="text-xs text-s112-muted">Danach bleibt die Meldung unverändert; Korrekturen gehen als neue Version. Die Erntemeldung wird dabei als Datei (CSV mit SHA-256) gespeichert und bleibt so abrufbar, wie sie abgegeben wurde.</p>
              )}
              <div className="flex gap-2">
                <button onClick={statusSpeichern} disabled={!datum} className={knopfHaupt}>Speichern</button>
                <button onClick={() => setDialog(null)} className={knopfNeben}>Abbrechen</button>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 flex-wrap" data-print="hide">
            {offen && <button onClick={neuBerechnen} className={knopfNeben}>Neu berechnen</button>}
            {amaMeldung.status === 'bereit' && !dialog && (
              <button onClick={() => dialogOeffnen('einreichen')} className={knopfNeben}>Als eingereicht markieren</button>
            )}
            {amaMeldung.status === 'eingereicht' && !dialog && (
              <button onClick={() => dialogOeffnen('rueckmeldung')} className={knopfNeben}>AMA-Rückmeldung erfassen</button>
            )}
            {!offen && !dialog && (
              <button onClick={korrektur} className={knopfNeben}>Korrekturmeldung anlegen</button>
            )}
            {csvErlaubt && (
              <CsvExportKnopf label={offen ? 'Erntemeldung als CSV' : 'Aktuelle Daten als CSV'} href={csvPfad('erntemeldung', { jahrgang: String(jahrgang) })} />
            )}
            <AbgabeKnopf version={amaMeldung} csvErlaubt={csvErlaubt} />
          </div>

          {aeltere.length > 0 && (
            <details className="mt-4 text-xs">
              <summary className="cursor-pointer text-s112-blue-700 hover:underline">Frühere Versionen ({aeltere.length})</summary>
              <table className="w-full mt-2">
                <thead>
                  <tr className="border-b border-s112-border text-s112-text-2">
                    <th className="text-left pb-1 font-semibold">Version</th>
                    <th className="text-left pb-1 font-semibold">Status</th>
                    <th className="text-left pb-1 font-semibold">Eingereicht</th>
                    <th className="text-left pb-1 font-semibold">Rückmeldung</th>
                    <th className="text-left pb-1 font-semibold">Referenz</th>
                    <th className="text-right pb-1 font-semibold">Menge (kg)</th>
                    <th className="text-left pb-1 pl-3 font-semibold">Abgegebene Datei</th>
                  </tr>
                </thead>
                <tbody>
                  {aeltere.map(v => (
                    <tr key={v.id} className="border-b border-s112-border/40 last:border-0">
                      <td className="py-1">{v.version}</td>
                      <td className="py-1">{AMA_STATUS_LABEL[v.status] ?? v.status}</td>
                      <td className="py-1">{datumDe(v.eingereicht_am)}</td>
                      <td className="py-1">{datumDe(v.bestaetigt_am)}</td>
                      <td className="py-1">{v.ama_referenznr ?? '–'}</td>
                      <td className="py-1 text-right tabular-nums">{v.gesamtmenge_kg == null ? '–' : fmtNum(v.gesamtmenge_kg)}</td>
                      <td className="py-1 pl-3"><AbgabeKnopf version={v} csvErlaubt={csvErlaubt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      ) : (
        <div>
          <p className="text-sm text-s112-muted mb-4" data-print="hide">
            Lesedaten aus {anzahlParzellen} Parzellen zu AMA-Meldung aggregieren.
          </p>
          {fehlerBox}
          <button onClick={neuBerechnen} disabled={anzahlParzellen === 0} data-print="hide" className={knopfHaupt}>
            AMA-Meldung erstellen
          </button>
        </div>
      )}
    </div>
  )
}
