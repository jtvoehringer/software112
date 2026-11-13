import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken, getMailboxBase } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { leseKonflikt } from '@/lib/api/lesebereich'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
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
    const [{ data: uc, error: ucErr }, { data: tc, error: tcErr }] = await Promise.all([
      (admin.from('user_email_connections') as any).select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle(),
      (admin.from('tenant_einstellungen') as any).select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
    ])
    { const ladeFehler = [ucErr, tcErr].find(Boolean)
      if (ladeFehler) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${ladeFehler.message}` }, { status: 500 }) }
    if (!(uc as R | null)?.m365_aktiv) return NextResponse.json({ fehler: 'Mailbox nicht verbunden' }, { status: 400 })

    const token = await getValidUserAccessToken(uc as R, tc as R, admin, tenantId, user?.id ?? '')
    const mailboxBase = getMailboxBase(uc as R, mailbox)
    const headers = { Authorization: `Bearer ${token}` }
    const res = await fetch(
      `${mailboxBase}/mailFolders?$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount&$top=100`,
      { headers }
    )
    const data = await res.json() as R
    if (!res.ok || data.error) {
      const code = (data as R)?.error?.code
      const msg = (data as R)?.error?.message ?? res.statusText
      const hint = mailbox === 'shared'
        ? ' – Hat die verbundene Person "Vollzugriff" (Full Access) DIREKT (nicht nur über eine Gruppe) auf diese Mailbox in Exchange? Microsoft Graph berücksichtigt Full-Access-Rechte, die nur über eine Gruppenmitgliedschaft vergeben wurden, oft nicht - anders als Outlook.'
        : ''
      return NextResponse.json({ fehler: `Ordner konnten nicht geladen werden (Graph API ${res.status}${code ? ' ' + code : ''}): ${msg}${hint}` }, { status: 502 })
    }
    // Unterordner mitspiegeln (Rückmeldung 17.9.2026): Graph liefert nur die
    // oberste Ebene; childFolders je Ordner mit Unterordnern nachladen, bis zu
    // drei Ebenen tief, parallel je Ebene. Ergebnis flach mit parentId/depth,
    // die Sortierung (Eltern → Kinder) macht der Client.
    type F = { id: string; name: string; unread: number; total: number; parentId: string | null; depth: number; childCount: number }
    const zuF = (f: R, parentId: string | null, depth: number): F => ({
      id: f.id, name: f.displayName, unread: f.unreadItemCount ?? 0, total: f.totalItemCount ?? 0,
      parentId, depth, childCount: f.childFolderCount ?? 0,
    })
    let ebene: F[] = ((data.value ?? []) as R[]).map(f => zuF(f, null, 0))
    const folders: F[] = [...ebene]
    for (let depth = 1; depth <= 3; depth++) {
      const eltern = ebene.filter(f => f.childCount > 0)
      if (eltern.length === 0) break
      const kinder = await Promise.all(eltern.map(async e => {
        try {
          const r = await fetch(`${mailboxBase}/mailFolders/${e.id}/childFolders?$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount&$top=100`, { headers })
          const d = await r.json() as R
          return r.ok && !d.error ? ((d.value ?? []) as R[]).map(f => zuF(f, e.id, depth)) : []
        } catch { return [] }
      }))
      ebene = kinder.flat()
      folders.push(...ebene)
    }
    return NextResponse.json({ folders })
  } catch (err) { return NextResponse.json({ fehler: String(err) }, { status: 500 }) }
}
