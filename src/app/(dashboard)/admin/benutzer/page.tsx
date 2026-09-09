import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCurrentUserRole, getCurrentMembership, isSandboxAdminUnlock } from '@/lib/auth/roles'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import SystemAdminClient from './SystemAdminClient'

export const metadata: Metadata = { title: 'System-Admin – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type SystemAdminUser = {
  membershipId: string
  userId: string
  email: string
  tenantName: string
  createdAt: string
}

export default async function SystemAdminPage() {
  const role = await getCurrentUserRole()
  const admin = createSupabaseAdminClient()

  // Sandbox-Tenant-ID ermitteln - für die Sonderfreigabe UND deren Härtung
  // (siehe isSandboxAdminUnlock in lib/auth/roles.ts).
  const { data: sandboxTenantRow } = await (admin.from('tenants') as any).select('id').eq('name', 'Sandbox').maybeSingle()
  const sandboxTenantId = (sandboxTenantRow as R | null)?.id ?? null

  let sandboxUnlock = false
  if (role !== 'system_admin') {
    const authClient = await createSupabaseServerClient()
    const { data: { user } } = await authClient.auth.getUser()
    const membership = await getCurrentMembership()
    const isSandboxActive = !!sandboxTenantId && membership?.tenantId === sandboxTenantId
    sandboxUnlock = isSandboxAdminUnlock(user?.email, isSandboxActive)
    if (!sandboxUnlock) redirect('/dashboard')
  }

  // Alle system_admin Memberships laden
  const [{ data: memberships }, { data: tenants }, { data: { users } }] = await Promise.all([
    (admin.from('tenant_memberships') as any)
      .select('id, user_id, tenant_id, created_at')
      .eq('role', 'system_admin')
      .order('created_at'),
    (admin.from('tenants') as any).select('id, name'),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  const tenantMap: Record<string, string> = {}
  for (const t of (tenants ?? []) as R[]) tenantMap[t.id] = t.name

  const emailMap: Record<string, string> = {}
  users.forEach(u => { emailMap[u.id] = u.email ?? '–' })

  // Härtung: die Sandbox-Sonderfreigabe (nicht-system_admin) darf NIE die
  // echte, plattformweite System-Admin-Liste sehen - nur einen etwaigen
  // system_admin-Eintrag des Sandbox-Mandanten selbst.
  const relevantMemberships = sandboxUnlock
    ? ((memberships ?? []) as R[]).filter(m => m.tenant_id === sandboxTenantId)
    : ((memberships ?? []) as R[])

  const admins: SystemAdminUser[] = relevantMemberships.map(m => ({
    membershipId: m.id,
    userId:       m.user_id,
    email:        emailMap[m.user_id] ?? m.user_id,
    tenantName:   tenantMap[m.tenant_id] ?? m.tenant_id,
    createdAt:    m.created_at,
  }))

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <span>Administration</span>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">System-Admin</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">System-Admin</h1>
          <p className="text-sm text-s112-muted mt-0.5">Globale Administratoren dieser Instanz</p>
        </div>
        <span className="text-sm text-s112-muted">{admins.length} Admin{admins.length !== 1 ? 's' : ''}</span>
      </div>
      {/* canInvite=false für die Sandbox-Sonderfreigabe: die Server-Action
          inviteSystemAdmin() bleibt ohnehin strikt system_admin-only (nicht
          verändert), aber die Buttons/Formulare sollen für die beiden
          freigeschalteten E-Mails erst gar nicht sichtbar sein. */}
      <SystemAdminClient admins={admins} canInvite={role === 'system_admin'} />
    </div>
  )
}
