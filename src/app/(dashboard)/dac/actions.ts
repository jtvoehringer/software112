'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function createDacAntrag(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId  = membership?.tenantId ?? null
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo

  const payload: R = {
    tenant_id:       tenantId,
    weinausbau_id:   (formData.get('weinausbau_id') as string) || null,
    bezeichnung:     formData.get('bezeichnung') as string,
    dac_region:      formData.get('dac_region') as string,
    jahrgang:        formData.get('jahrgang') ? Number(dezimal(formData.get('jahrgang'))) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    menge_liter:     formData.get('menge_liter') ? Number(dezimal((formData.get('menge_liter') as string))) : null,
    alkohol_prozent: formData.get('alkohol_prozent') ? Number(dezimal((formData.get('alkohol_prozent') as string))) : null,
    status:          (formData.get('status') as string) || 'entwurf',
    pruefnummer:     (formData.get('pruefnummer') as string) || null,
    eingereicht_am:  (formData.get('eingereicht_am') as string) || null,
    bescheid_am:     (formData.get('bescheid_am') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('dac_antrag') as any).insert(payload)
  if (error) throw new AktionsFehler((error as R).message)
  revalidatePath('/dac')
}

export async function updateDacAntrag(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId  = membership?.tenantId ?? null
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  const payload: R = {
    weinausbau_id:   (formData.get('weinausbau_id') as string) || null,
    bezeichnung:     formData.get('bezeichnung') as string,
    dac_region:      formData.get('dac_region') as string,
    jahrgang:        formData.get('jahrgang') ? Number(dezimal(formData.get('jahrgang'))) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    menge_liter:     formData.get('menge_liter') ? Number(dezimal((formData.get('menge_liter') as string))) : null,
    alkohol_prozent: formData.get('alkohol_prozent') ? Number(dezimal((formData.get('alkohol_prozent') as string))) : null,
    status:          formData.get('status') as string,
    pruefnummer:     (formData.get('pruefnummer') as string) || null,
    eingereicht_am:  (formData.get('eingereicht_am') as string) || null,
    bescheid_am:     (formData.get('bescheid_am') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
    aktiv:           formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('dac_antrag') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as R).message)
  revalidatePath('/dac')
}
