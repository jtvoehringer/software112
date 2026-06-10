import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Kellerbuch – software:112' }
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

const TYP_ICONS: Record<string, string> = {
  stahltank: '🪣', holzfass: '🪵', betonei: '⚪', amphore: '🏺', sonstiges: '📦',
}

export default async function KellerbuchPage() {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const [{ data: behaelterRaw }, { data: weinausbauRaw }] = await Promise.all([
    (supabase.from('behaelter') as any)
      .select('id, name, typ, volumen_liter, standort, aktiv')
      .order('name'),
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, status, aktiv, behaelter_id, ist_eroeffnungsbestand')
      .order('jahrgang', { ascending: false }),
  ])

  const behaelter   = (behaelterRaw   ?? []) as R[]
  const weinausbau  = (weinausbauRaw  ?? []) as R[]

  // abfuellung = Wein hat Keller verlassen → gehört zur Warenwirtschaft
  // Alle aktiven Chargen (inkl. Eröffnungsbestand für Liter-Berechnung)
  const alleAktiven    = weinausbau.filter((w: R) => w.aktiv && w.status !== 'abgeschlossen' && w.status !== 'abfuellung')
  // Reguläre Chargen (ohne Eröffnungsbestand) für die Stats-Card
  const aktiveChargen  = alleAktiven.filter((w: R) => !w.ist_eroeffnungsbestand)
  const gesamtLiter    = alleAktiven.reduce((s: number, w: R) => s + (parseFloat(w.menge_liter) || 0), 0)

  // Chargen nach Behälter gruppieren (inkl. Eröffnungsbestand für konsistente Statusbars)
  const chargenByBehaelter = new Map<string, R[]>()
  const chargenOhneBehaelter: R[] = []

  for (const w of alleAktiven) {
    if (w.behaelter_id) {
      if (!chargenByBehaelter.has(w.behaelter_id)) chargenByBehaelter.set(w.behaelter_id, [])
      chargenByBehaelter.get(w.behaelter_id)!.push(w)
    } else if (!w.ist_eroeffnungsbestand) {
      // Eröffnungsbestand ohne Behälter ist ein Datenfehler – nicht als Warnung anzeigen
      chargenOhneBehaelter.push(w)
    }
  }

  // Liter pro Behälter (inkl. Eröffnungsbestand)
  const literByBehaelter = new Map<string, number>()
  for (const w of alleAktiven) {
    if (w.behaelter_id) {
      literByBehaelter.set(w.behaelter_id, (literByBehaelter.get(w.behaelter_id) ?? 0) + (parseFloat(w.menge_liter) || 0))
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kellerbuch</h1>
          <p className="text-sm text-s112-muted mt-0.5">Gebinde</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="card text-center p-4">
          <p className="text-3xl font-bold text-s112-teal">{behaelter.filter((b: R) => b.aktiv).length}</p>
          <p className="text-xs text-s112-muted mt-1">Aktive Behälter</p>
        </div>
        <div className="card text-center p-4">
          <p className="text-3xl font-bold text-s112-teal">{aktiveChargen.length}</p>
          <p className="text-xs text-s112-muted mt-1">Laufende Chargen</p>
        </div>
        <div className="card text-center p-4">
          <p className="text-3xl font-bold text-s112-teal">{gesamtLiter.toLocaleString('de-AT')}</p>
          <p className="text-xs text-s112-muted mt-1">Liter in Ausbau</p>
        </div>
      </div>

      {/* Behälter mit Chargen */}
      <div className="space-y-4">
        {behaelter.filter((b: R) => b.aktiv).map((b: R) => {
          const chargen = chargenByBehaelter.get(b.id) ?? []
          const literImBehaelter = literByBehaelter.get(b.id) ?? 0
          const kapazitaet = b.volumen_liter ? parseFloat(b.volumen_liter) : null
          const auslastung = kapazitaet && kapazitaet > 0 ? Math.min(100, (literImBehaelter / kapazitaet) * 100) : null

          return (
            <div key={b.id} className="card p-0 overflow-hidden">
              {/* Behälter-Header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-s112-bg border-b border-s112-border">
                <span className="text-xl">{TYP_ICONS[b.typ] ?? '📦'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800 text-sm">{b.name}</span>
                    {b.standort && <span className="text-xs text-s112-muted">{b.standort}</span>}
                    {kapazitaet && (
                      <span className="text-xs text-s112-muted">
                        {kapazitaet.toLocaleString('de-AT')} L Kapazität
                      </span>
                    )}
                  </div>
                  {auslastung !== null && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-1.5 max-w-40">
                        <div
                          className={`h-1.5 rounded-full ${auslastung > 90 ? 'bg-amber-500' : 'bg-s112-teal'}`}
                          style={{ width: `${auslastung}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-gray-600">
                        {literImBehaelter.toLocaleString('de-AT')} / {kapazitaet!.toLocaleString('de-AT')} L
                      </span>
                    </div>
                  )}
                  {!kapazitaet && literImBehaelter > 0 && (
                    <p className="text-xs text-gray-600 mt-0.5">{literImBehaelter.toLocaleString('de-AT')} L belegt</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Link href={`/kellerbuch/behaelter/${b.id}/bewegungen`}
                    className="text-xs text-s112-teal hover:underline whitespace-nowrap font-medium">
                    Bewegungen →
                  </Link>
                  {writeOk && (
                    <Link href={`/kellerbuch/behaelter/${b.id}`}
                      className="text-xs text-s112-muted hover:text-s112-teal">
                      Bearbeiten
                    </Link>
                  )}
                </div>
              </div>

              {/* Chargen im Behälter */}
              {chargen.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-s112-border/50">
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Charge</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Jg.</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Status</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Liter</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {chargen.map((w: R) => {
                      const st = STATUS_LABELS[w.status] ?? { label: w.status, color: 'bg-gray-100 text-gray-600' }
                      const menge = parseFloat(w.menge_liter) || 0
                      const istEB = w.ist_eroeffnungsbestand === true
                      return (
                        <tr key={w.id} className={`border-b border-s112-border/30 last:border-0 hover:bg-s112-bg/40 ${istEB ? 'opacity-75' : ''}`}>
                          <td className="px-4 py-2.5 font-medium text-gray-800">
                            {w.name}
                            {w.rebsorte && <span className="text-xs text-s112-muted ml-1">· {w.rebsorte}</span>}
                            {istEB && <span className="text-xs text-s112-muted ml-1 italic">(Eröffnungsbestand)</span>}
                          </td>
                          <td className="px-4 py-2.5 text-s112-muted text-xs">{w.jahrgang ?? '–'}</td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">
                            {menge > 0 ? menge.toLocaleString('de-AT') + ' L' : <span className="text-red-500">0 L</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {writeOk && menge > 0.01 && !istEB && (
                              <Link href={`/weinhandel/fuellungen/neu?charge=${w.id}`}
                                className="text-xs text-s112-teal border border-s112-teal/30 rounded-full px-2 py-0.5 hover:bg-s112-teal hover:text-white transition-colors whitespace-nowrap">
                                🍾 Abfüllen
                              </Link>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-3 text-xs text-s112-muted italic">Kein Wein in diesem Behälter</p>
              )}
            </div>
          )
        })}

        {/* Chargen ohne Behälter */}
        {chargenOhneBehaelter.length > 0 && (
          <div className="card p-0 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200">
              <span className="text-xl">⚠️</span>
              <span className="font-semibold text-amber-800 text-sm">Chargen ohne Behälterzuweisung</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {chargenOhneBehaelter.map((w: R) => {
                  const st = STATUS_LABELS[w.status] ?? { label: w.status, color: 'bg-gray-100 text-gray-600' }
                  return (
                    <tr key={w.id} className="border-b border-s112-border/30 last:border-0 hover:bg-s112-bg/40">
                      <td className="px-4 py-2.5 font-medium text-gray-800">{w.name}</td>
                      <td className="px-4 py-2.5 text-s112-muted text-xs">{w.jahrgang ?? '–'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">
                        {(parseFloat(w.menge_liter) || 0).toLocaleString('de-AT')} L
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link href={`/kellerbuch/weinausbau/${w.id}`}
                          className="text-xs text-s112-teal hover:underline">
                          Bearbeiten →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {behaelter.filter((b: R) => b.aktiv).length === 0 && (
          <div className="card text-center py-10">
            <p className="text-3xl mb-2">🪣</p>
            <p className="text-sm text-s112-muted">Noch keine Behälter angelegt</p>
            {writeOk && (
              <Link href="/kellerbuch/behaelter/neu"
                className="mt-3 inline-block text-xs text-s112-teal font-semibold hover:underline">
                + Ersten Behälter anlegen
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
