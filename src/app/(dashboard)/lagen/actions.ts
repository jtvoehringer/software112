'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// Aktiv gewählten Betrieb respektieren (Cookie-basiert, s. lib/auth/roles.ts) statt einer
// beliebigen/ersten tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft
// Daten eines anderen Betriebs als des gerade ausgewählten angezeigt/verändert werden.
async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new Error('Kein aktiver Mandant gefunden')
  return membership.tenantId
}

export async function createLage(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const payload: AR = {
    tenant_id:    tenantId,
    name:         formData.get('name') as string,
    gemeinde:     (formData.get('gemeinde') as string) || null,
    weinbaugebiet:(formData.get('weinbaugebiet') as string) || null,
    notizen:      (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('lagen') as any).insert(payload)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/lagen')
  revalidatePath('/weingarten')
}

export async function updateLage(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const payload: AR = {
    name:         formData.get('name') as string,
    gemeinde:     (formData.get('gemeinde') as string) || null,
    weinbaugebiet:(formData.get('weinbaugebiet') as string) || null,
    notizen:      (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('lagen') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/lagen')
  revalidatePath('/weingarten')
}

export async function deleteLage(id: string): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const membership = await getCurrentMembership()
    if (!membership) return { error: 'Kein Betrieb gefunden' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('lagen') as any)
      .delete()
      .eq('id', id)
      .eq('tenant_id', membership.tenantId)
    if (error) return { error: (error as AR).message }

    revalidatePath('/lagen')
    revalidatePath('/weingarten')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen der Ried' }
  }
}

export async function assignWeingartenToLage(weingartenId: string, lageId: string | null) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  // ried-Text synchron halten: bei Zuweisung Lage-Name setzen, bei Entfernung löschen
  let riedName: string | null = null
  if (lageId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lage } = await (supabase.from('lagen') as any)
      .select('name').eq('id', lageId).eq('tenant_id', tenantId).maybeSingle()
    riedName = (lage as AR | null)?.name ?? null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any)
    .update({ lage_id: lageId, ried: riedName })
    .eq('id', weingartenId)
    .eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/lagen')
  revalidatePath('/weingarten')
}
