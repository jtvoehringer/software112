'use client'

// ── Kellerplan: Umzug bzw. Verschnitt aus dem Plan buchen (KAN-114, 07.10.2026) ──
// Öffnet sich nach dem Ziehen eines Tanks auf einen anderen (oder über „Umziehen nach …“ im Gebinde-Dialog, Tastatur,
// KAN-106). Vorbelegt mit der gezogenen Charge und ihrem ganzen Inhalt (Entscheidung Jörgen 06.10.2026); gebucht wird
// erst mit „Buchen“ über umziehen() – leeres Gebinde = Umzug, gleicher Wein = Zusammenführung, sonst Verschnitt (KAN-112),
// Rückfragen (Prüfnummer KAN-83/100, Rot/Weiß KAN-193) per Bestätigung wie im Umzugsformular.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight, GitMerge, X } from 'lucide-react'
import { umziehen } from '../../umziehen/actions'
import { fehlerText } from '@/lib/fehler'
import { fmtNum, zahlAus } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import { verschnittHinweis } from '@/lib/kellerbuch/verschnittHinweis'
import { useDialog } from '@/components/ui/useDialog'
import { bewerteZiel, ZIEL_FARBE, type PlanCharge, type PlanGebinde } from '@/lib/keller/kellerplanZiehen'

export default function KellerplanBuchen({ quellGebinde, ziel, quellChargen, zielChargen, onClose, onGebucht }: {
  quellGebinde: PlanGebinde
  ziel: PlanGebinde
  /** eigene Chargen im Quell-Gebinde (bei mehreren: Auswahl) */
  quellChargen: readonly PlanCharge[]
  zielChargen: readonly PlanCharge[]
  onClose: () => void
  /** Text der Bestätigung nach dem Buchen */
  onGebucht: (zeilen: string[]) => void
}) {
  const router = useRouter()
  const [chargeId, setChargeId] = useState(quellChargen[0]?.id ?? '')
  const quelle = quellChargen.find(c => c.id === chargeId) ?? null
  const [mengeText, setMengeText] = useState(quelle ? String(quelle.menge_liter).replace('.', ',') : '')
  const [datum, setDatum] = useState(wienHeute())
  const [notizen, setNotizen] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const dlg = useDialog(true, onClose, 'Umziehen bzw. Verschneiden')

  const menge = zahlAus(mengeText) ?? NaN
  const bewertung = useMemo(() => bewerteZiel({ quelle, quellGebinde, ziel, zielChargen, menge }),
    [quelle, quellGebinde, ziel, zielChargen, menge])
  const mehrAlsBestand = !!quelle && menge > quelle.menge_liter + 0.01

  function chargeWechseln(id: string) {
    setChargeId(id)
    const c = quellChargen.find(x => x.id === id)
    if (c) setMengeText(String(c.menge_liter).replace('.', ','))   // Standard: ganzer Inhalt
  }

  function buchen(e: React.FormEvent) {
    e.preventDefault()
    setFehler(null)
    if (!quelle) { setFehler('Bitte eine Charge wählen.'); return }
    if (!(menge >= 0.01)) { setFehler('Bitte eine Menge angeben.'); return }
    if (mehrAlsBestand) { setFehler(`In „${quelle.name}“ sind nur ${fmtNum(quelle.menge_liter, 2)} L.`); return }
    if (bewertung.art === 'gesperrt') { setFehler(bewertung.text); return }
    if (!datum) { setFehler('Bitte das Datum angeben.'); return }
    const fd = new FormData()
    fd.set('quellen_json', JSON.stringify([{ weinausbau_id: quelle.id, menge }]))
    fd.set('ziele_json', JSON.stringify([{ behaelter_id: ziel.id, menge }]))
    fd.set('datum', datum)
    fd.set('notizen', notizen)
    start(async () => {
      try {
        let r = await umziehen(fd)
        if (r?.bestaetigung) {
          // Prüfnummer bzw. Rot/Weiß: erst nach Bestätigung buchen (beide in derselben Rückfrage)
          if (!window.confirm(r.bestaetigung)) return
          fd.set('pn_bestaetigt', '1')
          fd.set('rotweiss_bestaetigt', '1')
          r = await umziehen(fd)
        }
        const zeilen = r?.verschnitte?.length
          ? r.verschnitte.flatMap(v => verschnittHinweis(v))
          : r?.abstufung
            ? [`${fmtNum(menge, 2)} L nach „${ziel.name}“ gebucht.`, `Abstufung von ${r.abstufung.vonLabel} auf ${r.abstufung.nachLabel}.`]
            : [`${fmtNum(menge, 2)} L von „${quellGebinde.name}“ nach „${ziel.name}“ gebucht.`]
        onGebucht(zeilen)
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Buchen fehlgeschlagen'))
      }
    })
  }

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
  const Icon = bewertung.art === 'verschnitt' ? GitMerge : ArrowLeftRight
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div {...dlg} onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto">
      <form onSubmit={buchen} className="space-y-4">
        <div className="flex items-start gap-2">
          <h3 className="font-semibold text-s112-text flex-1">{quellGebinde.name} → {ziel.name}</h3>
          <button type="button" onClick={onClose} aria-label="Schließen" className="text-s112-muted hover:text-s112-text"><X size={18} /></button>
        </div>

        <p role="status" className="flex items-start gap-2 text-sm rounded-lg px-3 py-2 border"
          style={{ borderColor: ZIEL_FARBE[bewertung.art], color: ZIEL_FARBE[bewertung.art] }}>
          <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{bewertung.text}</span>
        </p>

        {quellChargen.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Charge</label>
            <select aria-label="Charge" value={chargeId} onChange={e => chargeWechseln(e.target.value)} className={inputCls}>
              {quellChargen.map(c => <option key={c.id} value={c.id}>{c.name} ({fmtNum(c.menge_liter, 2)} L)</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge (L)</label>
            <input aria-label="Menge (L)" inputMode="decimal" value={mengeText} onChange={e => setMengeText(e.target.value)} className={inputCls} />
            {quelle && <p className="text-[11px] text-s112-muted mt-0.5">Inhalt: {fmtNum(quelle.menge_liter, 2)} L</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum</label>
            <input aria-label="Datum" type="date" value={datum} max={wienHeute()} onChange={e => setDatum(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
          <input aria-label="Notizen" value={notizen} onChange={e => setNotizen(e.target.value)} className={inputCls} />
        </div>

        {fehler && <p role="alert" className="text-sm bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-3 py-2">{fehler}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-s112-text-2 hover:text-s112-text">Abbrechen</button>
          <button type="submit" disabled={pending || bewertung.art === 'gesperrt'}
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40">
            {pending ? 'Wird gebucht …' : bewertung.art === 'verschnitt' ? 'Verschnitt buchen' : 'Umzug buchen'}
          </button>
        </div>
      </form>
      </div>
    </div>
  )
}
