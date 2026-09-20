import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { graphPost, getValidAccessToken } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ereignisMelden } from '@/lib/system/ereignis'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// Vercel Cron ruft GET auf – delegiert an die POST-Logik mit CRON_SECRET
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })
  }
  // Cron-Request als POST-ähnlichen Request weiterverarbeiten
  const modifiedReq = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
  })
  return POST(new NextRequest(modifiedReq))
}

export async function POST(req: NextRequest) {
  // Auth: CRON_SECRET (Cron-Job) ODER eingeloggte Session (Admin)
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const hasCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`

  try {
    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()

    if (!hasCronAuth) {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })
    }

    // Für Cron: alle aktiven M365-Tenants erneuern; für Session: nur eigenen (aktiven) Tenant.
    // getCurrentMembership() liest den Cookie des eingeloggten Users; bei einem reinen
    // Cron-Aufruf (kein Session-Cookie) liefert es null -> tenantId bleibt undefined und
    // der Cron-Zweig unten (alle Tenants) greift wie zuvor.
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId && !hasCronAuth) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    // Wenn Cron ohne Session: alle M365-Tenants erneuern
    if (hasCronAuth && !tenantId) {
      // Bewusst mandantenübergreifend – dieser Cron-Zweig erneuert die Graph-Webhook-
      // Subscription für JEDEN Mandanten mit aktivem M365-Modul (nicht nur den aktiven
      // Tenant eines Users), siehe Kommentar oben. Läuft mit dem service-role Admin-Client
      // außerhalb jeder User-Session.
      // tenant-isolation-ignore: bewusst mandantenübergreifender Cron-Zweig, siehe Kommentar oben
      const { data: allCfgs } = await (admin.from('tenant_einstellungen') as any)
        .select('*').eq('m365_modul_aktiv', true).not('m365_refresh_token_enc', 'is', null)
      const cfgs = (allCfgs ?? []) as R[]
      let renewed = 0
      const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'software112.icp-consultants.at'
      const proto = req.headers.get('x-forwarded-proto') ?? 'https'
      const notificationUrl = `${proto}://${host}/api/m365/webhook`
      const expiresAt = new Date(Date.now() + 4230 * 60 * 1000).toISOString()
      for (const cfg of cfgs) {
        try {
          const { getValidAccessToken } = await import('@/lib/m365/graph')
          const token = await getValidAccessToken(cfg as R, admin)
          let patched = false
          if (cfg.m365_webhook_sub_id) {
            try {
              const patchRes = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${cfg.m365_webhook_sub_id}`, {
                method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ expirationDateTime: expiresAt }),
              })
              if (patchRes.ok) {
                { const { error: e } = await (admin.from('tenant_einstellungen') as any).update({ m365_webhook_expires: expiresAt }).eq('tenant_id', cfg.tenant_id)
                  if (e) void ereignisMelden({ art: 'db', quelle: 'subscribe/tenant_einstellungen', meldung: e.message }) }
                patched = true
              }
            } catch { /* Subscription abgelaufen → neu erstellen */ }
          }
          if (!patched) {
            // Neu erstellen (entweder kein sub_id oder PATCH fehlgeschlagen)
            const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
              method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ changeType: 'created', notificationUrl, resource: "me/mailFolders('inbox')/messages", expirationDateTime: expiresAt, clientState: cfg.tenant_id }),
            })
            const sub = await res.json() as R
            if (sub.id) await (admin.from('tenant_einstellungen') as any).update({ m365_webhook_sub_id: sub.id, m365_webhook_expires: expiresAt }).eq('tenant_id', cfg.tenant_id)
          }
          renewed++
        } catch { /* weiter */ }
      }
      return NextResponse.json({ ok: true, renewed })
    }

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
        { const { error: e } = await (admin.from('tenant_einstellungen') as any)
          .update({ m365_webhook_expires: expiresAt }).eq('tenant_id', tenantId)
          if (e) void ereignisMelden({ art: 'db', quelle: 'subscribe/tenant_einstellungen', meldung: e.message }) }
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
