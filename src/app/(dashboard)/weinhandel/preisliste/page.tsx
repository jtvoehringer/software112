import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { createPreisliste } from './actions'

export const metadata: Metadata = { title: 'Preislisten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function PreislistePage() {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)
  const membership = await getCurrentMembership()

  const { data: listenRaw } = await (supabase.from('preislisten') as any)
    .select(`
      id, name, beschreibung, gueltig_von, gueltig_bis, aktiv, erstellt_am,
      positionen:preislisten_positionen(count)
    `)
    .eq('aktiv', true)
    .eq('tenant_id', membership?.tenantId ?? '')
    .order('name')

  const listen = (listenRaw ?? []) as R[]

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

  // Gültigkeitsstatus berechnen
  function gueltigkeit(von: string | null, bis: string | null) {
    const heute = new Date().toISOString().split('T')[0]
    if (bis && bis < heute) return { label: 'Abgelaufen', cls: 'bg-s112-err-bg text-s112-err-fg' }
    if (von && von > heute) return { label: 'Noch nicht aktiv', cls: 'bg-s112-warn-bg text-s112-warn-fg' }
    return { label: 'Aktiv', cls: 'bg-s112-ok-bg text-s112-ok-fg' }
  }

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Preislisten</h1>
          <p className="text-sm text-s112-muted mt-0.5">Mehrere Preislisten gleichzeitig aktiv</p>
        </div>
      </div>

      {/* Liste */}
      {listen.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-sm text-s112-muted">Noch keine Preislisten angelegt.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {listen.map((pl: R) => {
            const g     = gueltigkeit(pl.gueltig_von, pl.gueltig_bis)
            const count = (pl.positionen as R[])?.[0]?.count ?? 0
            return (
              <Link
                key={pl.id}
                href={`/weinhandel/preisliste/${pl.id}`}
                className="card p-5 hover:shadow-sm transition-shadow block"
              >
                <div className="flex items-start justify-between mb-2">
                  <h2 className="font-semibold text-s112-text">{pl.name}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${g.cls}`}>{g.label}</span>
                </div>
                {pl.beschreibung && (
                  <p className="text-xs text-s112-muted mb-2 line-clamp-2">{pl.beschreibung}</p>
                )}
                <div className="flex items-center gap-4 text-xs text-s112-muted mt-3">
                  <span>{count} Position{count !== 1 ? 'en' : ''}</span>
                  {pl.gueltig_von && <span>ab {new Date(pl.gueltig_von).toLocaleDateString('de-AT')}</span>}
                  {pl.gueltig_bis && <span>bis {new Date(pl.gueltig_bis).toLocaleDateString('de-AT')}</span>}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Neue Preisliste */}
      {writeOk && (
        <section className="card p-6">
          <h2 className="font-semibold text-s112-text mb-4">Neue Preisliste anlegen</h2>
          <form action={createPreisliste} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={labelCls}>Name *</label>
                <input
                  name="name"
                  required
                  placeholder="z.B. Privatkunden 2025, Gastronomie, Export"
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Beschreibung (optional)</label>
                <input
                  name="beschreibung"
                  placeholder="Kurze Beschreibung der Preisliste"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Gültig von</label>
                <input name="gueltig_von" type="date" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Gültig bis</label>
                <input name="gueltig_bis" type="date" className={inputCls} />
              </div>
            </div>
            <button
              type="submit"
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
            >
              Preisliste anlegen
            </button>
          </form>
        </section>
      )}
    </div>
  )
}
