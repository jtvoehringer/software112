// behoerdenmeldung: bsm, bsm-kontrolljournal
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import Image from 'next/image'
import PrintButton from '../../PrintButton'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import {
  BSM_INTERNE_ARTEN, BSM_SPALTEN, BSM_ZUORDNUNG, HERKUNFT_LABEL, HL_STELLEN_BSM, SPALTE_OHNE_LABEL,
  bsmJournal, bsmKennzeichnung, bsmParameter, bsmSchnellwahlen, buchungsartLabel, ladeBsm, standardBsmZeitraum,
  type BsmSummenZeile, type SpalteSchluessel,
} from '@/lib/behoerden/bsm'
import { KAT_BUCHUNGSART } from '@/lib/katalog/bki'
import { istParameterFehler } from '@/lib/behoerden/typen'
import { datumAT } from '@/lib/behoerden/ernte_hilfen'
import { fmtNum } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import { ladeKonzentratBestaende } from '@/lib/behoerden/besondereKonten'
import { AktionsFehler } from '@/lib/fehler'

export const metadata: Metadata = { title: 'Bestandsmeldung (BSM) – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Weinbestandsmeldung nach Buchungsarten (KAN-43 Etappe 2, Pflichtmeldung, reports/(pflicht)/layout.tsx).
// Eigene Seite statt eines weiteren Abschnitts auf /reports/ama: anderer Parameter (Meldezeitraum von–bis statt
// Stichtag/Jahrgang), eigener Filter (Kontrolljournal nach Buchungsart) und ein Ausdruck, der für sich steht; die
// Stichtagsliste (Etappe 1) bleibt auf /reports/ama und ist hier der Abgleich („Bestand zum Stichtag“).
// Druck und CSV (/meldungen/bsm/csv, /meldungen/bsm-kontrolljournal/csv) kommen aus ladeBsm() – dieselben Zeilen.
// Entscheidung Jörgen 02.10.2026: BSM = 1.8.–31.7.; Kalenderjahr nur als zusätzliche Auswertung (Schnellwahl).

const wert = (n: number) => (Math.abs(n) < 0.005 ? '–' : fmtNum(n, 2))

const ABWERTUNG = 'ZU_ABW,AB_ABW'
/** Buchungsarten des Kontrolljournals: Katalog (kat_buchungsart) + interne (Umstufung Most/Sturm → Wein) */
const ARTEN = [...KAT_BUCHUNGSART, ...BSM_INTERNE_ARTEN]
const ABSCHNITT_TITEL: Partial<Record<BsmSummenZeile['abschnitt'], string>> = { Zugang: 'Zugänge', Abgang: 'Abgänge', Umstufung: 'Umstufung (neutral)' }

export default async function BsmPage({ searchParams }: { searchParams: Promise<{ von?: string; bis?: string; art?: string }> }) {
  const sp = await searchParams
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!membership || !tenantId) {
    return <div className="card p-10 text-center text-s112-muted text-sm">Nicht angemeldet.</div>
  }

  const heute = wienHeute()
  const pruefung = bsmParameter(new URLSearchParams({ von: sp.von ?? '', bis: sp.bis ?? '', art: sp.art ?? '' }), heute)
  const fehler = istParameterFehler(pruefung) ? pruefung.fehler : null
  const p = istParameterFehler(pruefung) ? { ...standardBsmZeitraum(heute), arten: [] as string[] } : pruefung
  const zeitraum = { von: p.von, bis: p.bis }

  const [daten, { data: settingsRaw, error: stFehler }, konzentrate] = await Promise.all([
    ladeBsm(supabase, tenantId, zeitraum, { heute }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, betrieb_betriebsnummer, logo_url')
      .eq('tenant_id', tenantId).maybeSingle(),
    // KAN-45: § 29 Abs. 3 WG – Bestände an KTM/RTK zum Stichtag aus dem Stoffkonto (nachrichtlich)
    ladeKonzentratBestaende(supabase, tenantId, p.bis),
  ])
  if (stFehler) throw new AktionsFehler(`Betriebsdaten konnten nicht geladen werden: ${stFehler.message}`)
  const s = (settingsRaw as R | null) ?? {}
  const journal = bsmJournal(daten, p.arten)
  const spalten: SpalteSchluessel[] = daten.spalten
  const spaltenLabel = (k: SpalteSchluessel) => (k === 'ohne' ? SPALTE_OHNE_LABEL : BSM_SPALTEN.find(x => x.key === k)?.label ?? k)
  const zeitraumParam = { von: p.von, bis: p.bis }
  const artText = p.arten.length === 0 ? 'alle Buchungsarten' : p.arten.join(', ') === ABWERTUNG.replace(',', ', ') ? 'nur Abwertung' : p.arten.map(buchungsartLabel).join(', ')

  return (
    <div className="max-w-6xl space-y-4">
      {/* Brotkrume + Aktionen */}
      <div className="flex items-start justify-between gap-4 flex-wrap print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted mt-1.5">
          <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link>
          <span>/</span>
          <span className="font-medium text-s112-text">Bestandsmeldung (BSM)</span>
        </nav>
        <div className="flex items-start gap-2 flex-wrap">
          <form method="GET" action="/reports/bestandsmeldung-bsm" className="flex items-center gap-1 flex-wrap">
            <label className="flex items-center gap-1 text-xs text-s112-text-2">
              von
              <input type="date" name="von" aria-label="Beginn des Meldezeitraums" defaultValue={p.von} max={heute}
                className="border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-hidden" />
            </label>
            <label className="flex items-center gap-1 text-xs text-s112-text-2 ml-1">
              bis
              <input type="date" name="bis" aria-label="Ende des Meldezeitraums" defaultValue={p.bis} max={heute}
                className="border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-hidden" />
            </label>
            {p.arten.length > 0 && <input type="hidden" name="art" value={p.arten.join(',')} />}
            <button type="submit" aria-label="Meldezeitraum anzeigen" className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg">↻</button>
          </form>
          <PrintButton />
          <CsvExportKnopf label="BSM als CSV" href={csvPfad('bsm', zeitraumParam)} />
          <CsvExportKnopf label="Kontrolljournal als CSV" href={csvPfad('bsm-kontrolljournal', { ...zeitraumParam, art: p.arten.join(',') || null })} />
        </div>
      </div>

      {/* Schnellwahl: Weinwirtschaftsjahr (BSM) bzw. Kalenderjahr (nur Auswertung) */}
      <div className="flex items-center gap-2 flex-wrap text-xs print:hidden">
        <span className="text-s112-text-2">Schnellwahl:</span>
        {bsmSchnellwahlen(heute).map(w => (
          <Link key={w.label} href={`/reports/bestandsmeldung-bsm?von=${w.von}&bis=${w.bis}`}
            className={`border rounded-full px-2.5 py-0.5 ${w.von === p.von && w.bis === p.bis ? 'border-s112-blue-700 text-s112-blue-700 font-medium' : 'border-s112-border text-s112-text-2 hover:bg-s112-bg'}`}>
            {w.label}
          </Link>
        ))}
      </div>

      {fehler && (
        <div role="alert" className="print:hidden rounded-xl border border-s112-border bg-s112-bg px-4 py-3 text-xs text-s112-err-fg">
          {fehler} Angezeigt wird der Standard-Zeitraum {datumAT(p.von)} – {datumAT(p.bis)}.
        </div>
      )}

      {daten.warnungen.length > 0 && (
        <div className="print:hidden rounded-xl border border-s112-border bg-s112-bg px-4 py-3 text-xs text-s112-text-2">
          <p className="font-semibold text-s112-text mb-1">Hinweise und Plausibilitätsprüfung</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {daten.warnungen.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Dokument */}
      <div className="card p-8 print:border-0 print:shadow-none print:p-0">
        <div className="flex items-start justify-between border-b-2 border-s112-text pb-4 mb-6">
          <div>
            {s.logo_url && <Image unoptimized src={s.logo_url} alt="" width={150} height={40} className="object-contain object-left max-h-10 mb-2" />}
            <p className="font-semibold text-s112-text">{s.betrieb_name ?? 'software:112'}</p>
            <p className="text-sm text-s112-text-2">{[s.betrieb_strasse, [s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
            {s.betrieb_betriebsnummer && <p className="text-xs text-s112-tertiary">Betriebsnummer: {s.betrieb_betriebsnummer}</p>}
            {s.betrieb_uid && <p className="text-xs text-s112-tertiary">UID: {s.betrieb_uid}</p>}
          </div>
          <div className="text-right">
            <h1 className="text-lg font-semibold text-s112-text">Weinbestandsmeldung nach Buchungsarten</h1>
            <p className="text-2xl font-semibold text-s112-blue-700">{bsmKennzeichnung(zeitraum)}</p>
            <p className="text-xs text-s112-text-2 mt-1">{datumAT(p.von)} – {datumAT(p.bis)}</p>
            <p className="text-xs text-s112-tertiary">Erstellt: {datumAT(heute)}</p>
          </div>
        </div>

        <p className="text-xs text-s112-text-2 mb-1">
          § 29 Weingesetz 2009 · Weinwirtschaftsjahr 1. August – 31. Juli · Stichtag 31. Juli · Meldefrist 15. August · Weindatenbank: online.wein.bmluk.gv.at
        </p>
        <p className="text-xs text-s112-text-2 mb-4">
          Mengen in Liter (Summe zusätzlich in hl). Anfangsbestand = Bestand am Ende des {datumAT(daten.anfangAm)}; Endbestand lt. Rechnung = Anfangsbestand + Zugänge − Abgänge,
          abgeglichen mit dem Bestand zum {datumAT(p.bis)}.
          {!daten.istWeinwirtschaftsjahr && <strong className="text-s112-warn-fg"> Kein Weinwirtschaftsjahr – Auswertung, keine Bestandsmeldung.</strong>}
        </p>

        {daten.herkuenfte.map(h => (
          <div key={h} className="mb-8">
            <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider mb-1">Herkunft: {HERKUNFT_LABEL[h]}</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead><tr className="bg-[#F2F3F5]">
                  <th className="px-2 py-1.5 border border-s112-line text-left">Position</th>
                  {spalten.map(k => <th key={k} className="px-2 py-1.5 border border-s112-line text-right">{spaltenLabel(k)}</th>)}
                  <th className="px-2 py-1.5 border border-s112-line text-right">Summe (l)</th>
                  <th className="px-2 py-1.5 border border-s112-line text-right">Summe (hl)</th>
                </tr></thead>
                <tbody>
                  {daten.summen.filter(z => z.herkunft === h).map((z: BsmSummenZeile, i, liste) => {
                    const neuerAbschnitt = z.teil === 'gesamt' && (i === 0 || liste[i - 1].abschnitt !== z.abschnitt) && !!ABSCHNITT_TITEL[z.abschnitt]
                    const gesamt = z.teil === 'gesamt'
                    const bestand = z.abschnitt === 'Bestand' && gesamt
                    const pruefung = z.position === 'DIFFERENZ' && gesamt && Math.abs(z.summeLiter) >= 0.005
                    return [
                      neuerAbschnitt ? (
                        <tr key={`${i}-k`}><td colSpan={spalten.length + 3} className="px-2 pt-2 pb-0.5 font-semibold text-s112-text-2 uppercase tracking-wider text-[10px]">{ABSCHNITT_TITEL[z.abschnitt]}</td></tr>
                      ) : null,
                      <tr key={i} className={bestand ? 'bg-s112-line font-semibold' : pruefung ? 'text-s112-err-fg font-semibold' : gesamt ? '' : 'text-s112-tertiary'}>
                        <td className={`px-2 py-1 border border-s112-line ${gesamt ? '' : 'pl-5'}`}>
                          {gesamt ? <>{z.bezeichnung}{/^[A-Z_]+$/.test(z.position) && ARTEN.some(b => b.code === z.position) && <span className="ml-1 text-[10px] text-s112-tertiary">{z.position}</span>}</> : z.teil}
                        </td>
                        {spalten.map(k => <td key={k} className="px-2 py-1 border border-s112-line text-right tabular-nums">{wert(z.werte[k])}</td>)}
                        <td className="px-2 py-1 border border-s112-line text-right tabular-nums">{wert(z.summeLiter)}</td>
                        <td className="px-2 py-1 border border-s112-line text-right tabular-nums">{Math.abs(z.summeHl) < 0.0005 ? '–' : fmtNum(z.summeHl, HL_STELLEN_BSM)}</td>
                      </tr>,
                    ]
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* Zuordnung der Buchungsarten */}
        <details className="mb-8 print:hidden">
          <summary className="text-xs font-semibold text-s112-text-2 cursor-pointer">Zuordnung der Kellerbuchungen zu den BSM-Buchungsarten</summary>
          <table className="w-full border-collapse text-xs mt-2">
            <thead><tr className="bg-[#F2F3F5]">
              <th className="px-2 py-1.5 border border-s112-line text-left">Vorgang in software:112</th>
              <th className="px-2 py-1.5 border border-s112-line text-left">BSM-Buchungsart</th>
              <th className="px-2 py-1.5 border border-s112-line text-left">Hinweis</th>
            </tr></thead>
            <tbody>
              {BSM_ZUORDNUNG.map(z => (
                <tr key={z.vorgang}>
                  <td className="px-2 py-1 border border-s112-line">{z.vorgang}</td>
                  <td className="px-2 py-1 border border-s112-line font-mono">{z.code}</td>
                  <td className="px-2 py-1 border border-s112-line text-s112-text-2">{z.hinweis ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        {/* KAN-45: § 29 Abs. 3 WG – Konzentrate (nachrichtlich, Darstellung im BSM-Formular mit der BKI zu klären, KAN-38) */}
        <div className="mt-6">
          <h2 className="text-base font-semibold text-s112-text">Bestände an Konzentraten zum {datumAT(p.bis)} (§ 29 Abs. 3 WG, nachrichtlich)</h2>
          {konzentrate.length === 0 ? (
            <p className="text-xs text-s112-muted mt-1">Kein Stoff der Art KTM oder RTK im Stoffkonto (Kellerbuch › Besondere Konten).</p>
          ) : (
            <table className="text-sm mt-2 border-collapse">
              <thead><tr className="text-left text-xs text-s112-text-2"><th className="px-2 py-1 border border-s112-line">Stoff</th><th className="px-2 py-1 border border-s112-line">Art</th><th className="px-2 py-1 border border-s112-line text-right">Bestand</th></tr></thead>
              <tbody>
                {konzentrate.map(k => (
                  <tr key={k.stoff}>
                    <td className="px-2 py-1 border border-s112-line">{k.stoff}</td>
                    <td className="px-2 py-1 border border-s112-line">{k.art}</td>
                    <td className="px-2 py-1 border border-s112-line text-right tabular-nums">{fmtNum(k.bestand, { max: 3 })} {k.einheit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Kontrolljournal */}
        <div className="mt-10 pt-6 border-t-2 border-s112-line-str print:break-before-page">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
            <div>
              <h2 className="text-base font-semibold text-s112-text">Kontrolljournal</h2>
              <p className="text-xs text-s112-text-2">{journal.length} {journal.length === 1 ? 'Buchung' : 'Buchungen'} · {artText}</p>
            </div>
            <form method="GET" action="/reports/bestandsmeldung-bsm" className="flex items-center gap-1 print:hidden">
              <input type="hidden" name="von" value={p.von} />
              <input type="hidden" name="bis" value={p.bis} />
              <select name="art" aria-label="Buchungsart filtern" defaultValue={p.arten.join(',')}
                className="border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-hidden">
                <option value="">alle Buchungsarten</option>
                <option value={ABWERTUNG}>nur Abwertung (ZU_ABW, AB_ABW)</option>
                {ARTEN.map(b => <option key={b.code} value={b.code}>{b.code} – {b.bezeichnung}</option>)}
              </select>
              <button type="submit" aria-label="Kontrolljournal filtern" className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg">Filtern</button>
            </form>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead><tr className="bg-[#F2F3F5]">
                <th className="px-2 py-1.5 border border-s112-line text-left">Datum</th>
                <th className="px-2 py-1.5 border border-s112-line text-left">Buchungsart</th>
                <th className="px-2 py-1.5 border border-s112-line text-left">Spalte · Farbe · Herkunft</th>
                <th className="px-2 py-1.5 border border-s112-line text-left">offen/Fl.</th>
                <th className="px-2 py-1.5 border border-s112-line text-right">Zugang (l)</th>
                <th className="px-2 py-1.5 border border-s112-line text-right">Abgang (l)</th>
                <th className="px-2 py-1.5 border border-s112-line text-left">Vorgang</th>
                <th className="px-2 py-1.5 border border-s112-line text-left">Charge / Füllung</th>
                <th className="px-2 py-1.5 border border-s112-line text-left">Beleg</th>
                <th className="px-2 py-1.5 border border-s112-line text-left">Hinweis</th>
              </tr></thead>
              <tbody>
                {journal.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-3 text-center text-s112-tertiary italic border border-s112-line">Keine Buchungen im Zeitraum</td></tr>
                ) : journal.map((j, i) => (
                  <tr key={i} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                    <td className="px-2 py-1 border border-s112-line whitespace-nowrap">{datumAT(j.datum)}</td>
                    <td className="px-2 py-1 border border-s112-line"><span className="font-mono">{j.code}</span> <span className="text-s112-text-2">{j.buchungsart}</span></td>
                    <td className="px-2 py-1 border border-s112-line">{[j.spalte, j.farbe, j.herkunft].filter(Boolean).join(' · ')}</td>
                    <td className="px-2 py-1 border border-s112-line">{j.gebinde}</td>
                    <td className="px-2 py-1 border border-s112-line text-right tabular-nums">{j.zugang === null ? '' : fmtNum(j.zugang, 2)}</td>
                    <td className="px-2 py-1 border border-s112-line text-right tabular-nums">{j.abgang === null ? (j.kg ? `${fmtNum(j.kg, 0)} kg` : '') : fmtNum(j.abgang, 2)}</td>
                    <td className="px-2 py-1 border border-s112-line">{j.vorgang}{j.gegenstelle ? <span className="block text-s112-tertiary">{j.gegenstelle}</span> : null}</td>
                    <td className="px-2 py-1 border border-s112-line">{[j.charge, j.fuellung].filter(Boolean).join(' → ') || '–'}</td>
                    <td className="px-2 py-1 border border-s112-line font-mono">{j.beleg ?? ''}</td>
                    <td className="px-2 py-1 border border-s112-line text-s112-text-2">{[j.storno, j.hinweis].filter(Boolean).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Unterschrift */}
        <div className="grid grid-cols-2 gap-16 mt-12 pt-4">
          <div><div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Datum, Unterschrift Betriebsführer/in</div></div>
          <div><div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Stempel</div></div>
        </div>
      </div>
    </div>
  )
}
