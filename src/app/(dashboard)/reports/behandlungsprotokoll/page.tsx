import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import PrintButton from '../PrintButton'

export const metadata: Metadata = { title: 'Behandlungsprotokoll – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function BehandlungsprotokollPage({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  const { jahr: jahrParam } = await searchParams
  const supabase = await createSupabaseServerClient()
  const aktJahr = jahrParam ? parseInt(jahrParam) : new Date().getFullYear()
  const jahre = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  const [{ data: behandlungenRaw }, { data: settingsRaw }] = await Promise.all([
    (supabase.from('behandlungen') as any)
      .select('id, datum, aufwandmenge, aufwandmenge_einheit, menge_gesamt, menge_einheit, art, bbch_stadium, witterung, notizen, weingarten:weingarten_id(name, ried), psm:psm_id(name, handelsname, wirkstoff, wartezeit_tage, oeko_zugelassen, cu_gehalt_pct)')
      .gte('datum', `${aktJahr}-01-01`).lte('datum', `${aktJahr}-12-31`)
      .order('datum'),
    (supabase.from('tenant_einstellungen') as any).select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url').limit(1).maybeSingle(),
  ])

  const behandlungen = (behandlungenRaw ?? []) as R[]
  const s = (settingsRaw as R | null) ?? {}
  const heute = new Date().toLocaleDateString('de-AT', { day:'2-digit', month:'2-digit', year:'numeric' })

  const ART_LABEL: Record<string, string> = { spritzung: 'Spritzung', duengung: 'Düngung', sonstiges: 'Sonstiges' }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/reports" className="hover:text-s112-teal">Auswertungen</Link>
          <span>/</span>
          <span className="font-medium text-gray-800">Behandlungsprotokoll</span>
        </nav>
        <div className="flex gap-2">
          <form method="GET" action="/reports/behandlungsprotokoll">
            <select name="jahr"
              defaultValue={aktJahr}
              onChange={e => (e.target as HTMLSelectElement).form?.submit()}
              className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
              {jahre.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
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
            <p className="text-lg font-bold text-gray-900">Weinbauliches Behandlungsprotokoll</p>
            <p className="text-2xl font-extrabold text-s112-teal">Saison {aktJahr}</p>
            <p className="text-xs text-gray-400 mt-1">Erstellt: {heute} · {behandlungen.length} Einträge</p>
          </div>
        </div>

        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100">
              {['Datum','Weingarten','Mittel (Handelsname)','Wirkstoff','Art','BBCH','Aufwand','Wartezeit','Öko','Notiz'].map(h => (
                <th key={h} className="text-left px-2 py-2 border border-gray-300 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {behandlungen.map((b, i) => {
              const psm = b.psm as R | null
              const wg  = b.weingarten as R | null
              return (
                <tr key={b.id} className={i % 2 === 1 ? 'bg-gray-50' : ''}>
                  <td className="px-2 py-1.5 border border-gray-200 tabular-nums whitespace-nowrap">{new Date(b.datum).toLocaleDateString('de-AT')}</td>
                  <td className="px-2 py-1.5 border border-gray-200">{wg?.name ?? '–'}{wg?.ried ? ` (${wg.ried})` : ''}</td>
                  <td className="px-2 py-1.5 border border-gray-200">{psm?.handelsname ?? psm?.name ?? '–'}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-600">{psm?.wirkstoff ?? '–'}</td>
                  <td className="px-2 py-1.5 border border-gray-200">{ART_LABEL[b.art] ?? b.art ?? '–'}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-center">{b.bbch_stadium ?? '–'}</td>
                  <td className="px-2 py-1.5 border border-gray-200 tabular-nums whitespace-nowrap">{b.menge_gesamt ?? b.aufwandmenge ?? '–'} {b.menge_einheit ?? b.aufwandmenge_einheit ?? ''}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-center">{psm?.wartezeit_tage ? `${psm.wartezeit_tage} T` : '–'}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-center">{psm?.oeko_zugelassen ? '✓' : ''}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{b.notizen ?? ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {behandlungen.length === 0 && <p className="text-center text-s112-muted py-12">Keine Behandlungen für {aktJahr} erfasst.</p>}

        <div className="grid grid-cols-2 gap-16 mt-12 pt-4">
          <div><div className="border-t border-gray-400 pt-2 text-xs text-gray-500">Datum, Unterschrift Betriebsführer/in</div></div>
          <div><div className="border-t border-gray-400 pt-2 text-xs text-gray-500">Stempel / Kontrollstelle</div></div>
        </div>
      </div>
    </div>
  )
}
