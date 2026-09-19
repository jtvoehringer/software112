'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canManageUsers, isModul, type Modul } from '@/lib/auth/roles'
import { pruefeBenutzerlimit, benutzerlimitFehler } from '@/lib/pakete-server'

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
  /** Modulmatrix (Migration 218) – nur für Rolle winzer (Mitarbeiter) relevant */
  schreibmodule: Modul[]
}

// Modulliste aus dem Client bereinigen: nur bekannte Module, ohne Duplikate
function moduleBereinigen(module: unknown): Modul[] {
  return Array.isArray(module) ? [...new Set(module.filter(isModul))] as Modul[] : []
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
    .select('id, user_id, role, created_at, aktiv, schreibmodule')
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
    schreibmodule: moduleBereinigen(m.schreibmodule),
  }))
}

// Rollen, die ein Betriebsleiter (tenant_admin) hier selbst vergeben darf -
// bewusst OHNE system_admin, das bleibt ausschließlich system_admin selbst
// über /admin/mandanten/[id] vorbehalten (siehe inviteUserToTenant dort).
const VERGEBBARE_ROLLEN = ['tenant_admin', 'winzer', 'leser']

/** Neuen Benutzer zum eigenen Betrieb einladen (Rückmeldung 19.8.2026: der
 *  Betriebsleiter (tenant_admin) konnte bisher nur bestehende Mitglieder
 *  verwalten, aber niemanden neu hinzufügen - das war bisher ausschließlich
 *  einem system_admin über /admin/mandanten/[id] vorbehalten). Analog zu
 *  inviteUserToTenant() dort, aber der Ziel-Betrieb kommt AUSSCHLIESSLICH aus
 *  der aktiven Mitgliedschaft (serverseitig) statt von einem Client-Parameter -
 *  ein Betriebsleiter kann so technisch nie einen fremden Betrieb bestücken. */
export async function inviteMember(email: string, role: string, fullName: string, module: Modul[] = []) {
  const membership = await getCurrentMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return { error: 'Keine Berechtigung' }
  }
  if (!VERGEBBARE_ROLLEN.includes(role)) {
    return { error: 'Ungültige Rolle' }
  }

  const name = fullName.trim()
  if (!name) return { error: 'Name ist ein Pflichtfeld.' }
  const mail = email.trim()
  if (!mail) return { error: 'E-Mail ist ein Pflichtfeld.' }

  const admin = createSupabaseAdminClient()

  // Benutzerlimit des Pakets (Basis 1 / Standard 5 / Premium unbegrenzt,
  // Migration 194) - VOR der Einladung prüfen, damit kein Auth-User ohne
  // Mitgliedschaft entsteht.
  const limit = await pruefeBenutzerlimit(admin, membership.tenantId)
  if (!limit.erlaubt) return { error: benutzerlimitFehler(limit) }

  // Prüfen ob User schon existiert
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let userId = users.find(u => u.email === mail)?.id

  if (!userId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(mail, {
      redirectTo: 'https://software112.icp-consultants.at/auth/invite',
    })
    if (error || !data.user) return { error: error?.message ?? 'Einladung fehlgeschlagen' }
    userId = data.user.id
  }

  // Prüfen ob Membership schon existiert
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin.from('tenant_memberships') as any)
    .select('id').eq('user_id', userId).eq('tenant_id', membership.tenantId).maybeSingle()
  if (existing) return { error: 'Benutzer ist bereits Mitglied dieses Betriebs.' }

  // Modulmatrix (Migration 218): nur Mitarbeiter (winzer) tragen sie, Admins haben alles, Leser nichts
  const { error: memberError } = await (admin.from('tenant_memberships') as any)
    .insert({ tenant_id: membership.tenantId, user_id: userId, role, schreibmodule: role === 'winzer' ? moduleBereinigen(module) : null })
  if (memberError) return { error: (memberError as R).message }

  const { error: profileError } = await (admin.from('profiles') as any)
    .upsert({ id: userId, full_name: name, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (profileError) return { error: (profileError as R).message }

  revalidatePath('/benutzer')
  revalidatePath('/betrieb/einstellungen')
  return { success: true }
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
export async function updateMemberRole(membershipId: string, newRole: string, module?: Modul[]) {
  const membership = await getCurrentMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return { error: 'Keine Berechtigung' }
  }
  if (!VERGEBBARE_ROLLEN.includes(newRole)) return { error: 'Ungültige Rolle' }

  // Admin-Client verwenden, damit RLS das Update nicht blockiert
  const admin = createSupabaseAdminClient()
  // Modulmatrix (Migration 218): Wechsel auf Mitarbeiter ohne Angabe → alle Module
  // (Verhalten wie bisher), andere Rollen tragen keine Matrix
  const patch: R = { role: newRole }
  if (newRole === 'winzer') patch.schreibmodule = module ? moduleBereinigen(module) : ['rieden', 'kellerbuch', 'warenwirtschaft', 'crm', 'ea', 'auswertungen']
  else patch.schreibmodule = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, count } = await (admin.from('tenant_memberships') as any)
    .update(patch, { count: 'exact' })
    .eq('id', membershipId)
    .eq('tenant_id', membership.tenantId)
    .neq('role', 'system_admin')   // Super-Admins werden hier nicht verändert (siehe BenutzerClient)

  if (error) return { error: error.message }
  if (count === 0) return { error: 'Eintrag nicht gefunden oder keine Änderung möglich.' }
  revalidatePath('/benutzer')
  return { success: true }
}

/** Modulmatrix eines Mitarbeiters setzen (Migration 218) */
export async function updateMemberModule(membershipId: string, module: Modul[]) {
  const membership = await getCurrentMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return { error: 'Keine Berechtigung' }
  }
  const admin = createSupabaseAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, count } = await (admin.from('tenant_memberships') as any)
    .update({ schreibmodule: moduleBereinigen(module) }, { count: 'exact' })
    .eq('id', membershipId)
    .eq('tenant_id', membership.tenantId)
    .eq('role', 'winzer')
  if (error) return { error: error.message }
  if (count === 0) return { error: 'Nur bei Mitarbeitern lässt sich die Modulmatrix ändern.' }
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
  // Reaktivieren zählt wie eine neue Einladung gegen das Benutzerlimit des
  // Pakets (Migration 194); Deaktivieren ist immer erlaubt.
  if (aktiv) {
    const limit = await pruefeBenutzerlimit(admin, membership.tenantId)
    if (!limit.erlaubt) return { error: benutzerlimitFehler(limit) }
  }
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
