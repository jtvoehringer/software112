import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { updateUmzug } from '../../../gebinde-actions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Umzug bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function UmzugEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const role = await getCurrentUserRole()
  if (!canWrite(role)) redirect('/kellerbuch/gebinde?tab=umziehen')

  const supabase = await createSupabaseServerClient()

  const [{ data: rowRaw }, { data: chargenRaw }, { data: gebindeRaw }] = await Promise.all([
    (supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, schwund_liter, notizen, von_weinausbau_id, nach_behaelter_id')
      .eq('id', id).limit(1),
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, menge_liter')
      .eq('aktiv', true).order('name'),
    (supabase.from('behaelter') as any)
      .select('id, name').eq('aktiv', true).order('name'),
  ])

  const umzug  = (((rowRaw ?? []) as R[])[0] ?? null) as R | null
  if (!umzug) notFound()

  const chargen = (chargenRaw ?? []) as R[]
  const gebinde = (gebindeRaw ?? []) as R[]

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch/gebinde?tab=umziehen" className="hover:text-s112-teal">Umziehen</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Bearbeiten</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900">Umzug bearbeiten</h1>

      <form action={updateUmzug.bind(null, id)} className="card p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Datum *</label>
            <input name="datum" type="date" required
              defaultValue={umzug.datum} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Wein-Charge (von) *</label>
            <select name="von_weinausbau_id" required defaultValue={umzug.von_weinausbau_id ?? ''} className={inputCls}>
              <option value="">– Charge wählen –</option>
              {chargen.map((c: R) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.jahrgang ? ` (${c.jahrgang})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Ziel-Gebinde *</label>
            <select name="nach_behaelter_id" required defaultValue={umzug.nach_behaelter_id ?? ''} className={inputCls}>
              <option value="">– Gebinde wählen –</option>
              {gebinde.map((g: R) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Menge (Liter) *</label>
            <input name="menge_liter" type="number" step="0.01" min={0}
              required defaultValue={umzug.menge_liter ?? ''} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Schwund (Liter)</label>
            <input name="schwund_liter" type="number" step="0.01" min={0}
              defaultValue={umzug.schwund_liter ?? 0} className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Notizen</label>
            <input name="notizen" defaultValue={umzug.notizen ?? ''} className={inputCls} />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit"
            className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            Speichern
          </button>
          <Link href="/kellerbuch/gebinde?tab=umziehen"
            className="px-6 py-2 rounded-xl text-sm text-gray-600 hover:text-gray-800 transition-colors">
            Abbrechen
          </Link>
        </div>
      </form>
    </div>
  )
}
