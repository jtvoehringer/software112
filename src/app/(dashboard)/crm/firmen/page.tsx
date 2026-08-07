import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import FirmenClient from './FirmenClient'
import type { FirmaRow } from '@/lib/crm/types'

export const metadata: Metadata = { title: 'Firmen – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function FirmenPage() {
  const supabase = await createSupabaseServerClient()
  const role    = await getCurrentUserRole()
  const writeOk = canWrite(role)

  const [{ data: fRaw }, { data: kRaw }] = await Promise.all([
    (supabase.from('firmen') as any)
      .select('id, kundennummer, name, segment, strasse, plz, ort, land, telefon, telefon_vorwahl, email, website, uid_nummer, betrieb_nr, kreditlimit, zahlungsziel_tage, skonto_pct, skonto_tage, waehrung, notizen, aktiv, is_lead, sonderrabatt_pct, rabattgruppe_id, rabattgruppe:rabattgruppe_id(id, name, rabatt_pct)')
      .eq('aktiv', true)
      .order('name'),

    (supabase.from('kontakte') as any)
      .select('id, vorname, nachname, segment, firma_id')
      .eq('aktiv', true)
      .not('firma_id', 'is', null),

  ])

  const firmen: FirmaRow[] = ((fRaw ?? []) as R[]).map(f => ({
    id: f.id, kundennummer: f.kundennummer ?? null, name: f.name, segment: f.segment,
    strasse: f.strasse ?? null, plz: f.plz ?? null, ort: f.ort ?? null, land: f.land ?? null,
    telefon: f.telefon ?? null, email: f.email ?? null, website: f.website ?? null,
    uid_nummer: f.uid_nummer ?? null, kreditlimit: f.kreditlimit ?? null,
    zahlungsziel_tage: f.zahlungsziel_tage ?? 30, waehrung: f.waehrung ?? null,
    notizen: f.notizen ?? null, aktiv: f.aktiv ?? true,
    rabattgruppe_id: f.rabattgruppe_id ?? null,
    rabattgruppe_name: (f.rabattgruppe as R | null)?.name ?? null,
    rabattgruppe_pct: (f.rabattgruppe as R | null)?.rabatt_pct ?? null,
    sonderrabatt_pct: parseFloat(f.sonderrabatt_pct) || 0,
    is_lead:          !!(f.is_lead as boolean),
    telefon_vorwahl:  (f.telefon_vorwahl as string | null) ?? '+43',
  }))

  // Rabattgruppen (non-fatal – Tabelle existiert erst nach Migration 031)
  let rRaw: R[] = []
  try {
    const { data: r } = await (supabase.from('rabattgruppen') as any)
      .select('id, name, rabatt_pct').order('rabatt_pct')
    rRaw = (r ?? []) as R[]
  } catch { /* Tabelle noch nicht vorhanden */ }

  const rabattgruppen = rRaw.map(r => ({
    id: r.id as string, name: r.name as string, rabatt_pct: Number(r.rabatt_pct),
  }))

  // Kontakte nach firma_id gruppieren
  const kontakteMap: Record<string, { id: string; vorname: string | null; nachname: string; segment: string }[]> = {}
  for (const k of (kRaw ?? []) as R[]) {
    if (!k.firma_id) continue
    if (!kontakteMap[k.firma_id]) kontakteMap[k.firma_id] = []
    kontakteMap[k.firma_id].push({ id: k.id, vorname: k.vorname ?? null, nachname: k.nachname, segment: k.segment })
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/crm" className="hover:text-s112-teal transition-colors">CRM</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Firmen</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Firmen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Gastronomie, Handel, Export & Großhandel</p>
        </div>
        <span className="text-sm text-s112-muted">{firmen.length} Firmen</span>
      </div>

      <FirmenClient firmen={firmen} kontakteMap={kontakteMap} rabattgruppen={rabattgruppen} writeOk={writeOk} />
    </div>
  )
}
