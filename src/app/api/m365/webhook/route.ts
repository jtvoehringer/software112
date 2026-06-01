import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { graphGet, getValidAccessToken } from '@/lib/m365/graph'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// Graph sendet validationToken bei Subscription-Erstellung
export async function POST(req: NextRequest) {
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) return new NextResponse(validationToken, { headers: { 'Content-Type': 'text/plain' } })

  try {
    const body = await req.json() as R
    const admin = createSupabaseAdminClient()

    for (const notification of (body.value ?? []) as R[]) {
      const tenantId = notification.clientState  // wir speichern tenant_id als clientState

      const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
        .select('*').eq('tenant_id', tenantId).maybeSingle()
      if (!cfg) continue

      // Kontakte + Firmen laden für Matching
      const [{ data: kRaw }, { data: fRaw }] = await Promise.all([
        (admin.from('kontakte') as any).select('id, email').eq('aktiv', true).eq('tenant_id', tenantId).not('email', 'is', null),
        (admin.from('firmen') as any).select('id, email').eq('aktiv', true).eq('tenant_id', tenantId).not('email', 'is', null),
      ])
      const emailMap: Record<string, { kontakt_id?: string; firma_id?: string }> = {}
      ;(kRaw ?? []).forEach((k: R) => { if (k.email) emailMap[k.email.toLowerCase()] = { kontakt_id: k.id } })
      ;(fRaw ?? []).forEach((f: R) => { if (f.email) emailMap[f.email.toLowerCase()] = { firma_id: f.id } })

      // Mail via Graph laden
      const msgId = notification.resourceData?.id
      if (!msgId) continue
      const accessToken = await getValidAccessToken(cfg as R, admin)
      const msg = await graphGet(accessToken, `/me/messages/${msgId}?$select=subject,from,receivedDateTime,internetMessageId`)
      const from  = msg.from?.emailAddress?.address?.toLowerCase() ?? ''
      const match = emailMap[from]
      if (!match) continue

      const { count } = await (admin.from('aktivitaeten') as any)
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('art', 'email')
        .ilike('beschreibung', `%${msg.internetMessageId ?? ''}%`)
      if ((count ?? 0) > 0) continue

      await (admin.from('aktivitaeten') as any).insert({
        tenant_id: tenantId, kontakt_id: match.kontakt_id ?? null, firma_id: match.firma_id ?? null,
        art: 'email', betreff: msg.subject ?? '(kein Betreff)',
        beschreibung: `Eingehende E-Mail von ${from}`,
        datum: msg.receivedDateTime?.split('T')[0] ?? new Date().toISOString().split('T')[0],
        erledigt: false, ganztags: true,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('M365 Webhook error:', err)
    return NextResponse.json({ ok: true })  // immer 200 zurück an Graph
  }
}
