import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fmtLiter } from '@/lib/format'
import type { Metadata } from 'next'
import Link from 'next/link'
import PrintButton from './PrintButton'

export const metadata: Metadata = { title: 'Keller-Auswertungen – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const TYP_ICONS: Record<string, string> = {
  stahltank: '🪣', holzfass: '🪵', betonei: '⚪', amphore: '🏺', sonstiges: '📦',
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ernte:         { label: 'Ernte',         color: 'bg-yellow-100 text-yellow-700' },
  gaerung:       { label: 'Gärung',        color: 'bg-orange-100 text-orange-700' },
  ausbau:        { label: 'Ausbau',        color: 'bg-blue-100 text-blue-700' },
  abfuellung:    { label: 'Abfüllung',    color: 'bg-purple-100 text-purple-700' },
  abgeschlossen: { label: 'Abgeschlossen', color: 'bg-green-100 text-green-700' },
}

export default async function KellerAuswertungenPage() {
  const supabase = await createSupabaseServerClient()

  const thisYear = new Date().getFullYear()
  const jahresStart = `${thisYear}-01-01`

  const [
    { data: behaelterRaw },
    { data: chargenRaw },
    { data: behandlungenRaw },
    { data: umzuegeRaw },
    { data: fuellungenRaw },
  ] = await Promise.all([
    (supabase.from('behaelter') as any)
      .select('id, name, typ, volumen_liter, standort, aktiv')
      .eq('aktiv', true)
      .order('name'),
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, status, aktiv, behaelter_id, ist_eroeffnungsbestand')
      .order('jahrgang', { ascending: false }),
    (supabase.from('keller_behandlungen') as any)
      .select('id, datum, menge, einheit, behaelter_id, behaelter:behaelter_id(name), typ:typ_id(name)')
      .gte('datum', jahresStart)
      .order('datum', { ascending: false }),
    (supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, von_behaelter:von_behaelter_id(name), nach_behaelter:nach_behaelter_id(name)')
      .gte('datum', jahresStart)
      .not('zeilen_typ', 'eq', 'ziel')
      .order('datum', { ascending: false })
      .limit(100),
    (supabase.from('fuellungen') as any)
      .select('id, datum, name, anzahl_flaschen, menge_liter_gefuellt')
      .gte('datum', jahresStart)
      .order('datum', { ascending: false }),
  ])

  const behaelter    = (behaelterRaw    ?? []) as R[]
  const chargen      = (chargenRaw      ?? []) as R[]
  const behandlungen = (behandlungenRaw ?? []) as R[]
  const umzuege      = (umzuegeRaw      ?? []) as R[]
  const fuellungen   = (fuellungenRaw   ?? []) as R[]

  // abfuellung mit menge>0 = noch im Behälter (nur abgeschlossen ausschließen)
  const aktiveChargen = chargen.filter((c: R) => c.aktiv && c.status !== 'abgeschlossen')

  // Liter pro Behälter
  const literByBehaelter = new Map<string, number>()
  for (const c of aktiveChargen) {
    if (c.behaelter_id) {
      literByBehaelter.set(c.behaelter_id, (literByBehaelter.get(c.behaelter_id) ?? 0) + (parseFloat(c.menge_liter) || 0))
    }
  }

  // Gesamtliter + Kapazität
  const gesamtLiter     = aktiveChargen.reduce((s: number, c: R) => s + (parseFloat(c.menge_liter) || 0), 0)
  const gesamtKapazitaet = behaelter.reduce((s: number, b: R) => s + (parseFloat(b.volumen_liter) || 0), 0)
  const gesamtAuslastung = gesamtKapazitaet > 0 ? Math.min(100, (gesamtLiter / gesamtKapazitaet) * 100) : 0

  // Schwund gesamt (laufendes Jahr)
  const schwundGesamt = umzuege.reduce((s: number, u: R) => s + (parseFloat(u.schwund_liter) || 0), 0)

  // Abgefüllte Liter (laufendes Jahr)
  const abgefuelltLiter = fuellungen.reduce((s: number, f: R) => s + (parseFloat(f.menge_liter_gefuellt) || 0), 0)

  // Behandlungen nach Typ gruppieren
  const behandlungTypMap = new Map<string, number>()
  for (const b of behandlungen) {
    const typ = (b.typ as R | null)?.name ?? 'Unbekannt'
    behandlungTypMap.set(typ, (behandlungTypMap.get(typ) ?? 0) + 1)
  }

  return (
    <div className="max-w-5xl space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/reports" className="hover:text-s112-teal transition-colors">Reports</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Keller-Auswertungen</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Keller-Auswertungen</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-s112-muted">Jahrgang {thisYear}</span>
          <PrintButton />
        </div>
      </div>

      {/* KPI-Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card text-center p-4">
          <p className="text-2xl font-bold text-s112-teal">{gesamtLiter.toLocaleString('de-AT', { maximumFractionDigits: 0 })}</p>
          <p className="text-xs text-s112-muted mt-1">Liter im Ausbau</p>
          {gesamtKapazitaet > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">{gesamtAuslastung.toFixed(0)} % Auslastung</p>
          )}
        </div>
        <div className="card text-center p-4">
          <p className="text-2xl font-bold text-s112-teal">{aktiveChargen.filter((c: R) => !c.ist_eroeffnungsbestand).length}</p>
          <p className="text-xs text-s112-muted mt-1">Laufende Chargen</p>
        </div>
        <div className="card text-center p-4">
          <p className="text-2xl font-bold text-amber-600">{schwundGesamt.toLocaleString('de-AT', { maximumFractionDigits: 0 })}</p>
          <p className="text-xs text-s112-muted mt-1">Liter Schwund {thisYear}</p>
        </div>
        <div className="card text-center p-4">
          <p className="text-2xl font-bold text-purple-600">{abgefuelltLiter.toLocaleString('de-AT', { maximumFractionDigits: 0 })}</p>
          <p className="text-xs text-s112-muted mt-1">Liter abgefüllt {thisYear}</p>
        </div>
      </div>

      {/* Behälter-Auslastung */}
      <section>
        <h2 className="font-semibold text-gray-800 mb-3">Behälter-Auslastung</h2>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Behälter</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Standort</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Kapazität</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Inhalt</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 w-40">Auslastung</th>
              </tr>
            </thead>
            <tbody>
              {behaelter.map((b: R, i: number) => {
                const liter     = literByBehaelter.get(b.id) ?? 0
                const kapazitaet = parseFloat(b.volumen_liter) || null
                const pct       = kapazitaet && kapazitaet > 0 ? Math.min(100, (liter / kapazitaet) * 100) : null
                return (
                  <tr key={b.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      <Link href={`/kellerbuch/behaelter/${b.id}/bewegungen`}
                        className="flex items-center gap-2 hover:text-s112-teal">
                        <span>{TYP_ICONS[b.typ] ?? '📦'}</span>
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{b.standort ?? '–'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500 text-xs">
                      {kapazitaet ? fmtLiter(kapazitaet) : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-s112-teal">
                      {liter > 0 ? fmtLiter(liter) : <span className="text-gray-300">–</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {pct !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${pct > 95 ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-s112-teal'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-gray-500 w-9 text-right">{pct.toFixed(0)} %</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">–</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {behaelter.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-s112-muted italic">Keine aktiven Behälter</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Chargen-Status */}
      <section>
        <h2 className="font-semibold text-gray-800 mb-3">Chargen im Ausbau</h2>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Charge</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">JG</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Behälter</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Liter</th>
              </tr>
            </thead>
            <tbody>
              {aktiveChargen.filter((c: R) => !c.ist_eroeffnungsbestand).map((c: R, i: number) => {
                const st = STATUS_LABELS[c.status] ?? { label: c.status ?? '–', color: 'bg-gray-100 text-gray-600' }
                const bh = behaelter.find((b: R) => b.id === c.behaelter_id)
                return (
                  <tr key={c.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      <Link href={`/kellerbuch/weinausbau/${c.id}`} className="hover:text-s112-teal">
                        {c.name}
                        {c.rebsorte && <span className="text-xs text-s112-muted ml-1">· {c.rebsorte}</span>}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{c.jahrgang ?? '–'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 text-sm">
                      {bh ? (
                        <Link href={`/kellerbuch/behaelter/${bh.id}/bewegungen`} className="hover:text-s112-teal">
                          {TYP_ICONS[bh.typ] ?? '📦'} {bh.name}
                        </Link>
                      ) : <span className="text-amber-600 text-xs">⚠️ kein Behälter</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-s112-teal">
                      {fmtLiter(parseFloat(c.menge_liter) || 0)}
                    </td>
                  </tr>
                )
              })}
              {aktiveChargen.filter((c: R) => !c.ist_eroeffnungsbestand).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-s112-muted italic">Keine laufenden Chargen</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Kellerbehandlungen laufendes Jahr */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Kellerbehandlungen {thisYear}</h2>
          <span className="text-xs text-s112-muted">{behandlungen.length} Einträge</span>
        </div>

        {behandlungTypMap.size > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {Array.from(behandlungTypMap.entries()).sort((a, b) => b[1] - a[1]).map(([typ, anzahl]) => (
              <span key={typ} className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-100">
                🧪 {typ}
                <span className="font-semibold ml-0.5">{anzahl}×</span>
              </span>
            ))}
          </div>
        )}

        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Behandlung</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Behälter</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Menge</th>
              </tr>
            </thead>
            <tbody>
              {behandlungen.map((b: R, i: number) => (
                <tr key={b.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                    {new Date(b.datum).toLocaleDateString('de-AT')}
                  </td>
                  <td className="px-4 py-2.5 text-gray-800">
                    🧪 {(b.typ as R | null)?.name ?? '–'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {(b.behaelter as R | null)?.name ?? '–'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                    {b.menge && b.einheit
                      ? `${parseFloat(b.menge).toLocaleString('de-AT')} ${b.einheit}`
                      : '–'}
                  </td>
                </tr>
              ))}
              {behandlungen.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-s112-muted italic">Keine Kellerbehandlungen für {thisYear} erfasst</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Umzüge / Filtrationen laufendes Jahr */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Umzüge & Filtrationen {thisYear}</h2>
          <span className="text-xs text-s112-muted">{umzuege.length} Einträge</span>
        </div>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Von</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Nach</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Brutto</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Schwund</th>
              </tr>
            </thead>
            <tbody>
              {umzuege.map((u: R, i: number) => {
                const isFilt  = u.umzug_typ === 'filtration'
                const brutto  = parseFloat(u.brutto_liter) || parseFloat(u.menge_liter) || 0
                const schwund = parseFloat(u.schwund_liter) || 0
                return (
                  <tr key={u.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                      {new Date(u.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {isFilt ? '🔽' : '⬇️'} {(u.von_behaelter as R | null)?.name ?? '–'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {isFilt ? '🔼' : '⬆️'} {(u.nach_behaelter as R | null)?.name ?? '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-700">
                      {brutto > 0 ? fmtLiter(brutto) : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-600">
                      {schwund > 0 ? fmtLiter(schwund) : '–'}
                    </td>
                  </tr>
                )
              })}
              {umzuege.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-s112-muted italic">Keine Umzüge für {thisYear} erfasst</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
