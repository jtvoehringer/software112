'use client'
import Link from 'next/link'
import { exportCSV } from '@/lib/utils/csv'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const TYP_ICONS: Record<string, string> = {
  lagertank: '🪣', immervolltank: '🪣', stahltank: '🪣', holzfass: '🪵', betonei: '⚪', amphore: '🏺', sonstiges: '📦',
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ernte:         { label: 'Ernte',         color: 'bg-yellow-100 text-yellow-700' },
  gaerung:       { label: 'Gärung',        color: 'bg-orange-100 text-orange-700' },
  ausbau:        { label: 'Ausbau',        color: 'bg-blue-100 text-blue-700' },
  abfuellung:    { label: 'Abfüllung',     color: 'bg-purple-100 text-purple-700' },
  abgeschlossen: { label: 'Abgeschlossen', color: 'bg-green-100 text-green-700' },
}

function fmtLiter(n: number) {
  return n.toLocaleString('de-AT', { maximumFractionDigits: 0 }) + ' L'
}

interface Props {
  behaelter:     R[]
  aktiveChargen: R[]
  behandlungen:  R[]
  umzuege:       R[]
  literByBehaelter: Record<string, number>
  gesamtLiter:      number
  gesamtKapazitaet: number
  gesamtAuslastung: number
  schwundGesamt:    number
  abgefuelltLiter:  number
  behandlungTypMap: [string, number][]
  thisYear:         number
}

function CsvBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs border border-s112-border text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-s112-bg transition-colors print:hidden"
    >
      ↓ CSV
    </button>
  )
}

export default function KellerAuswertungenClient({
  behaelter, aktiveChargen, behandlungen, umzuege,
  literByBehaelter, gesamtLiter, gesamtKapazitaet, gesamtAuslastung,
  schwundGesamt, abgefuelltLiter, behandlungTypMap, thisYear,
}: Props) {

  // ── CSV-Exporter ──────────────────────────────────────────────────────────
  function exportBehaelter() {
    const rows = behaelter.map(b => {
      const liter      = literByBehaelter[b.id] ?? 0
      const kapazitaet = parseFloat(b.volumen_liter) || null
      const pct        = kapazitaet && kapazitaet > 0 ? Math.min(100, (liter / kapazitaet) * 100) : null
      return {
        name:       b.name,
        typ:        b.typ ?? '',
        standort:   b.standort ?? '',
        kapazitaet: kapazitaet ?? '',
        inhalt:     liter,
        auslastung: pct !== null ? pct.toFixed(1).replace('.', ',') : '',
      }
    })
    exportCSV(rows, [
      { key: 'name',       header: 'Behälter' },
      { key: 'typ',        header: 'Typ' },
      { key: 'standort',   header: 'Standort' },
      { key: 'kapazitaet', header: 'Kapazität (L)' },
      { key: 'inhalt',     header: 'Inhalt (L)' },
      { key: 'auslastung', header: 'Auslastung (%)' },
    ], `behaelter_auslastung_${thisYear}.csv`)
  }

  function exportChargen() {
    const rows = aktiveChargen
      .filter(c => !c.ist_eroeffnungsbestand)
      .map(c => {
        const bh = behaelter.find(b => b.id === c.behaelter_id)
        const st = STATUS_LABELS[c.status]?.label ?? c.status ?? ''
        return {
          name:      c.name,
          rebsorte:  c.rebsorte ?? '',
          jahrgang:  c.jahrgang ?? '',
          status:    st,
          behaelter: bh?.name ?? '',
          liter:     parseFloat(c.menge_liter) || 0,
        }
      })
    exportCSV(rows, [
      { key: 'name',      header: 'Charge' },
      { key: 'rebsorte',  header: 'Rebsorte' },
      { key: 'jahrgang',  header: 'Jahrgang' },
      { key: 'status',    header: 'Status' },
      { key: 'behaelter', header: 'Behälter' },
      { key: 'liter',     header: 'Liter' },
    ], `chargen_ausbau_${thisYear}.csv`)
  }

  function exportBehandlungen() {
    const rows = behandlungen.map(b => ({
      datum:     new Date(b.datum).toLocaleDateString('de-AT'),
      typ:       (b.typ as R | null)?.name ?? '',
      behaelter: (b.behaelter as R | null)?.name ?? '',
      menge:     b.menge != null ? parseFloat(b.menge) : '',
      einheit:   b.einheit ?? '',
    }))
    exportCSV(rows, [
      { key: 'datum',     header: 'Datum' },
      { key: 'typ',       header: 'Behandlung' },
      { key: 'behaelter', header: 'Behälter' },
      { key: 'menge',     header: 'Menge' },
      { key: 'einheit',   header: 'Einheit' },
    ], `kellerbehandlungen_${thisYear}.csv`)
  }

  function exportUmzuege() {
    const rows = umzuege.map(u => ({
      datum:   new Date(u.datum).toLocaleDateString('de-AT'),
      typ:     u.umzug_typ ?? '',
      von:     (u.von_behaelter as R | null)?.name ?? '',
      nach:    (u.nach_behaelter as R | null)?.name ?? '',
      brutto:  parseFloat(u.brutto_liter) || parseFloat(u.menge_liter) || 0,
      schwund: parseFloat(u.schwund_liter) || 0,
    }))
    exportCSV(rows, [
      { key: 'datum',   header: 'Datum' },
      { key: 'typ',     header: 'Typ' },
      { key: 'von',     header: 'Von Behälter' },
      { key: 'nach',    header: 'Nach Behälter' },
      { key: 'brutto',  header: 'Brutto (L)' },
      { key: 'schwund', header: 'Schwund (L)' },
    ], `umzuege_${thisYear}.csv`)
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
        <div className="flex items-center gap-3 print:hidden">
          <span className="text-sm text-s112-muted">Jahrgang {thisYear}</span>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 border border-s112-border text-gray-600 px-3 py-2 rounded-xl text-sm hover:bg-s112-bg transition-colors"
          >
            🖨 Drucken
          </button>
        </div>
      </div>

      {/* KPI-Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card text-center p-4">
          <p className="text-2xl font-bold text-s112-teal">{gesamtLiter.toLocaleString('de-AT', { maximumFractionDigits: 0 })}</p>
          <p className="text-xs text-s112-muted mt-1">Liter im Ausbau</p>
          {gesamtKapazitaet > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">{Math.round(gesamtAuslastung)} % Auslastung</p>
          )}
        </div>
        <div className="card text-center p-4">
          <p className="text-2xl font-bold text-s112-teal">{aktiveChargen.filter(c => !c.ist_eroeffnungsbestand).length}</p>
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Behälter-Auslastung</h2>
          <CsvBtn onClick={exportBehaelter} />
        </div>
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
              {behaelter.map((b, i) => {
                const liter      = literByBehaelter[b.id] ?? 0
                const kapazitaet = parseFloat(b.volumen_liter) || null
                const pct        = kapazitaet && kapazitaet > 0 ? Math.min(100, (liter / kapazitaet) * 100) : null
                return (
                  <tr key={b.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      <Link href={`/kellerbuch/behaelter/${b.id}/bewegungen`} className="flex items-center gap-2 hover:text-s112-teal">
                        <span>{TYP_ICONS[b.typ] ?? '📦'}</span>{b.name}
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
                          <span className="text-xs tabular-nums text-gray-500 w-9 text-right">{Math.round(pct)} %</span>
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

      {/* Chargen im Ausbau */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Chargen im Ausbau</h2>
          <CsvBtn onClick={exportChargen} />
        </div>
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
              {aktiveChargen.filter(c => !c.ist_eroeffnungsbestand).map((c, i) => {
                const st = STATUS_LABELS[c.status] ?? { label: c.status ?? '–', color: 'bg-gray-100 text-gray-600' }
                const bh = behaelter.find(b => b.id === c.behaelter_id)
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
              {aktiveChargen.filter(c => !c.ist_eroeffnungsbestand).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-s112-muted italic">Keine laufenden Chargen</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Kellerbehandlungen */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-gray-800">Kellerbehandlungen {thisYear}</h2>
            <span className="text-xs text-s112-muted">{behandlungen.length} Einträge</span>
          </div>
          <CsvBtn onClick={exportBehandlungen} />
        </div>

        {behandlungTypMap.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {behandlungTypMap.sort((a, b) => b[1] - a[1]).map(([typ, anzahl]) => (
              <span key={typ} className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-100">
                🧪 {typ}<span className="font-semibold ml-0.5">{anzahl}×</span>
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
              {behandlungen.map((b, i) => (
                <tr key={b.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                    {new Date(b.datum).toLocaleDateString('de-AT')}
                  </td>
                  <td className="px-4 py-2.5 text-gray-800">🧪 {(b.typ as R | null)?.name ?? '–'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{(b.behaelter as R | null)?.name ?? '–'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                    {b.menge && b.einheit ? `${parseFloat(b.menge).toLocaleString('de-AT')} ${b.einheit}` : '–'}
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

      {/* Umzüge & Filtrationen */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-gray-800">Umzüge & Filtrationen {thisYear}</h2>
            <span className="text-xs text-s112-muted">{umzuege.length} Einträge</span>
          </div>
          <CsvBtn onClick={exportUmzuege} />
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
              {umzuege.map((u, i) => {
                const isFilt    = u.umzug_typ === 'filtration'
                const isSchwund = u.umzug_typ === 'schwund'
                const brutto    = parseFloat(u.brutto_liter) || parseFloat(u.menge_liter) || 0
                const schwund   = parseFloat(u.schwund_liter) || 0
                const vonName   = isSchwund
                  ? ((u.von_weinausbau as R | null)?.name ?? (u.von_behaelter as R | null)?.name ?? '–')
                  : (u.von_behaelter as R | null)?.name ?? '–'
                const nachName  = isSchwund
                  ? 'Schwund / Verlust'
                  : (u.nach_behaelter as R | null)?.name ?? '–'
                return (
                  <tr key={u.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                      {new Date(u.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {isSchwund ? '💧' : isFilt ? '🔽' : '⬇️'} {vonName}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {isSchwund ? '💧' : isFilt ? '🔼' : '⬆️'} {nachName}
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
