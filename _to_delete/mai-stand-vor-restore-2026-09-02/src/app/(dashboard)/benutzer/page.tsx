import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCurrentMembership, canManageUsers } from '@/lib/auth/roles'
import { getTenantMembers, getUnassignedUsers } from './actions'
import BenutzerClient from './BenutzerClient'

export const metadata: Metadata = { title: 'Benutzerverwaltung – software:112' }
export const dynamic = 'force-dynamic'

export default async function BenutzerPage() {
  const membership = await getCurrentMembership()

  if (!membership || !canManageUsers(membership.role)) {
    redirect('/dashboard')
  }

  const [members, unassigned] = await Promise.all([
    getTenantMembers(),
    getUnassignedUsers(),
  ])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Benutzerverwaltung</h1>
          <p className="text-sm text-s112-muted mt-0.5">Mitglieder und Rollen Ihres Betriebs</p>
        </div>
      </div>

      <BenutzerClient members={members} unassigned={unassigned} />
    </div>
  )
}
