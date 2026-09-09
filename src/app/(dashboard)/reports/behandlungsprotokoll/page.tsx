import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
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

  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [{ data: behandlungenRaw }, { data: settingsRaw }] = await Promise.all([
    tf((supabase.from('behandlungen') as any)
      .select('id, datum, aufwandmenge, aufwandmenge_einheit, menge_gesamt, menge_einheit, art, bbch_stadium, witterung, notizen, weingarten:weingarten_id(name, ried), psm:psm_id(name, handelsname, wirkstoff, wartezeit_tage, oeko_zugelassen, cu_gehalt_pct)')
      .gte('datum', `${aktJahr}-01-01`).lte('datum', `${aktJahr}-12-31`)
      .order('datum')),
    tf((supabase.from('tenant_einstellungen') as any).select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url').limit(1)).maybeSingle(),
  ])

  const behandlungen = (behandlungenRaw ?? []) as R[]
  const s = (settingsRaw as R | null) ?? {}
  const heute = new Date().toLocaleDateString('de-AT', { day:'2-digit', month:'2-digit', year:'numeric' })

  const ART_LABEL: Record<string, string> = { spritzung: 'Spritzung', duengung: 'Düngung', sonstiges: 'Sonstiges' }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/reports" className="hover:text-s112-blue-700">Auswertungen</Link>
          <span>/</span>
          <span className="font-medium text-s112-text">Behandlungsprotokoll</span>
        </nav>
        <div className="flex gap-2">
          <form method="GET" action="/reports/behandlungsprotokoll">
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
            <p className="text-lg font-semibold text-s112-text">Weinbauliches Behandlungsprotokoll</p>
            <p className="text-2xl font-semibold text-s112-blue-700">Saison {aktJahr}</p>
            <p className="text-xs text-s112-tertiary mt-1">Erstellt: {heute} · {behandlungen.length} Einträge</p>
          </div>
        </div>

        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[#F2F3F5]">
              {['Datum','Weingarten','Mittel (Handelsname)','Wirkstoff','Art','BBCH','Aufwand','Wartezeit','Öko','Notiz'].map(h => (
                <th key={h} className="text-left px-2 py-2 border border-s112-line-str font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {behandlungen.map((b, i) => {
              const psm = b.psm as R | null
              const wg  = b.weingarten as R | null
              return (
                <tr key={b.id} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                  <td className="px-2 py-1.5 border border-s112-line tabular-nums whitespace-nowrap">{new Date(b.datum).toLocaleDateString('de-AT')}</td>
                  <td className="px-2 py-1.5 border border-s112-line">{wg?.name ?? '–'}{wg?.ried ? ` (${wg.ried})` : ''}</td>
                  <td className="px-2 py-1.5 border border-s112-line">{psm?.handelsname ?? psm?.name ?? '–'}</td>
                  <td className="px-2 py-1.5 border border-s112-line text-s112-text-2">{psm?.wirkstoff ?? '–'}</td>
                  <td className="px-2 py-1.5 border border-s112-line">{ART_LABEL[b.art] ?? b.art ?? '–'}</td>
                  <td className="px-2 py-1.5 border border-s112-line text-center">{b.bbch_stadium ?? '–'}</td>
                  <td className="px-2 py-1.5 border border-s112-line tabular-nums whitespace-nowrap">{b.menge_gesamt ?? b.aufwandmenge ?? '–'} {b.menge_einheit ?? b.aufwandmenge_einheit ?? ''}</td>
                  <td className="px-2 py-1.5 border border-s112-line text-center">{psm?.wartezeit_tage ? `${psm.wartezeit_tage} T` : '–'}</td>
                  <td className="px-2 py-1.5 border border-s112-line text-center">{psm?.oeko_zugelassen ? 'Ja' : ''}</td>
                  <td className="px-2 py-1.5 border border-s112-line text-s112-text-2">{b.notizen ?? ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {behandlungen.length === 0 && <p className="text-center text-s112-muted py-12">Keine Behandlungen für {aktJahr} erfasst.</p>}

        <div className="grid grid-cols-2 gap-16 mt-12 pt-4">
          <div><div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Datum, Unterschrift Betriebsführer/in</div></div>
          <div><div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Stempel / Kontrollstelle</div></div>
        </div>
      </div>
    </div>
  )
}
