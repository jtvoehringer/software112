'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function upsertPSM(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new Error('Nicht angemeldet')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').eq('user_id', user.id).single()
  if (!membership) throw new Error('Kein Mandant')

  const existingId = fd.get('existing_id') as string | null

  const payload = {
    tenant_id:          membership.tenant_id,
    name:               fd.get('name') as string,
    handelsname:        (fd.get('handelsname') as string) || null,
    wirkstoff:          (fd.get('wirkstoff') as string) || null,
    wirkstoffgehalt_pct: parseFloat(fd.get('wirkstoffgehalt_pct') as string) || null,
    cu_gehalt_pct:      parseFloat(fd.get('cu_gehalt_pct') as string) || null,
    kategorie:          (fd.get('kategorie') as string) || null,
    wartezeit_tage:     parseInt(fd.get('wartezeit_tage') as string) || null,
    max_aufwand_kg_ha:  parseFloat(fd.get('max_aufwand_kg_ha') as string) || null,
    max_anwendungen:    parseInt(fd.get('max_anwendungen') as string) || null,
    oeko_zugelassen:    fd.get('oeko_zugelassen') === 'true',
    aktiv:              true,
    notizen:            (fd.get('notizen') as string) || null,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('pflanzenschutzmittel') as any)
      .update(payload).eq('id', existingId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('pflanzenschutzmittel') as any).insert(payload)
  }

  revalidatePath('/pflanzenschutz')
  revalidatePath('/behandlungen/lager')
  revalidatePath('/behandlungen/neu')
}

export async function deactivatePSM(id: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('pflanzenschutzmittel') as any)
    .update({ aktiv: false }).eq('id', id)
  revalidatePath('/pflanzenschutz')
}
