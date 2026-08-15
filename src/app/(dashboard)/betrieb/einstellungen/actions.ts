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
// Spalten gelesen und geschrieben.

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function requireOwnTenant(): Promise<{ tenantId: string } | { error: string }> {
  const membership = await getCurrentMembership()
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
      aktualisiert_am:           new Date().toISOString(),
      // Absichtlich KEINE brevo_*/modul_*/sumup_*/email_*/m365_*-Felder hier -
      // .upsert() setzt nur die angegebenen Spalten, alle anderen bleiben
      // unangetastet (siehe gleiches Muster in admin/mandanten/[id]/actions.ts).
    }, { onConflict: 'tenant_id' })

  if (error) return { error: error.message }
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
  if (uploadErr) return { error: uploadErr.message }

  const { data: pub } = admin.storage.from('mandant-logos').getPublicUrl(path)

  const { error: dbErr } = await (admin.from('tenant_einstellungen') as any)
    .upsert(
      { tenant_id: auth.tenantId, logo_url: pub.publicUrl, aktualisiert_am: new Date().toISOString() },
      { onConflict: 'tenant_id' }
    )
  if (dbErr) return { error: dbErr.message }

  revalidatePath('/betrieb/einstellungen')
  return { url: pub.publicUrl }
}

// ── Betrieb (Briefkopf, Bankverbindung, Bio-Status) ─────────────────────────

export async function saveBetriebOwn(formData: FormData) {
  const auth = await requireOwnTenant()
  if ('error' in auth) return { error: auth.error }
  const admin = createSupabaseAdminClient()

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
      betrieb_betriebsnummer:    (formData.get('betrieb_betriebsnummer') as string) || null,
      rechnung_iban:             (formData.get('rechnung_iban')   as string) || null,
      rechnung_bic:              (formData.get('rechnung_bic')    as string) || null,
      rechnung_fusstext:         (formData.get('rechnung_fusstext') as string) || null,
      aktualisiert_am:           new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) return { error: error.message }

  // Bio-Status liegt auf der tenants-Tabelle (nicht tenant_einstellungen) -
  // steuert die Warn-/Sperrlogik bei der Mittelwahl im Maßnahmenformular.
  const bioStatus = (formData.get('bio_status') as string) || 'konventionell'
  const { error: bioError } = await (admin.from('tenants') as any)
    .update({ bio_status: bioStatus })
    .eq('id', auth.tenantId)
  if (bioError) return { error: bioError.message }

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
    bawb_passwort:   (formData.get('bawb_passwort') as string) || null,
    aktualisiert_am: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })

  if (error) return { error: error.message }
  revalidatePath('/betrieb/einstellungen')
  return { success: true }
}
