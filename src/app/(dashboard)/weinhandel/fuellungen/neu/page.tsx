import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { createFuellung } from '../../actions'
import FuellungFormClient from './FuellungFormClient'

export const metadata: Metadata = { title: 'Neue Füllung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function NeueFuellungPage({
  searchParams,
}: {
  searchParams: Promise<{ charge?: string }>
}) {
  const role = await getCurrentUserRole()
  if (!canWrite(role)) redirect('/weinhandel')

  const { charge: chargeId } = await searchParams
  const supabase = await createSupabaseServerClient()

  // Alle aktiven Weinausbau-Chargen (nicht abgeschlossen)
  const { data: chargenRaw } = await (supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, menge_liter, status')
    .eq('aktiv', true)
    .neq('status', 'abgeschlossen')
    .order('jahrgang', { ascending: false })

  const chargen = (chargenRaw ?? []) as R[]

  return (
    <div className="max-w-2xl">
      <nav className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weinhandel" className="hover:text-s112-teal">Weinhandel</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Neue Füllung</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Neue Füllung anlegen</h1>
      <p className="text-sm text-s112-muted mb-6">
        Der Wein verlässt den Keller und wird als verkaufsfertiger Artikel im Weinhandel angelegt.
      </p>

      <FuellungFormClient
        chargen={chargen}
        action={createFuellung}
        defaultChargeId={chargeId}
      />
    </div>
  )
}
