import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'
import Link from 'next/link'
import WeingartenForm from '@/components/weingarten/WeingartenForm'
import { createWeingarten } from '../actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'

export const metadata: Metadata = { title: 'Neuer Weingarten – software:112' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export default async function NeuePage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  let lagen: { id: string; name: string }[] = []
  if (membership?.tenantId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('lagen') as any)
      .select('id, name')
      .eq('tenant_id', membership.tenantId)
      .order('name')
    lagen = ((data ?? []) as AR[]).map(l => ({ id: l.id as string, name: l.name as string }))
  }

  return (
    <div className="max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weingarten" className="hover:text-s112-teal transition-colors">Weingarten</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Neu anlegen</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Neuer Weingarten</h1>

      <WeingartenForm action={createWeingarten} lagen={lagen} />
    </div>
  )
}
