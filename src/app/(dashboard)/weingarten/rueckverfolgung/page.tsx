// behoerdenmeldung: rueckverfolgung-weingarten
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { AlertTriangle, Leaf, Search } from 'lucide-react'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { wienHeute } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import { BEHANDLUNG_ART_LABEL, massnahmeMittel, massnahmeZeitraum } from '@/lib/behoerden/rueckverfolgung'
import { fensterBeginnText, ttmmjjjj } from '@/lib/behoerden/rueckverfolgungFenster'
import {
  AMPEL_TEXT, QUELLE_TEXT, einstiegFehler, ladeRvWeingarten, massnahmeWartezeit,
  type RvEinstieg, type RvErgebnis, type WartezeitAmpel,
} from '@/lib/behoerden/rv-weingarten'
import RueckverfolgungPrintButton from '@/app/(dashboard)/kellerbuch/rueckverfolgung/PrintButton'

export const metadata: Metadata = { title: 'Rückverfolgung Weingarten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuid(v: string | undefined): string | null {
  const t = v?.trim() ?? ''
  return UUID.test(t) ? t.toLowerCase() : null
}

const AMPEL_KLASSE: Record<WartezeitAmpel, string> = {
  eingehalten: 'bg-s112-ok-bg text-s112-ok-fg border-s112-ok/30',
  verletzt: 'bg-s112-err-bg text-s112-err-fg border-s112-err/30',
  pruefen: 'bg-s112-warn-bg text-s112-warn-fg border-s112-warn/30',
}

type Suche = { jahrgang?: string; gst?: string; weingarten?: string; lese?: string; charge?: string; fuellung?: string }

export default async function RiedenRueckverfolgungPage({ searchParams }: { searchParams: Promise<Suche> }) {
  const sp = await searchParams
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  // Einstieg: Lese, Charge oder Füllung (Links aus Lese, Kellerbuch und Warenlager) – sonst Jahrgang
  // (Standard: laufendes Jahr) mit optionalem Grundstück
  const direkt = !!(sp.lese || sp.charge || sp.fuellung)
  const jahrgangRoh = sp.jahrgang?.trim() ?? ''
  // „alle“ (leerer Jahrgang) nur zusammen mit einem Grundstück – sonst meldet einstiegFehler die fehlende Auswahl
  const jahrgang = /^\d{4}$/.test(jahrgangRoh) ? Number(jahrgangRoh)
    : direkt || sp.gst || sp.jahrgang !== undefined ? null : Number(wienHeute().slice(0, 4))
  const einstieg: RvEinstieg = {
    lese: uuid(sp.lese), charge: uuid(sp.charge), fuellung: uuid(sp.fuellung),
    gst: direkt ? null : uuid(sp.gst), weingarten: direkt ? null : uuid(sp.weingarten),
    jahrgang: direkt ? null : jahrgang,
  }
  const fehler = einstiegFehler(einstieg)
  const ergebnis: RvErgebnis | null = tenantId && !fehler ? await ladeRvWeingarten(supabase, tenantId, einstieg) : null

  // Auswahllisten: Jahrgänge und Grundstücke des Betriebs
  const [jgRes, gstRes] = tenantId
    ? await Promise.all([
        (supabase.from('weinjahrgaenge') as R).select('jahrgang').eq('tenant_id', tenantId).order('jahrgang', { ascending: false }),
        (supabase.from('grundstuecke') as R).select('id, gst_nr, katastralgemeinde, weingarten_id, weingarten:weingarten_id(name)').eq('tenant_id', tenantId).order('gst_nr'),
      ])
    : [{ data: [] }, { data: [] }]
  const jahrgaenge = [...new Set(((jgRes.data ?? []) as R[]).map(j => Number(j.jahrgang)))]
  const grundstuecke = ((gstRes.data ?? []) as R[])
    .map(g => ({ id: String(g.id), weingartenId: g.weingarten_id ? String(g.weingarten_id) : null, text: `${(g.weingarten as R | null)?.name ?? '–'} · GST ${g.gst_nr ?? '?'}${g.katastralgemeinde ? ` (KG ${g.katastralgemeinde})` : ''}` }))
    .sort((a, b) => a.text.localeCompare(b.text, 'de-AT'))

  const csvParameter: Record<string, string | number | null> = {
    lese: einstieg.lese, charge: einstieg.charge, fuellung: einstieg.fuellung,
    gst: einstieg.gst, weingarten: einstieg.weingarten, jahrgang: einstieg.jahrgang,
  }
  const lesen = ergebnis?.lesen ?? []
  const inputCls = 'w-full border border-s112-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <nav className="flex items-center gap-2 text-sm text-s112-muted mb-4 print:hidden">
          <Link href="/weingarten" className="hover:text-s112-blue-700">Rieden</Link>
          <span>/</span>
          <span className="text-s112-text font-medium">Rückverfolgung</span>
        </nav>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-s112-text flex items-center gap-2">
              <Search className="w-5 h-5" />Rückverfolgung Weingarten
            </h1>
            <p className="text-sm text-s112-muted mt-1">
              Je Lese-Grundstück die Maßnahmen „von Ernte bis Ernte“ mit Wartezeitprüfung der Pflanzenschutzmittel
              {ergebnis?.titel ? ` – ${ergebnis.titel}` : ''}. Weiter zum Keller:{' '}
              <Link href="/kellerbuch/rueckverfolgung" className="underline">Rückverfolgung Kellerbuch</Link>.
            </p>
          </div>
          {ergebnis && (
            <div className="flex items-center gap-2 print:hidden">
              <RueckverfolgungPrintButton />
              <CsvExportKnopf href={csvPfad('rueckverfolgung-weingarten', csvParameter)} />
            </div>
          )}
        </div>
      </div>

      {/* Auswahl: Jahrgang und Grundstück (GET) */}
      {!direkt ? (
        <form method="get" className="card p-4 grid grid-cols-1 sm:grid-cols-[10rem_1fr_auto] gap-3 items-end print:hidden">
          <div>
            <label htmlFor="rv-jahrgang" className={labelCls}>Jahrgang</label>
            <select id="rv-jahrgang" name="jahrgang" defaultValue={einstieg.jahrgang ?? ''} className={inputCls}>
              <option value="">alle</option>
              {jahrgaenge.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rv-gst" className={labelCls}>Grundstück</label>
            <select id="rv-gst" name="gst" defaultValue={einstieg.gst ?? ''} className={inputCls}>
              <option value="">alle Grundstücke</option>
              {grundstuecke.map(g => <option key={g.id} value={g.id}>{g.text}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-primary px-4 py-2 text-sm rounded-xl">Anzeigen</button>
        </form>
      ) : (
        <p className="text-sm print:hidden">
          <Link href="/weingarten/rueckverfolgung" className="underline text-s112-text-2">Andere Auswahl (Jahrgang, Grundstück)</Link>
        </p>
      )}

      {fehler && <p className="text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{fehler}</p>}
      {!fehler && tenantId && !ergebnis && (
        <p className="text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">Lese, Charge oder Füllung nicht gefunden.</p>
      )}

      {ergebnis && ergebnis.warnungen.map((w, i) => (
        <p key={i} className="text-sm text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span>{w}</span>
        </p>
      ))}

      {ergebnis && lesen.length === 0 && (() => {
        // Rückmeldung 30.09.2026: statt nur „Keine Lese erfasst.“ erklären, dass die Rückverfolgung bei der Lese
        // beginnt, und auf den Maßnahmen-Verlauf des Grundstücks verweisen
        const gst = einstieg.gst ? grundstuecke.find(g => g.id === einstieg.gst) : null
        const jahr = einstieg.jahrgang ? `im Jahrgang ${einstieg.jahrgang} ` : ''
        return (
          <div className="text-sm text-s112-muted space-y-1">
            <p>
              {gst ? <>Für <span className="text-s112-text">{gst.text}</span> ist {jahr}keine Lese erfasst.</> : <>Es ist {jahr}keine Lese erfasst.</>}
              {' '}Die Rückverfolgung „von Ernte bis Ernte“ geht von der Lese aus und zeigt die Maßnahmen, sobald die Lese erfasst ist.
            </p>
            {gst?.weingartenId && (
              <p>
                Die bisherigen Maßnahmen stehen im{' '}
                <Link href={`/weingarten/${gst.weingartenId}`} className="underline hover:text-s112-text">Maßnahmen-Verlauf der Ried</Link>
                {' '}(Grundstück aufklappen).
              </p>
            )}
          </div>
        )
      })()}

      {lesen.map(l => (
        <div key={l.leseId} className="card p-5 space-y-3 break-inside-avoid">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold text-s112-text flex items-center gap-2">
              <Leaf className="w-4 h-4" />
              {l.weingarten ?? (l.quelle === 'pressung' ? 'Traubenzukauf / Weingarten unbekannt' : 'Weingarten unbekannt')}
              {l.gstNr ? ` · GST ${l.gstNr}` : ''}
            </h2>
            <span className="text-xs text-s112-muted">
              {[
                QUELLE_TEXT[l.quelle],
                l.leseText,
                l.katastralgemeinde ? `KG ${l.katastralgemeinde}` : null,
                l.feldstueck ? `Feldstück ${l.feldstueck}` : null,
                l.rebsorte,
              ].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="text-xs text-s112-text-2 flex flex-wrap gap-x-4 gap-y-0.5 tabular-nums">
            <span>Lese {l.lesedatum ? ttmmjjjj(l.lesedatum) : l.fenster?.bisAus === 'erntemeldung' ? `${ttmmjjjj(l.fenster.bis)} (laut Erntemeldung)` : '–'}</span>
            {l.kg !== null && <span>{fmtNum(l.kg)} kg</span>}
            {l.kmw !== null && <span>{fmtNum(l.kmw)} °KMW</span>}
            {l.abnehmer && <span>Abnehmer: {l.abnehmer}</span>}
            {l.liefernummer && <span>Liefernummer: {l.liefernummer}</span>}
            {l.anteilPct !== null && <span>Anteil an der Füllung: {fmtNum(l.anteilPct)} %</span>}
          </div>
          {l.fenster && (
            <div className="text-xs text-s112-muted">
              Zeitfenster {ttmmjjjj(l.fenster.von)} – {ttmmjjjj(l.fenster.bis)} ({fensterBeginnText(l.fenster)})
            </div>
          )}
          {l.hinweise.length > 0 && (
            <div className="text-xs bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-lg px-3 py-1.5">
              {l.hinweise.join(' ')}
            </div>
          )}
          {l.massnahmen.length === 0 ? (
            <p className="text-xs text-s112-muted italic">Keine Maßnahmen im Zeitfenster erfasst.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-s112-muted border-b border-s112-border">
                    <th className="py-1.5 pr-3 font-medium">Datum</th>
                    <th className="py-1.5 pr-3 font-medium">Maßnahme / Mittel</th>
                    <th className="py-1.5 pr-3 font-medium">Reg.-Nr.</th>
                    <th className="py-1.5 pr-3 font-medium">Aufwand</th>
                    <th className="py-1.5 pr-3 font-medium">Menge anteilig</th>
                    <th className="py-1.5 pr-3 font-medium">Wartezeit</th>
                    <th className="py-1.5 font-medium">Frühester Lesetermin</th>
                  </tr>
                </thead>
                <tbody>
                  {l.massnahmen.map(m => {
                    const b = m.behandlung
                    const psm = b.psm as R | null
                    const w = massnahmeWartezeit(m, l.fenster)
                    return (
                      <tr key={b.id} className="border-b border-s112-border/40 last:border-0 align-top">
                        <td className="py-1.5 pr-3 text-xs tabular-nums whitespace-nowrap">{massnahmeZeitraum(b)}</td>
                        <td className="py-1.5 pr-3">
                          <span className="font-medium text-s112-text">{massnahmeMittel(b)}</span>
                          {psm && <span className="text-xs text-s112-muted ml-1">({BEHANDLUNG_ART_LABEL[b.art] ?? b.art})</span>}
                          {(m.nurWeingarten || !l.lese.grundstueck_id) && (
                            <div className="text-xs text-s112-muted">
                              {m.nurWeingarten ? 'nur am Weingarten erfasst (ohne Grundstück)' : `GST ${m.grundstuecke.join(', ')}`}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-xs">{psm?.zulassungsnr ?? '–'}</td>
                        <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{b.aufwandmenge != null ? `${fmtNum(Number(b.aufwandmenge))} ${b.aufwandmenge_einheit ?? ''}`.trim() : '–'}</td>
                        <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{m.menge != null ? `${fmtNum(m.menge)} ${m.mengeEinheit ?? ''}`.trim() : '–'}</td>
                        <td className="py-1.5 pr-3 text-xs">{psm?.wartezeit_tage != null ? `${psm.wartezeit_tage} Tage` : '–'}</td>
                        <td className="py-1.5 text-xs">
                          {w.fruehester ? <span className="tabular-nums mr-2">{ttmmjjjj(w.fruehester)}</span> : '–'}
                          {w.ampel && (
                            <span className={`inline-block border rounded-full px-2 py-0.5 text-[11px] font-medium ${AMPEL_KLASSE[w.ampel]}`}>
                              {AMPEL_TEXT[w.ampel]}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
