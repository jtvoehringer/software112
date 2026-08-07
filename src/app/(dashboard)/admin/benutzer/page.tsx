import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
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
  if (role !== 'system_admin') redirect('/dashboard')

  const admin = createSupabaseAdminClient()

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

  const admins: SystemAdminUser[] = ((memberships ?? []) as R[]).map(m => ({
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
        <span className="text-gray-700 font-medium">System-Admin</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System-Admin</h1>
          <p className="text-sm text-s112-muted mt-0.5">Globale Administratoren dieser Instanz</p>
        </div>
        <span className="text-sm text-s112-muted">{admins.length} Admin{admins.length !== 1 ? 's' : ''}</span>
      </div>
      <SystemAdminClient admins={admins} />
    </div>
  )
}
