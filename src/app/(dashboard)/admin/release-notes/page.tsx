import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, isSandboxAdminUnlock } from '@/lib/auth/roles'
import { SANDBOX_TENANT_ID } from '@/lib/abo/regeln'
import ReleaseNotesAdminClient from './ReleaseNotesAdminClient'

export const metadata: Metadata = { title: 'Release Notes' }
export const dynamic = 'force-dynamic'

// Diese Seite war bisher komplett ungeschützt (reine 'use client'-Komponente
// ohne serverseitige Rollenprüfung) - jeder eingeloggte Nutzer jeder Rolle
// konnte hier theoretisch neue, GLOBAL an alle Kunden ausgespielte Release
// Notes veröffentlichen. Jetzt wie die übrigen Administration-Seiten
// system_admin-only, mit einer read-only Sandbox-Sonderfreigabe für die
// beiden in isSandboxAdminUnlock() erlaubten E-Mails (siehe lib/auth/roles.ts).
export default async function ReleaseNotesPage() {
  const role = await getCurrentUserRole()

  if (role !== 'system_admin') {
    const authClient = await createSupabaseServerClient()
    const { data: { user } } = await authClient.auth.getUser()
    // KAN-10 (01.10.2026): Sandbox über die feste ID statt über den Namen
    const membership = await getCurrentMembership()
    const isSandboxActive = membership?.tenantId === SANDBOX_TENANT_ID
    if (!isSandboxAdminUnlock(user?.email, isSandboxActive)) redirect('/dashboard')
  }

  return <ReleaseNotesAdminClient readOnly={role !== 'system_admin'} />
}
