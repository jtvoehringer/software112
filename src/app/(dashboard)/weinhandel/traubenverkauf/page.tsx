import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
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
      qualitaetsstufe, herkunft_code, gesundheit, liefernummer, notizen, jahrgang_id, grundstueck_id, zukauf_posten_id,
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
  const { data: kontakteRaw } = await alle((supabase.from('kontakte') as any)
    .select('id, vorname, nachname, betrieb_nr')
    .eq('tenant_id', membership.tenantId)
    .order('nachname').order('id'))

  const { data: firmenRaw } = await alle((supabase.from('firmen') as any)
    .select('id, name, betrieb_nr')
    .eq('tenant_id', membership.tenantId)
    .order('name').order('id'))

  const kontakte = (kontakteRaw ?? []) as R[]
  const firmen   = (firmenRaw   ?? []) as R[]

  // Zugekaufte Trauben (art='trauben') - stehen zusätzlich zur eigenen Ernte
  // als verkaufbare Menge zur Verfügung (siehe Migration 141).
  const { data: zukaufRaw } = await (supabase.from('zukauf_posten') as any)
    .select(`
      id, datum, menge, rebsorte, herkunft,
      lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname),
      lieferant_firma:firmen!lieferant_firma_id(name)
    `)
    .eq('tenant_id', membership.tenantId)
    .eq('art', 'trauben')
    .eq('aktiv', true)
    .order('datum', { ascending: false })

  const zukaufListe = (zukaufRaw ?? []) as R[]
  const zukaufIds = zukaufListe.map(z => z.id)

  // Bereits verpresste bzw. verkaufte Menge je Zukauf-Posten (tenant-weit, über
  // alle Jahrgänge - dieses Modul ist nicht jahrgangsgebunden).
  const pressedKgByZukauf: Record<string, number> = {}
  if (zukaufIds.length > 0) {
    const { data: pressedRaw } = await (supabase.from('pressung_weingaerten') as any)
      .select('zukauf_posten_id, trauben_kg')
      .in('zukauf_posten_id', zukaufIds)
    for (const p of (pressedRaw ?? []) as R[]) {
      pressedKgByZukauf[p.zukauf_posten_id] = (pressedKgByZukauf[p.zukauf_posten_id] ?? 0) + (parseFloat(p.trauben_kg) || 0)
    }
  }
  const soldKgByZukauf: Record<string, number> = {}
  for (const v of verkaufe) {
    if (v.zukauf_posten_id) soldKgByZukauf[v.zukauf_posten_id] = (soldKgByZukauf[v.zukauf_posten_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
  }

  const zukaufOptions = zukaufListe.map(z => {
    const mengeKg = parseFloat(z.menge) || 0
    const lieferant = z.lieferant_kontakt
      ? [z.lieferant_kontakt.vorname, z.lieferant_kontakt.nachname].filter(Boolean).join(' ')
      : (z.lieferant_firma?.name ?? '–')
    return {
      id: z.id,
      datum: z.datum,
      lieferant,
      rebsorte: z.rebsorte ?? null,
      herkunft: z.herkunft ?? null,
      menge_kg: mengeKg,
      verfuegbar_kg: Math.max(0, mengeKg - (pressedKgByZukauf[z.id] ?? 0) - (soldKgByZukauf[z.id] ?? 0)),
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel" className="hover:text-s112-blue-700 transition-colors">Weinhandel</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Traubenverkauf</span>
      </div>
      <div>
        <h1 className="text-xl font-semibold text-s112-text">Traubenverkauf</h1>
        <p className="text-sm text-s112-muted mt-0.5">Verkauf von Weintrauben gem. § 3 Weingesetz-Formularverordnung</p>
      </div>

      <TraubenverkaufClient
        verkaufe={verkaufe}
        ernteOptions={ernteOptions}
        zukaufOptions={zukaufOptions}
        kontakte={kontakte}
        firmen={firmen}
        writeOk={writeOk}
      />
    </div>
  )
}
