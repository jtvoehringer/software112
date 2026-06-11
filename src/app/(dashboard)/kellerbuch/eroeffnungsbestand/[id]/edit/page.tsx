import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { updateEroeffnungsbestand } from '../../../gebinde-actions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Eröffnungsbestand bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const QUALITAETEN = [
  { value: 'qualitaetswein', label: 'Qualitätswein' },
  { value: 'kabinett', label: 'Kabinett' },
  { value: 'spaetlese', label: 'Spätlese' },
  { value: 'auslese', label: 'Auslese' },
  { value: 'beerenauslese', label: 'Beerenauslese' },
  { value: 'trockenbeerenauslese', label: 'Trockenbeerenauslese (TBA)' },
  { value: 'eiswein', label: 'Eiswein' },
  { value: 'strohwein', label: 'Strohwein / Schilfwein' },
  { value: 'dac', label: 'DAC' },
  { value: 'reserve', label: 'Reservé / Reserve' },
  { value: 'erste_lage', label: 'Erste Lage (ÖTW)' },
  { value: 'grosses_gewachs', label: 'Großes Gewächs' },
  { value: 'landwein', label: 'Landwein' },
  { value: 'sekt', label: 'Sekt b.A.' },
  { value: 'perlwein', label: 'Perlwein' },
  { value: 'sonstiges', label: 'Sonstiges' },
]

export default async function EroeffnungsbestandEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const role = await getCurrentUserRole()
  if (!canWrite(role)) redirect('/kellerbuch/gebinde?tab=eroeffnungsbestand')

  const supabase = await createSupabaseServerClient()

  const [{ data: rowRaw }, { data: gebindeRaw }] = await Promise.all([
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, kmw, menge_liter, qualitaetsstufe, behaelter_id, notizen, einstandspreis_pro_liter')
      .eq('id', id).eq('ist_eroeffnungsbestand', true).limit(1),
    (supabase.from('behaelter') as any).select('id, name').eq('aktiv', true).order('name'),
  ])

  const eintrag = (((rowRaw ?? []) as R[])[0] ?? null) as R | null
  if (!eintrag) notFound()

  const gebinde = (gebindeRaw ?? []) as R[]
  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch/gebinde?tab=eroeffnungsbestand" className="hover:text-s112-teal">Eröffnungsbestand</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Bearbeiten</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900">Eröffnungsbestand bearbeiten</h1>

      <form action={updateEroeffnungsbestand.bind(null, id)} className="card p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Weinbezeichnung *</label>
            <input name="name" required defaultValue={eintrag.name} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Gebinde</label>
            <select name="behaelter_id" defaultValue={eintrag.behaelter_id ?? ''} className={inputCls}>
              <option value="">– kein –</option>
              {gebinde.map((g: R) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Jahrgang</label>
            <input name="jahrgang" type="number" min={1900} max={2100}
              defaultValue={eintrag.jahrgang ?? ''} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>KMW (°KMW)</label>
            <input name="kmw" type="number" step="0.1" min={0} max={50}
              defaultValue={eintrag.kmw ?? ''} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Menge (Liter) *</label>
            <input name="menge_liter" type="number" step="0.01" min={0}
              required defaultValue={eintrag.menge_liter ?? ''} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Einstandspreis pro Liter (€)</label>
            <input name="einstandspreis_pro_liter" type="text" inputMode="decimal"
              defaultValue={eintrag.einstandspreis_pro_liter != null
                ? String(eintrag.einstandspreis_pro_liter).replace('.', ',') : ''}
              placeholder="z.B. 1,50" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Qualitätsstufe</label>
            <select name="qualitaetsstufe" defaultValue={eintrag.qualitaetsstufe ?? ''} className={inputCls}>
              <option value="">– keine –</option>
              {QUALITAETEN.map(q => (
                <option key={q.value} value={q.value}>{q.label}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Notizen</label>
            <input name="notizen" defaultValue={eintrag.notizen ?? ''} className={inputCls} />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit"
            className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            Speichern
          </button>
          <Link href="/kellerbuch/gebinde?tab=eroeffnungsbestand"
            className="px-6 py-2 rounded-xl text-sm text-gray-600 hover:text-gray-800 transition-colors">
            Abbrechen
          </Link>
        </div>
      </form>
    </div>
  )
}
