'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function upsertLagerBewegung(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new Error('Nicht angemeldet')

  // Tenant ermitteln
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').eq('user_id', user.id).single()
  if (!membership) throw new Error('Kein Mandant')

  const existingId = fd.get('existing_id') as string | null
  const mengeRaw = parseFloat((fd.get('menge') as string) ?? '0')
  const richtung = fd.get('richtung') as string // 'eingang' | 'ausgang'
  const menge = richtung === 'ausgang' ? -Math.abs(mengeRaw) : Math.abs(mengeRaw)

  const payload = {
    tenant_id: membership.tenant_id,
    psm_id:    fd.get('psm_id') as string,
    datum:     fd.get('datum') as string,
    typ:       fd.get('typ') as string,
    menge,
    einheit:   fd.get('einheit') as string || null,
    notizen:   (fd.get('notizen') as string) || null,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('psm_lager_bewegungen') as any)
      .update(payload).eq('id', existingId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('psm_lager_bewegungen') as any).insert(payload)
  }

  revalidatePath('/behandlungen/lager')
}

export async function deleteLagerBewegung(id: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('psm_lager_bewegungen') as any).delete().eq('id', id)
  revalidatePath('/behandlungen/lager')
}
