import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { createKellerplan } from './actions'

export const metadata: Metadata = { title: 'Kellerplan – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

export default async function KellerplanListPage() {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const { data: raw } = await (supabase.from('kellerplaene') as any)
    .select('id, name, breite_m, laenge_m, notizen, aktiv')
    .eq('aktiv', true)
    .order('name')

  const plaene = (raw ?? []) as R[]

  // Behälter-Anzahl pro Plan
  const { data: posRaw } = await (supabase.from('kellerplan_positionen') as any)
    .select('kellerplan_id')
  const posCounts: Record<string, number> = {}
  for (const p of (posRaw ?? []) as R[]) {
    posCounts[p.kellerplan_id] = (posCounts[p.kellerplan_id] ?? 0) + 1
  }

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/kellerbuch" className="hover:text-s112-teal">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Kellerplan</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kellerplan</h1>
          <p className="text-sm text-s112-muted mt-0.5">Grundrisse mit Behälter-Positionen</p>
        </div>
      </div>

      {/* Bestehende Pläne */}
      {plaene.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {plaene.map((p: R) => (
            <Link
              key={p.id}
              href={`/kellerbuch/kellerplan/${p.id}`}
              className="card p-5 hover:shadow-md transition-shadow group"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-s112-teal/10 flex items-center justify-center text-xl flex-shrink-0">
                  🗺️
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-gray-900 group-hover:text-s112-teal transition-colors">
                    {p.name}
                  </h2>
                  <p className="text-xs text-s112-muted mt-0.5">
                    {p.breite_m} × {p.laenge_m} m
                    {posCounts[p.id] ? ` · ${posCounts[p.id]} Behälter` : ' · Noch leer'}
                  </p>
                  {p.notizen && (
                    <p className="text-xs text-gray-500 mt-1 italic truncate">{p.notizen}</p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Neuen Plan anlegen */}
      {writeOk && (
        <div className="card p-5 max-w-lg">
          <h2 className="font-semibold text-gray-800 mb-4">
            {plaene.length === 0 ? '🗺️ Ersten Kellerplan anlegen' : '＋ Weiterer Kellerplan'}
          </h2>
          <form action={createKellerplan} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Name der Lagerstätte *
              </label>
              <input
                name="name"
                placeholder="z.B. Hauptkeller, Fassraum, Außenlager"
                required
                className={inputCls()}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Breite (m) *
                </label>
                <input
                  name="breite_m"
                  type="number"
                  step="0.5"
                  min="1"
                  defaultValue="20"
                  required
                  className={inputCls()}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Länge / Tiefe (m) *
                </label>
                <input
                  name="laenge_m"
                  type="number"
                  step="0.5"
                  min="1"
                  defaultValue="10"
                  required
                  className={inputCls()}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Notizen (optional)
              </label>
              <input
                name="notizen"
                placeholder="z.B. Erdgeschoss Nordbau"
                className={inputCls()}
              />
            </div>
            <button
              type="submit"
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
            >
              Plan anlegen & öffnen
            </button>
          </form>
        </div>
      )}

      {plaene.length === 0 && !writeOk && (
        <div className="card text-center py-12">
          <p className="text-4xl mb-3">🗺️</p>
          <p className="text-sm text-s112-muted">Noch keine Kellerplaene angelegt.</p>
        </div>
      )}
    </div>
  )
}
