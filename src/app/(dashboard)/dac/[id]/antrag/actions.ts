'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { AktionsFehler } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function savePNA(dacAntragId: string, daten: R): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) throw new AktionsFehler('Kein Tenant')
  await pruefeSeitenBetrieb(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  if (!canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Berechtigung')   // Admin-Client umgeht RLS → Modulrecht hier prüfen

  const { data: existing } = await (supabase.from('pruefnummernantraege') as any)
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('dac_antrag_id', dacAntragId)
    .maybeSingle()

  if (existing?.id) {
    { const { error: e } = await (admin.from('pruefnummernantraege') as any)
      .update({ formular_daten: daten, aktualisiert_am: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (pruefnummernantraege): ${e.message}`) }
    return { id: existing.id }
  }

  const { data: neu } = await (admin.from('pruefnummernantraege') as any)
    .insert({ tenant_id: tenantId, dac_antrag_id: dacAntragId, formular_daten: daten })
    .select('id').single()
  return { id: (neu as R).id }
}
