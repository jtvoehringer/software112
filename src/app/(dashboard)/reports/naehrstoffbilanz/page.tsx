import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import PrintButton from '../PrintButton'

export const metadata: Metadata = { title: 'Nährstoffbilanz – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Orientierungswerte für Weinbau in Österreich (Stand 2026, siehe Fußzeile für Quellen):
// - Stickstoff: Nitrat-Aktionsprogramm-Verordnung (NAPV) 2023 legt für Wein in "Gebieten mit
//   verstärkten Aktionen" (nitratbelastete Gebiete) erstmals eine Düngeobergrenze von 50 kg N/ha
//   und Jahr fest. Außerhalb dieser Gebiete gibt es (Stand dieser Recherche) keine eigene
//   gesetzliche Obergrenze für Wein - hier wird der Wert dennoch als Orientierung/Ampel verwendet.
// - Phosphor: keine bundesweite gesetzliche Obergrenze wie bei Stickstoff gefunden. Richtwert ist
//   die fachliche Erhaltungsdüngung bei mittlerer Bodengehaltsklasse (~15 kg P2O5/ha/Jahr) - dient
//   hier nur als grobe Orientierung, keine rechtliche Grenze. Wichtig: ob die in den
//   Düngemittel-Stammdaten hinterlegten "P-Gehalt %"-Werte als elementares P oder als P2O5
//   deklariert sind, hängt vom jeweiligen Produktetikett ab - bitte beim Erfassen der Stammdaten
//   prüfen, da sich P2O5 und elementares P um den Faktor ~2,29 unterscheiden.
const N_RICHTWERT_KG_HA = 50   // NAPV 2023: Düngeobergrenze Wein in Gebieten mit verstärkten Aktionen
const P_RICHTWERT_KG_HA = 15   // Fachliche Erhaltungsdüngung, Bodengehaltsklasse "mittel" (C)

export default async function NaehrstoffbilanzPage({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  const { jahr: jahrParam } = await searchParams
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query
  const aktJahr = jahrParam ? parseInt(jahrParam) : new Date().getFullYear()
  const jahre = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  const [{ data: raw }, { data: settingsRaw }, { data: flaecheRaw }] = await Promise.all([
    tf((supabase.from('behandlungen') as any)
      .select('id, datum, menge_gesamt, menge_einheit, art, weingarten:weingarten_id(name, flaeche_ha), duengemittel:duengemittel_id(name, handelsname, typ, naehrstoff_n_pct, naehrstoff_p_pct)')
      .eq('art', 'duengung')
      .gte('datum', `${aktJahr}-01-01`).lte('datum', `${aktJahr}-12-31`)
      .order('datum')),
    tf((supabase.from('tenant_einstellungen') as any).select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url').limit(1).maybeSingle()),
    tf((supabase.from('weingarten') as any).select('flaeche_ha').eq('aktiv', true)),
  ])

  const s = (settingsRaw as R | null) ?? {}
  const alleDuengungen = (raw ?? []) as R[]
  // Nur Einträge mit hinterlegtem Düngemittel UND Gesamtmenge in kg berücksichtigen - bei anderen
  // Einheiten (l/g/ml) fehlt eine verlässliche Umrechnungsgrundlage in der Datenbank (analog zur
  // bestehenden Cu-Bilanz, die ebenfalls von kg ausgeht).
  const behandlungen = alleDuengungen.filter(b => b.duengemittel && b.menge_einheit === 'kg')
  const uebersprungen = alleDuengungen.filter(b => !behandlungen.includes(b))
  const gesamtHa = ((flaecheRaw ?? []) as R[]).reduce((s, w) => s + (w.flaeche_ha ?? 0), 0)
  const heute = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })

  // N/P pro Behandlung berechnen
  const eintraege = behandlungen.map(b => {
    const d = b.duengemittel as R
    const menge = b.menge_gesamt ?? 0
    const nPct = d.naehrstoff_n_pct ?? 0
    const pPct = d.naehrstoff_p_pct ?? 0
    const nKg = (menge * nPct) / 100
    const pKg = (menge * pPct) / 100
    const ha = (b.weingarten as R | null)?.flaeche_ha ?? gesamtHa
    return { ...b, nKg, pKg, nKgHa: ha > 0 ? nKg / ha : 0, pKgHa: ha > 0 ? pKg / ha : 0, ha } as R
  })

  const totalNKg = eintraege.reduce((s, e) => s + e.nKg, 0)
  const totalPKg = eintraege.reduce((s, e) => s + e.pKg, 0)
  const totalNKgHa = gesamtHa > 0 ? totalNKg / gesamtHa : 0
  const totalPKgHa = gesamtHa > 0 ? totalPKg / gesamtHa : 0
  const nUeberRichtwert = totalNKgHa > N_RICHTWERT_KG_HA
  const pUeberRichtwert = totalPKgHa > P_RICHTWERT_KG_HA

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/reports" className="hover:text-s112-blue-700">Auswertungen</Link>
          <span>/</span>
          <span className="font-medium text-s112-text">Nährstoffbilanz Jahresbericht</span>
        </nav>
        <div className="flex gap-2">
          <form method="GET" action="/reports/naehrstoffbilanz">
            <select name="jahr"
              defaultValue={aktJahr}
              className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
              {jahre.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
            <button type="submit" className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg">
              ↻
            </button>
          </form>
          <PrintButton />
        </div>
      </div>

      <div className="card p-8 print:border-0 print:shadow-none print:p-0">
        <div className="flex items-start justify-between border-b-2 border-s112-text pb-4 mb-6">
          <div>
            {s.logo_url && <Image src={s.logo_url} alt="" width={150} height={40} className="object-contain object-left max-h-10 mb-2" />}
            <p className="font-semibold text-s112-text">{s.betrieb_name ?? ''}</p>
            <p className="text-sm text-s112-text-2">{[s.betrieb_strasse, [s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-s112-text">Nährstoffbilanz (Stickstoff/Phosphor)</p>
            <p className="text-2xl font-semibold text-s112-blue-700">Jahr {aktJahr}</p>
            <p className="text-xs text-s112-tertiary mt-1">Gem. Nitrat-Aktionsprogramm-Verordnung (NAPV) · Erstellt: {heute}</p>
          </div>
        </div>

        {/* KPI-Zusammenfassung */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className={`grid grid-cols-2 gap-4 p-4 rounded-xl border-2 ${nUeberRichtwert ? 'border-s112-err/50 bg-s112-err-bg' : 'border-s112-ok/50 bg-s112-ok-bg'}`}>
            <div className="text-center">
              <p className="text-xs text-s112-text-2 mb-1">N eingesetzt gesamt</p>
              <p className="text-xl font-semibold">{totalNKg.toFixed(2).replace('.', ',')} kg</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-s112-text-2 mb-1">N je ha</p>
              <p className={`text-xl font-semibold ${nUeberRichtwert ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                {totalNKgHa.toFixed(2).replace('.', ',')} kg/ha
              </p>
              <p className="text-xs mt-0.5">{nUeberRichtwert ? 'ÜBER Richtwert' : `Richtwert: ${N_RICHTWERT_KG_HA} kg/ha/Jahr`}</p>
            </div>
          </div>
          <div className={`grid grid-cols-2 gap-4 p-4 rounded-xl border-2 ${pUeberRichtwert ? 'border-s112-err/50 bg-s112-err-bg' : 'border-s112-ok/50 bg-s112-ok-bg'}`}>
            <div className="text-center">
              <p className="text-xs text-s112-text-2 mb-1">P eingesetzt gesamt</p>
              <p className="text-xl font-semibold">{totalPKg.toFixed(2).replace('.', ',')} kg</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-s112-text-2 mb-1">P je ha</p>
              <p className={`text-xl font-semibold ${pUeberRichtwert ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                {totalPKgHa.toFixed(2).replace('.', ',')} kg/ha
              </p>
              <p className="text-xs mt-0.5">{pUeberRichtwert ? 'ÜBER Richtwert' : `Richtwert: ${P_RICHTWERT_KG_HA} kg/ha/Jahr`}</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-s112-text-2 mb-6 -mt-2">
          Gesamtfläche: <strong>{gesamtHa.toFixed(2).replace('.', ',')} ha</strong>
        </p>

        {/* Detailtabelle */}
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#F2F3F5]">
              {['Datum', 'Weingarten', 'Düngemittel', 'N %', 'P %', 'Menge kg', 'Fläche ha', 'N kg', 'N kg/ha', 'P kg', 'P kg/ha'].map(h => (
                <th key={h} className="text-left px-2 py-2 border border-s112-line-str font-semibold text-xs whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eintraege.map((e, i) => (
              <tr key={e.id} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                <td className="px-2 py-1.5 border border-s112-line tabular-nums whitespace-nowrap text-xs">{new Date(e.datum).toLocaleDateString('de-AT')}</td>
                <td className="px-2 py-1.5 border border-s112-line text-xs">{(e.weingarten as R)?.name ?? '–'}</td>
                <td className="px-2 py-1.5 border border-s112-line text-xs">{(e.duengemittel as R)?.handelsname ?? (e.duengemittel as R)?.name ?? '–'}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{(e.duengemittel as R)?.naehrstoff_n_pct ?? '–'}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{(e.duengemittel as R)?.naehrstoff_p_pct ?? '–'}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{e.menge_gesamt ?? '–'}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{e.ha.toFixed(2).replace('.', ',')}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums font-medium text-xs">{e.nKg.toFixed(3).replace('.', ',')}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{e.nKgHa.toFixed(3).replace('.', ',')}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums font-medium text-xs">{e.pKg.toFixed(3).replace('.', ',')}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{e.pKgHa.toFixed(3).replace('.', ',')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-s112-line font-semibold border-t-2 border-s112-line-str">
              <td className="px-2 py-2 border border-s112-line-str text-xs" colSpan={7}>GESAMT {aktJahr}</td>
              <td className="px-2 py-2 border border-s112-line-str text-right tabular-nums text-xs">{totalNKg.toFixed(3).replace('.', ',')} kg</td>
              <td className={`px-2 py-2 border border-s112-line-str text-right tabular-nums text-xs ${nUeberRichtwert ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                {totalNKgHa.toFixed(3).replace('.', ',')} kg/ha
              </td>
              <td className="px-2 py-2 border border-s112-line-str text-right tabular-nums text-xs">{totalPKg.toFixed(3).replace('.', ',')} kg</td>
              <td className={`px-2 py-2 border border-s112-line-str text-right tabular-nums text-xs ${pUeberRichtwert ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                {totalPKgHa.toFixed(3).replace('.', ',')} kg/ha
              </td>
            </tr>
          </tfoot>
        </table>

        {eintraege.length === 0 && (
          <p className="text-center text-s112-muted py-8">
            Keine Düngungen mit hinterlegtem N/P-Gehalt (Einheit kg) für {aktJahr} erfasst.
          </p>
        )}

        {uebersprungen.length > 0 && (
          <p className="text-xs text-s112-warn-fg mt-3">
            Hinweis: {uebersprungen.length} Düngungs-Eintrag/Einträge für {aktJahr} wurden hier nicht berücksichtigt
            (kein Düngemittel hinterlegt oder Gesamtmenge nicht in kg erfasst).
          </p>
        )}

        <p className="text-xs text-s112-tertiary mt-4">
          Richtwert Stickstoff: {N_RICHTWERT_KG_HA} kg N/ha/Jahr (Nitrat-Aktionsprogramm-Verordnung 2023,
          Düngeobergrenze Wein in Gebieten mit verstärkten Aktionen – außerhalb dieser Gebiete besteht keine
          eigene gesetzliche Obergrenze für Wein, der Wert dient dort nur als Orientierung) · Richtwert
          Phosphor: {P_RICHTWERT_KG_HA} kg P/ha/Jahr (fachliche Erhaltungsdüngung bei mittlerer Bodengehaltsklasse,
          keine gesetzliche Grenze – abhängig von Bodenuntersuchung individuell abweichend). Beide Werte ersetzen
          keine Rechtsberatung; bei Betrieben in offiziell ausgewiesenen "Gebieten mit verstärkten Aktionen"
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
