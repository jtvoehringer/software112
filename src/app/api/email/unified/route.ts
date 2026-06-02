import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { decryptPass } from '@/lib/email/crypto'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function POST(req: NextRequest) {
  try {
    const { an, betreff, text, kontakt_id, firma_id } = await req.json()
    if (!an || !betreff) return NextResponse.json({ fehler: 'E-Mail und Betreff erforderlich' }, { status: 400 })

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const { data: membership } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
    const tenantId = (membership as R | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
      .select('m365_modul_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, m365_tenant_id, m365_client_id, m365_client_secret_enc, tenant_id, email_modul_aktiv, email_smtp_host, email_smtp_port, email_smtp_user, email_smtp_pass_enc, email_smtp_from_name')
      .eq('tenant_id', tenantId).maybeSingle()
    const c = cfg as R | null

    // ── M365 hat Vorrang ──────────────────────────────────────────────────────
    if (c?.m365_modul_aktiv && c?.m365_access_token_enc) {
      const { getValidAccessToken, graphPost } = await import('@/lib/m365/graph')
      const token = await getValidAccessToken(c, admin)
      await graphPost(token, '/me/sendMail', {
        message: {
          subject: betreff,
          body: { contentType: 'Text', content: text ?? '' },
          toRecipients: [{ emailAddress: { address: an } }],
        },
        saveToSentItems: true,
      })
      await (admin.from('aktivitaeten') as any).insert({
        tenant_id: tenantId, kontakt_id: kontakt_id ?? null, firma_id: firma_id ?? null,
        art: 'email', betreff, beschreibung: text?.slice(0, 200) ?? null,
        datum: new Date().toISOString().split('T')[0], erledigt: true, ganztags: true,
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
        datum: new Date().toISOString().split('T')[0], erledigt: true, ganztags: true,
      })
      return NextResponse.json({ ok: true, via: 'smtp' })
    }

    return NextResponse.json({ fehler: 'Kein E-Mail-Modul aktiv' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
