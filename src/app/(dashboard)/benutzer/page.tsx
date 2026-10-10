import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCurrentMembership, canManageUsers } from '@/lib/auth/roles'
import { getTenantMembers } from './actions'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { pruefeBenutzerlimit } from '@/lib/pakete-server'
import BenutzerClient from './BenutzerClient'

export const metadata: Metadata = { title: 'Benutzerverwaltung' }
export const dynamic = 'force-dynamic'

export default async function BenutzerPage() {
  const membership = await getCurrentMembership()

  if (!membership || !canManageUsers(membership.role)) {
    redirect('/dashboard')
  }

  const [members, limit] = await Promise.all([
    getTenantMembers(),
    pruefeBenutzerlimit(createSupabaseAdminClient(), membership.tenantId),
  ])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Benutzerverwaltung</h1>
          <p className="text-sm text-s112-muted mt-0.5">Mitglieder und Rollen Ihres Betriebs</p>
        </div>
      </div>

      <BenutzerClient members={members} limit={limit} />
    </div>
  )
}
