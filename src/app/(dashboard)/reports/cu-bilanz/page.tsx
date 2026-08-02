import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import PrintButton from '../PrintButton'

export const metadata: Metadata = { title: 'Cu-Bilanz – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const EU_LIMIT_KG_HA_JAHR = 4    // EU-Bio-Verordnung: max 4 kg/ha/Jahr
const EU_LIMIT_KG_HA_5J   = 20   // Österreich: max 20 kg/ha über 5 Jahre

export default async function CuBilanzPage({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  const { jahr: jahrParam } = await searchParams
  const supabase = await createSupabaseServerClient()
  const aktJahr = jahrParam ? parseInt(jahrParam) : new Date().getFullYear()
  const jahre = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  const [{ data: raw }, { data: settingsRaw }, { data: flaecheRaw }] = await Promise.all([
    (supabase.from('behandlungen') as any)
      .select('id, datum, menge_gesamt, menge_einheit, aufwandmenge, aufwandmenge_einheit, weingarten:weingarten_id(name, flaeche_ha), psm:psm_id(name, handelsname, cu_gehalt_pct)')
      .gte('datum', `${aktJahr}-01-01`).lte('datum', `${aktJahr}-12-31`)
      .order('datum'),
    (supabase.from('tenant_einstellungen') as any).select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url').limit(1).maybeSingle(),
    (supabase.from('weingarten') as any).select('flaeche_ha').eq('aktiv', true),
  ])

  const s = (settingsRaw as R | null) ?? {}
  const behandlungen = ((raw ?? []) as R[]).filter(b => ((b.psm as R | null)?.cu_gehalt_pct ?? 0) > 0)
  const gesamtHa = ((flaecheRaw ?? []) as R[]).reduce((s, w) => s + (w.flaeche_ha ?? 0), 0)
  const heute = new Date().toLocaleDateString('de-AT', { day:'2-digit', month:'2-digit', year:'numeric' })

  // Cu pro Behandlung berechnen
  const eintraege = behandlungen.map(b => {
    const psm = b.psm as R
    const menge = b.menge_gesamt ?? b.aufwandmenge ?? 0
    const cuPct = psm.cu_gehalt_pct ?? 0
    const cuKg  = (menge * cuPct) / 100
    const ha    = (b.weingarten as R | null)?.flaeche_ha ?? gesamtHa
    return { ...b, cuKg, cuKgHa: ha > 0 ? cuKg / ha : 0, ha } as R
  })

  const totalCuKg   = eintraege.reduce((s, e) => s + e.cuKg, 0)
  const totalCuKgHa = gesamtHa > 0 ? totalCuKg / gesamtHa : 0
  const ueberlimit  = totalCuKgHa > EU_LIMIT_KG_HA_JAHR

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/reports" className="hover:text-s112-teal">Auswertungen</Link>
          <span>/</span>
          <span className="font-medium text-gray-800">Cu-Bilanz Jahresbericht</span>
        </nav>
        <div className="flex gap-2">
          <form method="GET" action="/reports/cu-bilanz">
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
        <div className="flex items-start justify-between border-b-2 border-gray-800 pb-4 mb-6">
          <div>
            {s.logo_url && <Image src={s.logo_url} alt="" width={150} height={40} className="object-contain object-left max-h-10 mb-2" />}
            <p className="font-bold text-gray-900">{s.betrieb_name ?? ''}</p>
            <p className="text-sm text-gray-600">{[s.betrieb_strasse, [s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-gray-900">Kupfer-Bilanz (Cu-Bilanz)</p>
            <p className="text-2xl font-extrabold text-s112-teal">Jahr {aktJahr}</p>
            <p className="text-xs text-gray-400 mt-1">Gem. EU-Bio-VO 2018/848 · Erstellt: {heute}</p>
          </div>
        </div>

        {/* KPI-Zusammenfassung */}
        <div className={`grid grid-cols-3 gap-4 mb-6 p-4 rounded-xl border-2 ${ueberlimit ? 'border-red-400 bg-red-50' : 'border-green-400 bg-green-50'}`}>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">Gesamtfläche</p>
            <p className="text-xl font-bold">{gesamtHa.toFixed(2).replace('.',',')} ha</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">Cu eingesetzt gesamt</p>
            <p className="text-xl font-bold">{totalCuKg.toFixed(3).replace('.',',')} kg</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">Cu je ha</p>
            <p className={`text-xl font-bold ${ueberlimit ? 'text-red-600' : 'text-green-700'}`}>
              {totalCuKgHa.toFixed(3).replace('.',',')} kg/ha
            </p>
            <p className="text-xs mt-0.5">{ueberlimit ? 'ÜBER EU-Limit' : `Limit: ${EU_LIMIT_KG_HA_JAHR} kg/ha/Jahr`}</p>
          </div>
        </div>

        {/* Detailtabelle */}
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100">
              {['Datum','Weingarten','Mittel','Cu-Gehalt %','Menge','Einheit','Fläche ha','Cu kg gesamt','Cu kg/ha'].map(h => (
                <th key={h} className="text-left px-2 py-2 border border-gray-300 font-semibold text-xs whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eintraege.map((e, i) => (
              <tr key={e.id} className={i % 2 === 1 ? 'bg-gray-50' : ''}>
                <td className="px-2 py-1.5 border border-gray-200 tabular-nums whitespace-nowrap text-xs">{new Date(e.datum).toLocaleDateString('de-AT')}</td>
                <td className="px-2 py-1.5 border border-gray-200 text-xs">{(e.weingarten as R)?.name ?? '–'}</td>
                <td className="px-2 py-1.5 border border-gray-200 text-xs">{(e.psm as R)?.handelsname ?? (e.psm as R)?.name ?? '–'}</td>
                <td className="px-2 py-1.5 border border-gray-200 text-right tabular-nums text-xs">{(e.psm as R)?.cu_gehalt_pct ?? '–'}</td>
                <td className="px-2 py-1.5 border border-gray-200 text-right tabular-nums text-xs">{e.menge_gesamt ?? e.aufwandmenge ?? '–'}</td>
                <td className="px-2 py-1.5 border border-gray-200 text-xs">{e.menge_einheit ?? e.aufwandmenge_einheit ?? ''}</td>
                <td className="px-2 py-1.5 border border-gray-200 text-right tabular-nums text-xs">{e.ha.toFixed(2).replace('.',',')}</td>
                <td className="px-2 py-1.5 border border-gray-200 text-right tabular-nums font-medium text-xs">{e.cuKg.toFixed(4).replace('.',',')}</td>
                <td className="px-2 py-1.5 border border-gray-200 text-right tabular-nums text-xs">{e.cuKgHa.toFixed(4).replace('.',',')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-200 font-bold border-t-2 border-gray-400">
              <td className="px-2 py-2 border border-gray-300 text-xs" colSpan={7}>GESAMT {aktJahr}</td>
              <td className="px-2 py-2 border border-gray-300 text-right tabular-nums text-xs">{totalCuKg.toFixed(4).replace('.',',')} kg</td>
              <td className={`px-2 py-2 border border-gray-300 text-right tabular-nums text-xs ${ueberlimit ? 'text-red-700' : 'text-green-700'}`}>
                {totalCuKgHa.toFixed(4).replace('.',',')} kg/ha
              </td>
            </tr>
          </tfoot>
        </table>

        {eintraege.length === 0 && <p className="text-center text-s112-muted py-8">Keine Kupferbehandlungen für {aktJahr} erfasst.</p>}

        <p className="text-xs text-gray-400 mt-4">
          Grenzwert: max. {EU_LIMIT_KG_HA_JAHR} kg Cu/ha/Jahr (EU-Bio-VO 2018/848 Art. 24) · 
          Österreich: max. {EU_LIMIT_KG_HA_5J} kg Cu/ha über 5 Jahre (ÖPUL)
        </p>

        <div className="grid grid-cols-2 gap-16 mt-10 pt-4">
          <div><div className="border-t border-gray-400 pt-2 text-xs text-gray-500">Datum, Unterschrift Betriebsführer/in</div></div>
          <div><div className="border-t border-gray-400 pt-2 text-xs text-gray-500">Bio-Kontrollstelle / Stempel</div></div>
        </div>
      </div>
    </div>
  )
}
