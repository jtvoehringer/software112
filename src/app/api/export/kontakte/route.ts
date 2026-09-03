import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function GET() {
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

  const supabase = await createSupabaseServerClient()
  const { data } = await alle((supabase.from('kontakte') as any)
    .select('accountnummer, vorname, nachname, segment, email, telefon, telefon_vorwahl, mobil, mobil_vorwahl, strasse, plz, ort, land, stammkunde, is_lead, sonderrabatt_pct, notizen, erstellt_am')
    .eq('tenant_id', tenantId).eq('aktiv', true).order('nachname').order('id'))

  const rows = (data ?? []) as R[]
  const escape = (v: unknown) => { if (v == null) return ''; const s = String(v).replace(/"/g, '""'); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s }
  const headers = ['Accountnummer','Vorname','Nachname','Segment','E-Mail','Tel.-Vorwahl','Telefon','Mobil-Vorwahl','Mobil','Straße','PLZ','Ort','Land','Stammkunde','Lead','Sonderrabatt %','Notizen','Angelegt am']
  const lines = [headers.join(','), ...rows.map(r => [r.accountnummer,r.vorname,r.nachname,r.segment,r.email,r.telefon_vorwahl,r.telefon,r.mobil_vorwahl,r.mobil,r.strasse,r.plz,r.ort,r.land,r.stammkunde?'Ja':'Nein',r.is_lead?'Ja':'Nein',r.sonderrabatt_pct??0,r.notizen,r.erstellt_am?new Date(r.erstellt_am).toLocaleDateString('de-AT'):''].map(escape).join(','))]
  const csv = '\uFEFF' + lines.join('\r\n')
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="kontakte_${new Date().toISOString().split('T')[0]}.csv"` } })
}
