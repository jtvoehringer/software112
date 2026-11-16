import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { schreibSperre } from '@/lib/auth/sperren'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { nachTank, tankBehandlungZiel, TANK_OHNE_BELEGTE_KAMMER, tankTypLabel } from '@/lib/keller/tanks'
import { fmtLiter } from '@/lib/format'
import TankForm from '@/components/kellerbuch/TankForm'
import { updateTank } from '../../../actions'

export const metadata: Metadata = { title: 'Geteilter Tank' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-466: Stammdaten eines Tanks und seine Kammern (jede Kammer ist ein eigenes Gebinde)
export default async function TankPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tank = geladen(await (supabase.from('gebinde_tanks') as any)
    .select('id, name, typ, material, standort, notizen').eq('id', id).eq('tenant_id', tenantId).maybeSingle(), 'Tank') as R | null
  if (!tank) notFound()

  const kammern = nachTank((await ladeBehaelter(supabase, tenantId)).filter(b => b.tank_id === id)).tanks[0]?.kammern ?? []
  const volumen = kammern.reduce((s, k) => s + (k.volumen_liter ?? 0), 0)
  const inhalt = kammern.reduce((s, k) => s + k.eigen_liter + k.fremd_liter, 0)

  const darf = !!membership && canWrite(membership, 'kellerbuch') && !(await schreibSperre(membership))
  // KAN-468: zwei oder mehr belegte Kammern → Sammelmaßnahme; genau eine → Kellerbehandlung dieser Kammer
  const behandlungZiel = tankBehandlungZiel(id, kammern.filter(k => k.eigen_liter > 0.005).map(k => k.id))

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium truncate">Geteilter Tank {tank.name}</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text mb-1 break-words">Geteilter Tank {tank.name}</h1>
      <p className="text-sm text-s112-text-2 mb-6">
        {tankTypLabel(tank.typ)} · {kammern.length} {kammern.length === 1 ? 'Kammer' : 'Kammern'} · <span className="tabular-nums">{fmtLiter(inhalt)} / {fmtLiter(volumen)}</span>
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-base font-semibold text-s112-text">Kammern</h2>
        {/* KAN-468: Sammelmaßnahme mit den belegten Kammern dieses Tanks als Vorauswahl */}
        {darf && (behandlungZiel
          ? <Link href={behandlungZiel.href} className="btn-primary text-sm">{behandlungZiel.text}</Link>
          : <span title={TANK_OHNE_BELEGTE_KAMMER} className="text-sm text-s112-tertiary">Behandlung für alle Kammern (keine belegte Kammer)</span>)}
      </div>
      <div className="card p-0 overflow-hidden mb-6">
        {kammern.length === 0 && <p className="px-4 py-3 text-sm text-s112-muted">Dieser geteilte Tank hat keine Kammern mehr.</p>}
        <div className="divide-y divide-s112-line">
          {kammern.map(k => (
            <div key={k.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-20 shrink-0 text-xs text-s112-muted">Kammer {k.kammer_nr}</span>
              <Link href={`/kellerbuch/behaelter/${k.id}`} className="font-semibold text-s112-blue-700 hover:underline truncate">{k.name}</Link>
              {!k.aktiv && <span className="text-[10.5px] font-semibold px-1.5 py-px rounded-sm bg-s112-bg text-s112-text-2 border border-s112-line">inaktiv</span>}
              <span className="ml-auto text-xs tabular-nums text-s112-text-2 whitespace-nowrap">
                {fmtLiter(k.eigen_liter + k.fremd_liter)}{k.volumen_liter ? <span className="text-s112-tertiary"> / {fmtLiter(k.volumen_liter)}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-s112-muted mb-6">
        Name, Fassungsvermögen und Freigabe einer Kammer änderst du am Gebinde selbst (Klick auf die Kammer). Kammer 1 ist die unterste.
      </p>

      {darf ? (
        <>
          <h2 className="text-base font-semibold text-s112-text mb-3">Stammdaten des geteilten Tanks</h2>
          <TankForm tank={tank as Parameters<typeof TankForm>[0]['tank']} action={updateTank.bind(null, id)} />
        </>
      ) : (
        <div className="card p-4 text-sm text-s112-text-2">
          <p><span className="text-s112-muted">Material:</span> {tank.material ?? '–'} · <span className="text-s112-muted">Standort:</span> {tank.standort ?? '–'}</p>
          {tank.notizen && <p className="mt-1">{tank.notizen}</p>}
        </div>
      )}
    </div>
  )
}
