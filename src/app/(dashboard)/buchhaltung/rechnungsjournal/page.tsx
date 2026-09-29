// behoerdenmeldung: rechnungsausgangsjournal
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { fmtEur } from '@/lib/format'
import { wienDatum, wienHeute } from '@/lib/csv'
import { csvPfad } from '@/lib/behoerden/katalog'
import { KATALOG_BUCHHALTUNG } from '@/lib/behoerden/katalog/buchhaltung'
import { betriebUndModuleLaden, zugriffsFehler } from '@/lib/behoerden/zugriff'
import { datumText, istIsoDatum, standardZeitraum, summe } from '@/lib/behoerden/buchhaltung-gemeinsam'
import { ladeRechnungsjournal, type RechnungsjournalZeile } from '@/lib/behoerden/rechnungsausgang'
import DruckenKnopf from '../anlagen/DruckenKnopf'

export const metadata: Metadata = { title: 'Rechnungsausgangsjournal – software:112' }
export const dynamic = 'force-dynamic'

// ── Rechnungsausgangsjournal – /buchhaltung/rechnungsjournal?von=&bis= (24.09.2026) ──
// Alle Ausgangsrechnungen des Zeitraums inkl. Stornos mit Netto/USt je Steuersatz – für
// die Betriebsprüfung (§ 11 UStG fortlaufende Nummer, § 131 BAO). Zeilen aus
// ladeRechnungsjournal() (lib/behoerden/rechnungsausgang.ts) – dieselbe Ladefunktion liefert
// die CSV. Summen ohne Stornos, aus den gerundeten Zeilenwerten.

type Feld = 'netto20' | 'ust20' | 'netto13' | 'ust13' | 'netto10' | 'ust10' | 'netto0' | 'brutto'

export default async function RechnungsjournalPage({ searchParams }: { searchParams: Promise<{ von?: string; bis?: string }> }) {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()
  const { betrieb, module } = await betriebUndModuleLaden(supabase, tenantId)
  if (zugriffsFehler(KATALOG_BUCHHALTUNG.rechnungsausgangsjournal, membership, module)) redirect('/dashboard')

  const sp = await searchParams
  const heute = wienHeute()
  const std = standardZeitraum(heute)
  let von = istIsoDatum(sp.von) ? sp.von : std.von
  let bis = istIsoDatum(sp.bis) ? sp.bis : std.bis
  if (von > bis) [von, bis] = [bis, von]

  const { zeilen, warnungen } = await ladeRechnungsjournal(supabase, tenantId, { von, bis })
  const gueltig = zeilen.filter(z => !z.storniert)
  const s = (k: Feld) => summe(gueltig.map(z => z[k]))

  const th = 'px-1.5 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-s112-tertiary border-b border-s112-line-str whitespace-nowrap print:text-[7.5px] print:px-1'
  const thNum = th + ' text-right'
  const td = 'px-1.5 py-1.5 text-[12px] text-s112-text border-b border-s112-line align-top print:text-[8.5px] print:px-1 print:py-0.5'
  const tdNum = td + ' font-mono text-right whitespace-nowrap tabular-nums'
  const tdSum = tdNum + ' font-semibold border-t border-s112-text'
  const eur = (n: number | null) => (n === null ? '' : fmtEur(n))

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 print:p-0 print:max-w-none print:space-y-3">
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm 10mm 12mm; } }`}</style>
      <div className="flex items-center gap-2 text-sm text-s112-muted" data-print="hide">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700 transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Rechnungsausgangsjournal</span>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text print:text-[18px]">Rechnungsausgangsjournal</h1>
          <p className="text-sm text-s112-muted mt-0.5 print:text-[11px] print:text-s112-text-2">
            {betrieb.name ? `${betrieb.name} · ` : ''}{betrieb.betriebsnummer ? `Betriebsnummer ${betrieb.betriebsnummer} · ` : ''}Rechnungsdatum {datumText(von)} – {datumText(bis)}
            <span className="hidden print:inline"> · erstellt am {datumText(heute)} · software:112</span>
          </p>
        </div>
        <div className="flex items-start gap-2 print:hidden" data-print="hide">
          <DruckenKnopf />
          <CsvExportKnopf href={csvPfad('rechnungsausgangsjournal', { von, bis })} />
        </div>
      </div>

      <form method="GET" className="bg-white rounded-xl border border-s112-border p-4 flex gap-3 items-end flex-wrap" data-print="hide">
        <div>
          <label htmlFor="rj-von" className="block text-xs font-medium text-s112-text-2 mb-1">Von</label>
          <input id="rj-von" type="date" name="von" defaultValue={von} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
        </div>
        <div>
          <label htmlFor="rj-bis" className="block text-xs font-medium text-s112-text-2 mb-1">Bis</label>
          <input id="rj-bis" type="date" name="bis" defaultValue={bis} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
        </div>
        <button type="submit" className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm">Anzeigen</button>
      </form>

      {warnungen.length > 0 && (
        <ul className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 text-[12.5px] text-s112-warn-fg list-disc pl-8 space-y-0.5 print:text-[9px]">
          {warnungen.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      {zeilen.length === 0 ? (
        <div className="bg-white border border-s112-border rounded-xl p-6 text-sm text-s112-text-2">
          Keine Ausgangsrechnungen im Zeitraum {datumText(von)} – {datumText(bis)}.
        </div>
      ) : (
        <div className="bg-white border border-s112-border rounded-xl overflow-x-auto print:overflow-visible print:border-0 print:rounded-none">
          <table className="w-full min-w-[1100px] print:min-w-0 border-collapse">
            <thead>
              <tr>
                <th className={th}>Rechnungsnr.</th><th className={th}>Datum</th><th className={th}>Kunde</th><th className={th}>UID</th>
                <th className={thNum}>Netto 20 %</th><th className={thNum}>USt 20 %</th><th className={thNum}>Netto 13 %</th><th className={thNum}>USt 13 %</th>
                <th className={thNum}>Netto 10 %</th><th className={thNum}>USt 10 %</th><th className={thNum}>steuerfrei</th>
                <th className={thNum}>Brutto</th><th className={th}>Storno</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map(z => <JournalZeile key={z.id} z={z} td={td} tdNum={tdNum} eur={eur} />)}
            </tbody>
            <tfoot>
              <tr>
                <td className={td + ' font-semibold border-t border-s112-text'} colSpan={4}>Summe {gueltig.length} {gueltig.length === 1 ? 'Rechnung' : 'Rechnungen'} (ohne Stornos)</td>
                <td className={tdSum}>{fmtEur(s('netto20'))}</td><td className={tdSum}>{fmtEur(s('ust20'))}</td>
                <td className={tdSum}>{fmtEur(s('netto13'))}</td><td className={tdSum}>{fmtEur(s('ust13'))}</td>
                <td className={tdSum}>{fmtEur(s('netto10'))}</td><td className={tdSum}>{fmtEur(s('ust10'))}</td>
                <td className={tdSum}>{fmtEur(s('netto0'))}</td>
                <td className={tdSum}>{fmtEur(s('brutto'))}</td><td className={td + ' border-t border-s112-text'} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-[11px] text-s112-tertiary leading-relaxed print:text-[8.5px]">
        Beträge in Euro. Netto und USt je Steuersatz wie auf der Rechnung (Positionsbrutto abzüglich Rabatt und Sonderrabatt); Netto
        gesamt, USt gesamt, Kundennummer und Land enthält die CSV. Stornierte Rechnungen bleiben mit ihren Beträgen aufgeführt
        (Lückenlosigkeit der Nummern), zählen aber nicht zur Summe. Erstellt mit software:112 am {datumText(heute)}; ersetzt keine steuerliche Beratung.
      </p>
    </div>
  )
}

function JournalZeile({ z, td, tdNum, eur }: { z: RechnungsjournalZeile; td: string; tdNum: string; eur: (n: number | null) => string }) {
  return (
    <tr className={z.storniert ? 'text-s112-tertiary' : ''}>
      <td className={td + ' font-mono whitespace-nowrap'}>
        {z.rechnungsnummer ? <Link href={`/weinhandel/verkauf/${z.id}`} className="hover:text-s112-blue-700 print:no-underline">{z.rechnungsnummer}</Link> : <span className="text-s112-warn-fg">ohne Nr.</span>}
      </td>
      <td className={td + ' font-mono whitespace-nowrap'}>{datumText(z.datum)}</td>
      <td className={td}>{z.kunde ?? 'Barverkauf'}{z.land && z.land !== 'AT' ? <span className="text-s112-tertiary"> · {z.land}</span> : null}</td>
      <td className={td + ' font-mono whitespace-nowrap'}>{z.uid ?? ''}</td>
      <td className={tdNum}>{eur(z.netto20)}</td><td className={tdNum}>{eur(z.ust20)}</td>
      <td className={tdNum}>{eur(z.netto13)}</td><td className={tdNum}>{eur(z.ust13)}</td>
      <td className={tdNum}>{eur(z.netto10)}</td><td className={tdNum}>{eur(z.ust10)}</td>
      <td className={tdNum}>{eur(z.netto0)}</td>
      <td className={tdNum + ' font-semibold'}>{fmtEur(z.brutto)}</td>
      <td className={td + ' whitespace-nowrap'}>{z.storniert ? `storniert${z.storniertAm ? ` ${datumText(wienDatum(z.storniertAm))}` : ''}` : ''}</td>
    </tr>
  )
}
