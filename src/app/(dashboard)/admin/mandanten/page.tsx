import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import MandantenClient from './MandantenClient'

export const metadata: Metadata = { title: 'Mandanten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type MandantRow = {
  id: string
  name: string
  erstellt_am: string
  benutzer_anzahl: number
}

export default async function MandantenPage() {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin') redirect('/dashboard')

  const supabase = await createSupabaseServerClient()

  const [{ data: tenants }, { data: memberships }] = await Promise.all([
    (supabase.from('tenants') as any).select('id, name, erstellt_am').order('erstellt_am'),
    (supabase.from('tenant_memberships') as any).select('tenant_id'),
  ])

  // Benutzeranzahl je Mandant zählen
  const countMap: Record<string, number> = {}
  for (const m of (memberships ?? []) as R[]) {
    countMap[m.tenant_id] = (countMap[m.tenant_id] ?? 0) + 1
  }

  const mandanten: MandantRow[] = ((tenants ?? []) as R[]).map(t => ({
    id:              t.id,
    name:            t.name,
    erstellt_am:     t.erstellt_am,
    benutzer_anzahl: countMap[t.id] ?? 0,
  }))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mandanten</h1>
          <p className="text-sm text-s112-muted mt-0.5">Alle Betriebe auf dieser Instanz</p>
        </div>
        <span className="text-sm text-s112-muted">{mandanten.length} Mandanten</span>
      </div>
      <MandantenClient mandanten={mandanten} />
    </div>
  )
}
