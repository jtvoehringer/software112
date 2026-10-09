import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { schreibSperre } from '@/lib/auth/sperren'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Plus } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import StornoButton from '@/components/StornoButton'
import { lohnversektungStand, rueckkehrPfad, STAND_TEXT } from '@/lib/kellerbuch/lohnversektung'
import { lohnversektungStornieren } from './actions'

export const metadata: Metadata = { title: 'Lohnversektung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const datumText = (d: string) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })

// KAN-232 (08.10.2026): Lohnversektung – Grundwein beim Versekter (eigener Bestand bei Dritten), Rückkehr als Sekt in
// Flaschen (je Lieferung eine Füllung). Versand und Storno über die RPCs, Rückkehr im Füllungsformular.
export default async function LohnversektungPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const darf = !!membership && canWrite(membership, 'kellerbuch') && !(await schreibSperre(membership))
  const darfFuellen = !!membership && canWrite(membership, 'warenwirtschaft')

  // storno-sichtbar: stornierte Versände bleiben mit Kennzeichen in der Liste
  const { data } = tenantId ? await alle<R>((supabase.from('lohnversektungen') as R)
    .select(`id, datum, liter_versandt, abgeschlossen_am, notizen, erstellt_von_name, storniert_am, storno_grund,
      charge:weinausbau_id(id, name), firma:firmen!firma_id(id, name),
      rueckkehr:fuellungen!lohnversektung_id(id, name, datum, anzahl_flaschen, flaschengroesse_ml, menge_liter_gefuellt, storniert_am)`)
    .eq('tenant_id', tenantId).order('datum', { ascending: false }).order('id')) : { data: [] as R[] }
  const liste = (data ?? []) as R[]

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-2">Lohnversektung</span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-[16rem]">
          <h1 className="text-xl font-semibold text-s112-text">Lohnversektung</h1>
          <p className="text-sm text-s112-muted mt-1">
            Grundwein geht zur Versektung außer Haus und bleibt so lange eigener Bestand („Wein bei Dritten“); sein Gebinde
            wird frei. Der Sekt kommt in Flaschen zurück – auch in mehreren Lieferungen. Jede Rückkehr bucht den Grundwein ab
            (Abgang zur Lohnversektung) und die Flaschen zu (Zugang aus Lohnversektung); die Differenz ist Dosage bzw. Verlust.
          </p>
        </div>
        {darf && (
          <Link href="/kellerbuch/lohnversektung/neu" className="btn-primary inline-flex items-center gap-1.5 shrink-0">
            <Plus size={15} aria-hidden /> Grundwein versenden
          </Link>
        )}
      </div>

      <section className="card p-4">
        <h2 className="font-semibold text-s112-text text-sm mb-3">Versände</h2>
        {liste.length === 0 ? <p className="text-sm text-s112-muted">Noch keine Lohnversektung.</p> : (
          <ul className="divide-y divide-s112-line text-sm">
            {liste.map(l => {
              const rk = ((l.rueckkehr ?? []) as R[]).filter(f => !f.storniert_am)
              const literZurueck = rk.reduce((s, f) => s + (Number(f.menge_liter_gefuellt) || 0), 0)
              const flaschenLiter = rk.reduce((s, f) => s + (Number(f.anzahl_flaschen) || 0) * (Number(f.flaschengroesse_ml) || 750) / 1000, 0)
              const stand = lohnversektungStand({ storniertAm: l.storniert_am, abgeschlossenAm: l.abgeschlossen_am, literZurueck })
              const offen = stand === 'unterwegs' || stand === 'teilweise'
              return (
                <li key={l.id} className={`py-3 space-y-1 ${l.storniert_am ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 items-start">
                    <span className="tabular-nums text-s112-muted w-24">{datumText(l.datum)}</span>
                    <span className="flex-1 min-w-[16rem]">
                      {l.charge?.id
                        ? <Link href={`/kellerbuch/weinausbau/${l.charge.id}`} className="font-medium text-s112-blue-700 hover:underline">{l.charge.name}</Link>
                        : <span className="font-medium">Charge</span>}
                      {' → '}{l.firma?.name ?? 'Sektkellerei'} · {fmtNum(Number(l.liter_versandt), { max: 2 })} L Grundwein
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${stand === 'abgeschlossen' ? 'bg-s112-ok-bg text-s112-ok-fg' : stand === 'storniert' ? 'bg-s112-bg text-s112-muted' : 'bg-s112-warn-bg text-s112-warn-fg'}`}>
                        {STAND_TEXT[stand]}
                      </span>
                      {rk.length > 0 && (
                        <span className="block text-xs text-s112-text-2 mt-0.5">
                          Zurück: {fmtNum(literZurueck, { max: 2 })} L Grundwein als {fmtNum(flaschenLiter, { max: 2 })} L Sekt
                          {' ('}{rk.map(f => `${f.name} ${fmtNum(Number(f.anzahl_flaschen) || 0)} Fl.`).join(', ')}{')'}
                        </span>
                      )}
                      {l.storniert_am && <span className="block text-xs text-s112-err">Storniert: {l.storno_grund}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      {offen && darfFuellen && (
                        <Link href={rueckkehrPfad(String(l.id))} className="text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg">
                          Rückkehr erfassen
                        </Link>
                      )}
                      {darf && !l.storniert_am && rk.length === 0 && (
                        <StornoButton action={lohnversektungStornieren.bind(null, String(l.id))}
                          hinweis="Der Grundwein kommt in sein früheres Gebinde zurück. Nur möglich, solange noch keine Rückkehr gebucht ist." />
                      )}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
