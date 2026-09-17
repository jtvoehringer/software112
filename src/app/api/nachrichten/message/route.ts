import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken, getMailboxBase } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ladeAbsenderIndex, absenderStatus, type AbsenderStatus } from '@/lib/crm/absender'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type KontaktInfo = { typ: 'kontakt' | 'firma'; id: string; name: string; accountnummer: string | null; istLead: boolean; ueber: 'email' | 'domain' } | null

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ fehler: 'Keine ID' }, { status: 400 })
    const mailbox = req.nextUrl.searchParams.get('mailbox') === 'shared' ? 'shared' : 'own'

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: { user } } = await supabase.auth.getUser()
    const [{ data: cfg }, { data: tenantCfg }] = await Promise.all([
      (supabase.from('user_email_connections') as any)
        .select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email, email_address').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle(),
      (admin.from('tenant_einstellungen') as any)
        .select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
    ])
    const c = cfg as R | null

    if (c?.m365_aktiv && c?.m365_access_token_enc) {
      const token = await getValidUserAccessToken(c, tenantCfg as R, supabase, tenantId, user?.id ?? '')
      const mailboxBase = getMailboxBase(c as R, mailbox)
      const res = await fetch(
        `${mailboxBase}/messages/${id}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,conversationId,isRead`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) return NextResponse.json({ fehler: 'E-Mail nicht gefunden' }, { status: 404 })
      const msg = await res.json() as R

      // Als gelesen markieren
      await fetch(`${mailboxBase}/messages/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      }).catch((e: unknown) => console.error('[nachrichten] Operation fehlgeschlagen:', e))

      // Kontakt-Matching für Anzeige (E-Mail exakt, sonst Firmendomain; Leads
      // zählen als bekannt). Unbekannte Absender bekommen den Lead-Vorschlag
      // (Dialog „Soll ein Lead angelegt werden?“ im NachrichtenClient) - außer
      // Systemadressen, eigene Postfächer und „nicht mehr fragen“-Absender.
      const fromEmail = msg.from?.emailAddress?.address?.toLowerCase() ?? ''
      let kontaktInfo: KontaktInfo = null
      let absender: AbsenderStatus = 'system'
      if (fromEmail) {
        const idx = await ladeAbsenderIndex(supabase, tenantId, [c.email_address, c.monitored_email, user?.email])
        const s = absenderStatus(idx, fromEmail, msg.from?.emailAddress?.name)
        absender = s.status
        if (s.treffer) kontaktInfo = { typ: s.treffer.typ, id: s.treffer.id, name: s.treffer.name, accountnummer: s.treffer.accountnummer, istLead: s.treffer.istLead, ueber: s.treffer.ueber }

        // Eingehende Email als Aktivität speichern (fire-and-forget)
        if (kontaktInfo && msg.id && tenantId) {
          const bodyText = (msg.body?.content ?? '').replace(/<[^>]*>/g, '').trim()
          const bodyHtml = msg.body?.contentType === 'html' ? msg.body.content : null
          void (async () => {
            try {
              const emailData = {
                email_id: msg.id, email_conversation_id: msg.conversationId ?? null,
                email_von: msg.from?.emailAddress?.address ?? null,
                email_von_name: msg.from?.emailAddress?.name ?? null,
                email_an: (msg.toRecipients ?? []).map((r: R) => r.emailAddress?.address).join(', ') || null,
                email_body: bodyText || null, email_body_html: bodyHtml,
                beschreibung: bodyText.slice(0, 500),
              }
              // Bestehenden Eintrag (email_id=null) aktualisieren
              const { count } = await (supabase.from('aktivitaeten') as any)
                .update(emailData)
                .eq('tenant_id', tenantId)
                .eq('kontakt_id', kontaktInfo.typ === 'kontakt' ? kontaktInfo.id : null)
                .eq('firma_id',   kontaktInfo.typ === 'firma'   ? kontaktInfo.id : null)
                .eq('art', 'email').eq('betreff', msg.subject ?? '').is('email_id', null)
                .select('*', { count: 'exact', head: true })
              // Wenn nichts aktualisiert → neu anlegen
              if (!count || count === 0) {
                await (supabase.from('aktivitaeten') as any).upsert({
                  tenant_id: tenantId,
                  kontakt_id: kontaktInfo.typ === 'kontakt' ? kontaktInfo.id : null,
                  firma_id:   kontaktInfo.typ === 'firma'   ? kontaktInfo.id : null,
                  art: 'email', erledigt: false, ganztags: true,
                  betreff: msg.subject ?? '(kein Betreff)',
                  datum: (msg.receivedDateTime ?? msg.sentDateTime ?? '').split('T')[0],
                  ...emailData,
                }, { onConflict: 'tenant_id,email_id', ignoreDuplicates: true })
              }
            } catch { /* ignore */ }
          })()
        }
      }

      return NextResponse.json({
        id: msg.id,
        betreff: msg.subject ?? '(kein Betreff)',
        von: msg.from?.emailAddress?.address ?? '',
        vonName: msg.from?.emailAddress?.name ?? '',
        an: (msg.toRecipients ?? []).map((r: R) => r.emailAddress?.address).join(', '),
        cc: (msg.ccRecipients ?? []).map((r: R) => r.emailAddress?.address).filter(Boolean).join(', '),
        datum: msg.receivedDateTime ?? msg.sentDateTime,
        bodyHtml: msg.body?.contentType === 'html' ? msg.body.content : null,
        bodyText: msg.body?.contentType === 'text' ? msg.body.content : msg.body?.content ?? '',
        conversationId: msg.conversationId,
        kontaktInfo,
        absender,
        // Lead-Vorschlag nur für unbekannte Absender (eigene Postfächer → 'eigen')
        leadVorschlag: absender === 'unbekannt',
      })
    }
    return NextResponse.json({ fehler: 'Mailbox nicht verbunden' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
