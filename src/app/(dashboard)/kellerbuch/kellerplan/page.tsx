import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentUserRole, canWrite, canAdmin, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { createKellerplan, updateKellerplan, deleteKellerplan } from './actions'
import KellerplanEditModal from '@/components/kellerbuch/KellerplanEditModal'
import LoeschenButton from '@/components/kellerbuch/LoeschenButton'
import SendenKnopf from '@/components/ui/SendenKnopf'

export const metadata: Metadata = { title: 'Kellerplan – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const iCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
const lCls = 'block text-xs font-medium text-s112-text-2 mb-1'

export default async function KellerplanListPage() {
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role, 'kellerbuch')
  const adminOk    = canAdmin(role)   // KAN-243: Kellerplan löschen nur Betriebsleitung (Policy kellerplaene_delete)
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null

  let query = (supabase.from('kellerplaene') as any)
    .select('id, name, breite_m, laenge_m, notizen, aktiv')
    .eq('aktiv', true)
    .order('name')
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const raw = geladen(await query, 'Kellerpläne')

  const plaene = (raw ?? []) as R[]

  let posQuery = (supabase.from('kellerplan_positionen') as any)
    .select('kellerplan_id')
  if (tenantId) posQuery = posQuery.eq('tenant_id', tenantId)
  const posRaw = geladen(await posQuery, 'Kellerplan-Positionen')
  const posCounts: Record<string, number> = {}
  for (const p of (posRaw ?? []) as R[]) {
    posCounts[p.kellerplan_id] = (posCounts[p.kellerplan_id] ?? 0) + 1
  }

  return (
    <div>
      <nav className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text font-medium">Kellerplan</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Kellerplan</h1>
          <p className="text-sm text-s112-muted mt-0.5">Grundrisse mit Gebinde-Positionen</p>
        </div>
      </div>

      {plaene.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {plaene.map((p: R) => (
            <div key={p.id} className="card p-5 flex flex-col gap-3">
              <Link href={`/kellerbuch/kellerplan/${p.id}`} className="flex items-start gap-3 group flex-1">
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-s112-text group-hover:text-s112-blue-700 transition-colors">
                    {p.name}
                  </h2>
                  <p className="text-xs text-s112-muted mt-0.5">
                    {p.breite_m} × {p.laenge_m} m
                    {posCounts[p.id] ? ` · ${posCounts[p.id]} Gebinde` : ' · Noch leer'}
                  </p>
                  {p.notizen && (
                    <p className="text-xs text-s112-text-2 mt-1 italic truncate">{p.notizen}</p>
                  )}
                </div>
              </Link>

              {writeOk && (
                <div className="flex items-center gap-3 border-t border-s112-border/40 pt-2">
                  <KellerplanEditModal plan={p} action={updateKellerplan.bind(null, p.id)} inputCls={iCls} labelCls={lCls} />
                  {adminOk && (
                    <LoeschenButton
                      action={deleteKellerplan.bind(null, p.id)}
                      bestaetigung={`Kellerplan "${p.name}" wirklich löschen? Alle Positionen werden entfernt.`} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {writeOk && (
        <div className="card p-5 max-w-lg">
          <h2 className="font-semibold text-s112-text mb-4">
            {plaene.length === 0 ? 'Ersten Kellerplan anlegen' : 'Weiterer Kellerplan'}
          </h2>
          <form action={createKellerplan} className="space-y-4">
            <div>
              <label className={lCls}>Name der Lagerstätte *</label>
              <input aria-label="Name der Lagerstätte" name="name" placeholder="z.B. Hauptkeller, Fassraum, Außenlager"
                required className={iCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lCls}>Breite (m) *</label>
                <input aria-label="Breite (m)" name="breite_m" type="number" step="0.5" min="1"
                  defaultValue="20" required className={iCls} />
              </div>
              <div>
                <label className={lCls}>Länge / Tiefe (m) *</label>
                <input aria-label="Länge / Tiefe (m)" name="laenge_m" type="number" step="0.5" min="1"
                  defaultValue="10" required className={iCls} />
              </div>
            </div>
            <div>
              <label className={lCls}>Notizen (optional)</label>
              <input aria-label="Notizen (optional)" name="notizen" placeholder="z.B. Erdgeschoss Nordbau" className={iCls} />
            </div>
            <SendenKnopf
              className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors">
              Plan anlegen &amp; öffnen
            </SendenKnopf>
          </form>
        </div>
      )}

      {plaene.length === 0 && !writeOk && (
        <div className="card text-center py-12">
          <p className="text-sm text-s112-muted">Noch keine Kellerplaene angelegt.</p>
        </div>
      )}
    </div>
  )
}
