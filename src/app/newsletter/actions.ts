'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sendEmail, upsertContact } from '@/lib/brevo/api'
import { getListIds } from '@/lib/brevo/listen'
import crypto from 'crypto'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

function baseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'https://software112.icp-consultants.at'
}

// ── Schritt 1: Anmeldung → Double Opt-in E-Mail ───────────────────────────────

export type AnmeldeResult =
  | { ok: true }
  | { ok: false; error: string }

export async function newsletterAnmelden(formData: FormData): Promise<AnmeldeResult> {
  const email    = (formData.get('email') as string).trim().toLowerCase()
  const vorname  = (formData.get('vorname') as string).trim() || null
  const nachname = (formData.get('nachname') as string).trim() || null
  const segment  = (formData.get('segment') as string) || 'privat'

  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }
  }

  const supabase = await createSupabaseServerClient()

  // Tenant-ID für Gebeshuber (öffentliche Seite → fixer Tenant)
  const tenantId = process.env.NEWSLETTER_TENANT_ID ?? 'fa22dc07-eca5-43df-af96-f7b9b09f0471'

  // Prüfen ob schon bestätigt
  const { data: existing } = await (supabase.from('kontakte') as any)
    .select('id, newsletter_bestaetigt')
    .eq('tenant_id', tenantId)
    .eq('email', email)
    .single()

  if ((existing as AR | null)?.newsletter_bestaetigt) {
    return { ok: false, error: 'Diese E-Mail-Adresse ist bereits angemeldet.' }
  }

  // Token generieren
  const token = crypto.randomBytes(32).toString('hex')
  const now   = new Date().toISOString()

  // Kontakt anlegen oder aktualisieren
  if (existing) {
    await (supabase.from('kontakte') as any)
      .update({ newsletter: true, newsletter_token: token, newsletter_opt_in_am: now, aktualisiert_am: now })
      .eq('id', (existing as AR).id)
  } else {
    await (supabase.from('kontakte') as any).insert({
      tenant_id:             tenantId,
      vorname,
      nachname:              nachname ?? email,
      segment,
      email,
      newsletter:            true,
      newsletter_token:      token,
      newsletter_opt_in_am:  now,
      newsletter_bestaetigt: false,
    })
  }

  // Consent-Log (DSGVO)
  await (supabase.from('datenschutz_consents') as any).insert({
    tenant_id:   tenantId,
    email,
    aktion:      'opt_in_angefragt',
    quelle:      'website_formular',
    erstellt_am: now,
  })

  // Bestätigungs-E-Mail senden
  const confirmUrl = `${baseUrl()}/newsletter/bestaetigt?token=${token}`
  const name = [vorname, nachname].filter(Boolean).join(' ') || email

  await sendEmail({
    to: { email, name },
    subject: 'Bitte bestätigen Sie Ihre Newsletter-Anmeldung',
    htmlContent: `
      <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;color:#333">
        <h2 style="color:#2a7c6f">Weingut Gebeshuber – Newsletter</h2>
        <p>Hallo ${vorname ? vorname : 'Weinfreund/in'},</p>
        <p>vielen Dank für Ihre Anmeldung zu unserem Newsletter!</p>
        <p>Bitte bestätigen Sie Ihre E-Mail-Adresse durch einen Klick auf den folgenden Button:</p>
        <p style="margin:24px 0">
          <a href="${confirmUrl}"
             style="background:#2a7c6f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
            Anmeldung bestätigen
          </a>
        </p>
        <p style="color:#888;font-size:12px">
          Falls Sie sich nicht angemeldet haben, können Sie diese E-Mail ignorieren.<br>
          Dieser Link ist 72 Stunden gültig.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#888;font-size:11px">
          Weingut Gebeshuber · Datenschutz gemäß DSGVO ·
          <a href="${baseUrl()}/newsletter/abmelden?email=${encodeURIComponent(email)}" style="color:#888">Abmelden</a>
        </p>
      </div>
    `,
  })

  return { ok: true }
}

// ── Schritt 2: Token bestätigen ───────────────────────────────────────────────

export type BestaetigungResult =
  | { ok: true; name: string }
  | { ok: false; error: string }

export async function newsletterBestaetigen(token: string): Promise<BestaetigungResult> {
  if (!token) return { ok: false, error: 'Ungültiger Link.' }

  const supabase = await createSupabaseServerClient()
  const tenantId = process.env.NEWSLETTER_TENANT_ID ?? 'fa22dc07-eca5-43df-af96-f7b9b09f0471'

  const { data } = await (supabase.from('kontakte') as any)
    .select('id, email, vorname, nachname, segment, newsletter_opt_in_am, newsletter_bestaetigt')
    .eq('newsletter_token', token)
    .single()

  const kontakt = data as AR | null
  if (!kontakt) return { ok: false, error: 'Dieser Bestätigungslink ist ungültig oder bereits verwendet.' }

  if (kontakt.newsletter_bestaetigt) {
    return { ok: true, name: kontakt.vorname ?? 'Weinfreund/in' }
  }

  // Opt-in-Zeitstempel prüfen (72h)
  const optInAm = new Date(kontakt.newsletter_opt_in_am)
  if (Date.now() - optInAm.getTime() > 72 * 60 * 60 * 1000) {
    return { ok: false, error: 'Dieser Bestätigungslink ist abgelaufen. Bitte erneut anmelden.' }
  }

  const now = new Date().toISOString()

  // Kontakt als bestätigt markieren
  await (supabase.from('kontakte') as any)
    .update({ newsletter_bestaetigt: true, newsletter_token: null, aktualisiert_am: now })
    .eq('id', kontakt.id)

  // Consent-Log
  await (supabase.from('datenschutz_consents') as any).insert({
    tenant_id:   tenantId,
    kontakt_id:  kontakt.id,
    email:       kontakt.email,
    aktion:      'opt_in_bestaetigt',
    quelle:      'website_formular',
    erstellt_am: now,
  })

  // In Brevo eintragen
  const listIds = getListIds(kontakt.segment)
  await upsertContact({
    email:    kontakt.email,
    vorname:  kontakt.vorname,
    nachname: kontakt.nachname,
    listIds,
  })

  return { ok: true, name: kontakt.vorname ?? 'Weinfreund/in' }
}

// ── Opt-out ───────────────────────────────────────────────────────────────────

export async function newsletterAbmelden(email: string): Promise<{ ok: boolean }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = process.env.NEWSLETTER_TENANT_ID ?? 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
  const now = new Date().toISOString()

  await (supabase.from('kontakte') as any)
    .update({ newsletter: false, newsletter_bestaetigt: false, aktualisiert_am: now })
    .eq('tenant_id', tenantId)
    .eq('email', email.toLowerCase())

  await (supabase.from('datenschutz_consents') as any).insert({
    tenant_id:   tenantId,
    email:       email.toLowerCase(),
    aktion:      'opt_out',
    quelle:      'abmelde_link',
    erstellt_am: now,
  })

  return { ok: true }
}
