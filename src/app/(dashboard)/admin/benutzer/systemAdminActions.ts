'use server'
// seiten-betrieb-ausnahme: Plattform-Admins verwalten – wirkt plattformweit, nicht auf den aktiven Betrieb (KAN-30)
// schreibsperre-ausnahme-datei: Plattform-Admins verwalten – nur Super-Admin, und Super-Admins sind von der Abo-Sperre ausgenommen (KAN-5)

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'
import { AktionsFehler } from '@/lib/fehler'
import { kontoFuerEinladung, sendeZuordnungsMail } from '@/lib/auth/einladung'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Super-Admins ernennen/entziehen dürfen nur Plattform-Admins (plattform_admins),
// nicht jede system_admin-Mitgliedschaft (Härtung 24.9.2026). Liefert die eigene user_id.
async function assertPlattformAdmin(): Promise<string> {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin') throw new AktionsFehler('Nur system_admin erlaubt')
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) throw new AktionsFehler('Nicht angemeldet')
  const { data, error } = await (createSupabaseAdminClient().from('plattform_admins') as any)
    .select('user_id').eq('user_id', user.id).maybeSingle()
  if (error) throw new AktionsFehler(`Prüfung fehlgeschlagen (plattform_admins): ${error.message}`)
  if (!data) throw new AktionsFehler('Nur Plattform-Admins dürfen Super-Admins verwalten')
  return user.id
}

export async function inviteSystemAdmin(email: string) {
  const eigeneId = await assertPlattformAdmin()
  const admin = createSupabaseAdminClient()

  // System-Admin Membership auf Haupt-Tenant (fa22dc07) anlegen
  // Alle bestehenden Tenants holen und ersten nehmen
  const { data: tenants } = await (admin.from('tenants') as any)
    .select('id, name').order('created_at').limit(1)

  const tenantId = (tenants as R[])?.[0]?.id
  if (!tenantId) return { error: 'Kein Tenant gefunden' }

  // KAN-139: neues Konto per Einladung; ein bestehendes nur mit bestätigter Adresse
  // (sonst würde ein vorab mit fremder Adresse angelegtes Konto Super-Admin)
  const konto = await kontoFuerEinladung(admin, email)
  if (!konto.ok) return { error: konto.fehler }
  const userId = konto.userId

  // Plattform-Admin-Liste pflegen (Migration plattform_admin_haertung, 24.9.2026) -
  // vor der Mitgliedschaft, damit kein Super-Admin ohne Eintrag entsteht: RLS erkennt
  // Super-Admins nur noch über plattform_admins, nicht mehr über tenant_memberships.role
  // (ohne Eintrag z.B. keine Release Notes). Neue Mandanten erhalten ihn per Trigger (198).
  { const { error: e } = await (admin.from('plattform_admins') as any)
    .upsert({ user_id: userId, hinweis: 'Super-Admin (eingeladen über /admin/benutzer)' }, { onConflict: 'user_id', ignoreDuplicates: true })
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (plattform_admins): ${e.message}`) }

  // Prüfen ob Membership schon existiert
  const { data: existing } = await (admin.from('tenant_memberships') as any)
    .select('id').eq('user_id', userId).eq('tenant_id', tenantId).maybeSingle()

  if (existing) {
    // Rolle auf system_admin hochstufen
    { const { error: e } = await (admin.from('tenant_memberships') as any)
      .update({ role: 'system_admin' })
      .eq('user_id', userId).eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (tenant_memberships): ${e.message}`) }
  } else {
    const { error: memberError } = await (admin.from('tenant_memberships') as any)
      .insert({ tenant_id: tenantId, user_id: userId, role: 'system_admin' })
    if (memberError) return { error: (memberError as R).message }
  }

  revalidatePath('/admin/benutzer')
  if (konto.neuesKonto) return { success: true, hinweis: `Einladung an ${email.trim().toLowerCase()} versandt.` }

  // Bestehendes Konto: Person über die neue Super-Admin-Rolle informieren
  const { data: eigenesProfil } = await (admin.from('profiles') as any).select('full_name').eq('id', eigeneId).maybeSingle()
  const versandt = await sendeZuordnungsMail({
    email: konto.bestehendesKonto?.email ?? email.trim().toLowerCase(),
    name: (konto.bestehendesKonto?.user_metadata?.display_name as string | undefined) ?? null,
    betriebName: ((tenants as R[])[0]?.name as string | undefined) ?? 'software:112',
    rolle: 'Super-Admin',
    eingeladenVon: ((eigenesProfil as R | null)?.full_name as string | undefined) ?? null,
  })
  return {
    success: true,
    hinweis: versandt
      ? 'Bestehendes Konto ist jetzt Super-Admin – die Person wurde per E-Mail informiert.'
      : 'Bestehendes Konto ist jetzt Super-Admin. Bitte die Person selbst informieren (E-Mail-Versand ist nicht eingerichtet).',
  }
}

export async function removeSystemAdmin(membershipId: string) {
  const eigeneId = await assertPlattformAdmin()
  const admin = createSupabaseAdminClient()

  const { data: ziel, error: zielError } = await (admin.from('tenant_memberships') as any)
    .select('user_id').eq('id', membershipId).eq('role', 'system_admin').maybeSingle()
  if (zielError) return { error: (zielError as R).message }
  if (!ziel) return { error: 'Eintrag nicht gefunden.' }
  const userId = (ziel as R).user_id as string

  // Anzahl der system_admin-Mitgliedschaften dieses Benutzers (vor dem Löschen)
  const { count, error: countError } = await (admin.from('tenant_memberships') as any)
    .select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('role', 'system_admin')
  if (countError || count === null) throw new AktionsFehler(`Prüfung fehlgeschlagen (tenant_memberships): ${countError?.message ?? 'keine Anzahl'}`)
  if (userId === eigeneId && count <= 1) return { error: 'Die eigene letzte Super-Admin-Rolle kann nicht entfernt werden.' }

  const { error } = await (admin.from('tenant_memberships') as any)
    .delete().eq('id', membershipId).eq('role', 'system_admin')

  if (error) return { error: (error as R).message }

  // Letzte system_admin-Mitgliedschaft entfernt → auch aus plattform_admins austragen
  if (count <= 1) {
    const { error: e } = await (admin.from('plattform_admins') as any).delete().eq('user_id', userId)
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (plattform_admins): ${e.message}`)
  }

  revalidatePath('/admin/benutzer')
  return { success: true }
}
