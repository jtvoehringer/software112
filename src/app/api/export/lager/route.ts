import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { darfDatenexport } from '@/lib/auth/modul'
import { alle } from '@/lib/supabase/alle'
import { getRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const ML: Record<number,string> = {187:'0,187 L',375:'0,375 L',500:'0,500 L',750:'0,75 L',1000:'1,0 L',1500:'1,5 L',3000:'3,0 L',6000:'6,0 L'}
// Lagerbestand als CSV (Controlling → Datenexport). Rechte (KAN-54): Datenexport-Recht –
// Modul Controlling + Auswertungen, wie das Layout von /controlling/export.
export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  if (!(await darfDatenexport(membership)))
    return NextResponse.json({ fehler: 'Datenexport nicht freigeschaltet (Modul Controlling und Recht „Auswertungen“ nötig)' }, { status: 403 })

  const supabase = await createSupabaseServerClient()
  const { data, error } = await alle((supabase.from('fuellungen') as any)
    .select('name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto, aktiv')
    .eq('tenant_id', tenantId).eq('aktiv', true).order('name').order('id'))
  // alle() statt 1.000er-Deckel; bei einem Fehler kein halber Export
  if (error) return NextResponse.json({ fehler: 'Export fehlgeschlagen' }, { status: 500 })
  const rows = (data ?? []) as R[]
  const esc = (v: unknown) => { if (v==null) return ''; const s=String(v).replace(/"/g,'""'); return s.includes(';')||s.includes('"')||s.includes('\n')?`"${s}"`:s }
  const headers = ['Name','Jahrgang','Rebsorte','Kürzel','Flaschengröße','Bestand (Fl.)','VK-Preis (€)','Lagerwert (€)']
  const lines = [headers.join(';'), ...rows.map(r => [
    r.name, r.jahrgang, r.rebsorte, getRebsorteKuerzel(r.rebsorte), ML[r.flaschengroesse_ml]??`${r.flaschengroesse_ml} ml`,
    r.bestand_flaschen, r.vk_preis_brutto?.toFixed(2).replace('.',','),
    r.vk_preis_brutto!=null?(r.bestand_flaschen*r.vk_preis_brutto).toFixed(2).replace('.',','):'',
  ].map(esc).join(';'))]
  return new NextResponse('﻿'+lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="lagerbestand_${new Date().toISOString().split('T')[0]}.csv"`, 'Cache-Control': 'no-store' } })
}
