import { createSupabaseServerClient } from '@/lib/supabase/server'
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
  erstellt_am: string
}

export default async function ZeiterfassungPage() {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('zeiterfassung') as any)
    .select('id, datum, phase, beschreibung, stunden, stundensatz, tokens_input, tokens_output, token_kosten_euro, erstellt_am')
    .order('datum', { ascending: true })
    .order('erstellt_am', { ascending: true })

  return <ZeiterfassungClient eintraege={(data ?? []) as Zeiteintrag[]} />
}
