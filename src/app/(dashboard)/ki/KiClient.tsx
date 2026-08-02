'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Bot } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const BEISPIELE = [
  'Welche Gastro-Kunden haben wir in Wien?',
  'Zeig mir alle Rotwein-Füllungen mit mehr als 200 Flaschen Lagerbestand',
  'Wer hat noch kein Stammkunde-Status?',
  'Welche Behandlungen haben wir heuer mit Kupfer gemacht?',
  'Zeig mir offene Pipeline-Einträge im Stadium Angebot',
  'Welche Kunden kommen aus Deutschland?',
  'Weinausbau mit mehr als 1000 Liter aktuell im Keller',
]

const LIMIT_MAP: Record<string, number> = { basic: 100, standard: 200, unlimited: 99999 }

interface Props { aktiv: boolean; paket: string; verbraucht: number }

export default function KiClient({ aktiv, paket, verbraucht }: Props) {
  const [frage, setFrage]       = useState('')
  const [laden, setLaden]       = useState(false)
  const [ergebnis, setErgebnis] = useState<R | null>(null)
  const [fehler, setFehler]     = useState<string | null>(null)
  const limit = LIMIT_MAP[paket] ?? 100

  async function abfragen(e: React.FormEvent | null, beispiel?: string) {
    if (e) e.preventDefault()
    const q = beispiel ?? frage
    if (!q.trim()) return
    if (beispiel) setFrage(beispiel)
    setLaden(true); setFehler(null); setErgebnis(null)
    try {
      const res = await fetch('/api/ki-abfrage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frage: q }),
      })
      const data = await res.json()
      if (!res.ok || data.fehler) { setFehler(data.fehler ?? 'Fehler'); setLaden(false); return }
      setErgebnis(data)
    } catch (err) { setFehler(String(err)) }
    finally { setLaden(false) }
  }

  if (!aktiv) return (
    <div className="p-8 max-w-2xl mx-auto text-center py-20">
      <Bot className="w-12 h-12 text-s112-muted mx-auto mb-4" />
      <h1 className="text-2xl font-bold text-gray-800 mb-2">KI-Modul nicht aktiv</h1>
      <p className="text-s112-muted mb-4">Das Modul „Frag dein Weingut" ist für diesen Betrieb noch nicht freigeschaltet.</p>
      <Link href="/admin/mandanten" className="text-s112-teal hover:underline text-sm">Zum Admin-Bereich</Link>
    </div>
  )

  const cols = (ergebnis?.ergebnisse?.length ?? 0) > 0 ? Object.keys(ergebnis!.ergebnisse[0]) : []

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Bot className="w-6 h-6" /> Frag dein Weingut</h1>
          <p className="text-sm text-s112-muted mt-1">Stelle Fragen über deine Betriebsdaten in natürlicher Sprache</p>
        </div>
        <div className="text-right text-xs text-s112-muted">
          <p className="font-medium text-gray-700 capitalize">{paket === 'unlimited' ? 'Unlimited' : paket.charAt(0).toUpperCase() + paket.slice(1)}-Paket</p>
          <p>{paket === 'unlimited' ? `${verbraucht} Abfragen` : `${verbraucht} / ${limit} Abfragen`}</p>
          {paket !== 'unlimited' && (
            <div className="w-24 bg-gray-100 rounded-full h-1 mt-1 ml-auto">
              <div className="bg-s112-teal h-1 rounded-full" style={{ width: `${Math.min(100,(verbraucht/limit)*100)}%` }} />
            </div>
          )}
        </div>
      </div>

      {/* Eingabe */}
      <form onSubmit={abfragen} className="mb-6">
        <div className="flex gap-3">
          <input
            value={frage}
            onChange={e => setFrage(e.target.value)}
            placeholder="z.B. Welche Gastronomie-Kunden haben wir in der Steiermark?"
            className="flex-1 border border-s112-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 bg-white"
            disabled={laden}
          />
          <button type="submit" disabled={laden || !frage.trim()}
            className="bg-s112-teal text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40 flex items-center gap-2">
            {laden ? (
              <>Analysiere…</>
            ) : (
              <>Fragen</>
            )}
          </button>
        </div>
      </form>

      {/* Beispiele */}
      {!ergebnis && !laden && (
        <div className="mb-8">
          <p className="text-xs font-medium text-s112-muted uppercase tracking-wide mb-3">Beispiel-Fragen</p>
          <div className="flex flex-wrap gap-2">
            {BEISPIELE.map(b => (
              <button key={b} onClick={() => abfragen(null, b)}
                className="text-xs bg-white border border-s112-border text-gray-600 px-3 py-1.5 rounded-full hover:bg-s112-bg hover:text-s112-teal transition-colors">
                {b}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fehler */}
      {fehler && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-red-700 font-medium">Fehler</p>
          <p className="text-sm text-red-600 mt-1">{fehler}</p>
        </div>
      )}

      {/* Ergebnis */}
      {ergebnis && (
        <div className="space-y-4">
          {/* Zusammenfassung */}
          <div className="bg-s112-teal/5 border border-s112-teal/20 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <Bot className="w-5 h-5 text-s112-teal flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-800">{ergebnis.zusammenfassung}</p>
                {ergebnis.empfehlung && (
                  <p className="text-xs text-s112-muted mt-1 italic">{ergebnis.empfehlung}</p>
                )}
                <p className="text-xs text-s112-muted mt-2">
                  {ergebnis.anzahl} Ergebnis{ergebnis.anzahl !== 1 ? 'se' : ''} · Abfrage {ergebnis.verbraucht}/{paket === 'unlimited' ? '∞' : limit}
                </p>
              </div>
            </div>
          </div>

          {/* Tabelle */}
          {ergebnis.ergebnisse?.length > 0 ? (
            <div className="bg-white rounded-2xl border border-s112-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-s112-bg text-xs text-s112-muted uppercase tracking-wide">
                  <tr>
                    {cols.map((col: string) => (
                      <th key={col} className="px-4 py-3 text-left whitespace-nowrap">
                        {col.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-s112-border/40">
                  {ergebnis.ergebnisse.map((row: R, i: number) => (
                    <tr key={i} className="hover:bg-s112-bg/30">
                      {cols.map((col: string) => {
                        const val = row[col]
                        const display = val === null || val === undefined ? '–'
                          : typeof val === 'boolean' ? (val ? 'Ja' : 'Nein')
                          : typeof val === 'object' ? (val.vorname ? `${val.vorname} ${val.nachname}` : val.name ?? JSON.stringify(val))
                          : String(val)
                        return (
                          <td key={col} className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                            {display}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-s112-muted text-sm">
              Keine Ergebnisse für diese Abfrage gefunden.
            </div>
          )}

          <button onClick={() => {
            if (!ergebnis?.ergebnisse?.length) return
            const hdrs = Object.keys(ergebnis.ergebnisse[0]).filter((k: string) => !['id','tenant_id'].includes(k))
            const rows = ergebnis.ergebnisse.map((r: Record<string,unknown>) =>
              hdrs.map((h: string) => {
                const v = r[h]; if (v == null) return ''
                if (typeof v === 'object') return Object.values(v as object).filter(Boolean).join(' ')
                return String(v)
              })
            )
            const csv = [hdrs.join(';'), ...rows.map((r: string[]) => r.map((cc: string) => `"${cc.replace(/"/g,'""')}"`).join(';'))].join('\n')
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
            a.download = `ki-abfrage-${new Date().toISOString().slice(0,10)}.csv`; a.click()
          }} className="text-xs border border-s112-border text-gray-600 px-3 py-1.5 rounded-lg hover:bg-s112-bg">
            CSV / Excel
          </button>

          {/* Neue Frage */}
          <button onClick={() => { setErgebnis(null); setFrage('') }}
            className="text-sm text-s112-teal hover:underline">
            Neue Frage stellen
          </button>
        </div>
      )}
    </div>
  )
}
