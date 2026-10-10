import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { graphPost, getValidAccessToken } from '@/lib/m365/graph'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { ereignisMelden } from '@/lib/system/ereignis'
import { M365TokenFehler } from '@/lib/m365/tokenFehler'
import { erzeugeClientState } from '@/lib/m365/clientState'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { istPlattformAdmin } from '@/lib/auth/plattformAdmin'
import { dbFehlerText } from '@/lib/fehler'

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
      // Sitzungszweig: Zwei-Faktor wie jede benutzergebundene Route (KAN-54)
      const zweiFaktor = await pruefeZweiFaktor()
      if (zweiFaktor) return zweiFaktor
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })
    }

    // Für Cron: alle aktiven M365-Tenants erneuern; für Session: nur eigenen (aktiven) Tenant.
    // getCurrentMembership() liest den Cookie des eingeloggten Users; bei einem reinen
    // Cron-Aufruf (kein Session-Cookie) liefert es null -> tenantId bleibt undefined und
    // der Cron-Zweig unten (alle Tenants) greift wie zuvor.
    const membership = await getCurrentMembership()
    // KAN-25-Nachtrag (02.10.2026): Der Knopf in der Mandantenverwaltung schickt den angezeigten Betrieb mit
    // (?tenant=<id>) – vorher wurde immer der aktive Betrieb aus dem Cookie erneuert. Ein anderer als der aktive
    // Betrieb nur für Plattform-Admins.
    const zielParam = hasCronAuth ? null : req.nextUrl.searchParams.get('tenant')
    let tenantId = membership?.tenantId
    if (!tenantId && !hasCronAuth) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    if (!hasCronAuth) {
      // KAN-25 (01.10.2026): Sitzungszweig nur für Betriebs-Admins (tenant_admin/system_admin) –
      // bisher konnte jedes Mitglied, auch ein Leser, die Webhook-Subscription des Betriebs erneuern
      if (zielParam && zielParam !== tenantId) {
        if (!(await istPlattformAdmin())) return NextResponse.json({ fehler: 'Keine Berechtigung' }, { status: 403 })
        tenantId = zielParam
      } else if (!membership || !canAdmin(membership.role)) {
        return NextResponse.json({ fehler: 'Keine Berechtigung' }, { status: 403 })
      }
      // KAN-5: Sitzungszweig schreibt die Graph-Subscription des Betriebs – im Nur-Lesen-Modus
      // gesperrt; der Cron-Zweig (CRON_SECRET) erneuert bestehende Subscriptions weiter
      const gesperrt = await schreibSperreKonflikt(membership!)   // membership ist hier gesetzt (sonst oben 401)
      if (gesperrt) return gesperrt
    }

    // Wenn Cron ohne Session: alle M365-Tenants erneuern
    if (hasCronAuth && !tenantId) {
      // Bewusst mandantenübergreifend – dieser Cron-Zweig erneuert die Graph-Webhook-
      // Subscription für JEDEN Mandanten mit aktivem M365-Modul (nicht nur den aktiven
      // Tenant eines Users), siehe Kommentar oben. Läuft mit dem service-role Admin-Client
      // außerhalb jeder User-Session.
      // tenant-isolation-ignore: bewusst mandantenübergreifender Cron-Zweig, siehe Kommentar oben
      const { data: allCfgs, error: allCfgsErr } = await (admin.from('tenant_einstellungen') as any)
        .select('*').eq('m365_modul_aktiv', true).not('m365_refresh_token_enc', 'is', null)
      if (allCfgsErr) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${dbFehlerText(allCfgsErr)}` }, { status: 500 })
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
              body: JSON.stringify({ changeType: 'created', notificationUrl, resource: "me/mailFolders('inbox')/messages", expirationDateTime: expiresAt, clientState: erzeugeClientState(cfg.tenant_id) }),
            })
            const sub = await res.json() as R
            if (sub.id) await (admin.from('tenant_einstellungen') as any).update({ m365_webhook_sub_id: sub.id, m365_webhook_expires: expiresAt }).eq('tenant_id', cfg.tenant_id)
            // KAN-125: gescheitertes Abo nicht still übergehen
            else void ereignisMelden({ art: 'server', quelle: 'm365/subscribe', meldung: `Webhook-Abo nicht erneuert: ${(sub?.error as R | undefined)?.code ?? res.status}`, tenantId: cfg.tenant_id })
          }
          renewed++
        } catch (e) {
          // KAN-125: je Betrieb melden statt verschlucken; Token-Fehler meldet getValidAccessToken selbst
          if (!(e instanceof M365TokenFehler)) void ereignisMelden({ art: 'server', quelle: 'm365/subscribe', meldung: `Webhook-Abo: ${e instanceof Error ? e.message : String(e)}`, tenantId: cfg.tenant_id })
        }
      }
      return NextResponse.json({ ok: true, renewed })
    }

    const { data: cfg, error: cfgErr } = await (admin.from('tenant_einstellungen') as any)
      .select('*').eq('tenant_id', tenantId).maybeSingle()
    if (cfgErr) return NextResponse.json({ fehler: `M365-Einstellungen konnten nicht geladen werden: ${dbFehlerText(cfgErr)}` }, { status: 500 })
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
      clientState:          erzeugeClientState(c.tenant_id as string),  // S8: tenant_id + HMAC, im Webhook geprüft
    })

    // KAN-246: Fehler protokollieren – ohne gespeicherte Abo-ID läuft die Verlängerung ins Leere
    { const { error: e } = await (admin.from('tenant_einstellungen') as any).update({
      m365_webhook_sub_id: (sub as R).id,
      m365_webhook_expires: expiresAt,
    }).eq('tenant_id', tenantId)
      if (e) void ereignisMelden({ art: 'db', quelle: 'm365/subscribe/tenant_einstellungen', meldung: e.message }) }

    return NextResponse.json({ ok: true, aktion: 'erstellt', sub_id: (sub as R).id, expires: expiresAt })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
