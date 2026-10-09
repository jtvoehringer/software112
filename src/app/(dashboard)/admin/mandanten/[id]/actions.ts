'use server'
// seiten-betrieb-ausnahme: Mandantenverwaltung – Ziel-Betrieb kommt ausdrücklich als tenantId-Parameter, nicht aus dem Cookie (KAN-30)
// schreibsperre-ausnahme-datei: Mandantenverwaltung – nur Super-Admin bzw. Sandbox-Sonderfreigabe (Sandbox ist von der Abo-Sperre ausgenommen); Abo-Verwaltung des Betriebs muss auch bei Sperre gehen (KAN-5)

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { encryptPass } from '@/lib/email/crypto'
import { geheimSpeichern, geheimFeld } from '@/lib/email/geheimnis'
import { isSandboxAdminUnlock } from '@/lib/auth/roles'
import { istPlattformAdmin } from '@/lib/auth/plattformAdmin'
import { subdomainFehler } from '@/lib/tenant/subdomain'
import { SANDBOX_TENANT_ID, paketEntscheidung } from '@/lib/abo/regeln'
import { revalidatePath } from 'next/cache'
import { getStripe } from '@/lib/stripe/client'
import { pruefeBenutzerlimit, benutzerlimitFehler, wendePaketAn, ladePaket } from '@/lib/pakete-server'
import { istPaketKey, paketAusPlan, paketPriceId, PAKETE } from '@/lib/pakete'
import { tenantKopfInvalidieren } from '@/lib/tenant/kopf'
import { stripeKundennummerSync } from '@/lib/stripe/kundennummer'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { dezimal } from '@/lib/format'
import { betriebsartAus, weinbauBetriebsnummerPruefen } from '@/lib/betrieb/betriebsnummer'
import { mitgliedEinladen, EINLADUNG_REDIRECT } from '@/lib/auth/einladung'
import { istMostgewichtEinheit } from '@/lib/wein/mostgewicht'
import { austrittsWerte, beitrittFehler, beitrittsWerte, gemeinschaftsFreigaben, type VerbundBetrieb } from '@/lib/abo/verbund'
import { premiumSupportEingabeFehler } from '@/lib/abo/premiumSupport'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Nimmt jetzt bewusst die Ziel-tenantId entgegen (bisher parameterlos) - Grund:
// Sandbox-Sonderfreigabe (siehe isSandboxAdminUnlock in lib/auth/roles.ts). Die
// beiden dort freigeschalteten E-Mails dürfen diese Aktionen NUR für den
// Sandbox-Mandanten selbst ausführen, nie für einen echten Kunden-Mandanten -
// das lässt sich nur prüfen, wenn die Ziel-tenantId hier bekannt ist. Jede
// aufrufende Funktion unten hat bereits ein eigenes tenantId-Parameter in
// Scope, der Aufruf wird daher einheitlich zu assertSystemAdmin(tenantId).
//
// 01.10.2026 (Backlog-Abgleich, KAN-10): Plattform-Admin statt Rolle im AKTIVEN Betrieb (getCurrentUserRole prüfte
// nicht den Ziel-Betrieb), Sandbox über die feste ID statt über den Namen „Sandbox“, und die Sonderfreigabe gilt
// nicht für Stripe und das Umbenennen (sandboxFreigabe: false).
async function assertSystemAdmin(tenantId: string, { sandboxFreigabe = true }: { sandboxFreigabe?: boolean } = {}) {
  if (await istPlattformAdmin()) return

  if (sandboxFreigabe && tenantId === SANDBOX_TENANT_ID) {
    const authClient = await createSupabaseServerClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (isSandboxAdminUnlock(user?.email, true)) return
  }

  throw new AktionsFehler('Nur Plattform-Admins erlaubt')
}

/** Benutzer ist Mitglied des Ziel-Betriebs – sonst ließen sich über die Verwaltung eines Betriebs Name bzw. Einladung
 *  beliebiger Benutzer ändern (01.10.2026, Backlog-Abgleich). */
async function pruefeMitglied(userId: string, tenantId: string) {
  const { data, error } = await (createSupabaseAdminClient().from('tenant_memberships') as any)
    .select('id').eq('user_id', userId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new AktionsFehler(`Prüfung fehlgeschlagen (tenant_memberships): ${(error as R).message}`)
  if (!data) throw new AktionsFehler('Dieser Benutzer ist kein Mitglied des Betriebs.')
}

// ── Branding + Module + Brevo speichern ───────────────────────────────────────

export async function saveTenantSettings(tenantId: string, formData: FormData) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const num = (key: string) => {
    const v = formData.get(key) as string
    const n = parseInt(v)
    return isNaN(n) ? null : n
  }

  // S11: API-Key verschlüsselt; Maske (unverändert) → Feld nicht schreiben
  const brevoKey = geheimSpeichern(formData.get('brevo_api_key'))
  // Newsletter je Betrieb (Migration 227) – nur, wenn der Brevo-Tab die Felder mitschickt
  const kurzRoh = formData.has('newsletter_kurzname') ? String(formData.get('newsletter_kurzname') ?? '').trim().toLowerCase() : null
  if (kurzRoh && !/^[a-z0-9][a-z0-9-]{1,39}$/.test(kurzRoh)) throw new AktionsFehler('Kurzname: 2–40 Zeichen, nur a–z, 0–9 und Bindestrich.')
  const dsRoh = formData.has('newsletter_datenschutz_url') ? String(formData.get('newsletter_datenschutz_url') ?? '').trim() : null
  if (dsRoh && !/^https:\/\//.test(dsRoh)) throw new AktionsFehler('Datenschutz-Link muss mit https:// beginnen.')

  // KAN-24 (01.10.2026): jedes Feld nur schreiben, wenn der aufrufende Tab es mitschickt – der Tab „Module“
  // schickt z. B. kein session_timeout_minuten und hat das Sitzungs-Timeout bisher bei jedem Speichern auf
  // leer gesetzt. Fehlende Felder bleiben unverändert (bzw. beim Anlegen der Zeile auf dem DB-Standardwert).
  const feld = <T,>(key: string, wert: () => T): Record<string, T> => (formData.has(key) ? { [key]: wert() } : {})
  const text = (key: string) => feld(key, () => (formData.get(key) as string) || null)
  const schalter = (key: string) => feld(key, () => formData.get(key) === 'true')
  const zahl = (key: string) => feld(key, () => num(key))

  const payload = {
    tenant_id:          tenantId,
    ...text('anzeigename'),
    ...text('logo_url'),
    ...feld('primary_color', () => (formData.get('primary_color') as string) || '#4F86D6'),
    ...feld('secondary_color', () => (formData.get('secondary_color') as string) || '#FFFFFF'),
    ...schalter('modul_newsletter'),
    ...schalter('modul_crm'),
    ...schalter('modul_kellerbuch'),
    ...schalter('modul_weingarten'),
    ...schalter('modul_ea'),
    ...schalter('modul_sumup'),
    ...schalter('modul_export'),
    ...schalter('modul_controlling'),
    // Migration 197 – nur schreiben, wenn der Aufrufer sie mitschickt (Tab Module);
    // die anderen Tabs (Branding, Brevo) lassen die Buchhaltungsart unverändert.
    ...(formData.has('buchhaltungsart') ? { buchhaltungsart: formData.get('buchhaltungsart') === 'doppik' ? 'doppik' : 'ea' } : {}),
    ...schalter('assistent_aktiv'),
    ...(brevoKey !== undefined ? { brevo_api_key: brevoKey } : {}),
    ...(kurzRoh !== null ? { newsletter_kurzname: kurzRoh || null } : {}),
    ...(dsRoh !== null ? { newsletter_datenschutz_url: dsRoh || null } : {}),
    ...(formData.has('newsletter_einleitung') ? { newsletter_einleitung: String(formData.get('newsletter_einleitung') ?? '').trim().slice(0, 600) || null } : {}),
    ...text('brevo_sender_mail'),
    ...text('brevo_sender_name'),
    ...zahl('brevo_list_privat'),
    ...zahl('brevo_list_gastro'),
    ...zahl('brevo_list_handel'),
    ...zahl('brevo_list_export'),
    ...zahl('brevo_list_grossh'),
    ...zahl('session_timeout_minuten'),
    aktualisiert_am:            new Date().toISOString(),
  }

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert(payload, { onConflict: 'tenant_id' })

  if (error) {
    if (/newsletter_kurzname_uidx|duplicate key/i.test((error as R).message)) throw new AktionsFehler('Dieser Kurzname ist schon vergeben.')
    throw new AktionsFehler((error as R).message)
  }
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath('/admin/mandanten')
}

// ── Branding: Logo-Datei-Upload ───────────────────────────────────────────────

const LOGO_MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const LOGO_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

export async function uploadTenantLogo(tenantId: string, formData: FormData): Promise<{ url?: string; error?: string }> {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { error: 'Keine Datei ausgewählt' }
  if (file.size > LOGO_MAX_BYTES) return { error: 'Datei zu groß (max. 2 MB)' }
  if (!LOGO_ALLOWED_TYPES.includes(file.type)) return { error: 'Nur PNG, JPG, WebP oder SVG erlaubt' }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${tenantId}/logo-${Date.now()}.${ext}`

  const { error: uploadErr } = await admin.storage
    .from('mandant-logos')
    .upload(path, file, { contentType: file.type, upsert: true })
  if (uploadErr) return { error: uploadErr.message }

  const { data: pub } = admin.storage.from('mandant-logos').getPublicUrl(path)

  const { error: dbErr } = await (admin.from('tenant_einstellungen') as any)
    .upsert(
      { tenant_id: tenantId, logo_url: pub.publicUrl, aktualisiert_am: new Date().toISOString() },
      { onConflict: 'tenant_id' }
    )
  if (dbErr) return { error: dbErr.message }

  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath('/admin/mandanten')
  return { url: pub.publicUrl }
}

// ── Benutzer: Einladung ───────────────────────────────────────────────────────

// Rollen, die hier vergeben werden dürfen - wie die Auswahl in MandantDetailClient.
// system_admin bewusst nicht, und system_admin-Zeilen sind hier weder änder- noch
// entfernbar (Befund 24.9.2026: die Rolle wurde ungeprüft übernommen und das
// Rollen-Update wirkte ohne Betriebsbezug - über die Sandbox-Sonderfreigabe ließ
// sich so Super-Admin-Zugriff verschaffen). Super-Admins ernennt ausschließlich
// /admin/benutzer (inviteSystemAdmin, pflegt plattform_admins mit).
const VERGEBBARE_ROLLEN = ['tenant_admin', 'winzer', 'leser']

export async function inviteUserToTenant(tenantId: string, email: string, role: string, fullName: string) {
  await assertSystemAdmin(tenantId)
  if (!VERGEBBARE_ROLLEN.includes(role)) return { error: 'Ungültige Rolle' }
  const admin = createSupabaseAdminClient()

  // Name ist seit 7.8.2026 ein Pflichtfeld: der Klarname wird nicht mehr vom
  // Benutzer selbst unter /profil gepflegt, sondern zentral hier beim
  // Einladen/Verwalten - damit kann er nie mehr leer bleiben (siehe auch
  // updateMemberNameAdmin unten).
  const name = fullName.trim()
  if (!name) return { error: 'Name ist ein Pflichtfeld.' }

  // Benutzerlimit des Pakets (Migration 194). system_admin-Mitgliedschaften
  // zählen nicht mit (die Rolle ist oben ohnehin ausgeschlossen).
  {
    const limit = await pruefeBenutzerlimit(admin, tenantId)
    if (!limit.erlaubt) return { error: benutzerlimitFehler(limit) }
  }

  // KAN-139: gemeinsamer Ablauf mit /benutzer (lib/auth/einladung.ts) – bestehende
  // Konten nur mit bestätigter Adresse und mit Benachrichtigung; der Name wird bei
  // bestehenden Konten nur ergänzt, nicht überschrieben (Korrektur: updateMemberNameAdmin).
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  const ergebnis = await mitgliedEinladen(admin, { tenantId, email, role, name, eingeladenVon: user?.id ?? null })
  if ('error' in ergebnis) return { error: ergebnis.error }

  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true, hinweis: ergebnis.hinweis }
}

// ── Benutzer: Einladung erneut senden ──────────────────────────────────────────
//
// Für Benutzer, die ihr Konto noch nicht aktiviert haben (email_confirmed_at
// leer) - z.B. weil der erste Einladungslink abgelaufen ist, bevor er
// angeklickt wurde. inviteUserToTenant() oben ordnet ein bestehendes Konto
// nur zu, wenn dessen Adresse bestätigt ist (KAN-139), und schickt dann eine
// Hinweis-Mail statt einer Einladung - für den "steckengebliebenen"
// Fall hier braucht es also einen eigenen, expliziten Weg. Ruft dieselbe
// GoTrue-Route wie eine Erst-Einladung auf: für einen noch unbestätigten
// User erzeugt das einen frischen, neuen Einladungslink und verschickt ihn
// erneut über dieselbe Supabase-Mail (kein separates E-Mail-System nötig).
export async function resendInvite(userId: string, tenantId: string) {
  await assertSystemAdmin(tenantId)
  await pruefeMitglied(userId, tenantId)
  const admin = createSupabaseAdminClient()

  const { data: userRes, error: getErr } = await admin.auth.admin.getUserById(userId)
  const user = userRes?.user
  if (getErr || !user?.email) return { error: 'Benutzer nicht gefunden' }

  if (user.email_confirmed_at) {
    return { error: 'Dieser Benutzer hat sein Konto bereits aktiviert – kein erneuter Einladungslink nötig. Bei Anmeldeproblemen bitte „Passwort vergessen" auf der Login-Seite verwenden.' }
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(user.email, {
    redirectTo: EINLADUNG_REDIRECT,
  })
  if (error) return { error: error.message }

  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Benutzer: Name ändern ─────────────────────────────────────────────────────

export async function updateMemberNameAdmin(userId: string, fullName: string, tenantId: string) {
  await assertSystemAdmin(tenantId)
  await pruefeMitglied(userId, tenantId)
  const admin = createSupabaseAdminClient()

  const name = fullName.trim()
  if (!name) return { error: 'Name ist ein Pflichtfeld.' }

  const { error } = await (admin.from('profiles') as any)
    .upsert({ id: userId, full_name: name, updated_at: new Date().toISOString() }, { onConflict: 'id' })

  if (error) return { error: (error as R).message }
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Benutzer: Rolle ändern ────────────────────────────────────────────────────

export async function updateMemberRoleAdmin(membershipId: string, role: string, tenantId: string) {
  await assertSystemAdmin(tenantId)
  if (!VERGEBBARE_ROLLEN.includes(role)) return { error: 'Ungültige Rolle' }
  const admin = createSupabaseAdminClient()

  const { error, count } = await (admin.from('tenant_memberships') as any)
    .update({ role }, { count: 'exact' })
    .eq('id', membershipId)
    .eq('tenant_id', tenantId)
    .neq('role', 'system_admin')

  if (error) return { error: (error as R).message }
  if (count === 0) return { error: 'Eintrag nicht gefunden oder keine Änderung möglich.' }
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Benutzer: Entfernen ───────────────────────────────────────────────────────

export async function removeMemberAdmin(membershipId: string, tenantId: string) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { error, count } = await (admin.from('tenant_memberships') as any)
    .delete({ count: 'exact' })
    .eq('id', membershipId)
    .eq('tenant_id', tenantId)
    .neq('role', 'system_admin')

  if (error) return { error: (error as R).message }
  if (count === 0) return { error: 'Eintrag nicht gefunden oder keine Änderung möglich.' }
  // KEIN revalidatePath – Client entfernt den Eintrag aus dem State
  return { success: true }
}

// ── Betriebsdaten + Rechnungs-Einstellungen speichern ────────────────────────

export async function saveBetriebEinstellungen(tenantId: string, formData: FormData) {
  await assertSystemAdmin(tenantId)
  // Weinbau-Betriebsnummer – nur Ziffern, Leerzeichen werden entfernt; Pflicht nur für Weinproduzenten (KAN-261)
  const betriebsart = betriebsartAus(formData.get('betriebsart'))
  const betriebsnummer = weinbauBetriebsnummerPruefen(formData.get('betrieb_betriebsnummer'), betriebsart)
  if (!betriebsnummer.ok) throw new AktionsFehler(betriebsnummer.fehler)
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({
      tenant_id:                 tenantId,
      betrieb_name:              (formData.get('betrieb_name')    as string) || null,
      betrieb_strasse:           (formData.get('betrieb_strasse') as string) || null,
      betrieb_plz:               (formData.get('betrieb_plz')     as string) || null,
      betrieb_ort:               (formData.get('betrieb_ort')     as string) || null,
      betrieb_telefon:           (formData.get('betrieb_telefon') as string) || null,
      betrieb_email:             (formData.get('betrieb_email')   as string) || null,
      betrieb_website:           (formData.get('betrieb_website') as string) || null,
      betrieb_uid:               (formData.get('betrieb_uid')           as string) || null,
      betrieb_betriebsnummer:    betriebsnummer.wert,
      betriebsart,
      rechnung_iban:             (formData.get('rechnung_iban')   as string) || null,
      rechnung_bic:              (formData.get('rechnung_bic')    as string) || null,
      // rechnung_zahlungsziel wird hier bewusst NICHT mehr geschrieben - das
      // Zahlungsziel ist seit 6.8.2026 ein Pflichtfeld pro Kunde (Kontakt/
      // Firma, siehe crm/actions.ts), nicht mehr betriebsweit. Die Spalte
      // bleibt in der DB erhalten (siehe Migration 150), wird aber ab jetzt
      // nirgends mehr gelesen oder geschrieben - da .upsert() nur die
      // angegebenen Spalten setzt, bleibt ihr bisheriger Wert unangetastet.
      rechnung_fusstext:         (formData.get('rechnung_fusstext') as string) || null,
      aktualisiert_am:           new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) throw new AktionsFehler((error as R).message)

  // Bio-Status liegt auf der tenants-Tabelle (nicht tenant_einstellungen) –
  // steuert die Warn-/Sperrlogik bei der Mittelwahl im Maßnahmenformular (Migration 133).
  const bioStatus = (formData.get('bio_status') as string) || 'konventionell'
  const { error: bioError } = await (admin.from('tenants') as any)
    .update({ bio_status: bioStatus })
    .eq('id', tenantId)
  if (bioError) throw new AktionsFehler((bioError as R).message)

  await stripeKundennummerSync(tenantId) // PLZ gespeichert → Kundennummer ggf. neu vergeben
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── Kellerwirtschaft: bevorzugte Mostgewicht-Einheit (KAN-134) ────────────────
// Dieselbe Einstellung wie „Mein Betrieb“ → Kellerwirtschaft (saveKellerwirtschaftOwn, canAdmin):
// welche Einheit Formulare und Listen zuerst zeigen; die gemessene Einheit je Eintrag bleibt davon
// unabhängig. Eigenes Formular im Tab Betrieb, damit es nicht an den Pflichtfeldern der Betriebsdaten
// hängt. tenant_einstellungen nur per .update() – fehlt die Zeile, meldet die Action das.

export async function saveKellerwirtschaftAdmin(tenantId: string, formData: FormData) {
  await assertSystemAdmin(tenantId)
  const einheit = formData.get('mostgewicht_einheit')
  if (!istMostgewichtEinheit(einheit)) throw new AktionsFehler('Bitte wähle °KMW oder °Oe als bevorzugte Einheit.')
  const admin = createSupabaseAdminClient()

  const { error, count } = await (admin.from('tenant_einstellungen') as any)
    .update({ mostgewicht_einheit: einheit, aktualisiert_am: new Date().toISOString() }, { count: 'exact' })
    .eq('tenant_id', tenantId)

  if (error) throw new AktionsFehler((error as R).message)
  if (count === 0) throw new AktionsFehler('Für diesen Mandanten gibt es noch keine Einstellungen – bitte zuerst die Betriebsdaten speichern.')
  tenantKopfInvalidieren(tenantId)   // Layout-Cache: wirkt beim Betrieb ab der nächsten Anfrage
  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── Rechnungsnummer-Einstellungen speichern ───────────────────────────────────

export async function saveVerkaufEinstellungen(tenantId: string, formData: FormData) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const rPrefix  = (formData.get('rechnung_prefix') as string)?.trim() || 'RE'
  const rStellen = Math.max(1, Math.min(8, parseInt(dezimal(formData.get('rechnung_stellen') as string)) || 4))
  // Migration 189: Suffix mit {JJ}/{JJJJ}-Platzhalter gehört zur Rechnungsnummer
  // (nicht zur Accountnummer, siehe Rückmeldung 1.9.2026) - steuert den
  // automatischen Jahreswechsel-Reset in get_next_rechnungsnummer(). Kein
  // serverseitiges Whitelisting der Platzhalter nötig, die DB-Funktion ersetzt
  // nur bekannte Tokens und lässt alles andere unverändert im Suffix stehen.
  const rSuffix  = ((formData.get('rechnung_suffix') as string) ?? '').trim().slice(0, 16)
  const kPrefix  = (formData.get('account_prefix') as string)?.trim() || 'K'
  const kStellen = Math.max(1, Math.min(8, parseInt(dezimal(formData.get('account_stellen') as string)) || 4))

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({
      tenant_id:        tenantId,
      rechnung_prefix:  rPrefix,
      rechnung_stellen: rStellen,
      rechnung_suffix:  rSuffix,
      account_prefix:    kPrefix,
      account_stellen:    kStellen,
      ust_satz_standard: parseFloat(dezimal(formData.get('ust_satz_standard') as string)) || 13,
      aktualisiert_am:   new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) throw new AktionsFehler((error as R).message)
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── M365-Einstellungen speichern ──────────────────────────────────────────────

export async function saveM365Einstellungen(tenantId: string, formData: FormData) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()
  const clientSecret = (formData.get('m365_client_secret') as string).trim()

  const { data: existing, error: existingErr } = await (admin.from('tenant_einstellungen') as any)
    .select('m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle()
  // KAN-251: sonst überschriebe das Speichern das hinterlegte Client-Secret mit null
  if (existingErr) throw new AktionsFehler(dbFehlerText(existingErr, 'M365-Einstellungen konnten nicht geladen werden'))

  const payload: Record<string, unknown> = {
    m365_tenant_id: (formData.get('m365_tenant_id') as string) || null,
    m365_client_id: (formData.get('m365_client_id') as string) || null,
    // Migration 225: Kalender-Schreibrecht nur anfordern, wenn Entra es führt
    m365_kalender_schreiben: formData.get('m365_kalender_schreiben') === 'true',
    m365_client_secret_enc: clientSecret
      ? encryptPass(clientSecret)
      : ((existing as Record<string,string>|null)?.m365_client_secret_enc ?? null),
    aktualisiert_am: new Date().toISOString(),
  }
  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({ tenant_id: tenantId, ...payload }, { onConflict: 'tenant_id' })
  if (error) throw new AktionsFehler((error as Record<string,string>).message)
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── E-Mail-Einstellungen speichern ────────────────────────────────────────────

export async function saveEmailEinstellungen(tenantId: string, formData: FormData) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const smtpPass = (formData.get('email_smtp_pass') as string).trim()
  const imapPass = (formData.get('email_imap_pass') as string).trim()

  // Bestehende verschlüsselte Passwörter lesen (werden nur überschrieben wenn neu eingegeben)
  const { data: existing, error: existingErr } = await (admin.from('tenant_einstellungen') as any)
    .select('email_smtp_pass_enc, email_imap_pass_enc')
    .eq('tenant_id', tenantId).maybeSingle()
  // KAN-251: sonst überschriebe das Speichern die hinterlegten Passwörter mit null
  if (existingErr) throw new AktionsFehler(dbFehlerText(existingErr, 'E-Mail-Einstellungen konnten nicht geladen werden'))
  const existingR = (existing as Record<string,string> | null)

  const payload: Record<string, unknown> = {
    email_modul_aktiv:    formData.get('email_modul_aktiv') === 'true',
    email_smtp_host:      (formData.get('email_smtp_host') as string) || null,
    email_smtp_port:      parseInt(dezimal(formData.get('email_smtp_port') as string)) || 587,
    email_smtp_user:      (formData.get('email_smtp_user') as string) || null,
    email_smtp_from_name: (formData.get('email_smtp_from_name') as string) || null,
    email_smtp_pass_enc:  smtpPass ? encryptPass(smtpPass) : (existingR?.email_smtp_pass_enc ?? null),
    email_imap_host:      (formData.get('email_imap_host') as string) || null,
    email_imap_port:      parseInt(dezimal(formData.get('email_imap_port') as string)) || 993,
    email_imap_user:      (formData.get('email_imap_user') as string) || null,
    email_imap_pass_enc:  imapPass ? encryptPass(imapPass) : (existingR?.email_imap_pass_enc ?? null),
    aktualisiert_am:      new Date().toISOString(),
  }

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({ tenant_id: tenantId, ...payload }, { onConflict: 'tenant_id' })
  if (error) throw new AktionsFehler((error as Record<string,string>).message)
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── Rechnungsnummer-Zähler zurücksetzen ───────────────────────────────────────

export async function resetRechnungsZaehler(tenantId: string, auf: number) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({
      tenant_id:         tenantId,
      rechnung_zaehler:  Math.max(1, auf),
      // Ein manueller Reset zählt als "für dieses Jahr erledigt" - sonst würde
      // der automatische Jahreswechsel-Reset (Migration 189, falls ein
      // Jahres-Platzhalter im Suffix gesetzt ist) den Wert beim nächsten Aufruf
      // von get_next_rechnungsnummer() sofort wieder überschreiben.
      rechnung_zaehler_jahr: new Date().getFullYear(),
      aktualisiert_am:   new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) throw new AktionsFehler((error as R).message)
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── Accountnummer-Zähler zurücksetzen ─────────────────────────────────────────

export async function resetKundenZaehler(tenantId: string, auf: number) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({
      tenant_id:       tenantId,
      account_zaehler: Math.max(1, auf),
      aktualisiert_am: new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) throw new AktionsFehler((error as R).message)
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── Tenant umbenennen ─────────────────────────────────────────────────────────

export async function renameTenantAdmin(tenantId: string, name: string) {
  await assertSystemAdmin(tenantId, { sandboxFreigabe: false })
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenants') as any)
    .update({ name }).eq('id', tenantId)

  if (error) throw new AktionsFehler((error as R).message)
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath('/admin/mandanten')
}


// ── KAN-31: Betriebs-Subdomain (nur Plattform-Admins, Spalte durch a_schutz_plattformfelder geschützt) ────────

export async function setTenantSubdomain(tenantId: string, wert: string) {
  if (!(await istPlattformAdmin())) throw new AktionsFehler('Nur Plattform-Admins dürfen die Subdomain eines Betriebs festlegen.')
  const sub = (wert ?? '').trim().toLowerCase()
  const fehler = sub ? subdomainFehler(sub) : null
  if (fehler) throw new AktionsFehler(fehler)
  const admin = createSupabaseAdminClient()
  const { error } = await (admin.from('tenants') as R)
    .update({ subdomain: sub || null }).eq('id', tenantId)
  if (error) {
    throw new AktionsFehler((error as R).code === '23505' ? `Die Subdomain „${sub}“ hat bereits ein anderer Betrieb.` : (error as R).message)
  }
  revalidatePath(`/admin/mandanten/${tenantId}`)
}


// ── SumUp-Konfiguration speichern ────────────────────────────────────────────

export async function saveSumUpConfig(tenantId: string, formData: FormData) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const sumupKey = geheimSpeichern(formData.get('sumup_api_key'))  // S11: verschlüsselt
  const { error } = await (admin.from('tenant_einstellungen') as any).upsert({
    tenant_id:           tenantId,
    ...(sumupKey !== undefined ? { sumup_api_key: sumupKey } : {}),
    sumup_merchant_code: (formData.get('sumup_merchant_code') as string) || null,
    aktualisiert_am:     new Date().toISOString(),
  }, { onConflict: 'tenant_id' })

  if (error) return { error: (error as any).message }
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return null
}



// ── bawb.at Zugangsdaten speichern ───────────────────────────────────────────

export async function saveBawbZugangsdaten(tenantId: string, formData: FormData) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_einstellungen') as any).upsert({
    tenant_id:    tenantId,
    bawb_kennung:  (formData.get('bawb_kennung')  as string) || null,
    // S11: verschlüsselt; KAN-135: Maske (= unverändert) lässt das Feld weg, statt es zu leeren
    ...geheimFeld('bawb_passwort', formData.get('bawb_passwort')),
    aktualisiert_am: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })

  if (error) return { error: (error as any).message }
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return null
}

// ── Stripe: Mandant als Customer anlegen ──────────────────────────────────────

export async function createStripeCustomer(tenantId: string, tenantName: string, email: string) {
  await assertSystemAdmin(tenantId, { sandboxFreigabe: false })
  const admin = createSupabaseAdminClient()

  // Prüfen ob schon ein Customer existiert
  const { data: existing, error: existingErr } = await (admin.from('tenants') as any)
    .select('stripe_customer_id').eq('id', tenantId).maybeSingle()
  // KAN-251: sonst legte ein Lesefehler einen zweiten Stripe-Kunden an
  if (existingErr) return { error: dbFehlerText(existingErr, 'Betrieb konnte nicht geladen werden') }
  if ((existing as R | null)?.stripe_customer_id) {
    return { error: 'Stripe Customer existiert bereits.' }
  }

  let customer: { id: string }
  try {
    customer = await getStripe().customers.create({
      name:     tenantName,
      email:    email || undefined,
      metadata: { tenant_id: tenantId },
    })
  } catch (err) {
    return { error: `Stripe-Fehler: ${(err as Error).message}` }
  }

  const { error } = await (admin.from('tenants') as any)
    .update({ stripe_customer_id: customer.id }).eq('id', tenantId)
  if (error) return { error: (error as R).message }

  tenantKopfInvalidieren(tenantId)
  await stripeKundennummerSync(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { customerId: customer.id }
}

// ── Stripe: IDs des Betriebs serverseitig laden ───────────────────────────────
// KAN-10 (01.10.2026): Customer- und Subscription-ID kommen nicht mehr vom Client, sondern aus
// tenants – sonst ließen sich Portal, Kündigung und Checkout mit fremden cus_…/sub_… aufrufen.
async function ladeStripeIds(tenantId: string): Promise<{ customerId: string | null; subscriptionId: string | null }> {
  const { data, error } = await (createSupabaseAdminClient().from('tenants') as any)
    .select('stripe_customer_id, stripe_subscription_id, abrechnung_ueber').eq('id', tenantId).maybeSingle()
  if (error) throw new AktionsFehler(`Laden fehlgeschlagen (tenants): ${(error as R).message}`)
  if (!data) throw new AktionsFehler('Betrieb nicht gefunden.')
  // KAN-215: ein Submandant teilt Stripe-Kunde und -Abo des Hauptmandanten – Checkout, Portal und Kündigung hier
  // würden das Abo des Hauptmandanten treffen
  if ((data as R).abrechnung_ueber) throw new AktionsFehler('Dieser Betrieb wird über einen Hauptmandanten abgerechnet (Abrechnungsverbund) – das Abo beim Hauptmandanten verwalten bzw. zuerst austreten.')
  return { customerId: (data as R).stripe_customer_id ?? null, subscriptionId: (data as R).stripe_subscription_id ?? null }
}

// ── Stripe: Checkout-Session erstellen (Abo abschließen) ─────────────────────

// KAN-10 (01.10.2026): statt einer beliebigen priceId nur noch ein Paket-Schlüssel (basis/standard/premium);
// die Preis-ID ermittelt der Server über paketPriceId(). Keine Sandbox-Sonderfreigabe.
export async function createStripeCheckoutSession(tenantId: string, paket: string) {
  await assertSystemAdmin(tenantId, { sandboxFreigabe: false })
  if (!istPaketKey(paket)) return { error: 'Unbekanntes Paket.' }
  const priceId = paketPriceId(paket)
  if (!priceId) return { error: `Für das Paket ${PAKETE[paket].label} ist kein Stripe-Preis hinterlegt.` }
  const { customerId } = await ladeStripeIds(tenantId)
  if (!customerId) return { error: 'Zuerst Stripe Customer anlegen.' }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://software112.icp-consultants.at'

  try {
    const session = await getStripe().checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/admin/mandanten/${tenantId}?stripe=success`,
      cancel_url:  `${baseUrl}/admin/mandanten/${tenantId}?stripe=cancelled`,
      metadata:    { tenant_id: tenantId },
      subscription_data: {
        metadata: { tenant_id: tenantId },
      },
    })
    return { url: session.url }
  } catch (err) {
    return { error: `Stripe-Fehler: ${(err as Error).message}` }
  }
}

// ── Stripe: Customer Portal (Mandant verwaltet Abo selbst) ────────────────────

export async function createStripePortalSession(tenantId: string) {
  await assertSystemAdmin(tenantId, { sandboxFreigabe: false })
  // KAN-10 (01.10.2026): Customer-ID aus tenants, nicht vom Client
  const { customerId } = await ladeStripeIds(tenantId)
  if (!customerId) return { error: 'Für diesen Betrieb ist kein Stripe Customer hinterlegt.' }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://software112.icp-consultants.at'

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${baseUrl}/admin/mandanten/${tenantId}`,
    })
    return { url: session.url }
  } catch (err) {
    return { error: `Stripe-Fehler: ${(err as Error).message}` }
  }
}

// ── Stripe: Subscription direkt kündigen ─────────────────────────────────────

export async function cancelStripeSubscription(tenantId: string) {
  await assertSystemAdmin(tenantId, { sandboxFreigabe: false })
  // KAN-10 (01.10.2026): Subscription-ID aus tenants, nicht vom Client
  const { subscriptionId } = await ladeStripeIds(tenantId)
  if (!subscriptionId) return { error: 'Für diesen Betrieb ist kein Stripe-Abo hinterlegt.' }

  try {
    await getStripe().subscriptions.cancel(subscriptionId)
  } catch (err) {
    return { error: `Stripe-Fehler: ${(err as Error).message}` }
  }

  const admin = createSupabaseAdminClient()
  { const { error: e } = await (admin.from('tenants') as any).update({
    stripe_status:            'cancelled',
    stripe_subscription_id:   null,
    stripe_plan:              null,
    stripe_current_period_end: null,
  }).eq('id', tenantId)
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (tenants): ${e.message}`) }
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Paket-Vorgaben anwenden (Administration → Mandanten → Module) ─────────────
// Setzt Modul-Flags und Benutzerlimit exakt auf das gebuchte Paket
// (tenants.stripe_plan, lib/pakete.ts) - dasselbe, was der Stripe-Webhook bei
// jedem Subscription-Event macht. Für manuell betreute Mandanten ohne Stripe
// kann optional ein Paket vorgegeben werden.
// Rückmeldung 4.9.2026: Pakete mit E&A (Standard, Premium) verlangen die
// Buchhaltungsart (Migration 197) - 'ea' = E&A in software:112, 'doppik' =
// Steuerberater/BMD. Sie wird hier in einem Zug mit dem Paket gesetzt.
export async function wendePaketVorgabenAn(tenantId: string, paketWunsch?: string, buchhaltungsart?: 'ea' | 'doppik' | '') {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()
  const paket = istPaketKey(paketWunsch) ? paketWunsch : await ladePaket(admin, tenantId)
  if (!paket) return { error: 'Für diesen Mandanten ist kein Paket hinterlegt (kein Stripe-Abo).' }
  if (PAKETE[paket].module.modul_ea && buchhaltungsart !== 'ea' && buchhaltungsart !== 'doppik') {
    return { error: `Das Paket ${PAKETE[paket].label} enthält die E&A-Rechnung - bitte zuerst wählen, ob der Betrieb die E&A-Rechnung in software:112 führt oder die doppelte Buchhaltung beim Steuerberater (BMD).` }
  }
  if (istPaketKey(paketWunsch)) {
    { const { error: e } = await (admin.from('tenants') as any).update({ stripe_plan: paket }).eq('id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (tenants): ${e.message}`) }
  }
  const fehler = await wendePaketAn(admin, tenantId, paket)
  if (fehler) return { error: fehler }
  if (buchhaltungsart === 'ea' || buchhaltungsart === 'doppik') {
    const { error } = await (admin.from('tenant_einstellungen') as any)
      .update({ buchhaltungsart }).eq('tenant_id', tenantId)
    if (error) return { error: `Buchhaltungsart konnte nicht gesetzt werden: ${(error as R).message}` }
  }
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true, paket }
}

// ── Hauptmandant und Submandanten (KAN-215, KAN-214) ─────────────────────────────────────────────────────────────
// KAN-214 (Jörgen 08.10.2026): Submandant kostet 0 € – keine Stripe-Position mehr, nur Premium beim Hauptmandanten ist
// Pflicht. Der Submandant übernimmt Stripe-Kunde und -Abo des Hauptmandanten (falls vorhanden; Status, Paket und
// Testphase hält ab dann der Webhook gleich) und bekommt Premium. CRM und Kellergebinde werden gemeinschaftlich genutzt:
// beim Beitritt Keller- und CRM-Freigaben in beide Richtungen (Verwaltung weiter unter Administration › Gemeinschaften;
// beim Austritt bleiben sie stehen und werden dort bei Bedarf deaktiviert).

const VERBUND_SPALTEN = 'id, name, abrechnung_ueber, zusatz_preis_cent, stripe_customer_id, stripe_subscription_id, stripe_status, stripe_plan, stripe_current_period_end, stripe_trial_ends_at'

export async function verbundBeitreten(tenantId: string, hauptId: string): Promise<{ error?: string }> {
  await assertSystemAdmin(tenantId, { sandboxFreigabe: false })
  const admin = createSupabaseAdminClient()
  const [{ data: n, error: nErr }, { data: h, error: hErr }, { count, error: cErr }] = await Promise.all([
    (admin.from('tenants') as R).select(VERBUND_SPALTEN).eq('id', tenantId).maybeSingle(),
    (admin.from('tenants') as R).select(VERBUND_SPALTEN).eq('id', hauptId).maybeSingle(),
    (admin.from('tenants') as R).select('id', { count: 'exact', head: true }).eq('abrechnung_ueber', tenantId),
  ])
  const ladeFehler = nErr ?? hErr ?? cErr
  if (ladeFehler) return { error: dbFehlerText(ladeFehler, 'Betriebe konnten nicht geladen werden') }
  if (!n || !h) return { error: 'Betrieb nicht gefunden.' }
  const fehler = beitrittFehler(n as VerbundBetrieb, h as VerbundBetrieb, (count ?? 0) > 0)
  if (fehler) return { error: fehler }

  const { error } = await (admin.from('tenants') as R).update(beitrittsWerte(h as R)).eq('id', tenantId)
  if (error) return { error: `Submandant konnte nicht gespeichert werden: ${(error as R).message}` }
  // CRM und Kellergebinde gemeinschaftlich (beide Richtungen)
  for (const tab of ['keller_freigaben', 'crm_freigaben']) {
    // tenant-isolation-ignore: mandantenübergreifende Verwaltungstabelle (Plattform-Admin, Service-Role)
    const { error: fe } = await (admin.from(tab) as R).upsert(gemeinschaftsFreigaben(hauptId, tenantId), { onConflict: 'eigentuemer_tenant_id,nutzer_tenant_id' })
    if (fe) return { error: `Submandant gespeichert, aber die Gemeinschaft (${tab === 'crm_freigaben' ? 'CRM' : 'Keller'}) nicht: ${(fe as R).message} – bitte unter Administration › Gemeinschaften anlegen.` }
  }
  // Premium-Module: mit Stripe-Abo laut Status des Hauptmandanten (sonst übernimmt der Webhook), ohne Stripe sofort
  const mitAbo = !!(h as R).stripe_subscription_id
  const e = paketEntscheidung({ ereignis: 'aktualisiert', status: (h as R).stripe_status as string | null, neuesPaket: 'premium', bisherigesPaket: paketAusPlan((n as R).stripe_plan) })
  if (!mitAbo || e.moduleAnwenden) {
    const f = await wendePaketAn(admin, tenantId, 'premium')
    if (f) return { error: f }
  }
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath(`/admin/mandanten/${hauptId}`)
  revalidatePath('/admin/gemeinschaften')
  return {}
}

export async function verbundVerlassen(tenantId: string): Promise<{ error?: string }> {
  await assertSystemAdmin(tenantId, { sandboxFreigabe: false })
  const admin = createSupabaseAdminClient()
  const { data: n, error: nErr } = await (admin.from('tenants') as R).select(VERBUND_SPALTEN).eq('id', tenantId).maybeSingle()
  if (nErr) return { error: dbFehlerText(nErr, 'Betrieb konnte nicht geladen werden') }
  const hauptId = (n as R | null)?.abrechnung_ueber as string | null
  if (!n || !hauptId) return { error: 'Dieser Betrieb ist kein Submandant.' }
  const { error } = await (admin.from('tenants') as R).update(austrittsWerte(!!(n as R).stripe_subscription_id)).eq('id', tenantId)
  if (error) return { error: `Austritt konnte nicht gespeichert werden: ${(error as R).message}` }
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath(`/admin/mandanten/${hauptId}`)
  return {}
}

// ── Premium-Support (KAN-226) ──────────────────────────────────────────────────
// Bis Stripe steht (KAN-11) setzt der Plattform-Admin Beginn und Ende von Hand; danach übernimmt der Webhook.

export async function setPremiumSupport(tenantId: string, seitRoh: string, bisRoh: string): Promise<{ error?: string }> {
  await assertSystemAdmin(tenantId, { sandboxFreigabe: false })
  const fehler = premiumSupportEingabeFehler(seitRoh, bisRoh)
  if (fehler) return { error: fehler }
  const seit = seitRoh.trim() || null
  const bis = bisRoh.trim() || null
  const { error } = await (createSupabaseAdminClient().from('tenants') as R)
    .update({ premium_support_seit: seit, premium_support_bis: bis }).eq('id', tenantId)
  if (error) return { error: `Premium-Support konnte nicht gespeichert werden: ${(error as R).message}` }
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath('/admin/mandanten')
  return {}
}
