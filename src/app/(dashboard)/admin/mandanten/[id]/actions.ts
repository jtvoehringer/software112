'use server'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { encryptPass } from '@/lib/email/crypto'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function assertSystemAdmin() {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin') throw new Error('Nur system_admin erlaubt')
}

// ── Branding + Module + Brevo speichern ───────────────────────────────────────

export async function saveTenantSettings(tenantId: string, formData: FormData) {
  await assertSystemAdmin()
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
    primary_color:      (formData.get('primary_color') as string) || '#2a7c6f',
    secondary_color:    (formData.get('secondary_color') as string) || '#f5c842',
    modul_newsletter:   formData.get('modul_newsletter') === 'true',
    modul_crm:          formData.get('modul_crm') === 'true',
    modul_kellerbuch:   formData.get('modul_kellerbuch') === 'true',
    modul_weingarten:   formData.get('modul_weingarten') === 'true',
    modul_ea:           formData.get('modul_ea')           === 'true',
    modul_fibu:         formData.get('modul_fibu')         === 'true',
    modul_sumup:        formData.get('modul_sumup')        === 'true',
    brevo_api_key:      (formData.get('brevo_api_key') as string) || null,
    brevo_sender_mail:  (formData.get('brevo_sender_mail') as string) || null,
    brevo_sender_name:  (formData.get('brevo_sender_name') as string) || null,
    brevo_list_privat:  num('brevo_list_privat'),
    brevo_list_gastro:  num('brevo_list_gastro'),
    brevo_list_handel:  num('brevo_list_handel'),
    brevo_list_export:  num('brevo_list_export'),
    brevo_list_grossh:  num('brevo_list_grossh'),
    aktualisiert_am:    new Date().toISOString(),
  }

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert(payload, { onConflict: 'tenant_id' })

  if (error) throw new Error((error as R).message)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath('/admin/mandanten')
}

// ── Benutzer: Einladung ───────────────────────────────────────────────────────

export async function inviteUserToTenant(tenantId: string, email: string, role: string) {
  await assertSystemAdmin()
  const admin = createSupabaseAdminClient()

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

  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Benutzer: Rolle ändern ────────────────────────────────────────────────────

export async function updateMemberRoleAdmin(membershipId: string, role: string, tenantId: string) {
  await assertSystemAdmin()
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_memberships') as any)
    .update({ role }).eq('id', membershipId)

  if (error) return { error: (error as R).message }
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Benutzer: Entfernen ───────────────────────────────────────────────────────

export async function removeMemberAdmin(membershipId: string, tenantId: string) {
  await assertSystemAdmin()
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_memberships') as any)
    .delete().eq('id', membershipId)

  if (error) return { error: (error as R).message }
  // KEIN revalidatePath – Client entfernt den Eintrag aus dem State
  return { success: true }
}

// ── Betriebsdaten + Rechnungs-Einstellungen speichern ────────────────────────

export async function saveBetriebEinstellungen(tenantId: string, formData: FormData) {
  await assertSystemAdmin()
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
      rechnung_zahlungsziel:     parseInt(formData.get('rechnung_zahlungsziel') as string) || 14,
      rechnung_fusstext:         (formData.get('rechnung_fusstext') as string) || null,
      aktualisiert_am:           new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) throw new Error((error as R).message)
  revalidatePath(`/admin/mandanten/${tenantId}`)
}

// ── Rechnungsnummer-Einstellungen speichern ───────────────────────────────────

export async function saveVerkaufEinstellungen(tenantId: string, formData: FormData) {
  await assertSystemAdmin()
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
  await assertSystemAdmin()
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
  await assertSystemAdmin()
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
  await assertSystemAdmin()
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
  await assertSystemAdmin()
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
  await assertSystemAdmin()
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenants') as any)
    .update({ name }).eq('id', tenantId)

  if (error) throw new Error((error as R).message)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath('/admin/mandanten')
}


// ── SumUp-Konfiguration speichern ────────────────────────────────────────────

export async function saveSumUpConfig(tenantId: string, formData: FormData) {
  await assertSystemAdmin()
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
