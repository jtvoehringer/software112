import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { AktionsFehler } from '@/lib/fehler'

// Plattform-Admin (01.10.2026, Backlog-Abgleich Punkt 2 / KAN-10): Betriebsübergreifende Verwaltung
// (Mandanten, Kellergemeinschaft, Stripe, Zugangsdaten anderer Betriebe) nur für Einträge in plattform_admins –
// nicht für jede system_admin-Mitgliedschaft. Vorher genügte die Rolle im gerade AKTIVEN Betrieb
// (getCurrentUserRole), unabhängig vom Ziel-Betrieb der Aktion. Gleiche Regel wie die RLS
// („Plattform-Admin in RLS“ in CLAUDE.md) und wie assertPlattformAdmin in /admin/benutzer.

/** Angemeldeter Benutzer ist Plattform-Admin (User aus getUser(), Prüfung per Service-Role). */
export async function istPlattformAdmin(): Promise<boolean> {
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return false
  const { data, error } = await (createSupabaseAdminClient().from('plattform_admins') as any)   // eslint-disable-line @typescript-eslint/no-explicit-any
    .select('user_id').eq('user_id', user.id).maybeSingle()
  if (error) throw new AktionsFehler(`Prüfung fehlgeschlagen (plattform_admins): ${error.message}`)
  return !!data
}

/** Wirft, wenn der angemeldete Benutzer kein Plattform-Admin ist. */
export async function pruefePlattformAdmin(): Promise<void> {
  if (!(await istPlattformAdmin())) throw new AktionsFehler('Nur Plattform-Admins erlaubt')
}
