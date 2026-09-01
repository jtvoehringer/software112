import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, isSandboxAdminUnlock } from '@/lib/auth/roles'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import MandantDetailClient from './MandantDetailClient'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type TenantDetail = {
  id: string; name: string; slug: string; plan: string; created_at: string
  stripe_customer_id:       string | null
  stripe_subscription_id:   string | null
  stripe_status:            string | null
  stripe_plan:              string | null
  stripe_current_period_end: string | null
  bio_status:               string
}
export type TenantSettings = {
  anzeigename:      string | null
  logo_url:         string | null
  primary_color:    string
  secondary_color:  string
  modul_newsletter: boolean
  modul_crm:        boolean
  modul_kellerbuch: boolean
  modul_weingarten: boolean
  brevo_api_key:     string | null
  brevo_sender_mail: string | null
  brevo_sender_name: string | null
  brevo_list_privat: number | null
  brevo_list_gastro: number | null
  brevo_list_handel: number | null
  brevo_list_export: number | null
  brevo_list_grossh: number | null
  rechnung_prefix:   string
  rechnung_zaehler:  number
  rechnung_stellen:  number
  // Migration 189 – Suffix mit {JJ}/{JJJJ}-Jahresplatzhalter, steuert den
  // automatischen Jahreswechsel-Reset in get_next_rechnungsnummer().
  rechnung_suffix:   string
  account_prefix:     string
  account_zaehler:    number
  account_stellen:    number
  // Migration 030 – Betriebsdaten + Rechnungseinstellungen
  betrieb_name:             string | null
  betrieb_strasse:          string | null
  betrieb_plz:              string | null
  betrieb_ort:              string | null
  betrieb_telefon:          string | null
  betrieb_email:            string | null
  betrieb_website:          string | null
  betrieb_uid:              string | null
  betrieb_betriebsnummer:   string | null
  rechnung_iban:            string | null
  rechnung_bic:             string | null
  rechnung_zahlungsziel:    number
  rechnung_fusstext:        string | null
  session_timeout_minuten:  number | null
  // Migration 032
  ust_satz_standard:        number
  // Migration 038 – E-Mail
  email_modul_aktiv:   boolean
  email_smtp_host:     string | null
  email_smtp_port:     number
  email_smtp_user:     string | null
  email_smtp_from_name:string | null
  email_imap_host:     string | null
  email_imap_port:     number
  email_imap_user:     string | null
  email_last_poll:     string | null
  // Migration 039 – M365
  m365_modul_aktiv:    boolean
  m365_tenant_id:      string | null
  m365_client_id:      string | null
  m365_user_email:     string | null
  m365_token_expires_at: string | null
  m365_webhook_sub_id: string | null
  m365_webhook_expires: string | null
  // Migration 098 – E&A, SumUp (FIBU entfernt)
  modul_ea:            boolean
  modul_sumup:         boolean
  // Migration 152 – Exportaufträge (Weinexport)
  modul_export:        boolean
  // Migration 148 – Prozess-Assistent (Bot)
  assistent_aktiv:     boolean
  ea_buchung_modus:    string
  ea_kleinunternehmer: boolean
  ea_uva_zeitraum:     string
  sumup_api_key:       string | null
  sumup_merchant_code: string | null
  // Migration 123 – bawb.at
  bawb_kennung:        string | null
  bawb_passwort:       string | null
}
export type TenantMember = {
  id: string; userId: string; email: string; role: string; createdAt: string
  fullName: string | null
  confirmed: boolean
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const admin = createSupabaseAdminClient()
  const { data } = await (admin.from('tenants') as any).select('name').eq('id', id).single()
  return { title: `${(data as R | null)?.name ?? 'Mandant'} – software:112` }
}

export default async function MandantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const role = await getCurrentUserRole()
  const admin = createSupabaseAdminClient()

  if (role !== 'system_admin') {
    // Sandbox-Sonderfreigabe (siehe isSandboxAdminUnlock in lib/auth/roles.ts):
    // die beiden freigeschalteten E-Mails dürfen ausschließlich den
    // Sandbox-Mandanten SELBST hier öffnen - nie einen echten Kunden-
    // Mandanten, auch nicht per direkt eingegebener URL mit fremder ID
    // ("sonst NIE", Rückmeldung 19.8.2026).
    const authClient = await createSupabaseServerClient()
    const { data: { user } } = await authClient.auth.getUser()
    const { data: sandboxTenantRow } = await (admin.from('tenants') as any).select('id').eq('name', 'Sandbox').maybeSingle()
    const isSandboxTarget = (sandboxTenantRow as R | null)?.id === id
    if (!isSandboxAdminUnlock(user?.email, isSandboxTarget)) redirect('/dashboard')
  }

  const [
    { data: tenantRaw },
    { data: settingsRaw },
    { data: memberships },
    { data: { users } },
  ] = await Promise.all([
    (admin.from('tenants') as any)
      .select('id, name, slug, plan, created_at, stripe_customer_id, stripe_subscription_id, stripe_status, stripe_plan, stripe_current_period_end, bio_status').eq('id', id).single(),
    (admin.from('tenant_einstellungen') as any)
      .select('*').eq('tenant_id', id).maybeSingle(),
    (admin.from('tenant_memberships') as any)
      .select('id, user_id, role, created_at').eq('tenant_id', id).order('created_at'),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  if (!tenantRaw) notFound()

  const emailMap: Record<string, string> = {}
  const confirmedMap: Record<string, boolean> = {}
  users.forEach(u => {
    emailMap[u.id] = u.email ?? '–'
    confirmedMap[u.id] = !!u.email_confirmed_at
  })

  // Klarnamen der Mitglieder (Name wird seit 7.8.2026 hier zentral administriert,
  // nicht mehr vom Benutzer selbst unter /profil - siehe MandantDetailClient BenutzerTab).
  const memberUserIds = [...new Set(((memberships ?? []) as R[]).map((m: R) => m.user_id))]
  const nameMap: Record<string, string | null> = {}
  if (memberUserIds.length > 0) {
    const { data: profilesRaw } = await (admin.from('profiles') as any)
      .select('id, full_name').in('id', memberUserIds)
    ;(profilesRaw as R[] ?? []).forEach((p: R) => { nameMap[p.id] = p.full_name ?? null })
  }

  const t = tenantRaw as R
  const s = settingsRaw as R | null

  const tenant: TenantDetail = {
    id: t.id, name: t.name, slug: t.slug, plan: t.plan, created_at: t.created_at,
    stripe_customer_id:        t.stripe_customer_id        ?? null,
    stripe_subscription_id:    t.stripe_subscription_id    ?? null,
    stripe_status:             t.stripe_status             ?? null,
    stripe_plan:               t.stripe_plan               ?? null,
    stripe_current_period_end: t.stripe_current_period_end ?? null,
    bio_status:                t.bio_status                ?? 'konventionell',
  }

  const settings: TenantSettings = {
    anzeigename:      s?.anzeigename ?? null,
    logo_url:         s?.logo_url ?? null,
    primary_color:    s?.primary_color ?? '#4F86D6',
    secondary_color:  s?.secondary_color ?? '#FFFFFF',
    modul_newsletter: s?.modul_newsletter ?? false,
    modul_crm:        s?.modul_crm ?? true,
    modul_kellerbuch: s?.modul_kellerbuch ?? true,
    modul_weingarten: s?.modul_weingarten ?? true,
    brevo_api_key:     s?.brevo_api_key ?? null,
    brevo_sender_mail: s?.brevo_sender_mail ?? null,
    brevo_sender_name: s?.brevo_sender_name ?? null,
    brevo_list_privat: s?.brevo_list_privat ?? null,
    brevo_list_gastro: s?.brevo_list_gastro ?? null,
    brevo_list_handel: s?.brevo_list_handel ?? null,
    brevo_list_export: s?.brevo_list_export ?? null,
    brevo_list_grossh: s?.brevo_list_grossh ?? null,
    rechnung_prefix:   s?.rechnung_prefix ?? 'RE',
    rechnung_zaehler:  s?.rechnung_zaehler ?? 1,
    rechnung_stellen:  s?.rechnung_stellen ?? 4,
    rechnung_suffix:   s?.rechnung_suffix ?? '',
    account_prefix:     s?.account_prefix ?? 'K',
    account_zaehler:    s?.account_zaehler ?? 1,
    account_stellen:    s?.account_stellen ?? 4,
    betrieb_name:      s?.betrieb_name ?? null,
    betrieb_strasse:   s?.betrieb_strasse ?? null,
    betrieb_plz:       s?.betrieb_plz ?? null,
    betrieb_ort:       s?.betrieb_ort ?? null,
    betrieb_telefon:   s?.betrieb_telefon ?? null,
    betrieb_email:     s?.betrieb_email ?? null,
    betrieb_website:   s?.betrieb_website ?? null,
    betrieb_uid:       s?.betrieb_uid ?? null,
    betrieb_betriebsnummer: s?.betrieb_betriebsnummer ?? null,
    rechnung_iban:         s?.rechnung_iban ?? null,
    rechnung_bic:          s?.rechnung_bic ?? null,
    rechnung_zahlungsziel: s?.rechnung_zahlungsziel ?? 14,
    rechnung_fusstext:     s?.rechnung_fusstext ?? null,
    ust_satz_standard:     parseFloat(s?.ust_satz_standard) || 13,
    email_modul_aktiv:    !!(s?.email_modul_aktiv),
    email_smtp_host:      s?.email_smtp_host ?? null,
    email_smtp_port:      s?.email_smtp_port ?? 587,
    email_smtp_user:      s?.email_smtp_user ?? null,
    email_smtp_from_name: s?.email_smtp_from_name ?? null,
    email_imap_host:      s?.email_imap_host ?? null,
    email_imap_port:      s?.email_imap_port ?? 993,
    email_imap_user:      s?.email_imap_user ?? null,
    email_last_poll:      s?.email_last_poll ?? null,
    m365_modul_aktiv:     !!(s?.m365_modul_aktiv),
    m365_tenant_id:       s?.m365_tenant_id ?? null,
    m365_client_id:       s?.m365_client_id ?? null,
    m365_user_email:      s?.m365_user_email ?? null,
    m365_token_expires_at: s?.m365_token_expires_at ?? null,
    m365_webhook_sub_id:  s?.m365_webhook_sub_id ?? null,
    m365_webhook_expires: s?.m365_webhook_expires ?? null,
    session_timeout_minuten: s?.session_timeout_minuten ?? null,
    modul_ea:            !!(s?.modul_ea),
    modul_sumup:         !!(s?.modul_sumup),
    modul_export:        !!(s?.modul_export),
    ea_buchung_modus:    s?.ea_buchung_modus ?? 'brutto',
    ea_kleinunternehmer: !!(s?.ea_kleinunternehmer),
    ea_uva_zeitraum:     s?.ea_uva_zeitraum ?? 'quartalsweise',
    sumup_api_key:       s?.sumup_api_key ?? null,
    sumup_merchant_code: s?.sumup_merchant_code ?? null,
    bawb_kennung:        s?.bawb_kennung ?? null,
    bawb_passwort:       s?.bawb_passwort ?? null,
    assistent_aktiv:     !!(s?.assistent_aktiv),
  }

  const members: TenantMember[] = ((memberships ?? []) as R[]).map(m => ({
    id:        m.id,
    userId:    m.user_id,
    email:     emailMap[m.user_id] ?? m.user_id,
    role:      m.role,
    createdAt: m.created_at,
    fullName:  nameMap[m.user_id] ?? null,
    confirmed: confirmedMap[m.user_id] ?? false,
  }))

  return (
    <MandantDetailClient tenant={tenant} settings={settings} members={members} />
  )
}
