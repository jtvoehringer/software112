import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })

  const von = req.nextUrl.searchParams.get('von') ?? ''
  const bis = req.nextUrl.searchParams.get('bis') ?? ''

  const { data } = await (supabase.from('verkaufsposten') as any)
    .select('id, datum, rechnungsnummer, storniert, kontakt:kontakte!kontakt_id(nachname, vorname, kundennummer), firma:firmen(name, kundennummer), verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct, ust_satz)')
    .eq('tenant_id', tenantId).eq('aktiv', true).eq('storniert', false)
    .gte('datum', von).lte('datum', bis)
    .order('datum')

  const posten = (data ?? []) as R[]
  const esc = (v: unknown) => { const s = String(v ?? '').replace(/"/g, '""'); return s.includes(';') || s.includes('"') ? `"${s}"` : s }

  const zeilen = ['BDAT;BELNR;KONTO;GEGKTO;BETRAG;STEUER;BTEXT;KOSTL']
  for (const p of posten) {
    const datum = p.datum?.replace(/-/g, '') ?? ''
    const belnr = p.rechnungsnummer ?? p.id.slice(0, 8)
    const kdnr  = p.kontakt?.kundennummer ?? p.firma?.kundennummer ?? '10000'
    const name  = p.kontakt ? [p.kontakt.vorname, p.kontakt.nachname].filter(Boolean).join(' ') : (p.firma?.name ?? '–')

    for (const pos of (p.verkauf_positionen ?? []) as R[]) {
      const brutto  = (Number(pos.preis_brutto)||0) * (Number(pos.menge)||0)
      const r1 = 1 - (Number(pos.rabatt_pct)||0)/100
      const r2 = 1 - (Number(pos.sonderrabatt_pct)||0)/100
      const netto   = brutto * r1 * r2
      const ustSatz = Number(pos.ust_satz) || 13
      const steuer  = ustSatz === 20 ? 'U20' : 'U13'
      const gegkto  = ustSatz === 20 ? '40020' : '40013'

      zeilen.push([datum, belnr, kdnr, gegkto,
        netto.toFixed(2).replace('.', ','),
        steuer, esc(name), ''].join(';'))
    }
  }

  const csv = '﻿' + zeilen.join('\r\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bmd_ntcs_${von}_${bis}.csv"`,
    },
  })
}
