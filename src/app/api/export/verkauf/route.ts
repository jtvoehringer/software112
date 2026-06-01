import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('verkaufsposten') as any)
    .select('datum, rechnungsnummer, bezahlt, storniert, kontakt:kontakte(vorname,nachname,kundennummer), firma:firmen(name,kundennummer), verkauf_positionen(name,menge,einheit,preis_brutto,rabatt_pct,sonderrabatt_pct,ust_satz)')
    .eq('aktiv', true).order('datum', { ascending: false })
  const rows = (data ?? []) as R[]
  const esc = (v: unknown) => { if (v==null) return ''; const s=String(v).replace(/"/g,'""'); return s.includes(';')||s.includes('"')||s.includes('\n')?`"${s}"`:s }
  const headers = ['Datum','Rechnungsnummer','Kundennummer','Kunde','Artikel','Menge','Einheit','Preis (€)','Rabatt %','Sonderrabatt %','USt %','Zeilenbetrag (€)','Bezahlt','Storniert']
  const lines = [headers.join(';')]
  rows.forEach((p: R) => {
    const kdnr = p.kontakt?.kundennummer ?? p.firma?.kundennummer ?? ''
    const kunde = p.kontakt ? [p.kontakt.vorname,p.kontakt.nachname].filter(Boolean).join(' ') : p.firma?.name ?? '–'
    ;(p.verkauf_positionen ?? []).forEach((pos: R) => {
      const brutto = (Number(pos.preis_brutto)||0)*(Number(pos.menge)||0)
      const r1=1-(Number(pos.rabatt_pct)||0)/100, r2=1-(Number(pos.sonderrabatt_pct)||0)/100
      lines.push([p.datum,p.rechnungsnummer,kdnr,kunde,pos.name,pos.menge,pos.einheit,pos.preis_brutto?.toFixed(2).replace('.',','),pos.rabatt_pct,pos.sonderrabatt_pct,pos.ust_satz,(brutto*r1*r2).toFixed(2).replace('.',','),p.bezahlt?'Ja':'Nein',p.storniert?'Ja':'Nein'].map(esc).join(';'))
    })
  })
  return new NextResponse('﻿'+lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="verkauf_${new Date().toISOString().split('T')[0]}.csv"` } })
}
