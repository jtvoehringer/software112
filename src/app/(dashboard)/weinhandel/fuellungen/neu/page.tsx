import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { createFuellung } from '../../actions'

export const metadata: Metadata = { title: 'Neue Fuellung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const QUALITAETEN = [
  { value: 'qualitaetswein',        label: 'Qualitätswein' },
  { value: 'kabinett',              label: 'Kabinett' },
  { value: 'spaetlese',             label: 'Spätlese' },
  { value: 'auslese',               label: 'Auslese' },
  { value: 'beerenauslese',         label: 'Beerenauslese' },
  { value: 'trockenbeerenauslese',  label: 'Trockenbeerenauslese (TBA)' },
  { value: 'eiswein',               label: 'Eiswein' },
  { value: 'strohwein',             label: 'Strohwein / Schilfwein' },
  { value: 'dac',                   label: 'DAC (Districtus Austriae Controllatus)' },
  { value: 'reserve',               label: 'Reservé / Reserve' },
  { value: 'erste_lage',            label: 'Erste Lage (ÖTW)' },
  { value: 'grosses_gewachs',       label: 'Großes Gewächs' },
  { value: 'landwein',              label: 'Landwein' },
  { value: 'sekt',                  label: 'Sekt b.A.' },
  { value: 'perlwein',              label: 'Perlwein' },
  { value: 'sonstiges',             label: 'Sonstiges' },
]

const FLASCHENGROESSEN = [
  { value: 375,  label: '0,375 L – Halbflasche' },
  { value: 750,  label: '0,75 L – Normalflasche (Standard)' },
  { value: 1000, label: '1,0 L' },
  { value: 1500, label: '1,5 L – Magnum' },
  { value: 3000, label: '3,0 L – Doppelmagnum' },
  { value: 6000, label: '6,0 L – Imperiale' },
  { value: 187,  label: '0,187 L – Piccolo' },
  { value: 500,  label: '0,500 L' },
]

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

  // Vorausgewählte Charge für Vorbelegen des Formulars
  const vorausgewaehlt = chargeId
    ? chargen.find((c: R) => c.id === chargeId) ?? null
    : null

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

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

      <form action={createFuellung} className="space-y-6">

        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-800 text-sm">Kellerbuch-Charge</h2>
          <div>
            <label className={labelCls}>Weinausbau-Charge</label>
            <select name="weinausbau_id" defaultValue={vorausgewaehlt?.id ?? ''} className={inputCls}>
              <option value="">– keine Verknüpfung –</option>
              {chargen.map((c: R) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.jahrgang ? ` (${c.jahrgang})` : ''}{c.menge_liter ? ` · ${c.menge_liter.toLocaleString('de-AT')} L` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-s112-muted mt-1">
              Nach der Füllung wird der Charge-Status automatisch auf „Abfüllung“ gesetzt.
            </p>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-800 text-sm">Produktbezeichnung</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>Produktname *</label>
              <input
                name="name"
                defaultValue={vorausgewaehlt?.name ?? ''}
                placeholder="z.B. Grüner Veltliner Ried Hohenberg"
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Jahrgang</label>
              <input
                name="jahrgang"
                type="number"
                min={1900} max={2100}
                defaultValue={vorausgewaehlt?.jahrgang ?? new Date().getFullYear()}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Rebsorte</label>
              <input
                name="rebsorte"
                defaultValue={vorausgewaehlt?.rebsorte ?? ''}
                placeholder="z.B. Grüner Veltliner"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Qualitätsbezeichnung *</label>
              <select name="qualitaet" defaultValue="qualitaetswein" required className={inputCls}>
                {QUALITAETEN.map(q => (
                  <option key={q.value} value={q.value}>{q.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Anbaugebiet</label>
              <input
                name="anbaugebiet"
                placeholder="z.B. Traisental, Wachau, Kamptal …"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Subbezeichnung / Ried (optional)</label>
              <input
                name="bezeichnung"
                placeholder="z.B. Ried Hohenberg · Reserve · Alte Reben"
                className={inputCls}
              />
            </div>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-800 text-sm">Abfüllung</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Prüfnummer (optional)</label>
              <input
                name="pruefnummer"
                placeholder="z.B. AT 1234/2025"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Chargennummer (optional)</label>
              <input
                name="chargennummer"
                placeholder="z.B. CH-2025-001"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Abfülldatum *</label>
              <input
                name="datum"
                type="date"
                defaultValue={new Date().toISOString().split('T')[0]}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Flaschengrösse *</label>
              <select name="flaschengroesse_ml" defaultValue={750} required className={inputCls}>
                {FLASCHENGROESSEN.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Anzahl Flaschen *</label>
              <input
                name="anzahl_flaschen"
                type="number"
                min={1}
                placeholder="z.B. 2400"
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Tatsächlich gefüllt (Liter, optional)</label>
              <input
                name="menge_liter_gefuellt"
                type="number"
                step="0.01"
                placeholder="z.B. 1800"
                className={inputCls}
              />
            </div>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-800 text-sm">Preise</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>VK-Preis brutto pro Flasche (€)</label>
              <input
                name="vk_preis_brutto"
                type="number"
                step="0.01"
                min={0}
                placeholder="z.B. 12.90"
                className={inputCls}
              />
              <p className="text-xs text-s112-muted mt-1">Verkaufspreis inkl. MwSt.</p>
            </div>
            <div>
              <label className={labelCls}>Einstandspreis pro Flasche (€)</label>
              <input
                name="einstandspreis"
                type="number"
                step="0.01"
                min={0}
                placeholder="z.B. 4.20"
                className={inputCls}
              />
              <p className="text-xs text-s112-muted mt-1">Kalkulationskosten / Lagerwert – netto, intern</p>
            </div>
          </div>
        </div>

        <div className="card p-5">
          <label className={labelCls}>Notizen (optional)</label>
          <textarea
            name="notizen"
            rows={3}
            placeholder="Abfüllungsprotokoll, Besonderheiten …"
            className={inputCls + ' resize-none'}
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            🍾 Füllung anlegen
          </button>
          <Link
            href="/weinhandel"
            className="px-6 py-2 rounded-xl text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
            Abbrechen
          </Link>
        </div>
      </form>
    </div>
  )
}
