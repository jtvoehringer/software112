import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle, inBloecken } from '@/lib/supabase/alle'
import { filterAusParams, ladeFirmenSeite, ladeZaehler } from '@/lib/crm/liste'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import { ladeCrmGemeinschaft } from '@/lib/crm/gemeinschaft'
import Link from '@/components/ui/Link'
import FirmenClient from './FirmenClient'
import type { FirmaRow } from '@/lib/crm/types'

export const metadata: Metadata = { title: 'Firmen – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function FirmenPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const filter = filterAusParams(sp, 'firma')
  const supabase = await createSupabaseServerClient()
  const role    = await getCurrentUserRole()
  const writeOk = canWrite(role, 'crm')
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const gemeinschaft = await ladeCrmGemeinschaft(supabase, tenantId)   // KAN-212
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Serverseitig gefiltert und seitenweise (17.9.2026, lib/crm/liste.ts);
  // Ansprechpersonen nur für die geladenen Firmen.
  const [{ rows: fRaw, gesamt }, zaehler] = await Promise.all([
    ladeFirmenSeite(supabase, tenantId, filter),
    ladeZaehler(supabase, tenantId, 'firma'),
  ])
  const ids = fRaw.map(f => f.id as string)
  // inBloecken: bis zu 1.000 Firmen – 1.000 IDs in einer URL scheitern (ab ≈ 350), die Ansprechpersonen blieben leer.
  // Eine Firma liegt immer ganz in einem Block, die Reihenfolge je Firma bleibt.
  const kRaw = geladen(await inBloecken(ids, b => alle(tf((supabase.from('kontakte') as any)
    .select('id, vorname, nachname, segment, firma_id')
    .eq('aktiv', true)
    .in('firma_id', b)
    .order('nachname').order('id')))), 'Kontakte')

  const firmen: FirmaRow[] = ((fRaw ?? []) as R[]).map(f => ({
    id: f.id, accountnummer: f.accountnummer ?? null, name: f.name, segment: f.segment,
    strasse: f.strasse ?? null, plz: f.plz ?? null, ort: f.ort ?? null, land: f.land ?? null,
    telefon: f.telefon ?? null, email: f.email ?? null, email_weitere: (f.email_weitere as string[] | null) ?? [], website: f.website ?? null,
    uid_nummer: f.uid_nummer ?? null, betrieb_nr: f.betrieb_nr ?? null, debitor_nr: f.debitor_nr ?? null, kreditlimit: f.kreditlimit ?? null,
    mobil: f.mobil ?? null, mobil_vorwahl: (f.mobil_vorwahl as string | null) ?? '+43',
    zahlungsziel_tage: f.zahlungsziel_tage ?? 30, waehrung: f.waehrung ?? null,
    skonto_pct: f.skonto_pct ?? 0, skonto_tage: f.skonto_tage ?? 10,   // fehlten bis 02.10.2026 – Speichern aus der Liste setzte Skonto zurück
    notizen: f.notizen ?? null, aktiv: f.aktiv ?? true,
    rabattgruppe_id: f.rabattgruppe_id ?? null,
    rabattgruppe_name: (f.rabattgruppe as R | null)?.name ?? null,
    rabattgruppe_pct: (f.rabattgruppe as R | null)?.rabatt_pct ?? null,
    sonderrabatt_pct: parseFloat(f.sonderrabatt_pct) || 0,
    is_lead:          !!(f.is_lead as boolean),
    // Migration 167 – Default ist_kunde=true, ist_lieferant=false, daher hier
    // ebenso defaulten falls die Spalte bei Altdaten (vor der Migration) noch
    // null sein sollte.
    ist_kunde:        f.ist_kunde ?? true,
    ist_lieferant:    f.ist_lieferant ?? false,
    telefon_vorwahl:  (f.telefon_vorwahl as string | null) ?? '+43',
  }))

  // Rabattgruppen (non-fatal – Tabelle existiert erst nach Migration 031)
  let rRaw: R[] = []
  try {
    const r = geladen(await tf((supabase.from('rabattgruppen') as any)
      .select('id, name, rabatt_pct').order('rabatt_pct')), 'Rabattgruppen')
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
        <Link href="/crm" className="hover:text-s112-blue-700 transition-colors">CRM</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Firmen</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Firmen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Gastronomie, Handel, Export & Großhandel</p>
          {/* KAN-212: Kontakte/Firmen eines Partners der CRM-Gemeinschaft (nur lesen) */}
          {gemeinschaft.alsNutzer.length > 0 && (
            <Link href="/crm/gemeinsam?art=firmen" className="text-xs text-s112-blue-700 hover:underline">
              Gemeinsames CRM: auch Firmen aus {gemeinschaft.alsNutzer.map(p => p.name).join(', ')} →
            </Link>
          )}
        </div>
        <span className="text-sm text-s112-muted">{zaehler.gesamt} Firmen</span>
      </div>

      <FirmenClient firmen={firmen} kontakteMap={kontakteMap} rabattgruppen={rabattgruppen} writeOk={writeOk} filter={filter} gesamt={gesamt} zaehler={zaehler} />
    </div>
  )
}
