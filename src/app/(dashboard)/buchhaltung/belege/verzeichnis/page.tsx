// behoerdenmeldung: belegverzeichnis
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { fmtEur } from '@/lib/format'
import { wienHeute, wienZeitpunkt } from '@/lib/csv'
import { csvPfad } from '@/lib/behoerden/katalog'
import { KATALOG_BUCHHALTUNG } from '@/lib/behoerden/katalog/buchhaltung'
import { betriebUndModuleLaden, zugriffsFehler } from '@/lib/behoerden/zugriff'
import { datumText } from '@/lib/behoerden/buchhaltung-gemeinsam'
import { BELEG_STATUS, ladeBelegverzeichnis } from '@/lib/behoerden/belege'
import DruckenKnopf from '../../anlagen/DruckenKnopf'

export const metadata: Metadata = { title: 'Belegverzeichnis – software:112' }
export const dynamic = 'force-dynamic'

// ── Belegverzeichnis – /buchhaltung/belege/verzeichnis?jahr= (24.09.2026) ────────
// Alle hochgeladenen Belege eines Jahres mit Status und zugeordneter Buchung – für die
// Außenprüfung (§§ 131, 132 BAO). Zeilen aus ladeBelegverzeichnis() (lib/behoerden/belege.ts)
// – dieselbe Ladefunktion liefert die CSV.

function zeitpunkt(ts: string | null): string {
  const z = wienZeitpunkt(ts)
  return z ? `${datumText(z.datum)}${z.uhrzeit ? ` ${z.uhrzeit}` : ''}` : ''
}

export default async function BelegverzeichnisPage({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()
  const { betrieb, module } = await betriebUndModuleLaden(supabase, tenantId)
  if (zugriffsFehler(KATALOG_BUCHHALTUNG.belegverzeichnis, membership, module)) redirect('/dashboard')

  const heute = wienHeute()
  const aktJahr = Number(heute.slice(0, 4))
  const { jahr: jahrParam } = await searchParams
  const gewuenscht = Number(jahrParam)
  const jahr = Number.isInteger(gewuenscht) && gewuenscht >= 2000 && gewuenscht <= 2100 ? gewuenscht : aktJahr
  const jahre = Array.from({ length: 8 }, (_, i) => aktJahr - i)

  const { zeilen, warnungen } = await ladeBelegverzeichnis(supabase, tenantId, { jahr })

  const th = 'px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-s112-tertiary border-b border-s112-line-str whitespace-nowrap print:text-[8px] print:px-1'
  const thNum = th + ' text-right'
  const td = 'px-2 py-1.5 text-[12.5px] text-s112-text border-b border-s112-line align-top print:text-[9px] print:px-1 print:py-0.5'
  const tdNum = td + ' font-mono text-right whitespace-nowrap tabular-nums'

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 print:p-0 print:max-w-none print:space-y-3">
      <style>{`@media print { @page { size: A4 landscape; margin: 12mm 12mm 14mm; } }`}</style>
      <div className="flex items-center gap-2 text-sm text-s112-muted" data-print="hide">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700 transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <Link href="/buchhaltung/belege" className="hover:text-s112-blue-700 transition-colors">Belege</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Belegverzeichnis</span>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text print:text-[18px]">Belegverzeichnis {jahr}</h1>
          <p className="text-sm text-s112-muted mt-0.5 print:text-[11px] print:text-s112-text-2">
            {betrieb.name ? `${betrieb.name} · ` : ''}{betrieb.betriebsnummer ? `Betriebsnummer ${betrieb.betriebsnummer} · ` : ''}{zeilen.length} {zeilen.length === 1 ? 'Beleg' : 'Belege'}
            <span className="hidden print:inline"> · erstellt am {datumText(heute)} · software:112</span>
          </p>
        </div>
        <div className="flex items-start gap-2 print:hidden" data-print="hide">
          <DruckenKnopf />
          <CsvExportKnopf href={csvPfad('belegverzeichnis', { jahr })} />
        </div>
      </div>

      <form method="GET" className="bg-white rounded-xl border border-s112-border p-4 flex gap-3 items-end flex-wrap" data-print="hide">
        <div>
          <label htmlFor="bv-jahr" className="block text-xs font-medium text-s112-text-2 mb-1">Jahr</label>
          <select id="bv-jahr" name="jahr" defaultValue={String(jahr)} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            {(jahre.includes(jahr) ? jahre : [jahr, ...jahre]).map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <button type="submit" className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm">Anzeigen</button>
        <p className="text-xs text-s112-muted basis-full">Zuordnung zum Jahr: verbuchte Belege nach dem Buchungsdatum, offene nach dem Upload-Tag.</p>
      </form>

      {warnungen.length > 0 && (
        <ul className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 text-[12.5px] text-s112-warn-fg list-disc pl-8 space-y-0.5 print:text-[9px]">
          {warnungen.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      {zeilen.length === 0 ? (
        <div className="bg-white border border-s112-border rounded-xl p-6 text-sm text-s112-text-2">
          Keine Belege für {jahr}. <Link href="/buchhaltung/belege" className="text-s112-blue-700 hover:underline">Belege hochladen →</Link>
        </div>
      ) : (
        <div className="bg-white border border-s112-border rounded-xl overflow-x-auto print:overflow-visible print:border-0 print:rounded-none">
          <table className="w-full min-w-[1000px] print:min-w-0 border-collapse">
            <thead>
              <tr>
                <th className={thNum}>Nr.</th><th className={th}>Belegdatei</th><th className={th}>Status</th><th className={th}>Hochgeladen</th>
                <th className={th}>Buchung</th><th className={th}>Bezeichnung / Kategorie</th><th className={thNum}>Brutto</th>
                <th className={th}>Erkannt (Vorschlag)</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map(z => (
                <tr key={z.id}>
                  <td className={tdNum + ' text-s112-tertiary'}>{z.lfdNr}</td>
                  <td className={td}>
                    <Link href={`/buchhaltung/belege/${z.id}`} className="hover:text-s112-blue-700 break-all">{z.dateiname}</Link>
                  </td>
                  <td className={td + ` whitespace-nowrap ${z.status === BELEG_STATUS.verbucht ? '' : 'text-s112-warn-fg'}`}>{z.status}</td>
                  <td className={td + ' font-mono whitespace-nowrap'}>{zeitpunkt(z.hochgeladenAm)}</td>
                  <td className={td + ' font-mono whitespace-nowrap'}>{z.buchungsdatum ? `${datumText(z.buchungsdatum)} · ${z.buchungstyp}` : ''}</td>
                  <td className={td}>{z.buchungstext ?? ''}{z.kategorie ? <span className="block text-[11px] text-s112-tertiary">{z.kategorie}</span> : null}</td>
                  <td className={tdNum}>{z.brutto === null ? '' : fmtEur(z.brutto)}</td>
                  <td className={td + ' text-[11.5px] text-s112-text-2'}>
                    {[z.erkanntDatum ? datumText(z.erkanntDatum) : null, z.erkanntBrutto === null ? null : fmtEur(z.erkanntBrutto), z.erkanntLieferant].filter(Boolean).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-s112-tertiary leading-relaxed print:text-[8.5px]">
        „Erkannt“ sind Vorschläge der automatischen Belegerkennung und nicht geprüft; maßgeblich sind die Werte der Buchung.
        Die Belegdateien selbst liegen im Belegspeicher von software:112 (Aufbewahrungspflicht 7 Jahre, § 132 BAO).
        Erstellt am {datumText(heute)} · software:112.
      </p>
    </div>
  )
}
