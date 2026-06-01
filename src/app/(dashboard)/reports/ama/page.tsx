import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import PrintButton from '../PrintButton'
import { qualitaetLabel } from '@/lib/wein/qualitaet'

export const metadata: Metadata = { title: 'AMA Erntemeldung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function AMAPage({ searchParams }: { searchParams: Promise<{ jahrgang?: string }> }) {
  const { jahrgang: jahrgangParam } = await searchParams
  const supabase = await createSupabaseServerClient()

  const [{ data: jahrgaengeRaw }, { data: settingsRaw }] = await Promise.all([
    (supabase.from('weinjahrgaenge') as any).select('id, jahrgang, ernte_datum, qualitaet_gesamt').order('jahrgang', { ascending: false }),
    (supabase.from('tenant_einstellungen') as any).select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url').limit(1).maybeSingle(),
  ])

  const jahrgaenge = (jahrgaengeRaw ?? []) as R[]
  const s = (settingsRaw as R | null) ?? {}
  const aktJahrgang = jahrgaenge.find(j => String(j.jahrgang) === jahrgangParam) ?? jahrgaenge[0]

  let parzellen: R[] = []
  if (aktJahrgang) {
    const { data } = await (supabase.from('ernte_parzellen') as any)
      .select('id, ernte_datum, menge_kg, menge_hl, klosterneuburger, qualitaetsstufe, lesemethode, weingarten:weingarten_id(name, rebsorte, flaeche_ha)')
      .eq('jahrgang_id', aktJahrgang.id)
      .order('ernte_datum')
    parzellen = (data ?? []) as R[]
  }

  const gesamtKg = parzellen.reduce((s, p) => s + (p.menge_kg ?? 0), 0)
  const gesamtHl = parzellen.reduce((s, p) => s + (p.menge_hl ?? 0), 0)
  const heute = new Date().toLocaleDateString('de-AT', { day:'2-digit', month:'2-digit', year:'numeric' })

  return (
    <div className="max-w-4xl space-y-4">
      {/* Breadcrumb + Aktionen */}
      <div className="flex items-center justify-between print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/reports" className="hover:text-s112-teal">Auswertungen</Link>
          <span>/</span>
          <span className="font-medium text-gray-800">AMA Erntemeldung</span>
        </nav>
        <div className="flex gap-2">
          <select
            onChange={e => window.location.href = `/reports/ama?jahrgang=${e.target.value}`}
            value={aktJahrgang?.jahrgang ?? ''}
            className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            {jahrgaenge.map(j => <option key={j.id} value={j.jahrgang}>{j.jahrgang}</option>)}
          </select></form>
          <PrintButton />
        </div>
      </div>

      {/* Dokument */}
      <div className="card p-8 print:border-0 print:shadow-none print:p-0">
        {/* Kopf */}
        <div className="flex items-start justify-between border-b-2 border-gray-800 pb-4 mb-6">
          <div>
            {s.logo_url && <Image src={s.logo_url} alt="" width={150} height={40} className="object-contain object-left max-h-10 mb-2" />}
            <p className="font-bold text-gray-900">{s.betrieb_name ?? ''}</p>
            <p className="text-sm text-gray-600">{[s.betrieb_strasse, [s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
            {s.betrieb_uid && <p className="text-xs text-gray-400">UID: {s.betrieb_uid}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-gray-900">AMA Weinerntemeldung</p>
            <p className="text-2xl font-extrabold text-s112-teal">Jahrgang {aktJahrgang?.jahrgang}</p>
            <p className="text-xs text-gray-400 mt-1">Erstellt: {heute}</p>
          </div>
        </div>

        {/* Tabelle */}
        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="bg-gray-100 border border-gray-300">
              <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Weingarten / Rebsorte</th>
              <th className="text-right px-3 py-2 border border-gray-300 font-semibold">Erntedatum</th>
              <th className="text-right px-3 py-2 border border-gray-300 font-semibold">Menge (kg)</th>
              <th className="text-right px-3 py-2 border border-gray-300 font-semibold">Menge (hl)</th>
              <th className="text-right px-3 py-2 border border-gray-300 font-semibold">°KMW</th>
              <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Qualitätsstufe</th>
            </tr>
          </thead>
          <tbody>
            {parzellen.map((p, i) => (
              <tr key={p.id} className={i % 2 === 1 ? 'bg-gray-50' : ''}>
                <td className="px-3 py-2 border border-gray-200">
                  <span className="font-medium">{(p.weingarten as R)?.name ?? '–'}</span>
                  {(p.weingarten as R)?.rebsorte && <span className="text-gray-500 ml-1">({(p.weingarten as R).rebsorte})</span>}
                </td>
                <td className="px-3 py-2 border border-gray-200 text-right tabular-nums">{p.ernte_datum ? new Date(p.ernte_datum).toLocaleDateString('de-AT') : '–'}</td>
                <td className="px-3 py-2 border border-gray-200 text-right tabular-nums font-medium">{p.menge_kg?.toLocaleString('de-AT') ?? '–'}</td>
                <td className="px-3 py-2 border border-gray-200 text-right tabular-nums">{p.menge_hl?.toFixed(2).replace('.',',') ?? '–'}</td>
                <td className="px-3 py-2 border border-gray-200 text-right tabular-nums">{p.klosterneuburger ?? '–'}</td>
                <td className="px-3 py-2 border border-gray-200">{qualitaetLabel(p.qualitaetsstufe)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-200 font-bold border-t-2 border-gray-400">
              <td className="px-3 py-2 border border-gray-300">GESAMT</td>
              <td className="px-3 py-2 border border-gray-300 text-right">{parzellen.length} Parzellen</td>
              <td className="px-3 py-2 border border-gray-300 text-right tabular-nums">{gesamtKg.toLocaleString('de-AT')} kg</td>
              <td className="px-3 py-2 border border-gray-300 text-right tabular-nums">{gesamtHl.toFixed(2).replace('.',',')} hl</td>
              <td className="px-3 py-2 border border-gray-300" colSpan={2} />
            </tr>
          </tfoot>
        </table>

        {/* Unterschrift */}
        <div className="grid grid-cols-2 gap-16 mt-12 pt-4">
          <div>
            <div className="border-t border-gray-400 pt-2 text-xs text-gray-500">Datum, Unterschrift Betriebsführer/in</div>
          </div>
          <div>
            <div className="border-t border-gray-400 pt-2 text-xs text-gray-500">Stempel</div>
          </div>
        </div>
      </div>
    </div>
  )
}
