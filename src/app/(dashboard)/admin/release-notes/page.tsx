import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, isSandboxAdminUnlock } from '@/lib/auth/roles'
import ReleaseNotesAdminClient from './ReleaseNotesAdminClient'

export const metadata: Metadata = { title: 'Release Notes – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

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
    const admin = createSupabaseAdminClient()
    const { data: sandboxTenantRow } = await (admin.from('tenants') as any).select('id').eq('name', 'Sandbox').maybeSingle()
    const sandboxTenantId = (sandboxTenantRow as R | null)?.id ?? null
    const membership = await getCurrentMembership()
    const isSandboxActive = !!sandboxTenantId && membership?.tenantId === sandboxTenantId
    if (!isSandboxAdminUnlock(user?.email, isSandboxActive)) redirect('/dashboard')
  }

  return <ReleaseNotesAdminClient readOnly={role !== 'system_admin'} />
}
