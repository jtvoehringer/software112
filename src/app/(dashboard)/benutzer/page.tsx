import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCurrentMembership, canManageUsers, roleLabel } from '@/lib/auth/roles'
import { getTenantMembers } from './actions'
import BenutzerClient from './BenutzerClient'

export const metadata: Metadata = { title: 'Benutzerverwaltung – software:112' }
export const dynamic = 'force-dynamic'

export default async function BenutzerPage() {
  const membership = await getCurrentMembership()

  // Nur Admins dürfen diese Seite sehen
  if (!membership || !canManageUsers(membership.role)) {
    redirect('/dashboard')
  }

  const members = await getTenantMembers()

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Benutzerverwaltung</h1>
          <p className="text-sm text-s112-muted mt-0.5">Mitglieder und Rollen Ihres Betriebs</p>
        </div>
      </div>

      {/* Info-Box: Benutzer hinzufügen */}
      <div className="card bg-blue-50 border border-blue-200 mb-6">
        <div className="flex gap-3">
          <span className="text-blue-500 text-xl">ℹ️</span>
          <div>
            <p className="text-sm font-semibold text-blue-800">Neue Benutzer einladen</p>
            <p className="text-sm text-blue-700 mt-0.5">
              Um neue Mitarbeiter hinzuzufügen, gehen Sie im{' '}
              <strong>Supabase Dashboard → Authentication → Users → Invite user</strong>{' '}
              und tragen Sie die E-Mail-Adresse ein. Danach weisen Sie die Membership hier zu.
            </p>
          </div>
        </div>
      </div>

      <BenutzerClient
        members={members}
        currentMembershipId={membership.tenantId}
      />
    </div>
  )
}
