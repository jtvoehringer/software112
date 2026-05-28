import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import MandantDetailClient from './MandantDetailClient'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type TenantDetail = {
  id: string; name: string; slug: string; plan: string; created_at: string
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
}
export type TenantMember = {
  id: string; userId: string; email: string; role: string; createdAt: string
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
  if (role !== 'system_admin') redirect('/dashboard')

  const admin = createSupabaseAdminClient()

  const [
    { data: tenantRaw },
    { data: settingsRaw },
    { data: memberships },
    { data: { users } },
  ] = await Promise.all([
    (admin.from('tenants') as any)
      .select('id, name, slug, plan, created_at').eq('id', id).single(),
    (admin.from('tenant_einstellungen') as any)
      .select('*').eq('tenant_id', id).maybeSingle(),
    (admin.from('tenant_memberships') as any)
      .select('id, user_id, role, created_at').eq('tenant_id', id).order('created_at'),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  if (!tenantRaw) notFound()

  const emailMap: Record<string, string> = {}
  users.forEach(u => { emailMap[u.id] = u.email ?? '–' })

  const t = tenantRaw as R
  const s = settingsRaw as R | null

  const tenant: TenantDetail = {
    id: t.id, name: t.name, slug: t.slug, plan: t.plan, created_at: t.created_at,
  }

  const settings: TenantSettings = {
    anzeigename:      s?.anzeigename ?? null,
    logo_url:         s?.logo_url ?? null,
    primary_color:    s?.primary_color ?? '#2a7c6f',
    secondary_color:  s?.secondary_color ?? '#f5c842',
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
  }

  const members: TenantMember[] = ((memberships ?? []) as R[]).map(m => ({
    id:        m.id,
    userId:    m.user_id,
    email:     emailMap[m.user_id] ?? m.user_id,
    role:      m.role,
    createdAt: m.created_at,
  }))

  return (
    <MandantDetailClient tenant={tenant} settings={settings} members={members} />
  )
}
