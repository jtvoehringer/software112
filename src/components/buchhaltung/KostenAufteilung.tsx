'use client'

// KAN-421 (12.11.2026): Ausgabe beim Buchen auf Kostenstellen aufteilen. Steht im Buchungsformular (Neue Buchung, Beleg
// buchen) und liest Typ und Nettobetrag aus den Feldern desselben Formulars; die Zeilen gehen als JSON im versteckten
// Feld KOSTEN_FELD mit. Freiwillig – ohne Zeile entsteht kein Kosteneintrag.

import { useEffect, useId, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { KOSTEN_FELD, KOSTEN_MAX_ZEILEN, kostenAufteilungFehler, kostenRest, kostenZeilenAus } from '@/lib/kosten/aufteilung'
import { rundText } from '@/lib/zahl/runden'
import { fmtNum, zahlAus } from '@/lib/format'

type Auswahl = { id: string; name: string }
type Zeile = { kostenstelle_id: string; kostenart_id: string; betrag: string }

const feld = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
const eur = (n: number) => fmtNum(n, { min: 2, max: 2 })

export default function KostenAufteilung({ kostenstellen, kostenarten }: { kostenstellen: Auswahl[]; kostenarten: Auswahl[] }) {
  const id = useId()
  const rahmen = useRef<HTMLDivElement | null>(null)
  const [zeilen, setZeilen] = useState<Zeile[]>([])
  const [typ, setTyp] = useState('')
  const [netto, setNetto] = useState(NaN)

  // Typ und Nettobetrag stehen in unkontrollierten Feldern des umgebenden Formulars
  useEffect(() => {
    const form = rahmen.current?.closest('form')
    if (!form) return
    const lesen = () => {
      const fd = new FormData(form)
      setTyp(String(fd.get('typ') ?? ''))
      setNetto(zahlAus(fd.get('betrag_netto')) ?? NaN)
    }
    lesen()
    form.addEventListener('input', lesen)
    form.addEventListener('change', lesen)
    return () => { form.removeEventListener('input', lesen); form.removeEventListener('change', lesen) }
  }, [])

  const json = JSON.stringify(zeilen)
  const gelesen = kostenZeilenAus(json)
  const fehler = kostenAufteilungFehler(gelesen, typ || 'ausgabe', netto)
  const rest = gelesen && Number.isFinite(netto) ? kostenRest(gelesen, netto) : null

  const setze = (i: number, teil: Partial<Zeile>) => setZeilen(z => z.map((x, j) => (j === i ? { ...x, ...teil } : x)))
  const neu = () => setZeilen(z => [...z, {
    kostenstelle_id: '', kostenart_id: '',
    // Vorschlag: der noch nicht verteilte Rest
    betrag: rest !== null && rest > 0 ? rundText(rest, 2) : '',
  }])

  if (typ === 'einnahme' && zeilen.length === 0) return <div ref={rahmen}><input type="hidden" name={KOSTEN_FELD} value="[]" /></div>

  return (
    <div ref={rahmen} className="border border-s112-border rounded-xl p-4 space-y-3">
      <input type="hidden" name={KOSTEN_FELD} value={json} />
      <div>
        <p className="text-xs font-medium text-s112-text-2">Kostenrechnung</p>
        <p className="text-xs text-s112-muted mt-0.5">
          Optional: Die Ausgabe (netto) steht damit auch in der Kostenrechnung – ganz oder aufgeteilt auf mehrere Kostenstellen.
        </p>
      </div>

      {zeilen.map((z, i) => (
        <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_8rem_auto] gap-2 items-start">
          <select aria-label={`Kostenstelle ${i + 1}`} value={z.kostenstelle_id} onChange={e => setze(i, { kostenstelle_id: e.target.value })} className={feld}>
            <option value="">– Kostenstelle wählen –</option>
            {kostenstellen.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <select aria-label={`Kostenart ${i + 1}`} value={z.kostenart_id} onChange={e => setze(i, { kostenart_id: e.target.value })} className={feld}>
            <option value="">– Kostenart (optional) –</option>
            {kostenarten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <input aria-label={`Betrag netto ${i + 1} (€)`} type="number" step="0.01" min="0" inputMode="decimal" placeholder="0,00"
            value={z.betrag} onChange={e => setze(i, { betrag: e.target.value })}
            aria-describedby={fehler ? `${id}-fehler` : undefined}
            className={`${feld} text-right tabular-nums`} />
          <button type="button" aria-label={`Kostenstelle ${i + 1} entfernen`} title="Entfernen"
            onClick={() => setZeilen(alt => alt.filter((_, j) => j !== i))}
            className="p-2 rounded-lg text-s112-muted hover:text-s112-err-fg hover:bg-s112-err-bg">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        {zeilen.length < KOSTEN_MAX_ZEILEN && (
          <button type="button" onClick={neu} className="inline-flex items-center gap-1.5 text-xs text-s112-blue-700 hover:underline">
            <Plus className="w-3.5 h-3.5" /> {zeilen.length === 0 ? 'In die Kostenrechnung übernehmen' : 'Weitere Kostenstelle'}
          </button>
        )}
        {zeilen.length > 0 && rest !== null && rest >= 0 && (
          <p className="text-xs text-s112-muted tabular-nums">
            {rest === 0 ? 'Vollständig aufgeteilt.' : `Ohne Kostenstelle bleiben ${eur(rest)} €.`}
          </p>
        )}
      </div>

      {fehler && zeilen.length > 0 && (
        <p id={`${id}-fehler`} role="alert" className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-2.5 py-1.5">{fehler}</p>
      )}
    </div>
  )
}
