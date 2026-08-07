import type { Metadata } from 'next'
import ImportClient from './ImportClient'
import { createSupabaseServerClient } from '@/lib/supabase/server'
export const metadata: Metadata = { title: 'Datenimport – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ typ?: string; eb?: string; err?: string }>
}) {
  const { typ, eb, err } = await searchParams
  const supabase = await createSupabaseServerClient()

  // Gebinde-Liste fuer die Anfangsbestandsbuchung (Datenimport > Gebinde) - wird nur
  // dort benoetigt, deshalb hier serverseitig geladen und als Prop durchgereicht.
  const { data: gebindeRaw } = await (supabase.from('behaelter') as any)
    .select('id, name').eq('aktiv', true).order('name')

  return (
    <ImportClient
      gebinde={(gebindeRaw ?? []) as R[]}
      initialTyp={typ}
      ebOk={eb === '1'}
      ebErr={err}
    />
  )
}
