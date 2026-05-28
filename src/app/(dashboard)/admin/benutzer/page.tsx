import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { getTenantMembers, getUnassignedUsers } from '../../benutzer/actions'
import BenutzerClient from '../../benutzer/BenutzerClient'

export const metadata: Metadata = { title: 'Benutzer – software:112' }
export const dynamic = 'force-dynamic'

export default async function AdminBenutzerPage() {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin' && role !== 'tenant_admin') redirect('/dashboard')

  const [members, unassigned] = await Promise.all([
    getTenantMembers(),
    getUnassignedUsers(),
  ])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Benutzerverwaltung</h1>
          <p className="text-sm text-s112-muted mt-0.5">Mitglieder und Rollen dieses Mandanten</p>
        </div>
      </div>
      <BenutzerClient members={members} unassigned={unassigned} />
    </div>
  )
}
