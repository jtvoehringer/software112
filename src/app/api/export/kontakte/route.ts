import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { NextResponse } from 'next/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { darfDatenexport } from '@/lib/auth/modul'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Kontakte als CSV – aus Controlling → Datenexport und vom CSV-Knopf der Kontaktliste.
// Rechte (KAN-54): Datenexport-Recht (Modul Controlling + Auswertungen) oder
// Schreibrecht im CRM (nur dann zeigt die Kontaktliste den Knopf).
export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  if (!canWrite(membership, 'crm') && !(await darfDatenexport(membership)))
    return NextResponse.json({ fehler: 'Kein Recht für den Export der Kontakte' }, { status: 403 })

  const supabase = await createSupabaseServerClient()
  const { data, error } = await alle((supabase.from('kontakte') as any)
    .select('accountnummer, vorname, nachname, segment, email, email_weitere, telefon, telefon_vorwahl, mobil, mobil_vorwahl, strasse, plz, ort, land, stammkunde, is_lead, sonderrabatt_pct, notizen, erstellt_am')
    .eq('tenant_id', tenantId).eq('aktiv', true).order('nachname').order('id'))
  // alle() liefert bei einem Fehler die bis dahin geholten Blöcke – kein halber Export
  if (error) return NextResponse.json({ fehler: 'Export fehlgeschlagen' }, { status: 500 })

  const rows = (data ?? []) as R[]
  const escape = (v: unknown) => { if (v == null) return ''; const s = String(v).replace(/"/g, '""'); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s }
  const headers = ['Accountnummer','Vorname','Nachname','Segment','E-Mail','Weitere E-Mails','Tel.-Vorwahl','Telefon','Mobil-Vorwahl','Mobil','Straße','PLZ','Ort','Land','Stammkunde','Lead','Sonderrabatt %','Notizen','Angelegt am']
  const lines = [headers.join(','), ...rows.map(r => [r.accountnummer,r.vorname,r.nachname,r.segment,r.email,((r.email_weitere ?? []) as string[]).join('; '),r.telefon_vorwahl,r.telefon,r.mobil_vorwahl,r.mobil,r.strasse,r.plz,r.ort,r.land,r.stammkunde?'Ja':'Nein',r.is_lead?'Ja':'Nein',r.sonderrabatt_pct??0,r.notizen,r.erstellt_am?new Date(r.erstellt_am).toLocaleDateString('de-AT'):''].map(escape).join(','))]
  const csv = '\uFEFF' + lines.join('\r\n')
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="kontakte_${new Date().toISOString().split('T')[0]}.csv"`, 'Cache-Control': 'no-store' } })
}
