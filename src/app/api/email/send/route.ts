import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { decryptPass } from '@/lib/email/crypto'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function POST(req: NextRequest) {
  try {
    const { an, betreff, text, kontakt_id, firma_id } = await req.json()
    if (!an || !betreff) return NextResponse.json({ fehler: 'E-Mail und Betreff erforderlich' }, { status: 400 })

    const supabase = await createSupabaseServerClient()

    // Tenant + SMTP-Config laden
    const { data: membership } = await (supabase.from('tenant_memberships') as any)
      .select('tenant_id').limit(1).single()
    const tenantId = (membership as R | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: cfg } = await (supabase.from('tenant_einstellungen') as any)
      .select('email_modul_aktiv, email_smtp_host, email_smtp_port, email_smtp_user, email_smtp_pass_enc, email_smtp_from_name')
      .eq('tenant_id', tenantId).maybeSingle()

    const c = (cfg as R | null)
    if (!c?.email_modul_aktiv) return NextResponse.json({ fehler: 'E-Mail-Modul nicht aktiviert' }, { status: 403 })
    if (!c.email_smtp_host || !c.email_smtp_user || !c.email_smtp_pass_enc)
      return NextResponse.json({ fehler: 'SMTP nicht konfiguriert – bitte in den Admin-Einstellungen hinterlegen' }, { status: 400 })

    // SMTP senden
    const pass = decryptPass(c.email_smtp_pass_enc)
    const transporter = nodemailer.createTransport({
      host: c.email_smtp_host,
      port: Number(c.email_smtp_port) || 587,
      secure: Number(c.email_smtp_port) === 465,
      auth: { user: c.email_smtp_user, pass },
    })

    await transporter.sendMail({
      from: `"${c.email_smtp_from_name ?? 'software:112'}" <${c.email_smtp_user}>`,
      to: an,
      subject: betreff,
      text,
    })

    // Aktivität anlegen
    await (supabase.from('aktivitaeten') as any).insert({
      tenant_id:    tenantId,
      kontakt_id:   kontakt_id ?? null,
      firma_id:     firma_id   ?? null,
      art:          'email',
      betreff,
      beschreibung: text?.slice(0, 200) ?? null,
      datum:        new Date().toISOString().split('T')[0],
      erledigt:     true,
      ganztags:     true,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
