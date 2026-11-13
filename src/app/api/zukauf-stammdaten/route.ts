import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { nurBelegendeChargen } from '@/lib/kellerbuch/leereGebinde'
import { NextResponse } from 'next/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const dynamic = 'force-dynamic'

export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const membership = await getCurrentMembership()
    const leseSperre = leseKonflikt(membership, 'lager')   // KAN-455: Lesebereich je Profil
    if (leseSperre) return leseSperre
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 401 })

    const supabase = await createSupabaseServerClient()

    const [behaelterRows, { data: weinausbau, error: weinausbauErr }, { data: laender, error: laenderErr }] = await Promise.all([
      // eigene + freigegebene Gebinde, fremd belegte ausgenommen (Kellergemeinschaft, Migration 203)
      ladeBehaelter(supabase, tenantId, { alsZiel: true }),
      // Chargen in den Gebinden (Inhalt der Ziel-Gebinde-Auswahl) – KAN-358: Belegung wie Umzug und Abstufen (leereGebinde.ts)
      alle(nurBelegendeChargen((supabase.from('weinausbau') as any)
        .select('id, name, menge_liter, behaelter_id, rebsorte')
        .eq('tenant_id', tenantId))
        .order('name').order('id')),
      // KAN-186: Ursprungsland des Zukaufs (land_iso) – globaler Katalog ohne tenant_id (ISO-Länder)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('kat_land') as any).select('iso2, name_de, eu').order('name_de'),
    ])
    { const ladeFehler = [weinausbauErr, laenderErr].find(Boolean)
      if (ladeFehler) return NextResponse.json({ error: `Daten konnten nicht geladen werden: ${ladeFehler.message}` }, { status: 500 }) }

    const behaelter = behaelterRows.map(b => ({ id: b.id, name: b.anzeigeName, typ: b.typ, volumen_liter: b.volumen_liter }))
    // KAN-353: crm_schreiben – Lieferant direkt aus der Partner-Suche anlegen nur mit Schreibrecht CRM (canWrite nie im Client)
    return NextResponse.json({ behaelter, weinausbau: weinausbau ?? [], laender: laender ?? [], crm_schreiben: !!membership && canWrite(membership, 'crm') })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
