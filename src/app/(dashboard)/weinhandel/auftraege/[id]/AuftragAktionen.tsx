'use client'

// KAN-418 Teil 1: Reservierungsfrist ändern und Auftrag stornieren (mit Pflicht-Grund).
// Teil 2: Stornieren nur ohne Lieferung; ein teilgelieferter Auftrag wird abgeschlossen (Rest nicht mehr liefern).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import StornoButton from '@/components/StornoButton'
import ZukunftsDatum from '@/components/ui/ZukunftsDatum'
import { fehlerText } from '@/lib/fehler'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { fristFehler } from '@/lib/auftrag/regeln'
import { rueckfrage } from '@/lib/ui/rueckfrage'
import { auftragAbschliessen, setzeReservierungBis, stornoAuftrag } from '../actions'

export default function AuftragAktionen({ id, nummer, reserviertBis, heute, kannStornieren, kannAbschliessen }: {
  id: string; nummer: string; reserviertBis: string; heute: string; kannStornieren: boolean; kannAbschliessen: boolean
}) {
  const router = useRouter()
  const [bis, setBis] = useState(reserviertBis < heute ? heute : reserviertBis)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  async function fristSpeichern() {
    const f = fristFehler(bis, heute)
    setFehler(f)
    if (f) return
    setLaeuft(true)
    try {
      const r = await setzeReservierungBis(id, bis)
      if (r.error) { setFehler(r.error); return }
      zeigeErfolg('Reservierungsfrist gespeichert.')
      router.refresh()
    } catch (e) {
      setFehler(fehlerText(e, 'Die Frist wurde nicht gespeichert'))
    } finally {
      setLaeuft(false)
    }
  }

  async function abschliessen() {
    if (!(await rueckfrage({
      titel: `Auftrag ${nummer} abschließen?`,
      text: 'Der Rest wird nicht mehr geliefert, die Reservierung der offenen Flaschen fällt weg. Die bisherigen Lieferungen bleiben bestehen.',
      bestaetigen: 'Abschließen',
    }))) return
    setLaeuft(true)
    try {
      const r = await auftragAbschliessen(id)
      if (r.error) { setFehler(r.error); return }
      zeigeErfolg('Auftrag abgeschlossen – die offenen Flaschen sind wieder verfügbar.')
      router.refresh()
    } catch (e) {
      setFehler(fehlerText(e, 'Der Auftrag wurde nicht abgeschlossen'))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-end gap-2 flex-wrap justify-end">
        <label className="text-xs text-s112-text-2">
          <span className="block mb-1">Reserviert bis</span>
          <ZukunftsDatum aria-label="Reserviert bis" value={bis} min={heute} onChange={e => setBis(e.target.value)}
            aria-describedby={fehler ? 'auftrag-frist-fehler' : undefined}
            className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        </label>
        <button type="button" onClick={fristSpeichern} disabled={laeuft || bis === reserviertBis}
          className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg disabled:opacity-40">
          {laeuft ? 'Speichert…' : 'Frist speichern'}
        </button>
        {kannAbschliessen && (
          <button type="button" onClick={abschliessen} disabled={laeuft}
            className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg disabled:opacity-40">
            Auftrag abschließen
          </button>
        )}
        {kannStornieren && <StornoButton mitText schwebend label="Auftrag stornieren"
          hinweis={`Der Auftrag ${nummer} wird storniert, die Reservierung seiner Flaschen aufgehoben. Der Auftrag bleibt in der Liste sichtbar.`}
          action={async grund => { const r = await stornoAuftrag(id, grund); if (r.error) return { error: r.error }; zeigeErfolg('Auftrag storniert – die Flaschen sind wieder verfügbar.') }}
          danach={() => router.refresh()} />}
      </div>
      {fehler && <p id="auftrag-frist-fehler" role="alert" className="text-xs text-s112-err-fg">{fehler}</p>}
    </div>
  )
}
