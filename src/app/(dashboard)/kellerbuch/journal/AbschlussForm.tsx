'use client'
import { useState, useTransition } from 'react'
import { kellerbuchAbschliessen } from './actions'
import { rueckfrage } from '@/lib/ui/rueckfrage'

/** KAN-192: Kellerbuch bis zu einem Stichtag abschließen (nur Betriebsleitung, unwiderruflich) */
export default function AbschlussForm({ vorschlag, maxDatum }: { vorschlag: string; maxDatum: string }) {
  const [bis, setBis] = useState(vorschlag)
  const [bemerkung, setBemerkung] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, starten] = useTransition()

  const datumAT = (d: string) => (d ? d.split('-').reverse().join('.') : '')

  async function abschicken() {
    setFehler(null)
    if (!bis) { setFehler('Bitte ein Datum wählen.'); return }
    if (!(await rueckfrage({
      titel: `Kellerbuch bis ${datumAT(bis)} abschließen?`,
      text: 'Danach sind Bewegungen mit einem Datum bis zu diesem Tag nicht mehr möglich (anlegen, ändern, löschen); Stornos buchen am Storno-Tag. Das lässt sich nicht rückgängig machen.',
      bestaetigen: 'Abschließen',
      gefaehrlich: true,
    }))) return
    starten(async () => {
      const r = await kellerbuchAbschliessen(bis, bemerkung)
      if (!r.ok) setFehler(r.error ?? 'Abschließen fehlgeschlagen.')
      else setBemerkung('')
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="abschluss-bis" className="block text-xs font-medium text-s112-text-2 mb-1">Abschließen bis einschließlich</label>
          <input id="abschluss-bis" type="date" value={bis} max={maxDatum} onChange={e => setBis(e.target.value)}
            className="border border-s112-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="abschluss-bemerkung" className="block text-xs font-medium text-s112-text-2 mb-1">Bemerkung (optional)</label>
          <input id="abschluss-bemerkung" type="text" value={bemerkung} maxLength={500} onChange={e => setBemerkung(e.target.value)}
            placeholder="z. B. Bestandsmeldung WJ 2026/27 abgegeben" className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="button" onClick={abschicken} disabled={laeuft}
          className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
          {laeuft ? 'Wird abgeschlossen …' : 'Kellerbuch abschließen'}
        </button>
      </div>
      {fehler && <p role="alert" className="text-sm text-red-700">{fehler}</p>}
    </div>
  )
}
