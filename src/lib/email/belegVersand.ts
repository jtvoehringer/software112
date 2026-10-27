import 'server-only'

// Beleg (Rechnung, Stornobeleg) per E-Mail mit PDF-Anhang versenden (KAN-379, 27.10.2026; vorher nur in
// /api/weinhandel/verkauf/[id]/send). Kein eigener Mail-Dienst, sondern die Anbindung des Betriebs: zuerst die per
// Benutzer verbundene Microsoft-365-Mailbox (user_email_connections), sonst die SMTP-Zugangsdaten des Betriebs.
// Geheimnis-Spalten nur per Service-Role (KAN-135) – Aufrufer prüft vorher Berechtigung und Betrieb.

import nodemailer from 'nodemailer'
import { decryptPass } from '@/lib/email/crypto'
import { getValidUserAccessToken } from '@/lib/m365/graph'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import type { createSupabaseAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type BelegVersandErgebnis = { ok: true; via: 'm365' | 'smtp' } | { ok: false; status: number; fehler: string }

export async function belegPerMailSenden(o: {
  admin: ReturnType<typeof createSupabaseAdminClient>
  tenantId: string
  userId: string
  an: string
  betreff: string
  text: string
  dateiname: string
  pdf: Buffer
  absenderName: string
}): Promise<BelegVersandErgebnis> {
  const { admin, tenantId, userId } = o
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userCfgRaw, error: userCfgErr } = await (admin.from('user_email_connections') as any)
    .select('id, m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at')
    .eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle()
  if (userCfgErr) return { ok: false, status: 500, fehler: `Postfach-Verbindung konnte nicht geladen werden: ${dbFehlerText(userCfgErr)}` }
  const userCfg = userCfgRaw as R | null

  try {
    if (userCfg?.m365_aktiv && userCfg?.m365_access_token_enc) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tcfgRaw, error: tcfgErr } = await (admin.from('tenant_einstellungen') as any)
        .select('m365_tenant_id, m365_client_id, m365_client_secret_enc')
        .eq('tenant_id', tenantId).maybeSingle()
      if (tcfgErr) return { ok: false, status: 500, fehler: `M365-Einstellungen konnten nicht geladen werden: ${dbFehlerText(tcfgErr)}` }
      const token = await getValidUserAccessToken(userCfg, tcfgRaw as R, admin, tenantId, userId)

      const draftRes = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: o.betreff,
          body: { contentType: 'Text', content: o.text },
          toRecipients: [{ emailAddress: { address: o.an } }],
          attachments: [{
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: o.dateiname,
            contentBytes: o.pdf.toString('base64'),
          }],
        }),
      })
      if (!draftRes.ok) throw new AktionsFehler(`Graph-Entwurf fehlgeschlagen: ${draftRes.status} ${await draftRes.text()}`)
      const draft = await draftRes.json() as R
      if (draft.id) {
        const sendRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        })
        if (!sendRes.ok) throw new AktionsFehler(`Graph-Versand fehlgeschlagen: ${sendRes.status} ${await sendRes.text()}`)
      }
      return { ok: true, via: 'm365' }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tenantCfgRaw, error: tenantCfgErr } = await (admin.from('tenant_einstellungen') as any)
      .select('email_modul_aktiv, email_smtp_host, email_smtp_port, email_smtp_user, email_smtp_pass_enc, email_smtp_from_name')
      .eq('tenant_id', tenantId).maybeSingle()
    if (tenantCfgErr) return { ok: false, status: 500, fehler: `E-Mail-Einstellungen konnten nicht geladen werden: ${dbFehlerText(tenantCfgErr)}` }
    const c = tenantCfgRaw as R | null
    if (!c?.email_modul_aktiv || !c.email_smtp_host || !c.email_smtp_user || !c.email_smtp_pass_enc) {
      return {
        ok: false, status: 400,
        fehler: 'Kein E-Mail-Versand konfiguriert. Bitte in den Admin-Einstellungen eine Microsoft-365-Mailbox verbinden oder SMTP-Zugangsdaten hinterlegen.',
      }
    }
    const pass = decryptPass(c.email_smtp_pass_enc)
    const transporter = nodemailer.createTransport({
      host: c.email_smtp_host,
      port: Number(c.email_smtp_port) || 587,   // null-vorgabe-ok: Port 0 ist ungültig – Standardport des Protokolls
      secure: Number(c.email_smtp_port) === 465,
      auth: { user: c.email_smtp_user, pass },
    })
    await transporter.sendMail({
      from: `"${c.email_smtp_from_name ?? o.absenderName}" <${c.email_smtp_user}>`,
      to: o.an,
      subject: o.betreff,
      text: o.text,
      attachments: [{ filename: o.dateiname, content: o.pdf }],
    })
    return { ok: true, via: 'smtp' }
  } catch (err: unknown) {
    return { ok: false, status: 502, fehler: err instanceof Error ? err.message : 'Unbekannter Fehler beim Versand' }
  }
}
