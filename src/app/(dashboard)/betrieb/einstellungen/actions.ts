'use server'

// Betriebseinstellungen für den EIGENEN, aktuell aktiven Mandanten – erreichbar
// für system_admin UND tenant_admin (Betriebsleiter), siehe Sidebar.tsx
// ("Mein Betrieb", adminOnly, außerhalb der systemAdminOnly-Gruppe
// "Administration"). Bewusst eine eigene, schlanke Aktionen-Datei statt
// Wiederverwendung von src/app/(dashboard)/admin/mandanten/[id]/actions.ts:
// die dortigen Aktionen sind (a) für JEDEN beliebigen Mandanten aufrufbar
// (tenantId kommt vom Client) und (b) hängen an derselben TenantSettings-
// Struktur wie Brevo/SumUp/SMTP/IMAP/M365/Stripe-Zugangsdaten. Ein
// Betriebsleiter darf NUR seinen eigenen aktiven Betrieb bearbeiten und NIE
// diese plattformweiten Drittanbieter-Zugangsdaten sehen oder überschreiben -
// hier wird die Ziel-Tenant-ID daher ausschließlich serverseitig aus der
// aktiven Mitgliedschaft (getCurrentMembership) gelesen, nie vom Client
// übernommen, und es werden ausschließlich Branding-/Betriebsdaten-/bawb.at-
// und Kellerwirtschafts-Spalten (mostgewicht_einheit) gelesen und geschrieben.

import { geheimFeld } from '@/lib/email/geheimnis'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { seitenBetriebFehler } from '@/lib/auth/seitenBetrieb'
import { schreibSperreFehler } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { tenantKopfInvalidieren } from '@/lib/tenant/kopf'
import { stripeKundennummerSync } from '@/lib/stripe/kundennummer'
import { weinbauBetriebsnummerPruefen } from '@/lib/betrieb/betriebsnummer'
import { rechtsformAus } from '@/lib/betrieb/rechtsform'
import { istMostgewichtEinheit } from '@/lib/wein/mostgewicht'
import { dbFehlerText } from '@/lib/fehler'
import { ganzzahlAus } from '@/lib/format'

async function requireOwnTenant(): Promise<{ tenantId: string } | { error: string }> {
  const membership = await getCurrentMembership()
  // KAN-30: Seite aus einem anderen Betrieb? (vor den Rechten, sonst gelten die des neuen Betriebs)
  const betriebGewechselt = await seitenBetriebFehler(membership?.tenantId)
  if (betriebGewechselt) return { error: betriebGewechselt }
  const aboGesperrt = await schreibSperreFehler(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (aboGesperrt) return { error: aboGesperrt }
  if (!membership || !canAdmin(membership.role)) return { error: 'Keine Berechtigung' }
  return { tenantId: membership.tenantId }
}

// ── Branding ──────────────────────────────────────────────────────────────

export async function saveBrandingOwn(formData: FormData) {
  const auth = await requireOwnTenant()
  if ('error' in auth) return { error: auth.error }
  const admin = createSupabaseAdminClient()

  const num = (key: string) => {
    const v = formData.get(key) as string
    const n = parseInt(v)
    return isNaN(n) ? null : n
  }

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({
      tenant_id:                auth.tenantId,
      anzeigename:               (formData.get('anzeigename') as string) || null,
      logo_url:                  (formData.get('logo_url') as string) || null,
      primary_color:             (formData.get('primary_color') as string) || '#4F86D6',
      secondary_color:           (formData.get('secondary_color') as string) || '#FFFFFF',
      session_timeout_minuten:   num('session_timeout_minuten'),
      // Dashboard-Regeln (Migration 179) – Grenzen wie der CHECK in der DB
      gaerung_messintervall_tage: Math.min(60,  Math.max(1, num('gaerung_messintervall_tage') ?? 3)),
      fristen_vorwarnung_tage:    Math.min(365, Math.max(1, num('fristen_vorwarnung_tage')    ?? 30)),
      // KAN-87: Erfassungsfrist Pflanzenschutz (h) – Grenzen wie der CHECK in der DB
      psm_erfassungsfrist_h:      Math.min(720, Math.max(1, num('psm_erfassungsfrist_h')      ?? 24)),
      // KAN-418 Teil 5: Standardfrist einer Reservierung (Tage) – Grenzen wie der CHECK in der DB
      auftrag_reservierung_tage:  Math.min(365, Math.max(1, num('auftrag_reservierung_tage')  ?? 14)),
      // Morgenbericht & Wetter (Migration 201)
      morgenbericht_aktiv:        formData.get('morgenbericht_aktiv') === 'on',
      wetter_aktiv:               formData.get('wetter_aktiv') === 'on',
      wetter_abwasch_mm:          Math.min(100, Math.max(5, num('wetter_abwasch_mm') ?? 25)),
      wetter_intervall_tage:      Math.min(60, Math.max(5, num('wetter_intervall_tage') ?? 14)),
      aktualisiert_am:           new Date().toISOString(),
      // Absichtlich KEINE brevo_*/modul_*/sumup_*/email_*/m365_*-Felder hier -
      // .upsert() setzt nur die angegebenen Spalten, alle anderen bleiben
      // unangetastet (siehe gleiches Muster in admin/mandanten/[id]/actions.ts).
    }, { onConflict: 'tenant_id' })

  if (error) return { error: dbFehlerText(error) }
  tenantKopfInvalidieren(auth.tenantId)
  revalidatePath('/betrieb/einstellungen')
  return { success: true }
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const LOGO_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

export async function uploadLogoOwn(formData: FormData): Promise<{ url?: string; error?: string }> {
  const auth = await requireOwnTenant()
  if ('error' in auth) return { error: auth.error }
  const admin = createSupabaseAdminClient()

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { error: 'Keine Datei ausgewählt' }
  if (file.size > LOGO_MAX_BYTES) return { error: 'Datei zu groß (max. 2 MB)' }
  if (!LOGO_ALLOWED_TYPES.includes(file.type)) return { error: 'Nur PNG, JPG, WebP oder SVG erlaubt' }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${auth.tenantId}/logo-${Date.now()}.${ext}`

  const { error: uploadErr } = await admin.storage
    .from('mandant-logos')
    .upload(path, file, { contentType: file.type, upsert: true })
  if (uploadErr) return { error: dbFehlerText(uploadErr) }

  const { data: pub } = admin.storage.from('mandant-logos').getPublicUrl(path)

  const { error: dbErr } = await (admin.from('tenant_einstellungen') as any)
    .upsert(
      { tenant_id: auth.tenantId, logo_url: pub.publicUrl, aktualisiert_am: new Date().toISOString() },
      { onConflict: 'tenant_id' }
    )
  if (dbErr) return { error: dbFehlerText(dbErr) }

  tenantKopfInvalidieren(auth.tenantId)
  revalidatePath('/betrieb/einstellungen')
  return { url: pub.publicUrl }
}

// ── Betrieb (Briefkopf, Bankverbindung, Bio-Status) ─────────────────────────

export async function saveBetriebOwn(formData: FormData) {
  const auth = await requireOwnTenant()
  if ('error' in auth) return { error: auth.error }
  // KAN-48 AP11: Rechtsform (BKI-Betriebsdaten) – nur die Werte des CHECK
  const rechtsform = rechtsformAus(formData.get('betrieb_rechtsform'))
  if (!rechtsform.ok) return { error: 'Bitte eine gültige Rechtsform wählen.' }
  const admin = createSupabaseAdminClient()
  // Weinbau-Betriebsnummer – nur Ziffern, Leerzeichen werden entfernt; Pflicht nur für Weinproduzenten (KAN-261,
  // Betriebsart pflegt die Mandantenverwaltung)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase-Typen ohne Tabellenschema (Konvention)
  const { data: artZeile, error: artErr } = await (admin.from('tenant_einstellungen') as any)
    .select('betriebsart').eq('tenant_id', auth.tenantId).maybeSingle()
  if (artErr) return { error: `Betriebsart konnte nicht geladen werden: ${dbFehlerText(artErr)}` }
  const betriebsnummer = weinbauBetriebsnummerPruefen(formData.get('betrieb_betriebsnummer'), artZeile?.betriebsart)
  if (!betriebsnummer.ok) return { error: betriebsnummer.fehler }

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({
      tenant_id:                 auth.tenantId,
      betrieb_name:              (formData.get('betrieb_name')    as string) || null,
      betrieb_strasse:           (formData.get('betrieb_strasse') as string) || null,
      betrieb_plz:               (formData.get('betrieb_plz')     as string) || null,
      betrieb_ort:               (formData.get('betrieb_ort')     as string) || null,
      betrieb_telefon:           (formData.get('betrieb_telefon') as string) || null,
      betrieb_email:             (formData.get('betrieb_email')   as string) || null,
      betrieb_website:           (formData.get('betrieb_website') as string) || null,
      betrieb_uid:               (formData.get('betrieb_uid')           as string) || null,
      // KAN-432: Weinexport – EORI, kleiner Weinerzeuger, Standard „Flaschen je Karton“ (Grenzen wie der CHECK in der DB)
      betrieb_eori:              ((formData.get('betrieb_eori') as string | null) ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 30) || null,
      // KAN-434: Nummern für die Ursprungserklärung über 6.000 EUR (Grenze wie der CHECK in der DB)
      betrieb_rex_nummer:        ((formData.get('betrieb_rex_nummer') as string | null) ?? '').trim().slice(0, 40) || null,
      betrieb_ea_bewilligung:    ((formData.get('betrieb_ea_bewilligung') as string | null) ?? '').trim().slice(0, 40) || null,
      kleiner_weinerzeuger:      formData.get('kleiner_weinerzeuger') === 'on',
      export_flaschen_je_karton: Math.min(60, Math.max(1, ganzzahlAus(formData.get('export_flaschen_je_karton')) ?? 6)),
      betrieb_betriebsnummer:    betriebsnummer.wert,
      betrieb_rechtsform:        rechtsform.wert,
      betrieb_vorname:           ((formData.get('betrieb_vorname') as string | null) ?? '').trim() || null,
      betrieb_nachname:          ((formData.get('betrieb_nachname') as string | null) ?? '').trim() || null,
      betrieb_betriebsstaette:   ((formData.get('betrieb_betriebsstaette') as string | null) ?? '').trim() || null,
      // Betriebsbeginn E&A (Migration 180): leer = keine Einschränkung
      ea_betriebsbeginn:         /^\d{4}-\d{2}-\d{2}$/.test(String(formData.get('ea_betriebsbeginn') ?? '')) ? String(formData.get('ea_betriebsbeginn')) : null,
      rechnung_iban:             (formData.get('rechnung_iban')   as string) || null,
      rechnung_bic:              (formData.get('rechnung_bic')    as string) || null,
      rechnung_fusstext:         (formData.get('rechnung_fusstext') as string) || null,
      aktualisiert_am:           new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) return { error: dbFehlerText(error) }

  // Bio-Status liegt auf der tenants-Tabelle (nicht tenant_einstellungen) -
  // steuert die Warn-/Sperrlogik bei der Mittelwahl im Maßnahmenformular.
  const bioStatus = (formData.get('bio_status') as string) || 'konventionell'
  const { error: bioError } = await (admin.from('tenants') as any)
    .update({ bio_status: bioStatus })
    .eq('id', auth.tenantId)
  if (bioError) return { error: dbFehlerText(bioError) }

  await stripeKundennummerSync(auth.tenantId) // PLZ gespeichert → Kundennummer ggf. neu vergeben
  tenantKopfInvalidieren(auth.tenantId)
  revalidatePath('/betrieb/einstellungen')
  return { success: true }
}

// ── Kellerwirtschaft (KAN-128 Teil A, S3) ───────────────────────────────────
// Bevorzugte Mostgewicht-Einheit: welche Einheit Formulare und Listen zuerst zeigen
// (useMostgewichtEinheit / ladeMostgewichtEinheit). Die gemessene Einheit je Eintrag bleibt
// davon unabhängig. Nur canAdmin (requireOwnTenant); Service-Role wie saveBrandingOwn – keine
// neuen Trigger-Argumente für a_schutz_plattformfelder nötig.

export async function saveKellerwirtschaftOwn(formData: FormData) {
  const auth = await requireOwnTenant()
  if ('error' in auth) return { error: auth.error }
  const einheit = formData.get('mostgewicht_einheit')
  if (!istMostgewichtEinheit(einheit)) return { error: 'Bitte wähle °KMW oder °Oe als bevorzugte Einheit.' }
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_einstellungen') as any).upsert({
    tenant_id:           auth.tenantId,
    mostgewicht_einheit: einheit,
    aktualisiert_am:     new Date().toISOString(),
  }, { onConflict: 'tenant_id' })

  if (error) return { error: dbFehlerText(error) }
  tenantKopfInvalidieren(auth.tenantId)   // Layout-Cache: wirkt ab der nächsten Anfrage
  revalidatePath('/betrieb/einstellungen')
  return { success: true }
}

// ── bawb.at Zugangsdaten ─────────────────────────────────────────────────────

export async function saveBawbOwn(formData: FormData) {
  const auth = await requireOwnTenant()
  if ('error' in auth) return { error: auth.error }
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_einstellungen') as any).upsert({
    tenant_id:       auth.tenantId,
    bawb_kennung:    (formData.get('bawb_kennung')  as string) || null,
    // S11: verschlüsselt; KAN-135: Maske (= unverändert) lässt das Feld weg, statt es zu leeren
    ...geheimFeld('bawb_passwort', formData.get('bawb_passwort')),
    aktualisiert_am: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })

  if (error) return { error: dbFehlerText(error) }
  tenantKopfInvalidieren(auth.tenantId)
  revalidatePath('/betrieb/einstellungen')
  return { success: true }
}
