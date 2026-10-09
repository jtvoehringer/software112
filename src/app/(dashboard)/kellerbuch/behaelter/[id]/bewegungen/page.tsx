// behoerdenmeldung: bewegungsbuch
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { fmtLiter } from '@/lib/format'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import { manuellSchwundBuchen } from '../../../actions'
import AktionsFormular from '@/components/ui/AktionsFormular'
import { Boxes, Droplet } from 'lucide-react'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeBewegungsbuch, stornoText } from '@/lib/behoerden/bewegungsbuch'
import { istTag, zeitraumAnzeige } from '@/lib/behoerden/kellerbuch-hilfen'
import { wienHeute } from '@/lib/csv'
import DruckKnopf from '../../../_behoerden/DruckKnopf'
import ZeitraumFormular from '../../../_behoerden/ZeitraumFormular'
import { rundText } from '@/lib/zahl/runden'

export const metadata: Metadata = { title: 'Bewegungsbuch – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Die Ereignislogik (Zu-/Abgänge, Saldo, Kennzahlen) liegt seit 24.09.2026 in
// lib/behoerden/bewegungsbuch.ts – dieselbe Ladefunktion liefert die CSV
// (/meldungen/bewegungsbuch/csv). Zeitraum über ?von=&bis= (mit Übertrag-Zeile).
export default async function BehaelterBewegungsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ von?: string; bis?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const von = sp.von && istTag(sp.von) ? sp.von : null
  const bisRoh = sp.bis && istTag(sp.bis) ? sp.bis : null
  const bis = von && bisRoh && bisRoh < von ? null : bisRoh

  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role, 'kellerbuch')
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  if (!tenantId) notFound()

  // Eigenes oder freigegebenes Gebinde (Kellergemeinschaft, Migration 203) – die
  // Bewegungen darunter bleiben auf den eigenen Betrieb beschränkt.
  const bb = await ladeBewegungsbuch(supabase, tenantId, { behaelterId: id, von, bis })
  if (!bb) notFound()
  const bh = { ...bb.behaelter, name: bb.behaelter.anzeigeName }
  const { zeitraum: bewegungenMitSaldo, aktiveChargen, literByCharge, finalSaldo, gebuchterBestand, nichtVerbuchterSchwund, aktuell } = bb
  const chargenRaw = bb.chargen

  const kapazitaet = bh.volumen_liter ? bh.volumen_liter : null
  const auslastung = kapazitaet && kapazitaet > 0 ? Math.min(100, (aktuell / kapazitaet) * 100) : null
  const inputCls = 'border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'
  const mitZeitraum = !!(von || bis)
  const endSaldo = bewegungenMitSaldo.length > 0 ? bewegungenMitSaldo[bewegungenMitSaldo.length - 1].saldo : 0

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center gap-2 text-sm text-s112-muted print:hidden">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{bh.name}</span>
        <span>/</span>
        <span className="text-s112-text-2">Bewegungsbuch</span>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <Boxes className="w-7 h-7 mt-0.5 text-s112-muted print:hidden" />
          <div>
            <h1 className="text-2xl font-semibold text-s112-text">{bh.name}</h1>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-s112-muted">
              {bh.standort && <span>{bh.standort}</span>}
              {kapazitaet && <span>{fmtLiter(kapazitaet)} Kapazität</span>}
              <span className="hidden print:inline">Bewegungsbuch · {zeitraumAnzeige({ von, bis })} · Stand {wienHeute().split('-').reverse().join('.')}</span>
            </div>
            {aktuell < 0 && (
              <div className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-s112-err-bg border border-s112-err/30 rounded-lg text-s112-err-fg text-xs font-medium">
                Negativer Bestand: {fmtLiter(aktuell)} — Buchungsfehler prüfen
              </div>
            )}
            {auslastung !== null && (
              <div className="mt-2 flex items-center gap-2">
                <div className="w-36 bg-s112-line rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${aktuell < 0 ? 'bg-s112-err' : auslastung > 90 ? 'bg-s112-warn' : 'bg-s112-teal'}`}
                    style={{ width: `${Math.max(0, Math.min(100, auslastung))}%` }}
                  />
                </div>
                <span className={`text-xs tabular-nums ${aktuell < 0 ? 'text-s112-err-fg font-semibold' : 'text-s112-text-2'}`}>
                  {fmtLiter(aktuell)} / {fmtLiter(kapazitaet)}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 print:hidden">
          {writeOk && (
            <>
              <Link href={`/kellerbuch/umziehen?neu=1&von=${id}`}   /* KAN-174 B: Quelle vorbelegt */
                className="text-xs border border-s112-teal text-s112-blue-700 px-3 py-1.5 rounded-lg hover:bg-s112-teal/5 font-medium">
                Umziehen
              </Link>
              <Link href={`/kellerbuch/behaelter/${id}`}
                className="text-xs text-s112-muted border border-s112-line px-3 py-1.5 rounded-lg hover:border-s112-teal hover:text-s112-blue-700">
                Bearbeiten
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto sm:overflow-visible whitespace-nowrap border-b border-s112-border print:hidden">
        <span className="px-4 py-2 text-sm font-medium text-s112-blue-700 border-b-2 border-s112-teal -mb-px">
          Bewegungsbuch
        </span>
        <Link href={`/kellerbuch/behaelter/${id}/umzuege`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-s112-text-1 border-b-2 border-transparent hover:border-s112-line-str -mb-px transition-colors">
          Umziehen
        </Link>
        <Link href={`/kellerbuch/behaelter/${id}/behandlungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-s112-text-1 border-b-2 border-transparent hover:border-s112-line-str -mb-px transition-colors">
          Kellerbehandlungen
        </Link>
      </div>

      {aktiveChargen.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-s112-text-2 uppercase tracking-wide mb-2">Aktuelle Chargen</h2>
          <div className="flex flex-wrap gap-2">
            {aktiveChargen.map((c: R) => (
              <Link key={c.id} href={`/kellerbuch/weinausbau/${c.id}`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-s112-border bg-white hover:border-s112-teal hover:shadow-xs transition-all text-sm">
                <span className="font-medium text-s112-text">{c.name}</span>
                {c.jahrgang && <span className="text-xs text-s112-muted">{c.jahrgang}</span>}
                <span className="text-xs font-semibold text-s112-blue-700 tabular-nums">
                  {fmtLiter(Math.max(0, literByCharge[c.id] ?? (parseFloat(c.menge_liter) || 0)))}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {writeOk && nichtVerbuchterSchwund >= 0.01 && chargenRaw.length > 0 && (
        <section className="card p-5 border-s112-warn/30 bg-s112-warn-bg space-y-3 print:hidden">
          <div className="flex items-start gap-2">
            <Droplet className="w-5 h-5 text-s112-warn-fg shrink-0" />
            <div>
              <p className="text-sm font-semibold text-s112-warn-fg">Schwund ausbuchen (Nachbuchung)</p>
              <p className="text-xs text-s112-warn-fg mt-0.5">
                Laut Bewegungsbuch sind noch <strong>{fmtLiter(finalSaldo)}</strong> im Gebinde, gebucht
                sind <strong>{fmtLiter(gebuchterBestand)}</strong> – also{' '}
                <strong>{fmtLiter(nichtVerbuchterSchwund)}</strong> nicht verbuchter Schwund. Hier kann die
                Differenz als datierte Schwundzeile nachgebucht werden; der Bestand der Charge ändert sich
                dabei nicht. Echten Schwund einer Charge bitte über „Schwund buchen“ auf der Chargen-Seite erfassen.
              </p>
            </div>
          </div>
          <AktionsFormular action={manuellSchwundBuchen} className="grid grid-cols-2 gap-3 items-end sm:flex sm:flex-wrap"
            erfolgsMeldung="Schwund nachgebucht." fehlerErsatz="Schwund konnte nicht gebucht werden">
            <input type="hidden" name="behaelter_id" value={id} />
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Charge</label>
              <select aria-label="Charge" name="weinausbau_id" required className={`w-full sm:w-auto ${inputCls}`}>
                {chargenRaw.map((c: R) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.jahrgang ? ` (${c.jahrgang})` : ''}{!c.aktiv ? ' abgeschlossen' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge (L)</label>
              <input aria-label="Menge (L)"
                name="menge"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max={rundText(nichtVerbuchterSchwund, 2)}
                defaultValue={rundText(nichtVerbuchterSchwund, 2)}
                required
                className={`w-full sm:w-28 ${inputCls}`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum</label>
              <input aria-label="Datum"
                name="datum"
                type="date"
                defaultValue={wienHeute()}
                required
                className={`w-full sm:w-auto ${inputCls}`}
              />
            </div>
            <button
              type="submit"
              className="col-span-2 sm:col-span-1 w-full sm:w-auto bg-s112-warn-fg text-white px-4 py-3 sm:py-2 rounded-lg text-base sm:text-sm font-semibold hover:opacity-90 transition-colors"
            >
              Schwund nachbuchen
            </button>
          </AktionsFormular>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-s112-text">Bewegungsbuch</h2>
            <p className="text-xs text-s112-muted mt-0.5 print:hidden">{zeitraumAnzeige({ von, bis })}</p>
          </div>
          <div className="flex items-start gap-2 print:hidden">
            <DruckKnopf />
            <CsvExportKnopf href={csvPfad('bewegungsbuch', { behaelter: id, von, bis })} />
          </div>
        </div>
        <ZeitraumFormular von={von} bis={bis} zuruecksetzen={`/kellerbuch/behaelter/${id}/bewegungen`} />
        {bb.warnungen.length > 0 && (
          <ul className="text-xs text-s112-warn-fg list-disc pl-4 space-y-0.5">
            {bb.warnungen.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Vorgang</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Menge</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {bewegungenMitSaldo.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs text-s112-muted italic">
                    {mitZeitraum ? 'Keine Bewegungen in diesem Zeitraum' : 'Noch keine Bewegungen für dieses Gebinde erfasst'}
                  </td>
                </tr>
              ) : (
                bewegungenMitSaldo.map((bew, i) => {
                  const istUebertrag = bew.art === 'uebertrag'
                  const istAbgang    = bew.menge < 0
                  const istZugang    = bew.menge > 0
                  const istNeutral   = bew.menge === 0
                  const colorClass   = istAbgang ? 'text-s112-err-fg' : istZugang ? 'text-s112-ok-fg' : 'text-s112-tertiary'
                  const isZugangsRow = bew.art === 'anfangsbestand' || bew.art === 'zukauf' || bew.art === 'pressung' || bew.art === 'umzug_ein' || bew.art === 'filtration_ein'
                  const isBehandlung = bew.art === 'behandlung'
                  const rowBg        = istUebertrag ? 'bg-s112-bg' : isZugangsRow ? 'bg-s112-ok-bg/50' : isBehandlung ? 'bg-s112-blue-50/30' : (i % 2 === 1 ? 'bg-s112-bg/30' : '')
                  return (
                    <tr key={i} className={`border-b border-s112-border/30 last:border-0 ${rowBg}`}>
                      <td className="px-4 py-2.5 text-xs text-s112-text-2 whitespace-nowrap">
                        {bew.datum ? bew.datum.split('-').reverse().join('.') : '-'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-start gap-1.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className={istUebertrag ? 'text-s112-text-1 font-medium' : 'text-s112-text-1'}>{bew.beschreibung}</p>
                              {writeOk && bew.fuellung_id && (
                                <Link
                                  href={`/weinhandel/fuellungen/${bew.fuellung_id}/edit`}
                                  className="text-[11px] text-s112-blue-700 hover:underline shrink-0 print:hidden"
                                >
                                  Bearbeiten
                                </Link>
                              )}
                            </div>
                            {bew.extra && <p className="text-xs text-s112-muted">{bew.extra}</p>}
                            {/* KAN-145: stornierte Buchung bzw. ihre Gegenbuchung kennzeichnen */}
                            {stornoText(bew) && (
                              <p className="text-[11px] font-medium text-s112-warn-fg">{stornoText(bew)}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${colorClass}`}>
                        {istNeutral
                          ? <span className="text-s112-tertiary">-</span>
                          : <span>{istAbgang ? '' : '+'}{fmtLiter(bew.menge)}</span>
                        }
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${bew.saldo < 0 ? 'text-s112-err-fg font-semibold' : 'text-s112-text-1'}`}>
                        {istNeutral && !istUebertrag ? '' : fmtLiter(bew.saldo)}
                      </td>
                    </tr>
                  )
                })
              )}
              {mitZeitraum && bis && (
                <tr className="border-t border-s112-border">
                  <td colSpan={2} className="px-4 py-2.5 text-sm text-s112-text-1">
                    Saldo am {bis.split('-').reverse().join('.')}
                  </td>
                  <td className="px-4 py-2.5 text-right" />
                  <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${endSaldo < 0 ? 'text-s112-err-fg' : 'text-s112-text-1'}`}>
                    {fmtLiter(endSaldo)}
                  </td>
                </tr>
              )}
              <tr className={`border-t-2 ${aktuell < 0 ? 'border-s112-err/50 bg-s112-err-bg/50' : 'border-s112-teal/30 bg-s112-teal/5'}`}>
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-s112-text-1 text-sm">
                  Aktueller Bestand
                </td>
                <td className="px-4 py-2.5 text-right" />
                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold text-base ${aktuell < 0 ? 'text-s112-err-fg' : 'text-s112-blue-700'}`}>
                  {fmtLiter(aktuell)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
