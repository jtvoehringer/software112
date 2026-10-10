// behoerdenmeldung: naehrstoffbilanz, naehrstoffbilanz-weingarten
import { redirect } from 'next/navigation'
import { geladen } from '@/lib/supabase/geladen'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import Image from 'next/image'
import PrintButton from '../../PrintButton'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { wienHeute } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import { datumDe, jahrAus } from '@/lib/behoerden/psm'
import { ladeNaehrstoffbilanz, N_RICHTWERT_KG_HA, P_RICHTWERT_KG_HA } from '@/lib/behoerden/naehrstoff'

export const metadata: Metadata = { title: 'Nährstoffbilanz – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Nährstoffbilanz / Düngeaufzeichnung (Pflichtmeldung, Druck + CSV „naehrstoffbilanz“). Druck und
// CSV laden über dieselbe Funktion ladeNaehrstoffbilanz() (lib/behoerden/naehrstoff.ts); Summen =
// Summe der gerundeten Zeilenwerte. Orientierungswerte (N_RICHTWERT_KG_HA, P_RICHTWERT_KG_HA) und
// ihre Quellen siehe dort bzw. Fußzeile.

const np = (n: number | null) => (n === null ? '–' : fmtNum(n, 3))

export default async function NaehrstoffbilanzPage({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  const { jahr: jahrParam } = await searchParams
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/dashboard')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  const heute = wienHeute()
  const diesesJahr = Number(heute.slice(0, 4))
  const aktJahr = jahrAus(jahrParam) ?? diesesJahr
  const jahre = Array.from({ length: 5 }, (_, i) => diesesJahr - i)
  if (!jahre.includes(aktJahr)) jahre.push(aktJahr)

  const [bilanz, settingsRawRes] = await Promise.all([
    ladeNaehrstoffbilanz(supabase, tenantId, { jahr: aktJahr }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url, modul_controlling')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])
  const settingsRaw = geladen(settingsRawRes, 'Einstellungen')

  const s = (settingsRaw as R | null) ?? {}
  // Brotkrume wie die Navigation (Rieden › Maßnahmen › …) – die Tab-Leiste zeigt diese Seite
  // immer unter „Rieden“, auch mit Modul Controlling (Review 25.09.2026)
  const zurueck = { href: '/behandlungen', label: 'Maßnahmen' }

  const { zeilen: eintraege, gesamtHa, warnungen } = bilanz
  const nUeberRichtwert = (bilanz.nKgHa ?? 0) > N_RICHTWERT_KG_HA
  const pUeberRichtwert = (bilanz.pKgHa ?? 0) > P_RICHTWERT_KG_HA

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/weingarten" className="hover:text-s112-blue-700">Rieden</Link>
          <span>/</span>
          <Link href={zurueck.href} className="hover:text-s112-blue-700">{zurueck.label}</Link>
          <span>/</span>
          <span className="font-medium text-s112-text">Nährstoffbilanz Jahresbericht</span>
        </nav>
        <div className="flex items-start gap-2 flex-wrap">
          <form method="GET" action="/reports/naehrstoffbilanz" className="flex gap-2">
            <select name="jahr" aria-label="Jahr"
              defaultValue={aktJahr}
              className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden">
              {jahre.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
            <button type="submit" aria-label="Anzeigen" title="Anzeigen" className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg">
              ↻
            </button>
          </form>
          <PrintButton />
          <CsvExportKnopf href={csvPfad('naehrstoffbilanz', { jahr: aktJahr })} />
          <CsvExportKnopf label="Je Ried als CSV" href={csvPfad('naehrstoffbilanz-weingarten', { jahr: aktJahr })} />
        </div>
      </div>

      <div className="card p-8 print:border-0 print:shadow-none print:p-0">
        <div className="flex items-start justify-between border-b-2 border-s112-text pb-4 mb-6">
          <div>
            {s.logo_url && <Image unoptimized src={s.logo_url} alt="" width={150} height={40} className="object-contain object-left max-h-10 mb-2" />}
            <p className="font-semibold text-s112-text">{s.betrieb_name ?? ''}</p>
            <p className="text-sm text-s112-text-2">{[s.betrieb_strasse, [s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
          </div>
          <div className="text-right">
            <h1 className="text-lg font-semibold text-s112-text">Nährstoffbilanz (Stickstoff/Phosphor)</h1>
            <p className="text-2xl font-semibold text-s112-blue-700">Jahr {aktJahr}</p>
            <p className="text-xs text-s112-tertiary mt-1">Gem. Nitrat-Aktionsprogramm-Verordnung (NAPV) · Erstellt: {datumDe(heute)}</p>
          </div>
        </div>

        {/* KPI-Zusammenfassung */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className={`grid grid-cols-2 gap-4 p-4 rounded-xl border-2 ${nUeberRichtwert ? 'border-s112-err/50 bg-s112-err-bg' : 'border-s112-ok/50 bg-s112-ok-bg'}`}>
            <div className="text-center">
              <p className="text-xs text-s112-text-2 mb-1">N eingesetzt gesamt</p>
              <p className="text-xl font-semibold">{fmtNum(bilanz.nKg, 2)} kg</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-s112-text-2 mb-1">N je ha</p>
              <p className={`text-xl font-semibold ${nUeberRichtwert ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                {bilanz.nKgHa !== null ? `${fmtNum(bilanz.nKgHa, 2)} kg/ha` : '–'}
              </p>
              <p className="text-xs mt-0.5">{nUeberRichtwert ? 'ÜBER Richtwert' : `Richtwert: ${N_RICHTWERT_KG_HA} kg/ha/Jahr`}</p>
            </div>
          </div>
          <div className={`grid grid-cols-2 gap-4 p-4 rounded-xl border-2 ${pUeberRichtwert ? 'border-s112-err/50 bg-s112-err-bg' : 'border-s112-ok/50 bg-s112-ok-bg'}`}>
            <div className="text-center">
              <p className="text-xs text-s112-text-2 mb-1">P eingesetzt gesamt</p>
              <p className="text-xl font-semibold">{fmtNum(bilanz.pKg, 2)} kg</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-s112-text-2 mb-1">P je ha</p>
              <p className={`text-xl font-semibold ${pUeberRichtwert ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                {bilanz.pKgHa !== null ? `${fmtNum(bilanz.pKgHa, 2)} kg/ha` : '–'}
              </p>
              <p className="text-xs mt-0.5">{pUeberRichtwert ? 'ÜBER Richtwert' : `Richtwert: ${P_RICHTWERT_KG_HA} kg/ha/Jahr`}</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-s112-text-2 mb-6 -mt-2">
          Gesamtfläche: <strong>{fmtNum(gesamtHa, 2)} ha</strong>
        </p>

        {/* Je Ried (= Weingarten, KAN-132): N/P anteilig nach Grundstücksfläche */}
        {bilanz.riedZeilen.length > 0 && (
          <>
            <h2 className="text-sm font-semibold text-s112-text mb-2">Je Ried</h2>
            <table className="w-full text-sm border-collapse mb-6">
              <thead>
                <tr className="bg-[#F2F3F5]">
                  {['Ried', 'Lage', 'Fläche WI ha', 'Düngungen', 'N kg', 'N kg/ha', 'P kg', 'P kg/ha', 'Status N'].map(h => (
                    <th key={h} className="text-left px-2 py-2 border border-s112-line-str font-semibold text-xs whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bilanz.riedZeilen.map((r, i) => (
                  <tr key={r.weingartenId} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                    <td className="px-2 py-1.5 border border-s112-line text-xs">{r.ried}</td>
                    <td className="px-2 py-1.5 border border-s112-line text-xs">{r.lage ?? '–'}</td>
                    <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{r.flaecheHa !== null ? fmtNum(r.flaecheHa, { min: 2, max: 4 }) : '–'}</td>
                    <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{r.duengungen}</td>
                    <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{np(r.nKg)}</td>
                    <td className={`px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs ${r.nKgHa !== null && r.nKgHa > N_RICHTWERT_KG_HA ? 'text-s112-err-fg font-medium' : ''}`}>{np(r.nKgHa)}</td>
                    <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{np(r.pKg)}</td>
                    <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{np(r.pKgHa)}</td>
                    <td className="px-2 py-1.5 border border-s112-line text-xs whitespace-nowrap">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Detailtabelle */}
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#F2F3F5]">
              {['Datum', 'Ried', 'Düngemittel', 'N %', 'P %', 'Menge kg', 'Fläche ha', 'N kg', 'N kg/ha', 'P kg', 'P kg/ha'].map(h => (
                <th key={h} className="text-left px-2 py-2 border border-s112-line-str font-semibold text-xs whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eintraege.map((e, i) => (
              <tr key={e.behandlungId} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                <td className="px-2 py-1.5 border border-s112-line tabular-nums whitespace-nowrap text-xs">{datumDe(e.datum)}</td>
                <td className="px-2 py-1.5 border border-s112-line text-xs">{e.weingarten ?? '–'}</td>
                <td className="px-2 py-1.5 border border-s112-line text-xs">{e.duengemittel}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{e.nPct !== null ? fmtNum(e.nPct, { max: 3 }) : '–'}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{e.pPct !== null ? fmtNum(e.pPct, { max: 3 }) : '–'}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">
                  {fmtNum(e.mengeKg, { max: 3 })}
                  {e.mengeBasis !== 'Düngermenge' && <span className="block text-[10px] text-s112-tertiary">{e.mengeBasis}</span>}
                </td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{e.flaecheHa !== null ? fmtNum(e.flaecheHa, { min: 2, max: 4 }) : '–'}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums font-medium text-xs">{np(e.nKg)}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{np(e.nKgHa)}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums font-medium text-xs">{np(e.pKg)}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{np(e.pKgHa)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-s112-line font-semibold border-t-2 border-s112-line-str">
              <td className="px-2 py-2 border border-s112-line-str text-xs" colSpan={7}>GESAMT {aktJahr} (Betrieb, {fmtNum(gesamtHa, { min: 2, max: 4 })} ha)</td>
              <td className="px-2 py-2 border border-s112-line-str text-right tabular-nums text-xs">{np(bilanz.nKg)} kg</td>
              <td className={`px-2 py-2 border border-s112-line-str text-right tabular-nums text-xs ${nUeberRichtwert ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                {bilanz.nKgHa !== null ? `${np(bilanz.nKgHa)} kg/ha` : '–'}
              </td>
              <td className="px-2 py-2 border border-s112-line-str text-right tabular-nums text-xs">{np(bilanz.pKg)} kg</td>
              <td className={`px-2 py-2 border border-s112-line-str text-right tabular-nums text-xs ${pUeberRichtwert ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                {bilanz.pKgHa !== null ? `${np(bilanz.pKgHa)} kg/ha` : '–'}
              </td>
            </tr>
          </tfoot>
        </table>

        {eintraege.length === 0 && (
          <p className="text-center text-s112-muted py-8">
            Keine Düngungen mit hinterlegtem Düngemittel und Düngermenge in kg für {aktJahr} erfasst.
          </p>
        )}

        {warnungen.length > 0 && (
          <div className="text-xs text-s112-warn-fg mt-3">
            <p>
              Hinweis{bilanz.uebersprungen > 0 ? `: ${bilanz.uebersprungen} Düngungs-${bilanz.uebersprungen === 1 ? 'Eintrag' : 'Einträge'} für ${aktJahr} ${bilanz.uebersprungen === 1 ? 'wurde' : 'wurden'} hier nicht berücksichtigt` : 'e'}:
            </p>
            <ul className="list-disc pl-4 space-y-0.5 mt-0.5">
              {warnungen.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        <p className="text-xs text-s112-tertiary mt-4">
          Menge (kg) = Düngermenge in kg, sonst Aufwand (kg/ha) × behandelte Fläche; N/P je ha bezogen auf die behandelte
          Fläche (Summe der Grundstücke); je Ried anteilig nach Grundstücksfläche, bezogen auf die Fläche der Grundstücke mit
          Nutzart WI der Ried (Stand heute); Gesamtwerte je ha bezogen auf die Fläche der Grundstücke mit Nutzart WI aller
          aktiven Rieden.
          Richtwert Stickstoff: {N_RICHTWERT_KG_HA} kg N/ha/Jahr (Nitrat-Aktionsprogramm-Verordnung 2023,
          Düngeobergrenze Wein in Gebieten mit verstärkten Aktionen – außerhalb dieser Gebiete besteht keine
          eigene gesetzliche Obergrenze für Wein, der Wert dient dort nur als Orientierung) · Richtwert
          Phosphor: {P_RICHTWERT_KG_HA} kg P/ha/Jahr (fachliche Erhaltungsdüngung bei mittlerer Bodengehaltsklasse,
          keine gesetzliche Grenze – abhängig von Bodenuntersuchung individuell abweichend). Beide Werte ersetzen
          keine Rechtsberatung; bei Betrieben in offiziell ausgewiesenen „Gebieten mit verstärkten Aktionen“
          gelten ggf. strengere, hier nicht automatisch geprüfte Vorgaben.
        </p>

        <div className="grid grid-cols-2 gap-16 mt-10 pt-4">
          <div><div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Datum, Unterschrift Betriebsführer/in</div></div>
          <div><div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Landwirtschaftskammer / Kontrollstelle</div></div>
        </div>
      </div>
    </div>
  )
}
