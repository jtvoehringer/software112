import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse, after } from 'next/server'
import { getValidUserAccessToken, getMailboxBase } from '@/lib/m365/graph'
import { ImapFlow } from 'imapflow'
import { decryptPass } from '@/lib/email/crypto'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ladeAbsenderIndex, absenderStatus } from '@/lib/crm/absender'
import { spiegleNebenbei } from '@/lib/email/spiegel'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { M365TokenFehler, NEU_VERBINDEN_TEXT, istNeuVerbinden } from '@/lib/m365/tokenFehler'

export const dynamic = 'force-dynamic'
// after()-Spiegelung (bis 12 s) muss in die Laufzeit passen
export const maxDuration = 30
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const folder   = req.nextUrl.searchParams.get('folder') ?? 'inbox'
    const folderId = req.nextUrl.searchParams.get('folderId')  // echte Ordner-ID aus M365
    const mailbox  = req.nextUrl.searchParams.get('mailbox') === 'shared' ? 'shared' : 'own'
    // Seitenweise laden (Rückmeldung 17.9.2026: ältere Nachrichten fehlten - bisher
    // starr die 30 neuesten). 50 je Seite, ?skip=N holt die nächste Seite.
    const SEITE = 50
    const skip = Math.max(0, parseInt(req.nextUrl.searchParams.get('skip') ?? '0', 10) || 0)
    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    // Per-User Verbindung + Tenant App-Credentials laden
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
    const [{ data: cfg, error: cfgErr }, { data: tenantCfg, error: tenantCfgErr }] = await Promise.all([
      (admin.from('user_email_connections') as any)
        .select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email, email_address, email_spiegel_info').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle(),
      (admin.from('tenant_einstellungen') as any)
        .select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
    ])
    { const ladeFehler = [cfgErr, tenantCfgErr].find(Boolean)
      if (ladeFehler) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${ladeFehler.message}` }, { status: 500 }) }
    const c = cfg as R | null

    // KAN-125: Verbindung muss neu hergestellt werden (Tokens entfernt) – Hinweis mit „Neu verbinden“/„Trennen“
    if (c?.m365_aktiv && !c?.m365_access_token_enc && istNeuVerbinden(c.email_spiegel_info)) {
      return NextResponse.json({ fehler: NEU_VERBINDEN_TEXT, neuVerbinden: true }, { status: 409 })
    }

    // M365
    if (c?.m365_aktiv && c?.m365_access_token_enc) {
      const token = await getValidUserAccessToken(c, tenantCfg as R, admin, tenantId, user?.id ?? '')
      // Echte Ordner-ID verwenden wenn vorhanden, sonst Standard-Ordner
      // Mailbox laut ?mailbox=own|shared (own = Standard, siehe getMailboxBase)
      const mailboxBase = getMailboxBase(c as R, mailbox)
      const folderPath = folderId ? folderId : (folder === 'sent' ? 'sentItems' : 'inbox')
      const res = await fetch(
        `${mailboxBase}/mailFolders/${folderPath}/messages?$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,bodyPreview,conversationId&$top=${SEITE}&$skip=${skip}&$orderby=${folder === 'sent' ? 'sentDateTime' : 'receivedDateTime'} desc`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json() as R
      if (!res.ok || data.error) {
        const code = (data as R)?.error?.code
        const msg = (data as R)?.error?.message ?? res.statusText
        const hint = mailbox === 'shared'
          ? ' – Hat die verbundene Person "Vollzugriff" (Full Access) DIREKT (nicht nur über eine Gruppe) auf diese Mailbox in Exchange? Microsoft Graph berücksichtigt Full-Access-Rechte, die nur über eine Gruppenmitgliedschaft vergeben wurden, oft nicht - anders als Outlook.'
          : ''
        return NextResponse.json({ fehler: `Nachrichten konnten nicht geladen werden (Graph API ${res.status}${code ? ' ' + code : ''}): ${msg}${hint}` }, { status: 502 })
      }
      // Absender-Status je Nachricht (kontakt/firma/lead/unbekannt …), damit die
      // Liste unbekannte Absender als „neu“ markiert (E-Mail → Lead, 15.9.2026).
      // Ein Index je Aufruf (drei kleine Abfragen), nicht je Nachricht.
      const idx = await ladeAbsenderIndex(supabase, tenantId, [c.email_address, c.monitored_email, user?.email]).catch(() => null)
      const messages = (data.value ?? []).map((m: R) => ({
        id: m.id,
        betreff: m.subject ?? '(kein Betreff)',
        von: m.from?.emailAddress?.address ?? '',
        vonName: m.from?.emailAddress?.name ?? '',
        an: (m.toRecipients ?? []).map((r: R) => r.emailAddress?.address).join(', '),
        datum: folder === 'sent' ? m.sentDateTime : m.receivedDateTime,
        gelesen: m.isRead ?? false,
        vorschau: m.bodyPreview?.slice(0, 120) ?? '',
        conversationId: m.conversationId ?? null,
        quelle: 'm365',
        absender: idx ? absenderStatus(idx, m.from?.emailAddress?.address, m.from?.emailAddress?.name).status : null,
      }))
      // Beim Öffnen des Posteingangs (erste Seite) die CRM-Spiegelung nebenbei
      // nachziehen (höchstens alle 15 Minuten, läuft nach der Antwort) - damit
      // E-Mails bekannter Kontakte zeitnah als Aktivität am Account stehen (18.9.2026).
      if (skip === 0 && user?.id) after(() => spiegleNebenbei(tenantId, user.id))
      return NextResponse.json({ messages, quelle: 'm365', skip, hatMehr: !!data['@odata.nextLink'] || messages.length === SEITE, naechsteSeite: skip + messages.length })
    }

    // IMAP Fallback
    if (c?.imap_aktiv && c?.imap_host && c?.imap_pass_enc) {
      const pass = decryptPass(c.imap_pass_enc)
      const client = new ImapFlow({
        host: c.imap_host, port: Number(c.imap_port) || 993,
        secure: true, auth: { user: c.imap_user, pass }, logger: false,
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
    // KAN-125: eingestufte Token-Fehler lesbar, „neu verbinden“ mit eigenem Kennzeichen
    if (err instanceof M365TokenFehler) return NextResponse.json({ fehler: err.message, neuVerbinden: err.art === 'neu_verbinden' }, { status: err.art === 'neu_verbinden' ? 409 : 502 })
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
