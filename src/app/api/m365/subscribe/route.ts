import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { graphPost, getValidAccessToken } from '@/lib/m365/graph'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()

    const { data: membership } = await (supabase.from('tenant_memberships') as any)
      .select('tenant_id').limit(1).single()
    const tenantId = (membership as R | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
      .select('*').eq('tenant_id', tenantId).maybeSingle()
    const c = cfg as R | null
    if (!c?.m365_modul_aktiv) return NextResponse.json({ fehler: 'M365 nicht aktiv' }, { status: 400 })

    const accessToken = await getValidAccessToken(c, admin)

    // Webhook-URL aus Request-Host ableiten
    const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'software112.icp-consultants.at'
    const proto = req.headers.get('x-forwarded-proto') ?? 'https'
    const notificationUrl = `${proto}://${host}/api/m365/webhook`

    // Ablauf: max 4230 Minuten (≈ 3 Tage) für Mail-Subscriptions
    const expiresAt = new Date(Date.now() + 4230 * 60 * 1000).toISOString()

    // Bestehende Subscription erneuern falls vorhanden
    if (c.m365_webhook_sub_id) {
      try {
        await graphPost(accessToken, `/subscriptions/${c.m365_webhook_sub_id}`, {
          expirationDateTime: expiresAt,
        })
        await (admin.from('tenant_einstellungen') as any)
          .update({ m365_webhook_expires: expiresAt }).eq('tenant_id', tenantId)
        return NextResponse.json({ ok: true, aktion: 'erneuert', expires: expiresAt })
      } catch {
        // Subscription abgelaufen → neu erstellen
      }
    }

    // Neue Subscription erstellen
    const sub = await graphPost(accessToken, '/subscriptions', {
      changeType:           'created',
      notificationUrl,
      resource:             'me/mailFolders(\'inbox\')/messages',
      expirationDateTime:   expiresAt,
      clientState:          tenantId,  // zur Identifikation im Webhook
    })

    await (admin.from('tenant_einstellungen') as any).update({
      m365_webhook_sub_id: (sub as R).id,
      m365_webhook_expires: expiresAt,
    }).eq('tenant_id', tenantId)

    return NextResponse.json({ ok: true, aktion: 'erstellt', sub_id: (sub as R).id, expires: expiresAt })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
