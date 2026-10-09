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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const { an, betreff, text, kontakt_id, firma_id } = await req.json()
    if (!an || !betreff) return NextResponse.json({ fehler: 'E-Mail und Betreff erforderlich' }, { status: 400 })

    const supabase = await createSupabaseServerClient()

    // Tenant + SMTP-Config laden
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
    if (gesperrt) return gesperrt

    // KAN-135: SMTP-Passwort nur per Service-Role (Benutzer haben keinen SELECT darauf);
    // Mitgliedschaft ist über getCurrentMembership() geprüft, Zeile über tenant_id eingeschränkt
    const { data: cfg, error: cfgErr } = await (createSupabaseAdminClient().from('tenant_einstellungen') as any)
      .select('email_modul_aktiv, email_smtp_host, email_smtp_port, email_smtp_user, email_smtp_pass_enc, email_smtp_from_name')
      .eq('tenant_id', tenantId).maybeSingle()
    if (cfgErr) return NextResponse.json({ fehler: `E-Mail-Einstellungen konnten nicht geladen werden: ${cfgErr.message}` }, { status: 500 })

    const c = (cfg as R | null)
    if (!c?.email_modul_aktiv) return NextResponse.json({ fehler: 'E-Mail-Modul nicht aktiviert' }, { status: 403 })
    if (!c.email_smtp_host || !c.email_smtp_user || !c.email_smtp_pass_enc)
      return NextResponse.json({ fehler: 'SMTP nicht konfiguriert – bitte in den Admin-Einstellungen hinterlegen' }, { status: 400 })

    // SMTP senden
    const pass = decryptPass(c.email_smtp_pass_enc)
    const transporter = nodemailer.createTransport({
      host: c.email_smtp_host,
      port: Number(c.email_smtp_port) || 587,   // null-vorgabe-ok: Port 0 ist ungültig – Standardport des Protokolls
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
    { const { error: e } = await (supabase.from('aktivitaeten') as any).insert({
      tenant_id:    tenantId,
      kontakt_id:   kontakt_id ?? null,
      firma_id:     firma_id   ?? null,
      art:          'email',
      betreff,
      beschreibung: text?.slice(0, 200) ?? null,
      datum:        heuteWien(),
      erledigt:     true,
      ganztags:     true,
    })
      if (e) void ereignisMelden({ art: 'db', quelle: 'send/aktivitaeten', meldung: e.message }) }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
