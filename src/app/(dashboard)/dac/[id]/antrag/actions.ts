'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function savePNA(dacAntragId: string, daten: R): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()

  const { data: mb } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').limit(1).single()
  const tenantId = (mb as R | null)?.tenant_id
  if (!tenantId) throw new Error('Kein Tenant')

  const { data: existing } = await (supabase.from('pruefnummernantraege') as any)
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('dac_antrag_id', dacAntragId)
    .maybeSingle()

  if (existing?.id) {
    await (admin.from('pruefnummernantraege') as any)
      .update({ formular_daten: daten, aktualisiert_am: new Date().toISOString() })
      .eq('id', existing.id)
    return { id: existing.id }
  }

  const { data: neu } = await (admin.from('pruefnummernantraege') as any)
    .insert({ tenant_id: tenantId, dac_antrag_id: dacAntragId, formular_daten: daten })
    .select('id').single()
  return { id: (neu as R).id }
}
