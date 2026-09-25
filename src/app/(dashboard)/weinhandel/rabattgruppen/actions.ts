'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  // Aktiv gewählten Betrieb respektieren statt einer beliebigen Mitgliedschaft – sonst
  // könnte bei Mehrfach-Mitgliedschaft in den falschen Mandanten geschrieben/gelesen werden.
  const membership = await getCurrentMembership()
  const id = membership?.tenantId
  if (!id) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(id)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return id
}

export async function createRabattgruppe(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('rabattgruppen') as any).insert({
    tenant_id:  tenantId,
    name:       formData.get('name') as string,
    rabatt_pct: parseFloat(dezimal(formData.get('rabatt_pct') as string)) || 0,
    notizen:    (formData.get('notizen') as string) || null,
  })
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/weinhandel/rabattgruppen')
}

export async function updateRabattgruppe(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('rabattgruppen') as any)
    .update({
      name:       formData.get('name') as string,
      rabatt_pct: parseFloat(dezimal(formData.get('rabatt_pct') as string)) || 0,
      notizen:    (formData.get('notizen') as string) || null,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/weinhandel/rabattgruppen')
}

export async function deleteRabattgruppe(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('rabattgruppen') as any)
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/weinhandel/rabattgruppen')
}
