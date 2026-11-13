import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken, getMailboxBase } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { leseKonflikt } from '@/lib/api/lesebereich'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function DELETE(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ fehler: 'Keine ID' }, { status: 400 })
    const mailbox = req.nextUrl.searchParams.get('mailbox') === 'shared' ? 'shared' : 'own'

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const membership = await getCurrentMembership()
    const leseSperre = leseKonflikt(membership, 'crm')   // KAN-455: Lesebereich je Profil
    if (leseSperre) return leseSperre
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
    if (gesperrt) return gesperrt

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
    const [{ data: uc, error: ucErr }, { data: tc, error: tcErr }] = await Promise.all([
      (admin.from('user_email_connections') as any).select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle(),
      (admin.from('tenant_einstellungen') as any).select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
    ])
    { const ladeFehler = [ucErr, tcErr].find(Boolean)
      if (ladeFehler) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${ladeFehler.message}` }, { status: 500 }) }
    const token = await getValidUserAccessToken(uc as R, tc as R, admin, tenantId, user?.id ?? '')

    // In "Gelöschte Elemente" verschieben (nicht endgültig löschen)
    const mailboxBase = getMailboxBase(uc as R, mailbox)
    const moveRes = await fetch(`${mailboxBase}/messages/${id}/move`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationId: 'deleteditems' }),
    })
    if (!moveRes.ok) {
      const errBody = await moveRes.json().catch(() => ({}))
      const code = (errBody as R)?.error?.code
      const msg = (errBody as R)?.error?.message ?? moveRes.statusText
      return NextResponse.json({ fehler: `Graph API Fehler ${moveRes.status}${code ? ' ' + code : ''}: ${msg}` }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) { return NextResponse.json({ fehler: String(err) }, { status: 500 }) }
}
