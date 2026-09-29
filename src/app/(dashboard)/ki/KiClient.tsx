'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { Bot, ExternalLink } from 'lucide-react'
import { exportCSV } from '@/lib/utils/csv'
import { csvDateiname } from '@/lib/csv'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const BEISPIELE = [
  'Welche Gastro-Kunden haben wir in Wien?',
  'Zeig mir alle Rotwein-Füllungen mit mehr als 200 Flaschen Lagerbestand',
  'Wer hat noch kein Stammkunde-Status?',
  'Welche Behandlungen haben wir heuer mit Kupfer gemacht?',
  'Zeig mir offene Pipeline-Einträge im Stadium Angebot',
  'Welche Kunden kommen aus Deutschland?',
  'Wie viel Zierfandler mit Jahrgang 2026 liegt aktuell im Keller?',
  'Wie viele Flaschen habe ich dieses Jahr insgesamt verkauft?',
]

// Paketmodell 2.9.2026 (Basis 50 / Standard 100 / Premium unbegrenzt) - muss
// mit limit_map in check_und_increment_ki_abfrage (Migration 194) und kiLimit
// in lib/pakete.ts übereinstimmen.
const LIMIT_MAP: Record<string, number> = { basic: 50, standard: 100, unlimited: 99999 }

// Formatiert einen Zellenwert für Tabelle und Gesamt-Zusammenfassung einheitlich.
function formatWert(val: unknown): string {
  if (val === null || val === undefined) return '–'
  if (typeof val === 'boolean') return val ? 'Ja' : 'Nein'
  if (typeof val === 'object') {
    const o = val as R
    return o.vorname ? `${o.vorname} ${o.nachname}` : o.name ?? JSON.stringify(o)
  }
  return String(val)
}

// ── Verlinkung der Ergebnisse (Rückmeldung 18.9.2026) ────────────────────────
// Die KI liefert laut Prompt zu jeder Listen-Zeile die IDs der Datensätze als
// Spalten "<tabelle>_id" (Haupt-Entität zuerst). Diese Spalten werden nicht
// angezeigt, sondern in Links übersetzt: die erste bekannte ID macht die ganze
// Zeile anklickbar, weitere erscheinen als kleine Chips am Zeilenende.
const LINK_ZIELE: { spalte: string; label: string; pfad: (id: string) => string }[] = [
  { spalte: 'kontakt_id',          label: 'Kontakt',        pfad: id => `/crm/kontakte/${id}` },
  { spalte: 'firma_id',            label: 'Firma',          pfad: id => `/crm/firmen/${id}` },
  { spalte: 'weinausbau_id',       label: 'Charge',         pfad: id => `/kellerbuch/weinausbau/${id}` },
  { spalte: 'fuellung_id',         label: 'Füllung',        pfad: id => `/weinhandel/fuellungen/${id}/edit` },
  { spalte: 'verkaufsposten_id',   label: 'Verkauf',        pfad: id => `/weinhandel/verkauf/${id}` },
  { spalte: 'verkauf_id',          label: 'Verkauf',        pfad: id => `/weinhandel/verkauf/${id}` },
  { spalte: 'behaelter_id',        label: 'Behälter',       pfad: id => `/kellerbuch/behaelter/${id}` },
  { spalte: 'weingarten_id',       label: 'Ried',           pfad: id => `/weingarten/${id}` },
  { spalte: 'behandlung_id',       label: 'Behandlung',     pfad: id => `/behandlungen/${id}/edit` },
  { spalte: 'zukauf_posten_id',    label: 'Zukauf',         pfad: id => `/weinhandel/zukauf/${id}/edit` },
  { spalte: 'zukauf_id',           label: 'Zukauf',         pfad: id => `/weinhandel/zukauf/${id}/edit` },
  { spalte: 'exportauftrag_id',    label: 'Exportauftrag',  pfad: id => `/weinexport/${id}` },
  { spalte: 'dac_antrag_id',       label: 'DAC-Antrag',     pfad: id => `/dac/${id}` },
  { spalte: 'lage_id',             label: 'Lage',           pfad: id => `/lagen/${id}` },
  { spalte: 'ama_erntemeldung_id', label: 'Erntemeldung',   pfad: id => `/erntemeldung/${id}` },
  { spalte: 'keller_umzug_id',     label: 'Umzug',          pfad: id => `/kellerbuch/umzug/${id}/edit` },
  { spalte: 'kellerplan_id',       label: 'Kellerplan',     pfad: id => `/kellerbuch/kellerplan/${id}` },
]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const istIdSpalte = (c: string) => c === 'id' || c === 'tenant_id' || /_id$/i.test(c)

/** Sprungziele einer Zeile in der Reihenfolge der Spalten (erste = Hauptziel). */
function zeilenZiele(row: R, cols: string[]) {
  const ziele: { label: string; href: string }[] = []
  for (const c of cols) {
    const z = LINK_ZIELE.find(l => l.spalte === c.toLowerCase())
    const v = row[c]
    if (z && typeof v === 'string' && UUID.test(v)) ziele.push({ label: z.label, href: z.pfad(v) })
  }
  return ziele
}

interface Props { aktiv: boolean; paket: string; verbraucht: number }

export default function KiClient({ aktiv, paket, verbraucht }: Props) {
  const router = useRouter()
  const [frage, setFrage]       = useState('')
  const [laden, setLaden]       = useState(false)
  const [ergebnis, setErgebnis] = useState<R | null>(null)
  const [fehler, setFehler]     = useState<string | null>(null)
  const limit = LIMIT_MAP[paket] ?? 50

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
      <h1 className="text-2xl font-semibold text-s112-text mb-2">KI-Modul nicht aktiv</h1>
      <p className="text-s112-muted mb-4">Das Modul „Frag dein Weingut" ist für diesen Betrieb noch nicht freigeschaltet.</p>
      <Link href="/admin/mandanten" className="text-s112-blue-700 hover:underline text-sm">Zum Admin-Bereich</Link>
    </div>
  )

  // Spalten, die mit "gesamt_" beginnen, sind laut Prompt-Konvention Summenwerte über eine
  // Fenster-Funktion (SUM(...) OVER ()) und daher in JEDER Zeile identisch – als normale
  // Tabellenspalte wirken sie irreführend (sehen aus wie ein Pro-Zeile-Wert). Sie werden daher
  // aus der Zeilen-Tabelle herausgefiltert und stattdessen einmalig als Gesamt-Zusammenfassung
  // angezeigt.
  // *_id-Spalten (Verlinkung, siehe LINK_ZIELE) werden ebenfalls nicht als Spalte
  // gezeigt, sondern machen die Zeile anklickbar.
  const alleCols   = (ergebnis?.ergebnisse?.length ?? 0) > 0 ? Object.keys(ergebnis!.ergebnisse[0]) : []
  const gesamtCols = alleCols.filter((c: string) => /^gesamt_/i.test(c))
  const cols       = alleCols.filter((c: string) => !gesamtCols.includes(c) && !istIdSpalte(c))
  const hatZeilen  = (ergebnis?.ergebnisse?.length ?? 0) > 0
  const hatLinks   = hatZeilen && ergebnis!.ergebnisse.some((r: R) => zeilenZiele(r, alleCols).length > 0)

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text flex items-center gap-2"><Bot className="w-6 h-6" /> Frag dein Weingut</h1>
          <p className="text-sm text-s112-muted mt-1">Stelle Fragen über deine Betriebsdaten in natürlicher Sprache</p>
        </div>
        <div className="text-right text-xs text-s112-muted">
          <p className="font-medium text-s112-text-1 capitalize">{paket === 'unlimited' ? 'Unlimited' : paket.charAt(0).toUpperCase() + paket.slice(1)}-Paket</p>
          <p>{paket === 'unlimited' ? `${verbraucht} Abfragen` : `${verbraucht} / ${limit} Abfragen`}</p>
          {paket !== 'unlimited' && (
            <div className="w-24 bg-[#F2F3F5] rounded-full h-1 mt-1 ml-auto">
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
            className="bg-s112-teal text-s112-yellow px-6 py-3 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40 flex items-center gap-2">
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
                className="text-xs bg-white border border-s112-border text-s112-text-2 px-3 py-1.5 rounded-full hover:bg-s112-bg hover:text-s112-blue-700 transition-colors">
                {b}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fehler */}
      {fehler && (
        <div className="bg-s112-err-bg border border-s112-err/30 rounded-xl p-4 mb-6">
          <p className="text-sm text-s112-err-fg font-medium">Fehler</p>
          <p className="text-sm text-s112-err-fg mt-1">{fehler}</p>
        </div>
      )}

      {/* Ergebnis */}
      {ergebnis && (
        <div className="space-y-4">
          {/* Zusammenfassung */}
          <div className="bg-s112-teal/5 border border-s112-teal/20 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <Bot className="w-5 h-5 text-s112-blue-700 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-s112-text">{ergebnis.zusammenfassung}</p>
                {ergebnis.empfehlung && (
                  <p className="text-xs text-s112-muted mt-1 italic">{ergebnis.empfehlung}</p>
                )}
                <p className="text-xs text-s112-muted mt-2">
                  {ergebnis.anzahl} Ergebnis{ergebnis.anzahl !== 1 ? 'se' : ''} · Abfrage {ergebnis.verbraucht}/{paket === 'unlimited' ? '∞' : limit}
                </p>
              </div>
            </div>
          </div>

          {/* SQL-Transparenz */}
          {ergebnis.sql && (
            <details className="text-xs">
              <summary className="cursor-pointer text-s112-muted hover:text-s112-blue-700 select-none">
                Verwendete Abfrage anzeigen
              </summary>
              <pre className="mt-2 bg-s112-bg border border-s112-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap text-s112-text-1">
                {ergebnis.sql}
              </pre>
            </details>
          )}

          {/* Gesamtwerte (aus gesamt_*-Spalten, siehe Kommentar bei "gesamtCols" oben) */}
          {hatZeilen && gesamtCols.length > 0 && (
            <div className="bg-s112-bg border border-s112-border rounded-xl px-4 py-3 flex flex-wrap gap-x-8 gap-y-1">
              {gesamtCols.map((col: string) => (
                <div key={col} className="text-sm">
                  <span className="text-s112-muted">{col.replace(/^gesamt_/i, 'Gesamt ').replace(/_/g, ' ')}:</span>{' '}
                  <span className="font-semibold text-s112-text">{formatWert(ergebnis.ergebnisse[0][col])}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tabelle */}
          {hatZeilen && cols.length > 0 ? (
            <div className="bg-white rounded-xl border border-s112-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-s112-bg text-xs text-s112-muted uppercase tracking-wide">
                  <tr>
                    {cols.map((col: string) => (
                      <th key={col} className="px-4 py-3 text-left whitespace-nowrap">
                        {col.replace(/_/g, ' ')}
                      </th>
                    ))}
                    {hatLinks && <th className="px-4 py-3 text-right whitespace-nowrap">Öffnen</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-s112-border/40">
                  {ergebnis.ergebnisse.map((row: R, i: number) => {
                    const ziele = zeilenZiele(row, alleCols)
                    const haupt = ziele[0]
                    return (
                      <tr key={i}
                        className={haupt ? 'hover:bg-s112-blue-50/60 cursor-pointer' : 'hover:bg-s112-bg/30'}
                        title={haupt ? `${haupt.label} öffnen` : undefined}
                        onClick={haupt ? () => router.push(haupt.href) : undefined}>
                        {cols.map((col: string, ci: number) => (
                          <td key={col} className={`px-4 py-2.5 whitespace-nowrap ${ci === 0 && haupt ? 'text-s112-blue-700 font-medium' : 'text-s112-text-1'}`}>
                            {ci === 0 && haupt
                              ? <Link href={haupt.href} onClick={e => e.stopPropagation()} className="hover:underline">{formatWert(row[col])}</Link>
                              : formatWert(row[col])}
                          </td>
                        ))}
                        {hatLinks && (
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            <span className="inline-flex gap-1 justify-end">
                              {ziele.map((z, zi) => (
                                <Link key={zi} href={z.href} onClick={e => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-s112-border text-s112-text-2 hover:border-s112-blue-700 hover:text-s112-blue-700">
                                  <ExternalLink className="w-3 h-3" />{z.label}
                                </Link>
                              ))}
                            </span>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : !hatZeilen ? (
            <div className="text-center py-8 text-s112-muted text-sm">
              Keine Ergebnisse für diese Abfrage gefunden.
            </div>
          ) : null}

          <button onClick={() => {
            if (!ergebnis?.ergebnisse?.length) return
            // CSV-Standard EXCEL_AT über lib/utils/csv (Semikolon, CRLF, Dezimalkomma, Formelschutz
            // für den freien KI-Inhalt); Zahl-, Datums- und Ja/Nein-Spalten werden aus den Werten erkannt.
            const hdrs = Object.keys(ergebnis.ergebnisse[0]).filter((k: string) => !istIdSpalte(k))
            const rows = ergebnis.ergebnisse.map((r: Record<string, unknown>) => {
              const z: Record<string, unknown> = {}
              for (const h of hdrs) {
                const v = r[h]
                z[h] = v !== null && typeof v === 'object' ? Object.values(v as object).filter(Boolean).join(' ') : v
              }
              return z
            })
            exportCSV(rows, hdrs.map((h: string) => ({ key: h, header: h })), csvDateiname(['KI-Abfrage']).utf8)
          }} className="text-xs border border-s112-border text-s112-text-2 px-3 py-1.5 rounded-lg hover:bg-s112-bg">
            CSV / Excel
          </button>

          {/* Neue Frage */}
          <button onClick={() => { setErgebnis(null); setFrage('') }}
            className="text-sm text-s112-blue-700 hover:underline">
            Neue Frage stellen
          </button>
        </div>
      )}
    </div>
  )
}
