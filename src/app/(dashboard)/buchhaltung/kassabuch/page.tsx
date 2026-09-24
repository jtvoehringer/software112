// behoerdenmeldung: kassabuch
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { fmtEur } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import { csvPfad } from '@/lib/behoerden/katalog'
import { KATALOG_BUCHHALTUNG } from '@/lib/behoerden/katalog/buchhaltung'
import { betriebUndModuleLaden, zugriffsFehler } from '@/lib/behoerden/zugriff'
import { datumText, istIsoDatum, istUuid, standardZeitraum, summe } from '@/lib/behoerden/buchhaltung-gemeinsam'
import { ladeKassaKonten, ladeKassabuch } from '@/lib/behoerden/kassabuch'
import DruckenKnopf from '../anlagen/DruckenKnopf'

export const metadata: Metadata = { title: 'Kassabuch – software:112' }
export const dynamic = 'force-dynamic'

// ── Kassabuch – /buchhaltung/kassabuch?konto=&von=&bis= (Behördenmeldung, 24.09.2026) ──
// Druckfassung der Kassaaufzeichnungen (§ 131 BAO) je Kassa-Konto: Saldovortrag, jede
// Bewegung mit laufendem Kassastand. Zeilen aus ladeKassabuch() (lib/behoerden/kassabuch.ts)
// – dieselbe Ladefunktion liefert die CSV; die Summen addieren die gerundeten Zeilenwerte.
// Zugriff wie die übrigen E&A-Seiten (Modul E&A-Rechnung, jedes Mitglied).

export default async function KassabuchPage({ searchParams }: { searchParams: Promise<{ konto?: string; von?: string; bis?: string }> }) {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()
  const { betrieb, module } = await betriebUndModuleLaden(supabase, tenantId)
  if (zugriffsFehler(KATALOG_BUCHHALTUNG.kassabuch, membership, module)) redirect('/dashboard')

  const sp = await searchParams
  const heute = wienHeute()
  const std = standardZeitraum(heute)
  let von = istIsoDatum(sp.von) ? sp.von : std.von
  let bis = istIsoDatum(sp.bis) ? sp.bis : std.bis
  if (von > bis) [von, bis] = [bis, von]

  const konten = await ladeKassaKonten(supabase, tenantId)
  const gewaehlt = istUuid(sp.konto) ? konten.find(k => k.id === sp.konto) : undefined
  const konto = gewaehlt ?? konten.find(k => k.aktiv) ?? konten[0] ?? null
  const kb = konto ? await ladeKassabuch(supabase, tenantId, { konto: konto.id, von, bis }) : null
  const bewegungen = kb ? kb.zeilen.filter(z => !z.vortrag) : []
  const summeEin = summe(bewegungen.map(z => z.einnahme))
  const summeAus = summe(bewegungen.map(z => z.ausgabe))
  const endsaldo = kb && kb.zeilen.length > 0 ? kb.zeilen[kb.zeilen.length - 1].saldo : null

  const th = 'px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-s112-tertiary border-b border-s112-line-str whitespace-nowrap print:text-[8.5px] print:px-1.5'
  const thNum = th + ' text-right'
  const td = 'px-2 py-1.5 text-[12.5px] text-s112-text border-b border-s112-line align-top print:text-[9.5px] print:px-1.5 print:py-1'
  const tdNum = td + ' font-mono text-right whitespace-nowrap tabular-nums'
  const eur = (n: number | null) => (n === null ? '' : fmtEur(n))

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5 print:p-0 print:max-w-none print:space-y-3">
      <style>{`@media print { @page { size: A4 landscape; margin: 12mm 12mm 14mm; } }`}</style>
      <div className="flex items-center gap-2 text-sm text-s112-muted" data-print="hide">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700 transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <Link href="/konten" className="hover:text-s112-blue-700 transition-colors">Konten</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Kassabuch</span>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text print:text-[18px]">Kassabuch{kb ? ` ${kb.konto.name}` : ''}</h1>
          <p className="text-sm text-s112-muted mt-0.5 print:text-[11px] print:text-s112-text-2">
            {betrieb.name ? `${betrieb.name} · ` : ''}{betrieb.betriebsnummer ? `Betriebsnummer ${betrieb.betriebsnummer} · ` : ''}Zeitraum {datumText(von)} – {datumText(bis)}
            <span className="hidden print:inline"> · erstellt am {datumText(heute)} · software:112</span>
          </p>
        </div>
        {konto && (
          <div className="flex items-start gap-2 print:hidden" data-print="hide">
            <DruckenKnopf />
            <CsvExportKnopf href={csvPfad('kassabuch', { konto: konto.id, von, bis })} />
          </div>
        )}
      </div>

      {konten.length === 0 ? (
        <div className="bg-white border border-s112-border rounded-xl p-6 text-sm text-s112-text-2">
          Es gibt noch kein Konto vom Typ „Kassa“. <Link href="/konten/neu" className="text-s112-blue-700 hover:underline">Kassa-Konto anlegen →</Link>
        </div>
      ) : (
        <>
          <form method="GET" className="bg-white rounded-xl border border-s112-border p-4 flex gap-3 items-end flex-wrap" data-print="hide">
            <div>
              <label htmlFor="kb-konto" className="block text-xs font-medium text-s112-text-2 mb-1">Kassa</label>
              <select id="kb-konto" name="konto" defaultValue={konto?.id} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                {konten.map(k => <option key={k.id} value={k.id}>{k.name}{k.aktiv ? '' : ' (inaktiv)'}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="kb-von" className="block text-xs font-medium text-s112-text-2 mb-1">Von</label>
              <input id="kb-von" type="date" name="von" defaultValue={von} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label htmlFor="kb-bis" className="block text-xs font-medium text-s112-text-2 mb-1">Bis</label>
              <input id="kb-bis" type="date" name="bis" defaultValue={bis} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
            </div>
            <button type="submit" className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm">Anzeigen</button>
          </form>

          {kb && kb.warnungen.length > 0 && (
            <ul className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 text-[12.5px] text-s112-warn-fg list-disc pl-8 space-y-0.5 print:text-[9px]">
              {kb.warnungen.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          {kb && kb.zeilen.length > 0 && (
            <div className="bg-white border border-s112-border rounded-xl overflow-x-auto print:overflow-visible print:border-0 print:rounded-none">
              <table className="w-full min-w-[860px] print:min-w-0 border-collapse">
                <thead>
                  <tr>
                    <th className={thNum}>Nr.</th><th className={th}>Datum</th><th className={th}>Beleg</th><th className={th}>Text</th><th className={th}>Art</th>
                    <th className={thNum}>Einnahme</th><th className={thNum}>Ausgabe</th><th className={thNum}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {kb.zeilen.map((z, i) => (
                    <tr key={i} className={z.vortrag ? 'bg-s112-bg/60' : ''}>
                      <td className={tdNum + ' text-s112-tertiary'}>{z.lfdNr ?? ''}</td>
                      <td className={td + ' font-mono whitespace-nowrap'}>{datumText(z.datum)}</td>
                      <td className={td + ' font-mono'}>{z.beleg ?? ''}</td>
                      <td className={td + (z.vortrag ? ' italic text-s112-text-2' : '')}>{z.text}{z.gegenkonto ? <span className="text-s112-tertiary"> · {z.gegenkonto}</span> : null}</td>
                      <td className={td + ' text-s112-text-2 whitespace-nowrap'}>{z.vortrag ? '' : z.art}</td>
                      <td className={tdNum + ' text-s112-ok-fg'}>{eur(z.einnahme)}</td>
                      <td className={tdNum + ' text-s112-err-fg'}>{eur(z.ausgabe)}</td>
                      <td className={tdNum + ` font-semibold ${z.saldo < 0 ? 'text-s112-err-fg' : ''}`}>{fmtEur(z.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={td + ' font-semibold border-t border-s112-text'} colSpan={5}>Summe {bewegungen.length} {bewegungen.length === 1 ? 'Bewegung' : 'Bewegungen'} · Kassastand {datumText(bis)}</td>
                    <td className={tdNum + ' font-semibold border-t border-s112-text'}>{fmtEur(summeEin)}</td>
                    <td className={tdNum + ' font-semibold border-t border-s112-text'}>{fmtEur(summeAus)}</td>
                    <td className={tdNum + ' font-semibold border-t border-s112-text'}>{endsaldo === null ? '' : fmtEur(endsaldo)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="text-[11px] text-s112-tertiary leading-relaxed print:text-[8.5px]">
            Beträge in Euro. Bewegungen: Zahlungseingänge, E&amp;A-Buchungen (brutto) und Umbuchungen dieses Kontos; Bewegungen am oder
            vor dem Eröffnungsdatum stecken im Eröffnungssaldo. Erstellt mit software:112 am {datumText(heute)}; ersetzt keine steuerliche Beratung.
          </p>
        </>
      )}
    </div>
  )
}
