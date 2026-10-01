import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'

export const dynamic = 'force-dynamic'

// KAN-181 (01.10.2026): direkter Einstieg „Lese erfassen“ (App-Schnellzugriff, Befehlspalette, Handy) – springt zum
// neuesten Jahrgang des aktiven Betriebs und öffnet dort das Erfassungsformular (?erfassen=1, aktive Lese wie auf
// der Seite: die höchste). Ohne Jahrgang zur Lese-Übersicht, wo einer angelegt werden kann.
export default async function LeseErfassenPage() {
  const membership = await getCurrentMembership()
  if (!membership) redirect('/erntemeldung')
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('weinjahrgaenge') as any)
    .select('id')
    .eq('tenant_id', membership.tenantId)
    .order('jahrgang', { ascending: false })
    .limit(1)
    .maybeSingle()
  redirect(data?.id ? `/erntemeldung/${data.id}?erfassen=1` : '/erntemeldung')
}
