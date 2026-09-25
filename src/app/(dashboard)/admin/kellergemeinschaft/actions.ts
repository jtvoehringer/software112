'use server'
// seiten-betrieb-ausnahme: Freigaben zwischen Betrieben (nur Super-Admin), Betriebe kommen ausdrücklich als Parameter – nicht aus dem Cookie (KAN-30)
// ── Administration > Kellergemeinschaft (Migration 203) ──────────────────────
// Nur system_admin: legt fest, welcher Partner-Betrieb (Nutzer) die freigegebenen
// Gebinde eines Eigentümer-Betriebs sehen und befüllen darf. Schreibt über die
// Service-Role (keller_freigaben hat bewusst keine Schreib-Policy).

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

export async function createFreigabe(formData: FormData): Promise<{ error?: string }> {
  try {
    await assertSystemAdmin()
    const eigentuemer = (formData.get('eigentuemer_tenant_id') as string) || ''
    const nutzer      = (formData.get('nutzer_tenant_id') as string) || ''
    const notizen     = (formData.get('notizen') as string)?.trim() || null
    if (!eigentuemer || !nutzer) return { error: 'Eigentümer und Partner wählen' }
    if (eigentuemer === nutzer) return { error: 'Eigentümer und Partner müssen verschiedene Betriebe sein' }
    const admin = createSupabaseAdminClient()
    const authClient = await createSupabaseServerClient()
    const { data: { user } } = await authClient.auth.getUser()
    // tenant-isolation-ignore: mandantenübergreifende Verwaltungstabelle (system_admin, Service-Role)
    const { error } = await (admin.from('keller_freigaben') as any)
      .upsert({ eigentuemer_tenant_id: eigentuemer, nutzer_tenant_id: nutzer, aktiv: true, notizen, erstellt_von: user?.id ?? null }, { onConflict: 'eigentuemer_tenant_id,nutzer_tenant_id' })
    if (error) return { error: (error as AR).message }
    revalidatePath('/admin/kellergemeinschaft')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function setFreigabeAktiv(id: string, aktiv: boolean): Promise<{ error?: string }> {
  try {
    await assertSystemAdmin()
    const admin = createSupabaseAdminClient()
    // tenant-isolation-ignore: mandantenübergreifende Verwaltungstabelle (system_admin, Service-Role)
    const { error } = await (admin.from('keller_freigaben') as any).update({ aktiv }).eq('id', id)
    if (error) return { error: (error as AR).message }
    revalidatePath('/admin/kellergemeinschaft')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function deleteFreigabe(id: string): Promise<{ error?: string }> {
  try {
    await assertSystemAdmin()
    const admin = createSupabaseAdminClient()
    // tenant-isolation-ignore: mandantenübergreifende Verwaltungstabelle (system_admin, Service-Role)
    const { error } = await (admin.from('keller_freigaben') as any).delete().eq('id', id)
    if (error) return { error: (error as AR).message }
    revalidatePath('/admin/kellergemeinschaft')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}
