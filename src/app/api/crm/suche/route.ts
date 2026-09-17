import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { NextRequest, NextResponse } from 'next/server'

// Serverseitige Namenssuche für Auswahlfelder (17.9.2026):
//   /api/crm/suche?art=kontakt|firma&q=<text>
// Liefert höchstens 30 Treffer { id, label, sub } - statt alle Kontakte/Firmen
// (bei Gebeshuber 8.300 / 4.600) in den Browser zu laden.

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function ilikeSicher(q: string) {
  return q.replace(/[%_,()]/g, ' ').trim()
}

export async function GET(req: NextRequest) {
  const art = req.nextUrl.searchParams.get('art') === 'firma' ? 'firma' : 'kontakt'
  const q = ilikeSicher(req.nextUrl.searchParams.get('q') ?? '')
  const ids = (req.nextUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 50)
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ treffer: [] })
  const supabase = await createSupabaseServerClient()

  if (art === 'firma') {
    let query = (supabase.from('firmen') as any)
      .select('id, name, ort, accountnummer')
      .eq('tenant_id', tenantId).eq('aktiv', true)
    if (ids.length) query = query.in('id', ids)
    else if (q) query = query.or(`name.ilike.%${q}%,accountnummer.ilike.%${q}%,ort.ilike.%${q}%`)
    const { data } = await query.order('name').limit(30)
    return NextResponse.json({
      treffer: ((data ?? []) as R[]).map(f => ({ id: f.id, label: f.name, sub: [f.accountnummer, f.ort].filter(Boolean).join(' · ') || undefined })),
    })
  }

  let query = (supabase.from('kontakte') as any)
    .select('id, vorname, nachname, ort, accountnummer')
    .eq('tenant_id', tenantId).eq('aktiv', true)
  if (ids.length) query = query.in('id', ids)
  else if (q) {
    // Mehrere Wörter: jedes Wort muss in Vor-/Nachname/Ort/Accountnummer vorkommen
    for (const w of q.split(/\s+/).filter(Boolean).slice(0, 4)) {
      query = query.or(`nachname.ilike.%${w}%,vorname.ilike.%${w}%,accountnummer.ilike.%${w}%,ort.ilike.%${w}%,email.ilike.%${w}%`)
    }
  }
  const { data } = await query.order('nachname').order('vorname').limit(30)
  return NextResponse.json({
    treffer: ((data ?? []) as R[]).map(k => ({
      id: k.id,
      label: [k.vorname, k.nachname].filter(Boolean).join(' '),
      sub: [k.accountnummer, k.ort].filter(Boolean).join(' · ') || undefined,
    })),
  })
}
