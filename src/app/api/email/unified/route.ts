import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { decryptPass } from '@/lib/email/crypto'
import { getCurrentMembership } from '@/lib/auth/roles'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function POST(req: NextRequest) {
  try {
    const { an, betreff, text, kontakt_id, firma_id, useSharedMailbox } = await req.json()
    if (!an || !betreff) return NextResponse.json({ fehler: 'E-Mail und Betreff erforderlich' }, { status: 400 })

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    // Per-User Verbindung zuerst prüfen
    const { data: { user: authUser } } = await supabase.auth.getUser()
    const { data: userCfg } = await (supabase.from('user_email_connections') as any)
      .select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email').eq('tenant_id', tenantId).eq('user_id', authUser?.id ?? '').maybeSingle()
    const uc = userCfg as R | null

    // Tenant-Einstellungen als Fallback (für admin-gesendete M365)
    const { data: tenantCfg } = await (admin.from('tenant_einstellungen') as any)
      .select('m365_modul_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, m365_tenant_id, m365_client_id, m365_client_secret_enc, tenant_id, email_modul_aktiv, email_smtp_host, email_smtp_port, email_smtp_user, email_smtp_pass_enc, email_smtp_from_name')
      .eq('tenant_id', tenantId).maybeSingle()
    const c = tenantCfg as R | null

    // ── Per-User M365 hat höchste Priorität ─────────────────────────────────
    if (uc?.m365_aktiv && uc?.m365_access_token_enc) {
      const { getValidUserAccessToken, graphPost } = await import('@/lib/m365/graph')
      const { data: tcfg } = await (admin.from('tenant_einstellungen') as any)
        .select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle()
      const token = await getValidUserAccessToken(uc, tcfg as R, supabase, tenantId, authUser?.id ?? '')
      // Mehrere Empfänger: Komma-getrennt parsen
      const empfaenger = an.split(',').map((e: string) => e.trim()).filter(Boolean)
      // Shared Mailbox als Absender wenn explizit gewählt (erfordert Send-As-Rechte in Exchange)
      const sharedMailbox = useSharedMailbox ? ((uc as R).monitored_email as string | null) : null
      // Draft erstellen → senden → ID holen
      const mailboxBase2 = sharedMailbox
        ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sharedMailbox)}`
        : 'https://graph.microsoft.com/v1.0/me'
      const messagePayload: R = {
        subject: betreff,
        body: { contentType: 'Text', content: text ?? '' },
        toRecipients: empfaenger.map((addr: string) => ({ emailAddress: { address: addr } })),
      }
      if (sharedMailbox) messagePayload.from = { emailAddress: { address: sharedMailbox } }
      // Draft anlegen
      const draftRes = await fetch(`${mailboxBase2}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(messagePayload),
      })
      const draft = await draftRes.json() as R
      const draftId = draft.id as string | undefined
      const convId  = draft.conversationId as string | undefined
      // Draft senden
      if (draftId) {
        await fetch(`${mailboxBase2}/messages/${draftId}/send`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        })
      }
      // Empfänger-Liste für Speicherung
      const anStr = empfaenger.join(', ')
      await (admin.from('aktivitaeten') as any).insert({
        tenant_id: tenantId, kontakt_id: kontakt_id ?? null, firma_id: firma_id ?? null,
        art: 'email', betreff,
        beschreibung: (text ?? '').slice(0, 500) || null,
        datum: new Date().toISOString().split('T')[0], erledigt: false, ganztags: true,
        email_id: draftId ?? null, email_conversation_id: convId ?? null,
        email_von: sharedMailbox ?? null,  // wird beim Reply-To bekannt
        email_an: anStr,
        email_body: text ?? null,
        email_body_html: null,
      })
      return NextResponse.json({ ok: true, via: 'm365' })
    }

    // ── Fallback: SMTP ────────────────────────────────────────────────────────
    if (c?.email_modul_aktiv && c?.email_smtp_host && c?.email_smtp_pass_enc) {
      const pass = decryptPass(c.email_smtp_pass_enc)
      const transporter = nodemailer.createTransport({
        host: c.email_smtp_host, port: Number(c.email_smtp_port) || 587,
        secure: Number(c.email_smtp_port) === 465, auth: { user: c.email_smtp_user, pass },
      })
      await transporter.sendMail({
        from: `"${c.email_smtp_from_name ?? 'software:112'}" <${c.email_smtp_user}>`,
        to: an, subject: betreff, text,
      })
      await (admin.from('aktivitaeten') as any).insert({
        tenant_id: tenantId, kontakt_id: kontakt_id ?? null, firma_id: firma_id ?? null,
        art: 'email', betreff, beschreibung: text?.slice(0, 200) ?? null,
        datum: new Date().toISOString().split('T')[0], erledigt: false, ganztags: true,
      })
      return NextResponse.json({ ok: true, via: 'smtp' })
    }

    return NextResponse.json({ fehler: 'Kein E-Mail-Modul aktiv' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
