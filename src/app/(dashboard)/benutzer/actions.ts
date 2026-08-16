'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canManageUsers } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type MemberWithEmail = {
  id: string
  user_id: string
  role: string
  created_at: string
  email: string
  aktiv: boolean
  confirmed: boolean
}

/** Mitglieder des Tenants + Email aus auth.users */
export async function getTenantMembers(): Promise<MemberWithEmail[]> {
  const membership = await getCurrentMembership()
  if (!membership) return []

  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()

  // Memberships laden (inkl. inaktive - die Verwaltung muss sie sehen können,
  // um sie ggf. wieder zu aktivieren, siehe toggleMemberAktiv unten)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberships } = await (supabase.from('tenant_memberships') as any)
    .select('id, user_id, role, created_at, aktiv')
    .eq('tenant_id', membership.tenantId)
    .order('created_at')

  if (!memberships || memberships.length === 0) return []

  // Alle Auth-User laden (admin API) um Emails + Bestätigungsstatus zu bekommen
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const emailMap: Record<string, string> = {}
  const confirmedMap: Record<string, boolean> = {}
  users.forEach(u => {
    emailMap[u.id] = u.email ?? '–'
    confirmedMap[u.id] = !!u.email_confirmed_at
  })

  return (memberships as R[]).map(m => ({
    id:         m.id,
    user_id:    m.user_id,
    role:       m.role,
    created_at: m.created_at,
    email:      emailMap[m.user_id] ?? m.user_id,
    aktiv:      m.aktiv ?? true,
    confirmed:  confirmedMap[m.user_id] ?? false,
  }))
}

/** Einladung erneut senden – für Mitglieder, die ihr Konto noch nicht aktiviert
 *  haben (z.B. weil der erste Einladungslink abgelaufen ist, bevor er
 *  angeklickt wurde). Prüft zuerst, dass der Ziel-User tatsächlich Mitglied
 *  DIESES Betriebs ist (sonst könnte ein Betriebsleiter hierüber eine
 *  Einladung für eine fremde user_id/einen fremden Betrieb auslösen). */
export async function resendInvite(userId: string) {
  const membership = await getCurrentMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return { error: 'Keine Berechtigung' }
  }

  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: target } = await (supabase.from('tenant_memberships') as any)
    .select('id').eq('tenant_id', membership.tenantId).eq('user_id', userId).maybeSingle()
  if (!target) return { error: 'Benutzer ist kein Mitglied dieses Betriebs.' }

  const admin = createSupabaseAdminClient()
  const { data: userRes, error: getErr } = await admin.auth.admin.getUserById(userId)
  const user = userRes?.user
  if (getErr || !user?.email) return { error: 'Benutzer nicht gefunden' }

  if (user.email_confirmed_at) {
    return { error: 'Dieser Benutzer hat sein Konto bereits aktiviert – kein erneuter Einladungslink nötig. Bei Anmeldeproblemen bitte „Passwort vergessen" auf der Login-Seite verwenden.' }
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(user.email, {
    redirectTo: 'https://software112.icp-consultants.at/auth/invite',
  })
  if (error) return { error: error.message }

  revalidatePath('/benutzer')
  revalidatePath('/betrieb/einstellungen')
  return { success: true }
}

/** Rollenänderung */
export async function updateMemberRole(membershipId: string, newRole: string) {
  const membership = await getCurrentMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return { error: 'Keine Berechtigung' }
  }

  // Admin-Client verwenden, damit RLS das Update nicht blockiert
  const admin = createSupabaseAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, count } = await (admin.from('tenant_memberships') as any)
    .update({ role: newRole }, { count: 'exact' })
    .eq('id', membershipId)
    .eq('tenant_id', membership.tenantId)

  if (error) return { error: error.message }
  if (count === 0) return { error: 'Eintrag nicht gefunden oder keine Änderung möglich.' }
  revalidatePath('/benutzer')
  return { success: true }
}

/** Mitgliedschaft de-/aktivieren (Migration 159) - Betriebsleiter (tenant_admin) oder
 *  system_admin können damit z.B. den Zugriff eines System-Admin-Accounts für ihren
 *  Betrieb sperren, ohne die Mitgliedschaft komplett zu löschen. Eine deaktivierte
 *  Mitgliedschaft zählt app-weit (RLS + getCurrentMembership) wie "kein Zugriff" auf
 *  diesen Betrieb. Anders als bei Rollenänderung/Entfernen bewusst AUCH für
 *  system_admin-Zeilen erlaubt - siehe BenutzerClient.tsx. */
export async function toggleMemberAktiv(membershipId: string, aktiv: boolean) {
  const membership = await getCurrentMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return { error: 'Keine Berechtigung' }
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet' }

  // Eigene Mitgliedschaft kann man nicht selbst deaktivieren (Selbstaussperrung
  // verhindern) - analog zu "Sich selbst kann man nicht entfernen" bei removeMember.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: target } = await (supabase.from('tenant_memberships') as any)
    .select('user_id').eq('id', membershipId).eq('tenant_id', membership.tenantId).maybeSingle()
  if (!target) return { error: 'Eintrag nicht gefunden.' }
  if ((target as R).user_id === user.id) {
    return { error: 'Die eigene Mitgliedschaft kann nicht deaktiviert werden.' }
  }

  // Admin-Client verwenden, damit RLS das Update nicht blockiert
  const admin = createSupabaseAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, count } = await (admin.from('tenant_memberships') as any)
    .update({ aktiv }, { count: 'exact' })
    .eq('id', membershipId)
    .eq('tenant_id', membership.tenantId)

  if (error) return { error: error.message }
  if (count === 0) return { error: 'Eintrag nicht gefunden oder keine Änderung möglich.' }
  revalidatePath('/benutzer')
  return { success: true }
}

/** Mitglied entfernen */
export async function removeMember(membershipId: string) {
  const membership = await getCurrentMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return { error: 'Keine Berechtigung' }
  }

  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('tenant_memberships') as any)
    .delete()
    .eq('id', membershipId)
    .eq('tenant_id', membership.tenantId)

  if (error) return { error: error.message }
  revalidatePath('/benutzer')
  return { success: true }
}
