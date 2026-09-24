'use server'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { encryptPass } from '@/lib/email/crypto'
import { geheimSpeichern } from '@/lib/email/geheimnis'
import { getCurrentUserRole, isSandboxAdminUnlock } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'
import { getStripe } from '@/lib/stripe/client'
import { pruefeBenutzerlimit, benutzerlimitFehler, wendePaketAn, ladePaket } from '@/lib/pakete-server'
import { istPaketKey, PAKETE } from '@/lib/pakete'
import { tenantKopfInvalidieren } from '@/lib/tenant/kopf'
import { stripeKundennummerSync } from '@/lib/stripe/kundennummer'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Nimmt jetzt bewusst die Ziel-tenantId entgegen (bisher parameterlos) - Grund:
// Sandbox-Sonderfreigabe (siehe isSandboxAdminUnlock in lib/auth/roles.ts). Die
// beiden dort freigeschalteten E-Mails dürfen diese Aktionen NUR für den
// Sandbox-Mandanten selbst ausführen, nie für einen echten Kunden-Mandanten -
// das lässt sich nur prüfen, wenn die Ziel-tenantId hier bekannt ist. Jede
// aufrufende Funktion unten hat bereits ein eigenes tenantId-Parameter in
// Scope, der Aufruf wird daher einheitlich zu assertSystemAdmin(tenantId).
async function assertSystemAdmin(tenantId: string) {
  const role = await getCurrentUserRole()
  if (role === 'system_admin') return

  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  const admin = createSupabaseAdminClient()
  const { data: sandboxTenantRow } = await (admin.from('tenants') as any).select('id').eq('name', 'Sandbox').maybeSingle()
  const isSandboxTarget = (sandboxTenantRow as R | null)?.id === tenantId
  if (isSandboxAdminUnlock(user?.email, isSandboxTarget)) return

  throw new AktionsFehler('Nur system_admin erlaubt')
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

  const payload = {
    tenant_id:          tenantId,
    anzeigename:        (formData.get('anzeigename') as string) || null,
    logo_url:           (formData.get('logo_url') as string) || null,
    primary_color:      (formData.get('primary_color') as string) || '#4F86D6',
    secondary_color:    (formData.get('secondary_color') as string) || '#FFFFFF',
    modul_newsletter:   formData.get('modul_newsletter') === 'true',
    modul_crm:          formData.get('modul_crm') === 'true',
    modul_kellerbuch:   formData.get('modul_kellerbuch') === 'true',
    modul_weingarten:   formData.get('modul_weingarten') === 'true',
    modul_ea:           formData.get('modul_ea')           === 'true',
    modul_sumup:        formData.get('modul_sumup')        === 'true',
    modul_export:       formData.get('modul_export')       === 'true',
    modul_controlling:  formData.get('modul_controlling')  === 'true',
    // Migration 197 – nur schreiben, wenn der Aufrufer sie mitschickt (Tab Module);
    // die anderen Tabs (Branding, Brevo) lassen die Buchhaltungsart unverändert.
    ...(formData.has('buchhaltungsart') ? { buchhaltungsart: formData.get('buchhaltungsart') === 'doppik' ? 'doppik' : 'ea' } : {}),
    assistent_aktiv:    formData.get('assistent_aktiv')    === 'true',
    ...(brevoKey !== undefined ? { brevo_api_key: brevoKey } : {}),
    ...(kurzRoh !== null ? { newsletter_kurzname: kurzRoh || null } : {}),
    ...(dsRoh !== null ? { newsletter_datenschutz_url: dsRoh || null } : {}),
    ...(formData.has('newsletter_einleitung') ? { newsletter_einleitung: String(formData.get('newsletter_einleitung') ?? '').trim().slice(0, 600) || null } : {}),
    brevo_sender_mail:  (formData.get('brevo_sender_mail') as string) || null,
    brevo_sender_name:  (formData.get('brevo_sender_name') as string) || null,
    brevo_list_privat:  num('brevo_list_privat'),
    brevo_list_gastro:  num('brevo_list_gastro'),
    brevo_list_handel:  num('brevo_list_handel'),
    brevo_list_export:  num('brevo_list_export'),
    brevo_list_grossh:          num('brevo_list_grossh'),
    session_timeout_minuten:    num('session_timeout_minuten'),
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

  // Prüfen ob User schon existiert
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let userId = users.find(u => u.email === email)?.id

  if (!userId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: 'https://software112.icp-consultants.at/auth/invite',
    })
    if (error || !data.user) return { error: error?.message ?? 'Einladung fehlgeschlagen' }
    userId = data.user.id
  }

  // Prüfen ob Membership schon existiert
  const { data: existing } = await (admin.from('tenant_memberships') as any)
    .select('id').eq('user_id', userId).eq('tenant_id', tenantId).maybeSingle()

  if (existing) return { error: 'Benutzer ist bereits Mitglied dieses Mandanten.' }

  const { error: memberError } = await (admin.from('tenant_memberships') as any)
    .insert({ tenant_id: tenantId, user_id: userId, role })

  if (memberError) return { error: (memberError as R).message }

  // Name im Profil hinterlegen (upsert, falls das Signup-Trigger-Profil noch
  // nicht existiert oder ein bestehender User ohne Namen eingeladen wird).
  const { error: profileError } = await (admin.from('profiles') as any)
    .upsert({ id: userId, full_name: name, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (profileError) return { error: (profileError as R).message }

  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Benutzer: Einladung erneut senden ──────────────────────────────────────────
//
// Für Benutzer, die ihr Konto noch nicht aktiviert haben (email_confirmed_at
// leer) - z.B. weil der erste Einladungslink abgelaufen ist, bevor er
// angeklickt wurde. inviteUserToTenant() oben verschickt bei einem bereits
// existierenden Auth-User bewusst KEINE neue Mail (das ist dort so gewollt,
// damit ein bestehender, bereits aktiver Nutzer ohne Fehlermeldung einem
// weiteren Mandanten zugewiesen werden kann) - für den "steckengebliebenen"
// Fall hier braucht es also einen eigenen, expliziten Weg. Ruft dieselbe
// GoTrue-Route wie eine Erst-Einladung auf: für einen noch unbestätigten
// User erzeugt das einen frischen, neuen Einladungslink und verschickt ihn
// erneut über dieselbe Supabase-Mail (kein separates E-Mail-System nötig).
export async function resendInvite(userId: string, tenantId: string) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { data: userRes, error: getErr } = await admin.auth.admin.getUserById(userId)
  const user = userRes?.user
  if (getErr || !user?.email) return { error: 'Benutzer nicht gefunden' }

  if (user.email_confirmed_at) {
    return { error: 'Dieser Benutzer hat sein Konto bereits aktiviert – kein erneuter Einladungslink nötig. Bei Anmeldeproblemen bitte „Passwort vergessen" auf der Login-Seite verwenden.' }
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(user.email, {
    redirectTo: 'https://software112.icp-consultants.at/auth/invite',
  })
  if (error) return { error: error.message }

  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Benutzer: Name ändern ─────────────────────────────────────────────────────

export async function updateMemberNameAdmin(userId: string, fullName: string, tenantId: string) {
  await assertSystemAdmin(tenantId)
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
      betrieb_betriebsnummer:    (formData.get('betrieb_betriebsnummer') as string) || null,
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

  const { data: existing } = await (admin.from('tenant_einstellungen') as any)
    .select('m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle()

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
  const { data: existing } = await (admin.from('tenant_einstellungen') as any)
    .select('email_smtp_pass_enc, email_imap_pass_enc')
    .eq('tenant_id', tenantId).maybeSingle()
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
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenants') as any)
    .update({ name }).eq('id', tenantId)

  if (error) throw new AktionsFehler((error as R).message)
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath('/admin/mandanten')
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
    bawb_passwort: geheimSpeichern(formData.get('bawb_passwort')) ?? null,  // S11: verschlüsselt
    aktualisiert_am: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })

  if (error) return { error: (error as any).message }
  tenantKopfInvalidieren(tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return null
}

// ── Stripe: Mandant als Customer anlegen ──────────────────────────────────────

export async function createStripeCustomer(tenantId: string, tenantName: string, email: string) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  // Prüfen ob schon ein Customer existiert
  const { data: existing } = await (admin.from('tenants') as any)
    .select('stripe_customer_id').eq('id', tenantId).maybeSingle()
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

// ── Stripe: Checkout-Session erstellen (Abo abschließen) ─────────────────────

export async function createStripeCheckoutSession(
  tenantId: string,
  customerId: string,
  priceId: string,
) {
  await assertSystemAdmin(tenantId)

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

export async function createStripePortalSession(tenantId: string, customerId: string) {
  await assertSystemAdmin(tenantId)

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

export async function cancelStripeSubscription(tenantId: string, subscriptionId: string) {
  await assertSystemAdmin(tenantId)

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
