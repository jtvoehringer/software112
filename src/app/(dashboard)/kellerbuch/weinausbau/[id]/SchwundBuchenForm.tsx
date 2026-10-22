'use client'
import ErfolgsMeldung from '@/components/ErfolgsMeldung'

// „Schwund buchen“ auf der Chargen-Seite (KAN-35, 24.09.2026): datierte Schwundzeile im
// Bewegungsbuch UND Bestand der Charge mindern (Server Action schwundBuchen → RPC
// schwund_buchen). Einziger Korrekturweg nach unten, seit die Menge im Formular
// „Charge bearbeiten“ nicht mehr änderbar ist.

import { schwundGrundFehler } from '@/lib/keller/gebindeAnzeige'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Droplet } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { fmtLiter, zahlAus } from '@/lib/format'
import { SCHWUND_STORNO_HINWEIS } from '@/lib/kellerbuch/hinweise'
import { heuteWien } from '@/lib/datum/wien'
import ZukunftsDatum from '@/components/ui/ZukunftsDatum'
import { rueckfrage } from '@/lib/ui/rueckfrage'

interface Props {
  bestandLiter: number
  action: (formData: FormData) => Promise<void>
}

export default function SchwundBuchenForm({ bestandLiter, action }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [menge, setMenge] = useState('')
  const [datum, setDatum] = useState(heuteWien())
  const [notiz, setNotiz] = useState('')

  const liter = zahlAus(menge)
  const zuViel = liter != null && liter > bestandLiter + 0.005
  const restNachher = liter != null ? bestandLiter - liter : null
  const schliesstAb = restNachher != null && restNachher <= 0.01 && !zuViel

  async function absenden(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFehler(null)
    setOk(null)
    if (liter == null || liter < 0.01) { setFehler('Bitte eine Schwundmenge von mindestens 0,01 L angeben.'); return }
    const gf = schwundGrundFehler(notiz)   // KAN-174 D: Begründung Pflicht
    if (gf) { setFehler(gf); return }
    if (zuViel) { setFehler(`Die Schwundmenge übersteigt den Bestand der Charge (${fmtLiter(bestandLiter)}).`); return }
    if (schliesstAb && !(await rueckfrage({
      titel: 'Charge abschließen?',
      text: 'Nach diesem Schwund ist die Charge leer und wird abgeschlossen.',
      bestaetigen: 'Schwund buchen',
      gefaehrlich: true,
    }))) return
    const fd = new FormData()
    fd.set('menge', menge)
    fd.set('datum', datum)
    fd.set('notiz', notiz)
    startTransition(async () => {
      try {
        await action(fd)
        setOk(`Schwund von ${fmtLiter(liter)} gebucht.`)
        setMenge('')
        setNotiz('')
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Schwund konnte nicht gebucht werden'))
      }
    })
  }

  const inputCls = 'border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'

  return (
    <details className="card p-5">
      <summary className="cursor-pointer font-semibold text-sm text-s112-text select-none inline-flex items-center gap-1.5">
        <Droplet size={15} strokeWidth={1.75} className="text-s112-warn-fg" />Schwund buchen
      </summary>
      <p className="text-xs text-s112-muted mt-2">
        Verlust (z. B. Verdunstung, Trub, Verlust beim Ausbau) als datierte Buchung erfassen – der Bestand der Charge
        ({fmtLiter(bestandLiter)}) wird um die Menge gemindert. Bleiben höchstens 0,01 L übrig, wird die Charge abgeschlossen.
        Falsch gebucht? {SCHWUND_STORNO_HINWEIS}
      </p>
      <form onSubmit={absenden} className="mt-3 grid grid-cols-2 gap-3 items-end sm:flex sm:flex-wrap">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge (L) *</label>
          <input aria-label="Schwundmenge (L)" type="text" inputMode="decimal" value={menge}
            onChange={e => setMenge(e.target.value)} placeholder="z.B. 12,5" required
            className={`w-full sm:w-28 ${inputCls} ${zuViel ? 'border-s112-err/50' : ''}`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
          <ZukunftsDatum aria-label="Datum" value={datum} onChange={e => setDatum(e.target.value)} required className={`w-full sm:w-auto ${inputCls}`} />
        </div>
        <div className="col-span-2 sm:flex-1 sm:min-w-[180px]">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Begründung *</label>
          <input aria-label="Begründung" type="text" value={notiz} onChange={e => setNotiz(e.target.value)} required minLength={3}
            placeholder="z.B. ausgelaufen, Verdunstung Barrique" className={`w-full ${inputCls}`} />
        </div>
        <button type="submit" disabled={pending}
          className="col-span-2 sm:col-span-1 w-full sm:w-auto bg-s112-warn-fg text-white px-4 py-3 sm:py-2 rounded-lg text-base sm:text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {pending ? 'Wird gebucht …' : 'Schwund buchen'}
        </button>
      </form>
      {schliesstAb && !fehler && (
        <p className="text-xs text-s112-warn-fg mt-2">Nach dieser Buchung ist die Charge leer und wird abgeschlossen.</p>
      )}
      {fehler && <p role="alert" className="text-xs text-s112-err-fg mt-2">{fehler}</p>}
      <ErfolgsMeldung text={ok} />{/* KAN-359: Erfolg als Pop-up */}
    </details>
  )
}
