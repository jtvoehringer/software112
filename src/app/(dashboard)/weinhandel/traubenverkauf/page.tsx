import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import TraubenverkaufClient from './TraubenverkaufClient'

export const metadata: Metadata = { title: 'Traubenverkauf – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function TraubenverkaufPage() {
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  const writeOk    = canWrite(role)

  if (!membership) {
    return <div className="card p-10 text-center text-s112-muted text-sm">Nicht angemeldet.</div>
  }

  // Verkäufe
  const { data: verkaufeRaw } = await (supabase.from('traubenverkauf') as any)
    .select(`
      id, datum, menge_kg, preis_per_kg, kmw_grad,
      qualitaetsstufe, herkunft_code, notizen, jahrgang_id,
      weingarten:weingarten_id(id, name, rebsorte, trauben_herkunft_code),
      kontakt:kontakt_id(id, vorname, nachname),
      firma:firma_id(id, firmenname),
      jahrgang:jahrgang_id(id, jahrgang)
    `)
    .eq('tenant_id', membership.tenantId)
    .order('datum', { ascending: false })

  const verkaufe = (verkaufeRaw ?? []) as R[]

  // Weingärten mit Traubenverkauf-Freigabe
  const { data: wgRaw } = await (supabase.from('weingarten') as any)
    .select('id, name, rebsorte, trauben_herkunft_code')
    .eq('tenant_id', membership.tenantId)
    .eq('trauben_verkauf', true)
    .eq('aktiv', true)
    .order('name')

  const wgOptions = (wgRaw ?? []) as R[]

  // Jahrgänge
  const { data: jahrgaengeRaw } = await (supabase.from('weinjahrgaenge') as any)
    .select('id, jahrgang')
    .eq('tenant_id', membership.tenantId)
    .order('jahrgang', { ascending: false })

  const jahrgaenge = (jahrgaengeRaw ?? []) as R[]

  // Kontakte
  const { data: kontakteRaw } = await (supabase.from('kontakte') as any)
    .select('id, vorname, nachname')
    .eq('tenant_id', membership.tenantId)
    .order('nachname')

  const kontakte = (kontakteRaw ?? []) as R[]

  // Firmen
  const { data: firmenRaw } = await (supabase.from('firmen') as any)
    .select('id, firmenname')
    .eq('tenant_id', membership.tenantId)
    .order('firmenname')

  const firmen = (firmenRaw ?? []) as R[]

  const keinWgFreigegeben = wgOptions.length === 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Traubenverkauf</h1>
          <p className="text-sm text-s112-muted mt-0.5">Verkauf von Weintrauben gem. § 3 Weingesetz-Formularverordnung</p>
        </div>
        <div className="flex items-center gap-3">
          {verkaufe.length > 0 && (
            <a
              href="/weinhandel/traubenverkauf/datenblatt"
              className="border border-s112-border text-gray-700 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-bg transition-colors"
            >
              BKI-Datenblatt (Excel)
            </a>
          )}
        </div>
      </div>

      {keinWgFreigegeben && (
        <div className="card p-5 bg-amber-50 border-amber-200 text-sm text-amber-800">
          <p className="font-semibold mb-1">Noch keine Weingärten für Traubenverkauf freigegeben</p>
          <p>
            Gehe zu{' '}
            <Link href="/weingarten" className="underline hover:text-amber-900">
              Weingärten
            </Link>
            {' '}und aktiviere bei den gewünschten Weingärten die Option „Traubenverkauf".
          </p>
        </div>
      )}

      <TraubenverkaufClient
        verkaufe={verkaufe}
        wgOptions={wgOptions}
        jahrgaenge={jahrgaenge}
        kontakte={kontakte}
        firmen={firmen}
        writeOk={writeOk}
      />
    </div>
  )
}
