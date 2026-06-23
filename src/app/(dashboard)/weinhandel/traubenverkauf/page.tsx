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

  // Bestehende Verkäufe
  const { data: verkaufeRaw } = await (supabase.from('traubenverkauf') as any)
    .select(`
      id, datum, menge_kg, preis_per_kg, kmw_grad,
      qualitaetsstufe, herkunft_code, gesundheit, liefernummer, notizen, jahrgang_id, grundstueck_id,
      weingarten:weingarten_id(id, name, trauben_herkunft_code),
      grundstueck:grundstueck_id(id, gst_nr, rebsorte, trauben_herkunft_code),
      kontakt:kontakt_id(id, vorname, nachname),
      firma:firma_id(id, name),
      jahrgang:jahrgang_id(id, jahrgang)
    `)
    .eq('tenant_id', membership.tenantId)
    .order('datum', { ascending: false })

  const verkaufe = (verkaufeRaw ?? []) as R[]

  // Ernte-Parzellen als Basis für WG/GST-Optionen (alle geernteten)
  const { data: ernteRaw } = await (supabase.from('ernte_parzellen') as any)
    .select(`
      id, klosterneuburger, qualitaetsstufe, menge_kg, jahrgang_id,
      weingarten:weingarten_id(id, name, trauben_herkunft_code),
      grundstueck:grundstueck_id(id, gst_nr, rebsorte, trauben_herkunft_code),
      jahrgang:jahrgang_id(id, jahrgang)
    `)
    .not('menge_kg', 'is', null)
    .order('jahrgang_id', { ascending: false })

  const ernteOptions = (ernteRaw ?? []) as R[]

  // Kontakte + Firmen für Abnehmer-Dropdown
  const { data: kontakteRaw } = await (supabase.from('kontakte') as any)
    .select('id, vorname, nachname, betrieb_nr')
    .eq('tenant_id', membership.tenantId)
    .order('nachname')

  const { data: firmenRaw } = await (supabase.from('firmen') as any)
    .select('id, name, betrieb_nr')
    .eq('tenant_id', membership.tenantId)
    .order('name')

  const kontakte = (kontakteRaw ?? []) as R[]
  const firmen   = (firmenRaw   ?? []) as R[]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-sm text-s112-muted">
        <Link href="/weinhandel" className="hover:text-s112-teal transition-colors">Warenlager</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Traubenverkauf</span>
      </div>
      <div>
        <h1 className="text-xl font-bold text-gray-900">Traubenverkauf</h1>
        <p className="text-sm text-s112-muted mt-0.5">Verkauf von Weintrauben gem. § 3 Weingesetz-Formularverordnung</p>
      </div>

      <TraubenverkaufClient
        verkaufe={verkaufe}
        ernteOptions={ernteOptions}
        kontakte={kontakte}
        firmen={firmen}
        writeOk={writeOk}
      />
    </div>
  )
}
