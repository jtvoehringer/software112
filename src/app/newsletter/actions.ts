'use server'
// schreibsperre-ausnahme-datei: öffentliche Newsletter-An- und Abmeldung ohne Anmeldung – Abmelden muss immer gehen (DSGVO, KAN-5)

// ── Newsletter-Anmeldung je Betrieb (Double Opt-in) ───────────────────────────
// 23.9.2026: /newsletter/<kurzname> statt fest verdrahtetem Betrieb; Brevo-Konto je
// Betrieb (lib/newsletter/betrieb.ts); Abmeldung per signiertem Link statt ?email=.

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { sendEmail, upsertContact, removeFromList } from '@/lib/brevo/api'
import { AktionsFehler } from '@/lib/fehler'
import { clientIp, drossel } from '@/lib/sicherheit/drossel'
import {
  ladeNewsletterBetrieb, ladeNewsletterBetriebNachId, abmeldeLink, pruefeAbmeldeToken,
  SEGMENTE, type Segment, type NewsletterBetrieb,
} from '@/lib/newsletter/betrieb'
import { neuesNewsletterToken, istNewsletterToken, newsletterTokenHash } from '@/lib/newsletter/token'
import { ereignisMelden } from '@/lib/system/ereignis'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

const ERNEUT_NACH_MS = 10 * 60 * 1000  // Bestätigungsmail an dieselbe Adresse höchstens alle 10 Minuten
const GUELTIG_MS     = 72 * 60 * 60 * 1000

function baseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'https://software112.icp-consultants.at'
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

// ── Schritt 1: Anmeldung → Double-Opt-in-E-Mail ──────────────────────────────

export type AnmeldeResult =
  | { ok: true }
  | { ok: false; error: string }

export async function newsletterAnmelden(formData: FormData): Promise<AnmeldeResult> {
  const kurzname = ((formData.get('kurzname') as string) || '').trim()
  const email    = ((formData.get('email') as string) || '').trim().toLowerCase().slice(0, 254)
  const vorname  = ((formData.get('vorname') as string) || '').trim().slice(0, 100) || null
  const nachname = ((formData.get('nachname') as string) || '').trim().slice(0, 100) || null
  const segRoh   = (formData.get('segment') as string) || 'privat'
  const segment: Segment = (SEGMENTE as readonly string[]).includes(segRoh) ? segRoh as Segment : 'privat'

  // Schutz des öffentlichen Formulars: unsichtbares Feld „webseite“ füllen nur Bots –
  // sie bekommen scheinbar Erfolg, es passiert nichts. Je IP höchstens 5 Anmeldungen in 10 Minuten.
  if (((formData.get('webseite') as string) || '').trim()) return { ok: true }
  if (!drossel(`newsletter:${await clientIp()}`, 5, 10 * 60 * 1000)) {
    return { ok: false, error: 'Zu viele Anmeldungen in kurzer Zeit. Bitte in ein paar Minuten erneut versuchen.' }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }
  }

  const betrieb = await ladeNewsletterBetrieb(kurzname)
  if (!betrieb?.aktiv || !betrieb.zugang) {
    return { ok: false, error: 'Die Newsletter-Anmeldung ist derzeit nicht verfügbar.' }
  }
  const tenantId = betrieb.tenantId

  // Öffentliche Seite ohne Anmeldung → Service-Role-Client (RLS verlangt sonst eine Tenant-Rolle)
  const supabase = createSupabaseAdminClient()

  const { data: existing, error: selectErr } = await (supabase.from('kontakte') as any)
    .select('id, newsletter_bestaetigt, newsletter_opt_in_am')
    .eq('tenant_id', tenantId)
    .eq('email', email)
    .limit(1)
    .maybeSingle()
  if (selectErr) return { ok: false, error: 'Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.' }

  // Keine Auskunft, ob eine Adresse schon angemeldet ist – immer dieselbe Rückmeldung
  if ((existing as AR | null)?.newsletter_bestaetigt) return { ok: true }
  const letzte = (existing as AR | null)?.newsletter_opt_in_am
  if (letzte && Date.now() - new Date(letzte).getTime() < ERNEUT_NACH_MS) return { ok: true }

  // KAN-159 BK4: Klartext nur im Link der E-Mail, gespeichert wird der Hash
  const token = neuesNewsletterToken()
  const tokenHash = newsletterTokenHash(token)
  const now   = new Date().toISOString()
  let kontaktId: string

  if (existing) {
    kontaktId = (existing as AR).id
    const { error } = await (supabase.from('kontakte') as any)   // aenderung-ohne-pruefung: Service-Role (öffentliche Newsletter-Seite), Kontakt eben gelesen
      .update({ newsletter: true, newsletter_token_hash: tokenHash, newsletter_opt_in_am: now, aktualisiert_am: now })
      .eq('id', kontaktId)
      .eq('tenant_id', tenantId)
    if (error) return { ok: false, error: 'Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.' }
  } else {
    const { data: neu, error } = await (supabase.from('kontakte') as any).insert({
      tenant_id:             tenantId,
      vorname,
      nachname:              nachname ?? email,
      segment,
      email,
      newsletter:            true,
      newsletter_token_hash: tokenHash,
      newsletter_opt_in_am:  now,
      newsletter_bestaetigt: false,
    }).select('id').single()
    if (error || !neu) return { ok: false, error: 'Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.' }
    kontaktId = (neu as AR).id
  }

  // Consent-Log (DSGVO)
  { const { error: e } = await (supabase.from('datenschutz_consents') as any).insert({
    tenant_id:   tenantId,
    kontakt_id:  kontaktId,
    email,
    aktion:      'opt_in_angefragt',
    quelle:      'website_formular',
    erstellt_am: now,
  })
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (datenschutz_consents): ${e.message}`) }

  const confirmUrl = `${baseUrl()}/newsletter/bestaetigt?token=${token}`
  const n = esc(betrieb.name)
  const f = esc(betrieb.farbe)   // KAN-138: primary_color ist Freitext – nicht ungeprüft ins style-Attribut
  try {
    await sendEmail({
      zugang:  betrieb.zugang,
      to:      { email, name: [vorname, nachname].filter(Boolean).join(' ') || email },
      subject: `Bitte bestätigen Sie Ihre Newsletter-Anmeldung – ${betrieb.name}`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;color:#22252B">
          <h2 style="color:${f}">${n} – Newsletter</h2>
          <p>Hallo ${vorname ? esc(vorname) : 'und willkommen'},</p>
          <p>vielen Dank für Ihre Anmeldung zu unserem Newsletter!</p>
          <p>Bitte bestätigen Sie Ihre E-Mail-Adresse durch einen Klick auf den folgenden Button:</p>
          <p style="margin:24px 0">
            <a href="${confirmUrl}"
               style="background:${f};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
              Anmeldung bestätigen
            </a>
          </p>
          <p style="color:#5A5D66;font-size:12px">
            Falls Sie sich nicht angemeldet haben, können Sie diese E-Mail ignorieren.<br>
            Dieser Link ist 72 Stunden gültig.
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#5A5D66;font-size:11px">
            ${n}${betrieb.datenschutzUrl ? ` · <a href="${esc(betrieb.datenschutzUrl)}" style="color:#5A5D66">Datenschutz</a>` : ''} ·
            <a href="${abmeldeLink(baseUrl(), kontaktId)}" style="color:#5A5D66">Abmelden</a>
          </p>
        </div>
      `,
    })
  } catch {
    return { ok: false, error: 'Die Bestätigungs-E-Mail konnte nicht versendet werden. Bitte später erneut versuchen.' }
  }

  return { ok: true }
}

// ── Schritt 2: Token bestätigen ───────────────────────────────────────────────

export type BestaetigungResult =
  | { ok: true; name: string; betrieb: NewsletterBetrieb | null }
  | { ok: false; error: string; betrieb: NewsletterBetrieb | null }

export async function newsletterBestaetigen(token: string): Promise<BestaetigungResult> {
  if (!istNewsletterToken(token)) return { ok: false, error: 'Ungültiger Link.', betrieb: null }

  const supabase = createSupabaseAdminClient()
  // tenant-isolation-ignore: öffentlicher Bestätigungslink – der Betrieb ergibt sich aus dem zufälligen Token
  const { data, error: leseErr } = await (supabase.from('kontakte') as any)
    .select('id, tenant_id, email, vorname, nachname, segment, newsletter_opt_in_am, newsletter_bestaetigt')
    .eq('newsletter_token_hash', newsletterTokenHash(token))
    .limit(1)
    .maybeSingle()
  // KAN-251: ein Datenbankfehler ist kein „ungültiger Link“ – der Link bleibt gültig, später erneut versuchen
  if (leseErr) return { ok: false, error: 'Bestätigung derzeit nicht möglich. Bitte später erneut versuchen.', betrieb: null }

  const kontakt = data as AR | null
  if (!kontakt) return { ok: false, error: 'Dieser Bestätigungslink ist ungültig oder bereits verwendet.', betrieb: null }
  const tenantId = kontakt.tenant_id as string
  const betrieb  = await ladeNewsletterBetriebNachId(tenantId)

  if (kontakt.newsletter_bestaetigt) return { ok: true, name: kontakt.vorname ?? '', betrieb }

  if (Date.now() - new Date(kontakt.newsletter_opt_in_am).getTime() > GUELTIG_MS) {
    return { ok: false, error: 'Dieser Bestätigungslink ist abgelaufen. Bitte erneut anmelden.', betrieb }
  }

  const now = new Date().toISOString()
  const { error: updErr } = await (supabase.from('kontakte') as any)   // aenderung-ohne-pruefung: Service-Role (öffentliche Newsletter-Seite), Kontakt eben gelesen
    .update({ newsletter_bestaetigt: true, newsletter_token_hash: null, aktualisiert_am: now })
    .eq('id', kontakt.id)
    .eq('tenant_id', tenantId)
  if (updErr) return { ok: false, error: 'Bestätigung derzeit nicht möglich. Bitte später erneut versuchen.', betrieb }

  { const { error: e } = await (supabase.from('datenschutz_consents') as any).insert({
    tenant_id:   tenantId,
    kontakt_id:  kontakt.id,
    email:       kontakt.email,
    aktion:      'opt_in_bestaetigt',
    quelle:      'website_formular',
    erstellt_am: now,
  })
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (datenschutz_consents): ${e.message}`) }

  // In die Brevo-Liste des Betriebs eintragen (Fehler hier blockieren die Bestätigung nicht)
  if (betrieb?.zugang) {
    const liste = betrieb.listen[(kontakt.segment as Segment)] ?? betrieb.listen.privat
    try {
      await upsertContact({ zugang: betrieb.zugang, email: kontakt.email, vorname: kontakt.vorname, nachname: kontakt.nachname, listIds: liste ? [liste] : [] })
    } catch (e) {
      console.error('Newsletter: Brevo-Eintrag fehlgeschlagen', String(e))
    }
  }

  return { ok: true, name: kontakt.vorname ?? '', betrieb }
}

// ── Abmeldung (signierter Link) ───────────────────────────────────────────────

export async function newsletterAbmelden(kontaktId: string, token: string): Promise<{ ok: boolean; betrieb: NewsletterBetrieb | null }> {
  if (!pruefeAbmeldeToken(kontaktId, token)) return { ok: false, betrieb: null }
  const supabase = createSupabaseAdminClient()
  // tenant-isolation-ignore: öffentlicher Abmeldelink – Kontakt per signierter ID, Betrieb aus dem Datensatz
  const { data, error: leseErr } = await (supabase.from('kontakte') as any)
    .select('id, tenant_id, email').eq('id', kontaktId).maybeSingle()
  if (leseErr) return { ok: false, betrieb: null }
  const kontakt = data as AR | null
  if (!kontakt) return { ok: false, betrieb: null }
  const tenantId = kontakt.tenant_id as string
  const betrieb  = await ladeNewsletterBetriebNachId(tenantId)
  const now = new Date().toISOString()

  const { error } = await (supabase.from('kontakte') as any)   // aenderung-ohne-pruefung: Service-Role (öffentliche Newsletter-Seite), Kontakt eben gelesen
    .update({ newsletter: false, newsletter_bestaetigt: false, newsletter_token_hash: null, aktualisiert_am: now })
    .eq('id', kontakt.id)
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, betrieb }

  // KAN-246: Nachweis der Abmeldung (DSGVO) – Fehler protokollieren statt verschlucken; die Abmeldung selbst gilt
  const { error: nachweisFehler } = await (supabase.from('datenschutz_consents') as any).insert({
    tenant_id:   tenantId,
    kontakt_id:  kontakt.id,
    email:       kontakt.email,
    aktion:      'opt_out',
    quelle:      'abmelde_link',
    erstellt_am: now,
  })
  if (nachweisFehler) void ereignisMelden({ art: 'db', quelle: 'newsletter/datenschutz_consents', meldung: nachweisFehler.message })

  if (betrieb?.zugang && kontakt.email) {
    for (const liste of new Set(Object.values(betrieb.listen).filter((x): x is number => !!x))) {
      try { await removeFromList(kontakt.email, liste, betrieb.zugang) } catch { /* nicht in dieser Liste */ }
    }
  }
  return { ok: true, betrieb }
}
