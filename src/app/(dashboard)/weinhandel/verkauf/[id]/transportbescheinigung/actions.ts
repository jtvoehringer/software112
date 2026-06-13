'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function saveTB(verkaufspostenId: string, daten: R): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()

  const { data: mb } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').limit(1).single()
  const tenantId = (mb as R | null)?.tenant_id
  if (!tenantId) throw new Error('Kein Tenant')

  // Bestehendes Dokument suchen
  const { data: existing } = await (supabase.from('transportbescheinigungen') as any)
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
