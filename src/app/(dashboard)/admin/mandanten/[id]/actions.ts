'use server'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { encryptPass } from '@/lib/email/crypto'
import { getCurrentUserRole, isSandboxAdminUnlock } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'
import { getStripe } from '@/lib/stripe/client'

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

  throw new Error('Nur system_admin erlaubt')
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
    assistent_aktiv:    formData.get('assistent_aktiv')    === 'true',
    // KI-Modul "Frag dein Weingut" (Migration 037): nur ändern, wenn der Module-Tab die
    // Felder mitschickt – Branding-/Brevo-Tab rufen dieselbe Action ohne diese Felder auf
    // und dürfen die KI-Freischaltung nicht versehentlich zurücksetzen.
    ...(formData.has('ki_abfragen_aktiv') ? {
      ki_abfragen_aktiv: formData.get('ki_abfragen_aktiv') === 'true',
      ki_abfragen_paket: ['basic', 'standard', 'unlimited'].includes(String(formData.get('ki_abfragen_paket')))
        ? String(formData.get('ki_abfragen_paket')) : 'basic',
    } : {}),
    brevo_api_key:      (formData.get('brevo_api_key') as string) || null,
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

  if (error) throw new Error((error as R).message)
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

  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath('/admin/mandanten')
  return { url: pub.publicUrl }
}

// ── Benutzer: Einladung ───────────────────────────────────────────────────────

export async function inviteUserToTenant(tenantId: string, email: string, role: string, fullName: string) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  // Name ist seit 7.8.2026 ein Pflichtfeld: der Klarname wird nicht mehr vom
  // Benutzer selbst unter /profil gepflegt, sondern zentral hier beim
  // Einladen/Verwalten - damit kann er nie mehr leer bleiben (siehe auch
  // updateMemberNameAdmin unten).
  const name = fullName.trim()
  if (!name) return { error: 'Name ist ein Pflichtfeld.' }

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
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Benutzer: Rolle ändern ────────────────────────────────────────────────────

export async function updateMemberRoleAdmin(membershipId: string, role: string, tenantId: string) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_memberships') as any)
    .update({ role }).eq('id', membershipId)

  if (error) return { error: (error as R).message }
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Benutzer: Entfernen ───────────────────────────────────────────────────────

export async function removeMemberAdmin(membershipId: string, tenantId: string) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_memberships') as any)
    .delete().eq('id', membershipId)

  if (error) return { error: (error as R).message }
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

  if (error) throw new Error((error as R).message)

  // Bio-Status liegt auf der tenants-Tabelle (nicht tenant_einstellungen) –
  // steuert die Warn-/Sperrlogik bei der Mittelwahl im Maßnahmenformular (Migration 133).
  const bioStatus = (formData.get('bio_status') as string) || 'konventionell'
  const { error: bioError } = await (admin.from('tenants') as any)
    .update({ bio_status: bioStatus })
    .eq('id', tenantId)
  if (bioError) throw new Error((bioError as R).message)

  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── Rechnungsnummer-Einstellungen speichern ───────────────────────────────────

export async function saveVerkaufEinstellungen(tenantId: string, formData: FormData) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const rPrefix  = (formData.get('rechnung_prefix') as string)?.trim() || 'RE'
  const rStellen = Math.max(1, Math.min(8, parseInt(formData.get('rechnung_stellen') as string) || 4))
  const kPrefix  = (formData.get('kunden_prefix') as string)?.trim() || 'K'
  const kStellen = Math.max(1, Math.min(8, parseInt(formData.get('kunden_stellen') as string) || 4))

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({
      tenant_id:        tenantId,
      rechnung_prefix:  rPrefix,
      rechnung_stellen: rStellen,
      kunden_prefix:    kPrefix,
      kunden_stellen:    kStellen,
      ust_satz_standard: parseFloat(formData.get('ust_satz_standard') as string) || 13,
      aktualisiert_am:   new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) throw new Error((error as R).message)
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
    m365_client_secret_enc: clientSecret
      ? encryptPass(clientSecret)
      : ((existing as Record<string,string>|null)?.m365_client_secret_enc ?? null),
    aktualisiert_am: new Date().toISOString(),
  }
  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({ tenant_id: tenantId, ...payload }, { onConflict: 'tenant_id' })
  if (error) throw new Error((error as Record<string,string>).message)
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
    email_smtp_port:      parseInt(formData.get('email_smtp_port') as string) || 587,
    email_smtp_user:      (formData.get('email_smtp_user') as string) || null,
    email_smtp_from_name: (formData.get('email_smtp_from_name') as string) || null,
    email_smtp_pass_enc:  smtpPass ? encryptPass(smtpPass) : (existingR?.email_smtp_pass_enc ?? null),
    email_imap_host:      (formData.get('email_imap_host') as string) || null,
    email_imap_port:      parseInt(formData.get('email_imap_port') as string) || 993,
    email_imap_user:      (formData.get('email_imap_user') as string) || null,
    email_imap_pass_enc:  imapPass ? encryptPass(imapPass) : (existingR?.email_imap_pass_enc ?? null),
    aktualisiert_am:      new Date().toISOString(),
  }

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({ tenant_id: tenantId, ...payload }, { onConflict: 'tenant_id' })
  if (error) throw new Error((error as Record<string,string>).message)
  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── Rechnungsnummer-Zähler zurücksetzen ───────────────────────────────────────

export async function resetRechnungsZaehler(tenantId: string, auf: number) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({
      tenant_id:        tenantId,
      rechnung_zaehler: Math.max(1, auf),
      aktualisiert_am:  new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) throw new Error((error as R).message)
  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── Kundennummer-Zähler zurücksetzen ─────────────────────────────────────────

export async function resetKundenZaehler(tenantId: string, auf: number) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert({
      tenant_id:       tenantId,
      kunden_zaehler:  Math.max(1, auf),
      aktualisiert_am: new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) throw new Error((error as R).message)
  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── Tenant umbenennen ─────────────────────────────────────────────────────────

export async function renameTenantAdmin(tenantId: string, name: string) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenants') as any)
    .update({ name }).eq('id', tenantId)

  if (error) throw new Error((error as R).message)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath('/admin/mandanten')
}


// ── SumUp-Konfiguration speichern ────────────────────────────────────────────

export async function saveSumUpConfig(tenantId: string, formData: FormData) {
  await assertSystemAdmin(tenantId)
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_einstellungen') as any).upsert({
    tenant_id:           tenantId,
    sumup_api_key:       (formData.get('sumup_api_key') as string) || null,
    sumup_merchant_code: (formData.get('sumup_merchant_code') as string) || null,
    aktualisiert_am:     new Date().toISOString(),
  }, { onConflict: 'tenant_id' })

  if (error) return { error: (error as any).message }
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
    bawb_passwort: (formData.get('bawb_passwort') as string) || null,
    aktualisiert_am: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })

  if (error) return { error: (error as any).message }
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
  await (admin.from('tenants') as any).update({
    stripe_status:            'cancelled',
    stripe_subscription_id:   null,
    stripe_plan:              null,
    stripe_current_period_end: null,
  }).eq('id', tenantId)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}
