import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken, getMailboxBase } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { leseKonflikt } from '@/lib/api/lesebereich'

// E-Mail-Anhang herunterladen (17.9.2026): /api/nachrichten/anhang?id=<mail>&aid=<anhang>&mailbox=own|shared
// Holt den Anhang über Graph mit dem Token des angemeldeten Benutzers und
// reicht ihn als Download durch (kein Zwischenspeichern).

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const id  = req.nextUrl.searchParams.get('id')
    const aid = req.nextUrl.searchParams.get('aid')
    if (!id || !aid) return NextResponse.json({ fehler: 'Keine ID' }, { status: 400 })
    const mailbox = req.nextUrl.searchParams.get('mailbox') === 'shared' ? 'shared' : 'own'

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const membership = await getCurrentMembership()
    const leseSperre = leseKonflikt(membership, 'crm')   // KAN-455: Lesebereich je Profil
    if (leseSperre) return leseSperre
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
    const [{ data: cfg, error: cfgErr }, { data: tenantCfg, error: tenantCfgErr }] = await Promise.all([
      (admin.from('user_email_connections') as any)
        .select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, monitored_email, email_address').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle(),
      (admin.from('tenant_einstellungen') as any)
        .select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
    ])
    { const ladeFehler = [cfgErr, tenantCfgErr].find(Boolean)
      if (ladeFehler) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${ladeFehler.message}` }, { status: 500 }) }
    const c = cfg as R | null
    if (!c?.m365_aktiv || !c?.m365_access_token_enc) return NextResponse.json({ fehler: 'Mailbox nicht verbunden' }, { status: 400 })

    const token = await getValidUserAccessToken(c, tenantCfg as R, admin, tenantId, user?.id ?? '')
    const mailboxBase = getMailboxBase(c, mailbox)
    const res = await fetch(`${mailboxBase}/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(aid)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return NextResponse.json({ fehler: 'Anhang nicht gefunden' }, { status: 404 })
    const a = await res.json() as R
    if (typeof a.contentBytes !== 'string') return NextResponse.json({ fehler: 'Anhang nicht als Datei verfügbar' }, { status: 415 })

    const bytes = Buffer.from(a.contentBytes, 'base64')
    const name = String(a.name ?? 'anhang').replace(/[\r\n"]/g, '_')
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': a.contentType || 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
