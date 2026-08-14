'use server'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function saveTB(verkaufspostenId: string, daten: R): Promise<{ id: string }> {
  const admin = createSupabaseAdminClient()

  // Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen
  // Mitgliedschaft – sonst könnte bei Mehrfach-Mitgliedschaft in den falschen
  // Mandanten geschrieben werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) throw new Error('Kein Tenant')

  // Bestehendes Dokument suchen
  const { data: existing } = await (admin.from('transportbescheinigungen') as any)
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('verkaufsposten_id', verkaufspostenId)
    .maybeSingle()

  if (existing?.id) {
    await (admin.from('transportbescheinigungen') as any)
      .update({ formular_daten: daten, aktualisiert_am: new Date().toISOString() })
      .eq('id', existing.id)
    return { id: existing.id }
  }

  const { data: neu } = await (admin.from('transportbescheinigungen') as any)
    .insert({ tenant_id: tenantId, verkaufsposten_id: verkaufspostenId, formular_daten: daten })
    .select('id').single()
  return { id: (neu as R).id }
}
