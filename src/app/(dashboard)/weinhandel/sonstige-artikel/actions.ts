'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  return membership.tenantId
}

export async function upsertSonstigesArtikel(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const id           = (formData.get('id')           as string).trim() || null
  const name         = (formData.get('name')         as string).trim()
  const einheit      = (formData.get('einheit')      as string).trim() || 'Stk'
  const defaultPreis = parseFloat(dezimal(formData.get('default_preis') as string)) || null

  if (!name) throw new AktionsFehler('Name darf nicht leer sein')

  if (id) {
    const { error } = await (supabase.from('sonstige_artikel') as any)
      .update({ name, einheit, default_preis: defaultPreis })
      .eq('id', id).eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler((error as AR).message)
  } else {
    const { error } = await (supabase.from('sonstige_artikel') as any)
      .insert({ tenant_id: tenantId, name, einheit, default_preis: defaultPreis })
    if (error) throw new AktionsFehler((error as AR).message)
  }

  revalidatePath('/weinhandel/sonstige-artikel')
}

export async function toggleAktivSonstigesArtikel(id: string, aktiv: boolean) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('sonstige_artikel') as any)
    .update({ aktiv })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/weinhandel/sonstige-artikel')
}

export async function deleteSonstigesArtikel(id: string): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    // sonstige_artikel ist ein reiner Auswahl-Katalog (Verkaufspositionen speichern
    // Name/Preis direkt, keine Fremdschlüssel-Referenz hierher) - Löschen ist daher
    // immer unbedenklich, anders als z.B. bei Rieden mit verknüpften Pressungen.
    const { error } = await (supabase.from('sonstige_artikel') as any)
      .delete()
      .eq('id', id).eq('tenant_id', tenantId)
    if (error) return { error: (error as AR).message }
    revalidatePath('/weinhandel/sonstige-artikel')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen' }
  }
}
