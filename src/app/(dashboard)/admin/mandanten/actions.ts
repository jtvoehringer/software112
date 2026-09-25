'use server'
// seiten-betrieb-ausnahme: Mandanten anlegen/umbenennen (Super-Admin) – Ziel ausdrücklich als Parameter bzw. neu; der Wechsel läuft über /auth/betrieb (KAN-30)

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'
import { AktionsFehler } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function assertSystemAdmin() {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin') throw new AktionsFehler('Nur system_admin erlaubt')
}

/** Legt den Mandanten an; tenantId = neuer Betrieb, auf den der Client anschließend wechselt
 *  (null, wenn keine Mitgliedschaft angelegt wurde). */
export async function createMandant(formData: FormData): Promise<{ tenantId: string | null }> {
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
  if (error) throw new AktionsFehler((error as AR).message)

  // Den anlegenden System-Admin sofort als aktives Mitglied eintragen - sonst
  // ist der neue (noch leere) Mandant für niemanden sichtbar: die Mandanten-Liste
  // zeigt nur Mandanten mit aktiver Mitgliedschaft (siehe page.tsx), und ohne
  // Mitgliedschaft gäbe es keinen Weg mehr, sich selbst dort einzuladen.
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  let neuerBetrieb: string | null = null
  if (user) {
    // upsert statt insert (24.9.2026): für Plattform-Admins legt der Trigger
    // tenants_plattform_admins (Migration 198) die Zeile bereits beim Anlegen des
    // Mandanten an - der zweite Insert scheiterte an UNIQUE (tenant_id, user_id)
    const { error: membershipError } = await (supabase.from('tenant_memberships') as any)
      .upsert({ tenant_id: (tenant as AR).id, user_id: user.id, role: 'system_admin', aktiv: true },
        { onConflict: 'tenant_id,user_id', ignoreDuplicates: true })
    if (membershipError) throw new AktionsFehler((membershipError as AR).message)

    // Aktiven Betrieb sofort auf den neu angelegten Mandanten umschalten - sonst bleibt
    // der Ersteller (server- wie clientseitig) auf dem vorher aktiven Betrieb "hängen":
    // getCurrentMembership() liest den aktiven Betrieb ausschließlich aus diesem Cookie,
    // ohne diesen Wechsel würden z.B. der CSV-Import oder andere schreibende Aktionen
    // gegen den FALSCHEN (alten) Betrieb geprüft/ausgeführt - dort hat der User evtl. gar
    // keine Schreibrechte, was fälschlich wie ein Berechtigungsfehler aussieht, obwohl der
    // User auf dem neuen Mandanten korrekt system_admin ist.
    // KAN-30: Der Wechsel läuft nicht mehr hier per Cookie im laufenden Tab, sondern über den
    // regulären Wechselweg /auth/betrieb (MandantenClient navigiert mit dieser ID dorthin):
    // die Seite lädt dann vollständig im neuen Betrieb, der Betriebs-Wächter meldet den Wechsel
    // an die anderen Tabs – und sperrt diesen Tab nicht fälschlich, weil sein Layout plötzlich
    // einen anderen Betrieb zeigt.
    neuerBetrieb = (tenant as AR).id as string
  }

  revalidatePath('/admin/mandanten')
  return { tenantId: neuerBetrieb }
}

export async function renameMandant(id: string, name: string) {
  await assertSystemAdmin()
  const supabase = createSupabaseAdminClient()
  const { error } = await (supabase.from('tenants') as any).update({ name }).eq('id', id)
  if (error) throw new AktionsFehler((error as AR).message)
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

  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/admin/mandanten')
}
