'use client'
// KAN-437 Teil 3 (13.11.2026): länderspezifische Belegnummern am Exportauftrag (z. B. COLA, Prior Notice) – freie Liste
// aus Bezeichnung und Nummer mit Vorschlägen je Zielland; änderbar bis „Abgeschlossen“ (dieselbe Sperre in der Datenbank).
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { BELEGNUMMERN_MAX, BELEGNUMMER_LAENGE, belegnummernAus, belegnummernFehler, type Belegnummer } from '@/lib/export/belegnummern'

type Props = {
  auftragId: string
  belege: Belegnummer[]
  /** Vorschläge für die Bezeichnung (je Zielland) */
  vorschlaege: readonly string[]
  /** Schreibrecht und Auftrag weder abgeschlossen noch storniert */
  darfAendern: boolean
  gesperrtGrund: string | null
}

export default function ExportBelegnummernPanel({ auftragId, belege, vorschlaege, darfAendern, gesperrtGrund }: Props) {
  const router = useRouter()
  const [zeilen, setZeilen] = useState<Belegnummer[]>(belege)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const offeneVorschlaege = vorschlaege.filter(v => !zeilen.some(z => z.bezeichnung.trim().toLowerCase() === v.toLowerCase()))
  const setze = (i: number, k: keyof Belegnummer, wert: string) => setZeilen(alt => alt.map((z, j) => (j === i ? { ...z, [k]: wert } : z)))

  async function speichern(e: React.FormEvent) {
    e.preventDefault()
    const f = belegnummernFehler(zeilen)
    if (f) { setFehler(f); return }
    setLaeuft(true)
    try {
      setFehler(null)
      const res = await fetch(`/api/weinexport/${auftragId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ laender_belege: belegnummernAus(zeilen) }),
      })
      if (!res.ok) { setFehler((await res.json().catch(() => null))?.fehler ?? `Die Belegnummern konnten nicht gespeichert werden (Status ${res.status}).`); return }
      setZeilen(belegnummernAus(zeilen))
      zeigeErfolg('Belegnummern gespeichert.')
      router.refresh()
    } catch {
      setFehler('Die Belegnummern konnten nicht gespeichert werden – bitte die Verbindung prüfen.')
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <section className="bg-white rounded-xl border border-s112-border p-5 mt-6" data-export-belegnummern>
      <h2 className="font-semibold text-s112-text">Belegnummern</h2>
      <p className="text-sm text-s112-muted mt-1">
        Nummern, die das Zielland bzw. der Importeur zur Sendung verlangt – z. B. COLA je Wein und Prior Notice je Sendung (USA).
        Sie stehen am Auftrag und in der CSV der Auftragsliste, nicht auf Rechnung oder Packliste.
      </p>
      {gesperrtGrund && <p className="text-sm text-s112-muted mt-2">{gesperrtGrund}</p>}

      {!darfAendern ? (
        zeilen.length === 0
          ? <p className="text-sm text-s112-muted mt-3">Keine Belegnummern hinterlegt.</p>
          : (
            <ul className="mt-3 text-sm divide-y divide-s112-border/40 border border-s112-border/60 rounded-lg">
              {zeilen.map((z, i) => (
                <li key={i} className="px-3 py-2 flex justify-between gap-3 flex-wrap">
                  <span className="text-s112-text-1">{z.bezeichnung}</span><span className="font-mono text-[13px]">{z.nummer}</span>
                </li>
              ))}
            </ul>
          )
      ) : (
        <form onSubmit={speichern} className="mt-3 space-y-2">
          {zeilen.map((z, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <input aria-label={`Bezeichnung ${i + 1}`} value={z.bezeichnung} onChange={e => setze(i, 'bezeichnung', e.target.value)} maxLength={BELEGNUMMER_LAENGE}
                placeholder="Bezeichnung, z. B. COLA" disabled={laeuft} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm" />
              <input aria-label={`Nummer ${i + 1}`} value={z.nummer} onChange={e => setze(i, 'nummer', e.target.value)} maxLength={BELEGNUMMER_LAENGE}
                placeholder="Nummer" disabled={laeuft} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono" />
              <button type="button" disabled={laeuft} onClick={() => setZeilen(alt => alt.filter((_, j) => j !== i))}
                className="text-sm text-s112-err hover:underline disabled:opacity-50 justify-self-start">Entfernen</button>
            </div>
          ))}
          <div className="flex items-center gap-2 flex-wrap">
            {zeilen.length < BELEGNUMMERN_MAX && (
              <button type="button" disabled={laeuft} onClick={() => setZeilen(alt => [...alt, { bezeichnung: '', nummer: '' }])}
                className="border border-s112-border rounded-lg px-3 py-1.5 text-sm text-s112-text-1 hover:bg-s112-bg disabled:opacity-50">+ Belegnummer</button>
            )}
            {zeilen.length < BELEGNUMMERN_MAX && offeneVorschlaege.map(v => (
              <button key={v} type="button" disabled={laeuft} onClick={() => setZeilen(alt => [...alt, { bezeichnung: v, nummer: '' }])}
                className="border border-dashed border-s112-border rounded-lg px-3 py-1.5 text-sm text-s112-blue-700 hover:bg-s112-bg disabled:opacity-50">+ {v}</button>
            ))}
            <button type="submit" disabled={laeuft} className="ml-auto bg-s112-teal text-s112-yellow rounded-lg px-4 py-1.5 text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
              {laeuft ? 'Speichert …' : 'Speichern'}
            </button>
          </div>
        </form>
      )}
      {fehler && <div role="alert" className="mt-3 bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2 text-sm text-s112-err">{fehler}</div>}
    </section>
  )
}
