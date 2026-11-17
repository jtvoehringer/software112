'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { fehlerText } from '@/lib/fehler'
import { ernteAngabenSpeichern } from './actions'

// KAN-472 Teil 2: Ankreuzfelder der Weinerntemeldung je Jahrgang. Erscheint nur am Bildschirm (nicht im Druck) – das
// Formular darunter zeigt die gespeicherten Kreuze.
export default function ErnteAngabenForm({ jahrgangId, jahrgang, suessung, entsaeuerung, schreiben }: {
  jahrgangId: string; jahrgang: number; suessung: boolean; entsaeuerung: boolean; schreiben: boolean
}) {
  const router = useRouter()
  const [s, setS] = useState(suessung)
  const [e, setE] = useState(entsaeuerung)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const geaendert = s !== suessung || e !== entsaeuerung

  async function speichern() {
    setLaedt(true)
    setFehler(null)
    try {
      const r = await ernteAngabenSpeichern(jahrgangId, { suessung: s, entsaeuerung: e })
      if ('error' in r) { setFehler(r.error); return }
      zeigeErfolg(`Angaben zur Erntemeldung ${jahrgang} gespeichert.`)
      router.refresh()
    } catch (err) {
      setFehler(fehlerText(err))
    } finally {
      setLaedt(false)
    }
  }

  return (
    <div className="print:hidden rounded-xl border border-s112-border bg-s112-bg px-4 py-3 text-sm">
      <p className="font-semibold text-s112-text mb-2">Angaben zur Erntemeldung {jahrgang}</p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={s} disabled={!schreiben || laedt} onChange={ev => setS(ev.target.checked)} />
          beabsichtige Süßung
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={e} disabled={!schreiben || laedt} onChange={ev => setE(ev.target.checked)} />
          beabsichtige Entsäuerung
        </label>
        {schreiben && (
          <button type="button" onClick={speichern} disabled={laedt || !geaendert} className="btn-primary text-xs disabled:opacity-40">
            {laedt ? 'Speichert …' : 'Speichern'}
          </button>
        )}
      </div>
      {!schreiben && <p className="text-xs text-s112-text-2 mt-2">Nur lesend – zum Ändern ist die Freigabe Rieden oder Kellerbuch nötig.</p>}
      {fehler && <p role="alert" className="text-xs text-s112-err-fg mt-2">{fehler}</p>}
      <p className="text-xs text-s112-text-2 mt-2">„Biobetrieb“ kommt aus dem Bio-Status des Betriebs (Einstellungen).</p>
    </div>
  )
}
