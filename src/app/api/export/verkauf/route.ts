import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export async function GET() {
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('verkaufsposten') as any)
    .select('datum, rechnungsnummer, bezahlt, storniert, kontakt:kontakte!kontakt_id(vorname,nachname,accountnummer), firma:firmen(name,accountnummer,debitor_nr), verkauf_positionen(name,menge,einheit,preis_brutto,rabatt_pct,sonderrabatt_pct,ust_satz)')
    .eq('tenant_id', tenantId).eq('aktiv', true).order('datum', { ascending: false })
  const rows = (data ?? []) as R[]
  const esc = (v: unknown) => { if (v==null) return ''; const s=String(v).replace(/"/g,'""'); return s.includes(';')||s.includes('"')||s.includes('\n')?`"${s}"`:s }
  // DebitorNr. (BMD-Konto der Firma, Migration 191) als eigene Spalte neben der
  // internen Accountnummer - für die Buchhaltung/BMD-Zuordnung, ohne die
  // Bedeutung der bestehenden Accountnummer-Spalte zu verändern.
  const headers = ['Datum','Rechnungsnummer','Accountnummer','DebitorNr.','Kunde','Artikel','Menge','Einheit','Preis (€)','Rabatt %','Sonderrabatt %','USt %','Zeilenbetrag (€)','Bezahlt','Storniert']
  const lines = [headers.join(';')]
  rows.forEach((p: R) => {
    const kdnr = p.kontakt?.accountnummer ?? p.firma?.accountnummer ?? ''
    const debitorNr = p.firma?.debitor_nr ?? ''
    const kunde = p.kontakt ? [p.kontakt.vorname,p.kontakt.nachname].filter(Boolean).join(' ') : p.firma?.name ?? '–'
    ;(p.verkauf_positionen ?? []).forEach((pos: R) => {
      const brutto = (Number(pos.preis_brutto)||0)*(Number(pos.menge)||0)
      const r1=1-(Number(pos.rabatt_pct)||0)/100, r2=1-(Number(pos.sonderrabatt_pct)||0)/100
      lines.push([p.datum,p.rechnungsnummer,kdnr,debitorNr,kunde,pos.name,pos.menge,pos.einheit,pos.preis_brutto?.toFixed(2).replace('.',','),pos.rabatt_pct,pos.sonderrabatt_pct,pos.ust_satz,(brutto*r1*r2).toFixed(2).replace('.',','),p.bezahlt?'Ja':'Nein',p.storniert?'Ja':'Nein'].map(esc).join(';'))
    })
  })
  return new NextResponse('﻿'+lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="verkauf_${new Date().toISOString().split('T')[0]}.csv"` } })
}
