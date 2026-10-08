import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { decryptPass } from '@/lib/email/crypto'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ereignisMelden } from '@/lib/system/ereignis'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { heuteWien } from '@/lib/datum/wien'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const { an, cc, betreff, text, kontakt_id, firma_id, useSharedMailbox, antwortAuf, zitat } = await req.json() as R
    if (!an || !betreff) return NextResponse.json({ fehler: 'E-Mail und Betreff erforderlich' }, { status: 400 })
    // antwortAuf (Rückmeldung 17.9.2026): { id, modus: 'reply'|'replyAll', mailbox: 'own'|'shared' } -
    // Antwort über Graph createReply/createReplyAll, damit die Originalnachricht
    // zitiert mitgeht und die Antwort im Thread (conversationId) bleibt.
    const antwort = antwortAuf && typeof antwortAuf === 'object' && antwortAuf.id ? antwortAuf as { id: string; modus?: string; mailbox?: string } : null
    const ccListe: string[] = String(cc ?? '').split(',').map((e: string) => e.trim()).filter(Boolean)

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
    if (gesperrt) return gesperrt

    // Per-User Verbindung zuerst prüfen
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
    // KAN-135: Zugangsdaten (Token/Passwörter) nur per Service-Role lesen – immer auf die
    // eigene Zeile (tenant_id aus der Mitgliedschaft, user_id aus getUser()) eingeschränkt
    const { data: userCfg } = await (admin.from('user_email_connections') as any)
      .select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email').eq('tenant_id', tenantId).eq('user_id', authUser?.id ?? '').maybeSingle()
    const uc = userCfg as R | null

    // Tenant-Einstellungen als Fallback (für admin-gesendete M365)
    const { data: tenantCfg } = await (admin.from('tenant_einstellungen') as any)
      .select('m365_modul_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, m365_tenant_id, m365_client_id, m365_client_secret_enc, tenant_id, email_modul_aktiv, email_smtp_host, email_smtp_port, email_smtp_user, email_smtp_pass_enc, email_smtp_from_name')
      .eq('tenant_id', tenantId).maybeSingle()
    const c = tenantCfg as R | null

    // ── Per-User M365 hat höchste Priorität ─────────────────────────────────
    if (uc?.m365_aktiv && uc?.m365_access_token_enc) {
      const { getValidUserAccessToken, getMailboxBase } = await import('@/lib/m365/graph')
      const { data: tcfg } = await (admin.from('tenant_einstellungen') as any)
        .select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle()
      const token = await getValidUserAccessToken(uc, tcfg as R, admin, tenantId, authUser?.id ?? '')
      // Mehrere Empfänger: Komma-getrennt parsen
      const empfaenger = an.split(',').map((e: string) => e.trim()).filter(Boolean)
      // Shared Mailbox als Absender wenn explizit gewählt (erfordert Send-As-Rechte in Exchange)
      const sharedMailbox = useSharedMailbox ? ((uc as R).monitored_email as string | null) : null
      // Draft erstellen → senden → ID holen
      const mailboxBase2 = sharedMailbox
        ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sharedMailbox)}`
        : 'https://graph.microsoft.com/v1.0/me'
      const toRecipients = empfaenger.map((addr: string) => ({ emailAddress: { address: addr } }))
      const ccRecipients = ccListe.map((addr: string) => ({ emailAddress: { address: addr } }))
      const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      let draft: R = {}
      let sendBase = mailboxBase2
      if (antwort) {
        // Antwort: Entwurf aus der Originalnachricht (zitiert, gleicher Thread) in der
        // Mailbox, in der die Nachricht liegt; Empfänger danach laut Formular setzen.
        sendBase = getMailboxBase(uc as R, antwort.mailbox === 'shared' ? 'shared' : 'own')
        const aktion = antwort.modus === 'replyAll' ? 'createReplyAll' : 'createReply'
        const replyRes = await fetch(`${sendBase}/messages/${encodeURIComponent(antwort.id)}/${aktion}`, {
          method: 'POST', headers: authHeaders, body: JSON.stringify({ comment: text ?? '' }),
        })
        draft = await replyRes.json() as R
        if (!replyRes.ok || !draft.id) {
          return NextResponse.json({ fehler: `Antwort-Entwurf fehlgeschlagen (Graph ${replyRes.status}): ${draft?.error?.message ?? ''}` }, { status: 502 })
        }
        const patch: R = { subject: betreff, toRecipients, ccRecipients }
        if (sharedMailbox) patch.from = { emailAddress: { address: sharedMailbox } }
        const patchRes = await fetch(`${sendBase}/messages/${draft.id}`, { method: 'PATCH', headers: authHeaders, body: JSON.stringify(patch) })
        if (!patchRes.ok) {
          const pe = await patchRes.json().catch(() => ({})) as R
          return NextResponse.json({ fehler: `Empfänger konnten nicht gesetzt werden (Graph ${patchRes.status}): ${pe?.error?.message ?? ''}` }, { status: 502 })
        }
      } else {
        const messagePayload: R = {
          subject: betreff,
          body: { contentType: 'Text', content: text ?? '' },
          toRecipients, ccRecipients,
        }
        if (sharedMailbox) messagePayload.from = { emailAddress: { address: sharedMailbox } }
        const draftRes = await fetch(`${mailboxBase2}/messages`, { method: 'POST', headers: authHeaders, body: JSON.stringify(messagePayload) })
        draft = await draftRes.json() as R
        if (!draftRes.ok || !draft.id) {
          return NextResponse.json({ fehler: `Entwurf fehlgeschlagen (Graph ${draftRes.status}): ${draft?.error?.message ?? ''}` }, { status: 502 })
        }
      }
      const draftId = draft.id as string | undefined
      const convId  = draft.conversationId as string | undefined
      // Entwurf senden
      const sendRes = await fetch(`${sendBase}/messages/${draftId}/send`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      if (!sendRes.ok) {
        const se = await sendRes.json().catch(() => ({})) as R
        return NextResponse.json({ fehler: `Senden fehlgeschlagen (Graph ${sendRes.status}): ${se?.error?.message ?? ''}` }, { status: 502 })
      }
      // Kontakt/Firma automatisch zuordnen, wenn nicht übergeben (Absender-Index wie unter Nachrichten)
      let kId = kontakt_id ?? null, fId = firma_id ?? null
      if (!kId && !fId) {
        try {
          const { ladeAbsenderIndex, findeAbsender } = await import('@/lib/crm/absender')
          const idx = await ladeAbsenderIndex(supabase, tenantId, [])
          for (const e of empfaenger) { const t = findeAbsender(idx, e); if (t) { if (t.typ === 'kontakt') kId = t.id; else fId = t.id; break } }
        } catch { /* Zuordnung optional */ }
      }
      // Empfänger-Liste für Speicherung
      const anStr = [...empfaenger, ...ccListe.map((e: string) => `CC: ${e}`)].join(', ')
      { const { error: e } = await (admin.from('aktivitaeten') as any).insert({
        tenant_id: tenantId, kontakt_id: kId, firma_id: fId,
        art: 'email', betreff,
        beschreibung: (text ?? '').slice(0, 500) || null,
        datum: heuteWien(), erledigt: false, ganztags: true,
        email_id: draftId ?? null, email_conversation_id: convId ?? null,
        email_von: sharedMailbox ?? null,  // wird beim Reply-To bekannt
        email_an: anStr,
        email_body: text ?? null,
        email_body_html: null,
      })
        if (e) void ereignisMelden({ art: 'db', quelle: 'unified/aktivitaeten', meldung: e.message }) }
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
        // SMTP kennt keinen Graph-Antwortentwurf: Originalnachricht als Zitat (vom Client) anhängen
        to: an, cc: ccListe.length ? ccListe.join(', ') : undefined, subject: betreff,
        text: antwort && typeof zitat === 'string' && zitat ? `${text ?? ''}\n\n${zitat}` : text,
      })
      { const { error: e } = await (admin.from('aktivitaeten') as any).insert({
        tenant_id: tenantId, kontakt_id: kontakt_id ?? null, firma_id: firma_id ?? null,
        art: 'email', betreff, beschreibung: text?.slice(0, 200) ?? null,
        datum: heuteWien(), erledigt: false, ganztags: true,
      })
        if (e) void ereignisMelden({ art: 'db', quelle: 'unified/aktivitaeten', meldung: e.message }) }
      return NextResponse.json({ ok: true, via: 'smtp' })
    }

    return NextResponse.json({ fehler: 'Kein E-Mail-Modul aktiv' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
