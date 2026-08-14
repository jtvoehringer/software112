import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import ZeiterfassungClient from './ZeiterfassungClient'

export const dynamic = 'force-dynamic'

export type Zeiteintrag = {
  id: string
  datum: string
  phase: number
  beschreibung: string
  stunden: number
  stundensatz: number
  tokens_input: number | null
  tokens_output: number | null
  token_kosten_euro: number | null
  lizenzkosten_euro: number | null
  erstellt_am: string
}

export default async function ZeiterfassungPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const { data } = await (supabase.from('zeiterfassung') as any)
    .select('id, datum, phase, beschreibung, stunden, stundensatz, tokens_input, tokens_output, token_kosten_euro, lizenzkosten_euro, erstellt_am')
    .eq('tenant_id', tenantId)
    .order('datum', { ascending: true })
    .order('erstellt_am', { ascending: true })

  return <ZeiterfassungClient eintraege={(data ?? []) as Zeiteintrag[]} />
}
