'use server'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { setActiveTenantCookie } from '@/lib/auth/activeTenant'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function assertSystemAdmin() {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin') throw new Error('Nur system_admin erlaubt')
}

export async function createMandant(formData: FormData) {
  await assertSystemAdmin()
  const supabase = createSupabaseAdminClient()
  const name = formData.get('name') as string

  // Slug aus Name generieren: Kleinbuchstaben, Leerzeichen → Bindestrich, Sonderzeichen entfernen
  const baseSlug = name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // Umlaute: ä→a, ö→o, ü→u
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  // Eindeutigkeit sicherstellen: ggf. Timestamp-Suffix anhängen
  const slug = `${baseSlug}-${Date.now().toString(36)}`

  const { data: tenant, error } = await (supabase.from('tenants') as any)
    .insert({ name, slug })
    .select('id')
    .single()
  if (error) throw new Error((error as AR).message)

  // Den anlegenden System-Admin sofort als aktives Mitglied eintragen - sonst
  // ist der neue (noch leere) Mandant für niemanden sichtbar: die Mandanten-Liste
  // zeigt nur Mandanten mit aktiver Mitgliedschaft (siehe page.tsx), und ohne
  // Mitgliedschaft gäbe es keinen Weg mehr, sich selbst dort einzuladen.
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (user) {
    const { error: membershipError } = await (supabase.from('tenant_memberships') as any)
      .insert({ tenant_id: (tenant as AR).id, user_id: user.id, role: 'system_admin', aktiv: true })
    if (membershipError) throw new Error((membershipError as AR).message)

    // Aktiven Betrieb sofort auf den neu angelegten Mandanten umschalten - sonst bleibt
    // der Ersteller (server- wie clientseitig) auf dem vorher aktiven Betrieb "hängen":
    // getCurrentMembership() liest den aktiven Betrieb ausschließlich aus diesem Cookie,
    // ohne diesen Wechsel würden z.B. der CSV-Import oder andere schreibende Aktionen
    // gegen den FALSCHEN (alten) Betrieb geprüft/ausgeführt - dort hat der User evtl. gar
    // keine Schreibrechte, was fälschlich wie ein Berechtigungsfehler aussieht, obwohl der
    // User auf dem neuen Mandanten korrekt system_admin ist.
    await setActiveTenantCookie((tenant as AR).id)
  }

  revalidatePath('/admin/mandanten')
}

export async function renameMandant(id: string, name: string) {
  await assertSystemAdmin()
  const supabase = createSupabaseAdminClient()
  const { error } = await (supabase.from('tenants') as any).update({ name }).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/admin/mandanten')
}

export async function saveBranding(tenantId: string, formData: FormData) {
  await assertSystemAdmin()
  const supabase = createSupabaseAdminClient()

  const payload = {
    tenant_id:        tenantId,
    anzeigename:      (formData.get('anzeigename') as string) || null,
    logo_url:         (formData.get('logo_url') as string) || null,
    primary_color:    (formData.get('primary_color') as string) || '#4F86D6',
    secondary_color:  (formData.get('secondary_color') as string) || '#FFFFFF',
    modul_newsletter: formData.get('modul_newsletter') === 'true',
    aktualisiert_am:  new Date().toISOString(),
  }

  const { error } = await (supabase.from('tenant_einstellungen') as any)
    .upsert(payload, { onConflict: 'tenant_id' })

  if (error) throw new Error((error as AR).message)
  revalidatePath('/admin/mandanten')
}
