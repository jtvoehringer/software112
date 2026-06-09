import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import WeinausbauForm from '@/components/kellerbuch/WeinausbauForm'
import { updateWeinausbau } from '../../actions'

export const metadata: Metadata = { title: 'Charge bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ernte:        { label: 'Ernte',        color: 'bg-yellow-100 text-yellow-700' },
  gaerung:      { label: 'Gärung',       color: 'bg-orange-100 text-orange-700' },
  ausbau:       { label: 'Ausbau',       color: 'bg-blue-100 text-blue-700' },
  abfuellung:   { label: 'Abfüllung',   color: 'bg-purple-100 text-purple-700' },
  abgeschlossen:{ label: 'Abgeschlossen',color: 'bg-green-100 text-green-700' },
}

export default async function WeinausbauDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const [
    { data: rows },
    { data: wgRaw },
    { data: bhRaw },
    { data: umzuegeRaw },
    { data: fuellungenRaw },
    { data: verkaufRaw },
  ] = await Promise.all([
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, anfangsbestand_liter, status, qualitaetsstufe, notizen, aktiv, behaelter:behaelter_id(name)')
      .eq('id', id).limit(1),
    (supabase.from('weingarten') as any).select('id, name').eq('aktiv', true).order('name'),
    (supabase.from('behaelter') as any).select('id, name').eq('aktiv', true).order('name'),
    // Umzüge aus dieser Charge heraus
    (supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, schwund_liter, nach_behaelter:nach_behaelter_id(name), notizen')
      .eq('von_weinausbau_id', id)
      .order('datum', { ascending: true }),
    // Abfüllungen aus dieser Charge
    (supabase.from('fuellungen') as any)
      .select('id, datum, name, anzahl_flaschen, menge_liter_gefuellt, flaschengroesse_ml, pruefnummer, chargennummer')
      .eq('weinausbau_id', id)
      .order('datum', { ascending: true }),
    // Tank-Verkäufe aus dieser Charge
    (supabase.from('verkauf_positionen') as any)
      .select('id, menge, einheit, verkaufsposten:verkaufsposten_id(datum, storniert)')
      .eq('weinausbau_id', id)
      .eq('typ', 'tank')
      .order('id', { ascending: true }),
  ])

  type WeinausbauRow = {
    id: string; name: string; jahrgang: number | null; rebsorte: string | null
    weingarten_id: string | null; behaelter_id: string | null; menge_liter: number | null
    anfangsbestand_liter: number | null; status: string; qualitaetsstufe: string | null
    notizen: string | null; aktiv: boolean; behaelter: { name: string } | null
  }
  type NameRow = { id: string; name: string }

  const weinausbau = (((rows ?? []) as R[])[0] ?? null) as WeinausbauRow | null
  if (!weinausbau) notFound()

  const weingaerten = (wgRaw ?? []) as NameRow[]
  const behaelter   = (bhRaw  ?? []) as NameRow[]

  // Bewegungsbuch aufbauen
  const anfangsbestand = parseFloat(String(weinausbau.anfangsbestand_liter ?? weinausbau.menge_liter ?? 0)) || 0
  const aktuell        = parseFloat(String(weinausbau.menge_liter ?? 0)) || 0

  type Bewegung = {
    datum: string
    art: 'umziehen' | 'abfuellung' | 'verkauf'
    beschreibung: string
    menge: number     // positiv = Zugang, negativ = Abgang
    extra?: string
  }

  const bewegungen: Bewegung[] = []

  for (const u of ((umzuegeRaw ?? []) as R[])) {
    const abgang = parseFloat(u.menge_liter) || 0
    bewegungen.push({
      datum: u.datum,
      art: 'umziehen',
      beschreibung: `Umziehen → ${(u.nach_behaelter as R | null)?.name ?? '?'}${u.schwund_liter > 0 ? ` (Schwund: ${u.schwund_liter} L)` : ''}`,
      menge: -(abgang + (parseFloat(u.schwund_liter) || 0)),
      extra: u.notizen ?? undefined,
    })
  }

  for (const f of ((fuellungenRaw ?? []) as R[])) {
    const liter = parseFloat(f.menge_liter_gefuellt) || (parseInt(f.anzahl_flaschen) * parseInt(f.flaschengroesse_ml) / 1000)
    bewegungen.push({
      datum: f.datum,
      art: 'abfuellung',
      beschreibung: `Abfüllung: ${f.name}${f.pruefnummer ? ` · Prüfnr. ${f.pruefnummer}` : ''}${f.chargennummer ? ` · Ch. ${f.chargennummer}` : ''}`,
      menge: -liter,
      extra: `${parseInt(f.anzahl_flaschen).toLocaleString('de-AT')} Fl. à ${parseInt(f.flaschengroesse_ml)} ml`,
    })
  }

  for (const v of ((verkaufRaw ?? []) as R[])) {
    const vp = v.verkaufsposten as R | null
    if (vp?.storniert) continue
    const liter = parseFloat(v.menge) || 0
    bewegungen.push({
      datum: vp?.datum ?? '',
      art: 'verkauf',
      beschreibung: `Tank-Verkauf`,
      menge: -liter,
    })
  }

  // Nach Datum sortieren
  bewegungen.sort((a, b) => a.datum.localeCompare(b.datum))

  // Laufendes Saldo berechnen
  let saldo = anfangsbestand
  const bewegungenMitSaldo = bewegungen.map(bew => {
    saldo += bew.menge
    return { ...bew, saldo }
  })

  const st = STATUS_LABELS[weinausbau.status] ?? { label: weinausbau.status, color: 'bg-gray-100 text-gray-600' }

  return (
    <div className="max-w-4xl space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{weinausbau.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{weinausbau.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
            {weinausbau.jahrgang && <span className="text-xs text-s112-muted">Jahrgang {weinausbau.jahrgang}</span>}
            {weinausbau.behaelter && <span className="text-xs text-s112-muted">in {weinausbau.behaelter.name}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold text-s112-teal tabular-nums">{aktuell.toLocaleString('de-AT')} L</p>
          <p className="text-xs text-s112-muted mt-0.5">verfügbarer Bestand</p>
          {writeOk && aktuell > 0.01 && (
            <Link href={`/weinhandel/fuellungen/neu?charge=${weinausbau.id}`}
              className="mt-2 inline-block text-xs bg-s112-teal text-white px-3 py-1 rounded-lg hover:bg-opacity-90 transition-colors">
              🍾 Abfüllen
            </Link>
          )}
        </div>
      </div>

      {/* Bewegungsbuch */}
      <section>
        <h2 className="font-semibold text-gray-800 mb-3">Bewegungsbuch</h2>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Vorgang</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Menge</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {/* Anfangsbestand */}
              <tr className="border-b border-s112-border/40 bg-green-50/50">
                <td className="px-4 py-2.5 text-xs text-gray-500">–</td>
                <td className="px-4 py-2.5 font-medium text-gray-700">Anfangsbestand</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-green-700 font-semibold">
                  +{anfangsbestand.toLocaleString('de-AT')} L
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800">
                  {anfangsbestand.toLocaleString('de-AT')} L
                </td>
              </tr>

              {bewegungenMitSaldo.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-xs text-s112-muted italic">
                    Noch keine Bewegungen erfasst
                  </td>
                </tr>
              )}

              {bewegungenMitSaldo.map((bew, i) => {
                const artIcon = bew.art === 'umziehen' ? '↔️' : bew.art === 'abfuellung' ? '🍾' : '💰'
                const istAbgang = bew.menge < 0
                return (
                  <tr key={i} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {bew.datum ? new Date(bew.datum).toLocaleDateString('de-AT') : '–'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-start gap-1.5">
                        <span>{artIcon}</span>
                        <div>
                          <p className="text-gray-700">{bew.beschreibung}</p>
                          {bew.extra && <p className="text-xs text-s112-muted">{bew.extra}</p>}
                        </div>
                      </div>
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${istAbgang ? 'text-red-600' : 'text-green-600'}`}>
                      {istAbgang ? '' : '+'}{bew.menge.toLocaleString('de-AT')} L
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                      {bew.saldo.toLocaleString('de-AT')} L
                    </td>
                  </tr>
                )
              })}

              {/* Saldo-Zeile */}
              <tr className="border-t-2 border-s112-teal/30 bg-s112-teal/5">
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-gray-700 text-sm">
                  Aktueller Bestand
                </td>
                <td className="px-4 py-2.5 text-right" />
                <td className="px-4 py-2.5 text-right tabular-nums font-bold text-s112-teal text-base">
                  {aktuell.toLocaleString('de-AT')} L
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Edit-Formular */}
      {writeOk && (
        <section>
          <h2 className="font-semibold text-gray-800 mb-3">Charge bearbeiten</h2>
          <WeinausbauForm
            weinausbau={weinausbau}
            weingaerten={weingaerten}
            behaelter={behaelter}
            action={updateWeinausbau.bind(null, id)}
          />
        </section>
      )}
    </div>
  )
}
