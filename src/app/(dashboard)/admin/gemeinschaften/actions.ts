'use server'
/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
// seiten-betrieb-ausnahme: Freigaben zwischen Betrieben (nur Super-Admin), Betriebe kommen ausdrücklich als Parameter – nicht aus dem Cookie (KAN-30)
// schreibsperre-ausnahme-datei: Freigaben zwischen Betrieben – nur Super-Admin, von der Abo-Sperre ausgenommen (KAN-5)
// ── Administration > Gemeinschaften (Migration 203 Kellergemeinschaft, KAN-212 CRM-Gemeinschaft) ──────────────────────
// Nur Plattform-Admin: legt fest, welcher Partner-Betrieb (Nutzer) die freigegebenen Gebinde bzw. das CRM eines
// Eigentümer-Betriebs nutzen darf. Schreibt über die Service-Role (keller_freigaben/crm_freigaben haben bewusst keine
// Schreib-Policy).

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { pruefePlattformAdmin } from '@/lib/auth/plattformAdmin'
import { revalidatePath } from 'next/cache'
import { dbFehlerText } from '@/lib/fehler'

export type GemeinschaftArt = 'keller' | 'crm'
const TABELLE: Record<GemeinschaftArt, string> = { keller: 'keller_freigaben', crm: 'crm_freigaben' }
const PFAD = '/admin/gemeinschaften'

function tabelle(art: unknown): string {
  if (art !== 'keller' && art !== 'crm') throw new Error('Unbekannte Gemeinschaft')
  return TABELLE[art]
}

// 01.10.2026 (Backlog-Abgleich): Plattform-Admin statt Rolle im aktiven Betrieb (siehe lib/auth/plattformAdmin.ts)
async function assertSystemAdmin() {
  await pruefePlattformAdmin()
}

export async function createFreigabe(formData: FormData): Promise<{ error?: string }> {
  try {
    await assertSystemAdmin()
    const tab = tabelle(formData.get('art'))
    const eigentuemer = (formData.get('eigentuemer_tenant_id') as string) || ''
    const nutzer      = (formData.get('nutzer_tenant_id') as string) || ''
    const notizen     = (formData.get('notizen') as string)?.trim() || null
    if (!eigentuemer || !nutzer) return { error: 'Eigentümer und Partner wählen' }
    if (eigentuemer === nutzer) return { error: 'Eigentümer und Partner müssen verschiedene Betriebe sein' }
    const admin = createSupabaseAdminClient()
    const authClient = await createSupabaseServerClient()
    const { data: { user } } = await authClient.auth.getUser()
    // tenant-isolation-ignore: mandantenübergreifende Verwaltungstabelle (system_admin, Service-Role)
    const { error } = await (admin.from(tab) as any)
      .upsert({ eigentuemer_tenant_id: eigentuemer, nutzer_tenant_id: nutzer, aktiv: true, notizen, erstellt_von: user?.id ?? null }, { onConflict: 'eigentuemer_tenant_id,nutzer_tenant_id' })
    if (error) return { error: dbFehlerText(error) }
    revalidatePath(PFAD)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function setFreigabeAktiv(art: GemeinschaftArt, id: string, aktiv: boolean): Promise<{ error?: string }> {
  try {
    await assertSystemAdmin()
    const admin = createSupabaseAdminClient()
    // tenant-isolation-ignore: mandantenübergreifende Verwaltungstabelle (system_admin, Service-Role)
    const { error } = await (admin.from(tabelle(art)) as any).update({ aktiv }).eq('id', id)
    if (error) return { error: dbFehlerText(error) }
    revalidatePath(PFAD)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function deleteFreigabe(art: GemeinschaftArt, id: string): Promise<{ error?: string }> {
  try {
    await assertSystemAdmin()
    const admin = createSupabaseAdminClient()
    // loeschen-ohne-pruefung: Service-Role (keine RLS), nur Plattform-Admins
    // storno-ausnahme: Freigabe-Verwaltung (keller_freigaben/crm_freigaben), keine berichtsrelevante Buchung
    const { error } = await (admin.from(tabelle(art)) as any).delete().eq('id', id)   // tenant-isolation-ignore: mandantenübergreifende Verwaltungstabelle (system_admin, Service-Role)
    if (error) return { error: dbFehlerText(error) }
    revalidatePath(PFAD)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}
