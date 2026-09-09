import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { redirect, notFound } from 'next/navigation'
import { updateLage } from '../actions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Ried bearbeiten – software:112' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

interface Props { params: Promise<{ id: string }> }

export default async function EditLagePage({ params }: Props) {
  const { id } = await params
  const role = await getCurrentUserRole()
  if (!canWrite(role)) redirect('/lagen')

  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('lagen') as any)
    .select('*').eq('id', id).eq('tenant_id', tenantId).single()
  const lage = data as AR | null
  if (!lage) notFound()

  const action = updateLage.bind(null, id)

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Ried bearbeiten</h1>
        <p className="text-sm text-s112-muted mt-0.5">{lage.name}</p>
      </div>
      <div className="card">
        <form action={action} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">
              Name <span className="text-s112-err">*</span>
            </label>
            <input name="name" required defaultValue={lage.name}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Gemeinde</label>
            <input name="gemeinde" defaultValue={lage.gemeinde ?? ''}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Weinbaugebiet</label>
            <input name="weinbaugebiet" defaultValue={lage.weinbaugebiet ?? ''}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Notizen</label>
            <textarea name="notizen" rows={3} defaultValue={lage.notizen ?? ''}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit"
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
              Speichern
            </button>
            <a href="/lagen" className="px-5 py-2 rounded-xl text-sm font-medium text-s112-text-2 hover:text-s112-text">
              Abbrechen
            </a>
          </div>
        </form>
      </div>
    </div>
  )
}
