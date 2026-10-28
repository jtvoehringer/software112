import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import DacForm from '@/components/dac/DacForm'
import { createDacAntrag } from '../actions'
import { ladeZusammensetzungCharge } from '@/lib/wein/blendKomposition'
import { sortenAnteile } from '@/lib/wein/mischungsrechnung'
import { PN_OFFENE_ANTRAGS_STATUS, pnStatusLabel } from '@/lib/dac/workflow'
import { sortenAnteilText } from '@/lib/wein/sortenangabe'

export const metadata: Metadata = { title: 'Neuer Prüfnummern-Antrag' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** KAN-98/KAN-113: Sorten der Charge absteigend mit Anteil („Grüner Veltliner 80 % · Riesling 20 %“, wie Blend-Protokoll
 *  und Charge); eine Sorte ohne Anteil */
function sortenText(anteile: { wert: string; liter: number; anteil_pct: number }[]): string | null {
  const bekannt = anteile.filter(a => a.wert !== 'unbekannt')
  if (bekannt.length === 0) return null
  if (bekannt.length === 1 && bekannt.length === anteile.length) return bekannt[0].wert
  return sortenAnteilText(anteile)
}

export default async function NeuePage({
  searchParams,
}: {
  searchParams: Promise<{ charge?: string }>
}) {
  const { charge: chargeParam } = await searchParams
  const preCharge = chargeParam && UUID_RE.test(chargeParam) ? chargeParam : null
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  const [rawRes, anRawRes, offenRawRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle((supabase.from('weinausbau') as any).select('id, name, jahrgang, rebsorte, menge_liter').eq('aktiv', true).eq('tenant_id', tenantId).order('name').order('id')),
    preCharge
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (supabase.from('weinanalysen') as any)
          .select('analyse_datum, labor, alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert, flüchtige_saeure_gl, freie_so2_mgl, gesamt_so2_mgl')
          .eq('weinausbau_id', preCharge)
          .eq('tenant_id', tenantId)
          .is('storniert_am', null)   // KAN-150 F2: stornierte Analysen gelten nicht
          .order('analyse_datum', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    // KAN-98: je Charge höchstens ein offener Antrag
    preCharge
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (supabase.from('dac_antrag') as any)
          .select('id, bezeichnung, status')
          .eq('tenant_id', tenantId).eq('weinausbau_id', preCharge).is('storniert_am', null)
          .in('status', [...PN_OFFENE_ANTRAGS_STATUS]).limit(1)
      : Promise.resolve({ data: [], error: null }),
  ])
  const raw = geladen(rawRes, 'Chargen')
  const anRaw = geladen(anRawRes, 'Analysen')
  const offenRaw = geladen(offenRawRes, 'Prüfnummernanträge')

  type NameRow = { id: string; name: string; jahrgang: number | null; rebsorte: string | null; menge_liter: number | null }
  const weinausbau = (raw ?? []) as NameRow[]
  const analysen   = (anRaw ?? []) as R[]
  const offen = ((offenRaw ?? []) as R[])[0] ?? null

  // KAN-98: Vorbelegung aus der Charge – Sorten absteigend mit Anteil (Rechenkern KAN-76), Menge, Bezeichnung
  const charge = preCharge ? weinausbau.find(w => w.id === preCharge) ?? null : null
  let sorten: string | null = null
  if (charge && tenantId && !offen) {
    try {
      sorten = sortenText(sortenAnteile((await ladeZusammensetzungCharge(supabase, tenantId, charge.id)).anteile))
    } catch {
      sorten = null   // Vorbelegung ist Komfort – ohne Zusammensetzung bleibt die Sorte der Charge
    }
  }
  const vorbelegung = charge
    ? { bezeichnung: `${charge.name}${charge.jahrgang ? ` ${charge.jahrgang}` : ''}`, rebsorte: sorten ?? charge.rebsorte, menge_liter: charge.menge_liter }
    : null

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/dac" className="hover:text-s112-blue-700 transition-colors">DAC & Prüfnummern</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Neuer Antrag</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text mb-6">Neuer Prüfnummern-Antrag</h1>
      {offen ? (
        <div className="card space-y-2">
          <p className="text-sm">
            Für diese Charge gibt es bereits einen offenen Prüfnummernantrag: <strong>{offen.bezeichnung}</strong> ({pnStatusLabel(offen.status)}).
            Je Charge ist nur ein offener Antrag möglich.
          </p>
          <Link href={`/dac/${offen.id}`} className="text-sm text-s112-blue-700 underline">Zum offenen Antrag →</Link>
        </div>
      ) : (
        <DacForm
          weinausbau={weinausbau}
          analysen={analysen}
          preChargeId={preCharge}
          vorbelegung={vorbelegung}
          action={createDacAntrag}
        />
      )}
    </div>
  )
}
