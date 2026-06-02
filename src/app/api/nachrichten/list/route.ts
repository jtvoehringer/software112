import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidAccessToken } from '@/lib/m365/graph'
import { ImapFlow } from 'imapflow'
import { decryptPass } from '@/lib/email/crypto'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  try {
    const folder = req.nextUrl.searchParams.get('folder') ?? 'inbox'
    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const { data: membership } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
    const tenantId = (membership as R | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
      .select('*').eq('tenant_id', tenantId).maybeSingle()
    const c = cfg as R | null

    // M365
    if (c?.m365_modul_aktiv && c?.m365_access_token_enc) {
      const token = await getValidAccessToken(c, admin)
      const folderPath = folder === 'sent' ? 'sentItems' : 'inbox'
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders/${folderPath}/messages?$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,bodyPreview&$top=30&$orderby=${folder === 'sent' ? 'sentDateTime' : 'receivedDateTime'} desc`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json() as R
      const messages = (data.value ?? []).map((m: R) => ({
        id: m.id,
        betreff: m.subject ?? '(kein Betreff)',
        von: m.from?.emailAddress?.address ?? '',
        vonName: m.from?.emailAddress?.name ?? '',
        an: (m.toRecipients ?? []).map((r: R) => r.emailAddress?.address).join(', '),
        datum: folder === 'sent' ? m.sentDateTime : m.receivedDateTime,
        gelesen: m.isRead ?? false,
        vorschau: m.bodyPreview?.slice(0, 120) ?? '',
        quelle: 'm365',
      }))
      return NextResponse.json({ messages, quelle: 'm365' })
    }

    // IMAP Fallback
    if (c?.email_modul_aktiv && c?.email_imap_host && c?.email_imap_pass_enc) {
      const pass = decryptPass(c.email_imap_pass_enc)
      const client = new ImapFlow({
        host: c.email_imap_host, port: Number(c.email_imap_port) || 993,
        secure: true, auth: { user: c.email_imap_user, pass }, logger: false,
      })
      await client.connect()
      const folderName = folder === 'sent' ? 'Sent' : 'INBOX'
      const lock = await client.getMailboxLock(folderName).catch(() => null)
      const messages: R[] = []
      if (lock) {
        try {
          for await (const msg of client.fetch({ seq: `${Math.max(1, (client as R).mailbox?.exists - 29)}:*` }, { envelope: true, flags: true })) {
            messages.push({
              id: String(msg.uid),
              betreff: msg.envelope?.subject ?? '(kein Betreff)',
              von: msg.envelope?.from?.[0]?.address ?? '',
              vonName: msg.envelope?.from?.[0]?.name ?? '',
              an: (msg.envelope?.to ?? []).map((a: R) => a.address).join(', '),
              datum: msg.envelope?.date?.toISOString() ?? '',
              gelesen: msg.flags?.has('\\Seen') ?? false,
              vorschau: '',
              quelle: 'imap',
            })
          }
        } finally { lock.release() }
        await client.logout()
      }
      return NextResponse.json({ messages: messages.reverse().slice(0, 30), quelle: 'imap' })
    }

    return NextResponse.json({ fehler: 'Kein E-Mail-Modul konfiguriert' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
