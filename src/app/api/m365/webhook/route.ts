import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { graphGet, getValidAccessToken } from '@/lib/m365/graph'
import { alle } from '@/lib/supabase/alle'
import { pruefeClientState } from '@/lib/m365/clientState'
import { heuteWien, wienTag } from '@/lib/datum/wien'
import { ereignisMelden } from '@/lib/system/ereignis'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// Graph sendet validationToken bei Subscription-Erstellung
// zwei-faktor-ausnahme: Microsoft-Graph-Benachrichtigung ohne Benutzersitzung – nur mit gültigem clientState (HMAC, S8) und passender subscriptionId
// schreibsperre-ausnahme: Microsoft-Graph-Benachrichtigung ohne Benutzersitzung (Webhook)
export async function POST(req: NextRequest) {
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) return new NextResponse(validationToken, { headers: { 'Content-Type': 'text/plain' } })

  try {
    const body = await req.json() as R
    const admin = createSupabaseAdminClient()

    for (const notification of (body.value ?? []) as R[]) {
      // S8: Prüfwert verifizieren (HMAC), altes Format nur mit passender subscriptionId
      const cs = pruefeClientState(notification.clientState)
      if (!cs) { console.warn('M365 Webhook: ungültiger clientState verworfen'); continue }
      const tenantId = cs.tenantId

      const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
        .select('*').eq('tenant_id', tenantId).maybeSingle()
      if (!cfg) continue
      if (!notification.subscriptionId || notification.subscriptionId !== (cfg as R).m365_webhook_sub_id) {
        console.warn('M365 Webhook: unbekannte subscriptionId verworfen'); continue
      }

      // Kontakte + Firmen laden für Matching
      // Standard- und weitere Adressen (Migration 211)
      const [{ data: kRaw }, { data: fRaw }] = await Promise.all([
        alle((admin.from('kontakte') as any).select('id, email, email_weitere').eq('aktiv', true).eq('tenant_id', tenantId).order('id')),
        alle((admin.from('firmen') as any).select('id, email, email_weitere').eq('aktiv', true).eq('tenant_id', tenantId).order('id')),
      ])
      const emailMap: Record<string, { kontakt_id?: string; firma_id?: string }> = {}
      ;(fRaw ?? []).forEach((f: R) => { for (const e of [f.email, ...(f.email_weitere ?? [])]) if (e) emailMap[String(e).toLowerCase()] = { firma_id: f.id } })
      ;(kRaw ?? []).forEach((k: R) => { for (const e of [k.email, ...(k.email_weitere ?? [])]) if (e) emailMap[String(e).toLowerCase()] = { kontakt_id: k.id } })

      // Mail via Graph laden
      const msgId = notification.resourceData?.id
      if (!msgId) continue
      const accessToken = await getValidAccessToken(cfg as R, admin)
      const msg = await graphGet(accessToken, `/me/messages/${msgId}?$select=subject,from,receivedDateTime,internetMessageId,bodyPreview,conversationId`)
      const from  = msg.from?.emailAddress?.address?.toLowerCase() ?? ''
      const match = emailMap[from]
      if (!match) continue

      const { count } = await (admin.from('aktivitaeten') as any)
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('art', 'email')
        .ilike('beschreibung', `%${msg.internetMessageId ?? ''}%`)
      if ((count ?? 0) > 0) continue

      // KAN-246: Fehler protokollieren – sonst ging die eingehende E-Mail still verloren (Webhook antwortet trotzdem 202)
      const { error: aktFehler } = await (admin.from('aktivitaeten') as any).insert({
        tenant_id: tenantId, kontakt_id: match.kontakt_id ?? null, firma_id: match.firma_id ?? null,
        art: 'email', betreff: msg.subject ?? '(kein Betreff)',
        beschreibung: [msg.bodyPreview ? msg.bodyPreview.slice(0, 250) : `Eingehende E-Mail von ${from}`, msg.conversationId ? `[thread:${msg.conversationId.slice(-8)}]` : null].filter(Boolean).join(' '),
        datum: msg.receivedDateTime ? wienTag(msg.receivedDateTime) : heuteWien(),   // KAN-237: Wiener Kalendertag
        erledigt: false, ganztags: true,
      })
      if (aktFehler) void ereignisMelden({ art: 'db', quelle: 'm365/webhook/aktivitaeten', meldung: aktFehler.message })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('M365 Webhook error:', String(err))
    return NextResponse.json({ ok: true })  // immer 200 zurück an Graph
  }
}
