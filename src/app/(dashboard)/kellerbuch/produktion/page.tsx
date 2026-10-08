import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { schreibSperre } from '@/lib/auth/sperren'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { alle } from '@/lib/supabase/alle'
import { wienHeute } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { KAT_ERZEUGNIS } from '@/lib/katalog/bki'
import { PRODUKTION_ART_LABEL, PRODUKTION_ZUTAT_LABEL, type ProduktionArt } from '@/lib/kellerbuch/produktion'
import StornoButton from '@/components/StornoButton'
import ProduktionForm from './ProduktionForm'
import { produktionBuchen, produktionStornieren } from './actions'

export const metadata: Metadata = { title: 'Produktion – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-118 (08.10.2026): Produktion – Perlweinspritzer, Weinmischgetränk, Perlwein, Schaumwein/Sekt, PetNat. Aus Quell-Chargen
// und Zutaten entsteht eine neue Charge (Journal AB_VERAR/ZU_PROD). ?quelle=<charge> belegt die erste Quelle vor.
export default async function ProduktionPage({ searchParams }: { searchParams: Promise<{ quelle?: string }> }) {
  const { quelle } = await searchParams
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const darf = !!membership && canWrite(membership, 'kellerbuch') && !(await schreibSperre(membership))

  const [chargenRes, gebinde, mittelRes, prodRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle((supabase.from('weinausbau') as any)
      .select('id, name, menge_liter, weinart, erzeugnis, behaelter_id, behaelter:behaelter_id(name)')
      .eq('tenant_id', tenantId).eq('aktiv', true).is('storniert_am', null).gt('menge_liter', 0.01).order('name').order('id')),
    ladeBehaelter(supabase, tenantId, { alsZiel: true }),
    // alle-ausnahme: Stammdaten-Auswahl der aktiven Stoffe des Stoffkontos, wenige je Betrieb
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('kellermittel') as any).select('id, name, einheit').eq('tenant_id', tenantId).eq('aktiv', true).order('name').order('id').limit(200),
    // storno-sichtbar: stornierte Produktionen bleiben mit Kennzeichen in der Liste
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('produktionen') as any)
      .select('id, datum, art, erzeugnis, wein_liter, ziel_menge, notizen, erstellt_von_name, storniert_am, storno_grund, ziel:ziel_weinausbau_id(id, name), eingaenge:produktion_eingaenge(art, menge, einheit, bezeichnung, quelle:weinausbau_id(name))')
      .eq('tenant_id', tenantId).order('datum', { ascending: false }).order('id').limit(50),
  ])
  const chargen = ((chargenRes.data ?? []) as R[]).map(c => ({
    id: String(c.id), name: String(c.name ?? 'Charge'), menge: Number(c.menge_liter) || 0, weinart: c.weinart ?? null,
    erzeugnis: c.erzeugnis ?? null, gebinde: (c.behaelter as R | null)?.name ?? null,
  }))
  // Ziel-Gebinde: nutzbar und ohne aktive Charge (die neue Charge braucht ein leeres Gebinde)
  const belegt = new Set(((chargenRes.data ?? []) as R[]).map(c => c.behaelter_id).filter(Boolean))
  const leer = gebinde.filter(b => !belegt.has(b.id) && (Number(b.eigen_liter) || 0) + (Number(b.fremd_liter) || 0) <= 0.01)
    .map(b => ({ id: b.id, name: b.anzeigeName, volumen: b.volumen_liter ?? null }))
  const mittel = ((mittelRes.data ?? []) as R[]).map(m => ({ id: String(m.id), name: String(m.name), einheit: String(m.einheit) }))
  const liste = (prodRes.data ?? []) as R[]
  const erzeugnisText = (c: string) => KAT_ERZEUGNIS.find(k => k.code === c)?.bezeichnung ?? c

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-2">Produktion</span>
      </div>
      <div>
        <h1 className="text-xl font-semibold text-s112-text">Produktion</h1>
        <p className="text-sm text-s112-muted mt-1">
          Aus einer oder mehreren Chargen entsteht eine neue Charge mit eigenem Erzeugnis – Perlweinspritzer und
          Weinmischgetränk (weinhaltiges Getränk, mindestens 50 % Wein), Perlwein, Schaumwein/Sekt oder PetNat. Die Quellen
          buchen „Abgang durch Verarbeitung“, die neue Charge „Zugang durch Produktion“; Zutaten aus dem Stoffkonto werden
          dort als Verwendung gebucht.
        </p>
      </div>

      {darf ? (
        <ProduktionForm chargen={chargen} gebinde={leer} mittel={mittel} heute={wienHeute()} quelle={quelle ?? null}
          buchen={produktionBuchen} />
      ) : (
        <p className="card p-4 text-sm text-s112-muted">Nur lesend – für eine Produktion fehlt das Schreibrecht im Kellerbuch bzw. der Nur-Lesen-Modus ist aktiv.</p>
      )}

      <section className="card p-4">
        <h2 className="font-semibold text-s112-text text-sm mb-3">Produktionen</h2>
        {liste.length === 0 ? <p className="text-sm text-s112-muted">Noch keine Produktionen.</p> : (
          <ul className="divide-y divide-s112-line text-sm">
            {liste.map(p => {
              const ein = (p.eingaenge ?? []) as R[]
              return (
                <li key={p.id} className={`py-2 flex flex-wrap gap-x-4 gap-y-1 items-start ${p.storniert_am ? 'opacity-60' : ''}`}>
                  <span className="tabular-nums text-s112-muted w-24">{new Date(`${p.datum}T00:00:00`).toLocaleDateString('de-DE')}</span>
                  <span className="flex-1 min-w-[16rem]">
                    <span className="font-medium">{PRODUKTION_ART_LABEL[p.art as ProduktionArt] ?? p.art}</span>
                    {' → '}
                    {(p.ziel as R | null)?.id
                      ? <Link href={`/kellerbuch/weinausbau/${p.ziel.id}`} className="text-s112-blue-700 hover:underline">{p.ziel.name}</Link>
                      : '–'}
                    {' · '}{erzeugnisText(p.erzeugnis)} · {fmtNum(Number(p.ziel_menge), { max: 2 })} L
                    <span className="block text-xs text-s112-text-2">
                      {ein.map(e => e.art === 'wein'
                        ? `${(e.quelle as R | null)?.name ?? 'Charge'} ${fmtNum(Number(e.menge), { max: 2 })} L`
                        : `${e.bezeichnung ?? PRODUKTION_ZUTAT_LABEL[e.art] ?? e.art} ${fmtNum(Number(e.menge), { max: 3 })} ${e.einheit}`).join(', ')}
                    </span>
                    {p.storniert_am && <span className="block text-xs text-s112-err">Storniert: {p.storno_grund}</span>}
                  </span>
                  {darf && !p.storniert_am && (
                    <StornoButton action={produktionStornieren.bind(null, String(p.id))}
                      hinweis="Die Quell-Chargen bekommen ihre Menge zurück, die erzeugte Charge wird abgeschlossen. Nur möglich, solange die erzeugte Charge unverändert ist." />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
