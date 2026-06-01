import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('firmen') as any)
    .select('kundennummer, name, segment, email, telefon, telefon_vorwahl, strasse, plz, ort, land, uid_nummer, zahlungsziel_tage, is_lead, sonderrabatt_pct, notizen')
    .eq('aktiv', true).order('name')

  const rows = (data ?? []) as R[]
  const escape = (v: unknown) => { if (v == null) return ''; const s = String(v).replace(/"/g, '""'); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s }
  const headers = ['Kundennummer','Firmenname','Segment','E-Mail','Tel.-Vorwahl','Telefon','Straße','PLZ','Ort','Land','UID-Nummer','Zahlungsziel (Tage)','Lead','Sonderrabatt %','Notizen']
  const lines = [headers.join(','), ...rows.map(r => [r.kundennummer,r.name,r.segment,r.email,r.telefon_vorwahl,r.telefon,r.strasse,r.plz,r.ort,r.land,r.uid_nummer,r.zahlungsziel_tage,r.is_lead?'Ja':'Nein',r.sonderrabatt_pct??0,r.notizen].map(escape).join(','))]
  const csv = '\uFEFF' + lines.join('\r\n')
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="firmen_${new Date().toISOString().split('T')[0]}.csv"` } })
}
