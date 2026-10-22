'use client'

// ── Zahlung erfassen (KAN-355, 22.10.2026) ───────────────────────────────────────────────────────────────
// Gemeinsames Formular für die Verkaufsseite und die Offenen Posten. Befund UAT: Eine Zahlung mit Datum in einem
// abgeschlossenen Monat lehnte die Datenbank richtig ab (Trigger a_ea_periodensperre), das reine <form action> führte
// aber auf die Fehlerseite („Link ins Leere“), und die Eingaben waren weg. Jetzt: createZahlung gibt erwartbare
// Ablehnungen als { error } zurück, die Meldung steht im Formular (role="alert"), die Eingaben bleiben erhalten.
// Erst nach dem Speichern wird das Formular geleert und die Seite neu geladen.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createZahlung } from '@/app/(dashboard)/weinhandel/verkauf/actions'
import { fehlerText } from '@/lib/fehler'
import { heuteWien } from '@/lib/datum/wien'
import ZukunftsDatum from '@/components/ui/ZukunftsDatum'

export type ZahlungKonto = { id: string; name: string }

export default function ZahlungErfassen({
  verkaufspostenId,
  betragVorschlag = '',
  konten = [],
  onAbbrechen,
  onGespeichert,
  className = 'border border-s112-border rounded-lg p-3 space-y-3',
  feldKlasse = 'form-input py-2.5 sm:py-2 text-base sm:text-sm w-full',
}: {
  verkaufspostenId: string
  /** Vorbelegung des Betrags (z. B. offener Betrag), Text im Eingabeformat */
  betragVorschlag?: string
  /** E&A-Konten; ohne Konten kein Kontofeld */
  konten?: ZahlungKonto[]
  /** zeigt „Abbrechen“ (Offene Posten: Zeile zuklappen) */
  onAbbrechen?: () => void
  onGespeichert?: () => void
  className?: string
  feldKlasse?: string
}) {
  const router = useRouter()
  const [fehler, setFehler] = useState<string | null>(null)
  const [speichern, setSpeichern] = useState(false)

  async function absenden(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    setFehler(null)
    setSpeichern(true)
    try {
      const r = await createZahlung(verkaufspostenId, fd)
      if ('error' in r) {
        // erwartbare Ablehnung (z. B. Monat abgeschlossen): Meldung, Eingaben bleiben stehen
        setFehler(r.error)
        return
      }
      form.reset()
      onGespeichert?.()
      router.refresh()
    } catch (err) {
      // Unerwartetes bzw. E&A-Abgleich gescheitert (Zahlung dann schon gespeichert): Meldung statt Fehlerseite, Seite neu laden
      setFehler(fehlerText(err, 'Die Zahlung konnte nicht gespeichert werden.'))
      router.refresh()
    } finally {
      setSpeichern(false)
    }
  }

  return (
    <form onSubmit={absenden} className={className} aria-busy={speichern}>
      <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider">Zahlung erfassen</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="block text-xs text-s112-text-2 mb-1">Datum</label>
          <ZukunftsDatum aria-label="Datum" name="datum" defaultValue={heuteWien()} className={feldKlasse} />
        </div>
        <div>
          <label className="block text-xs text-s112-text-2 mb-1">Art</label>
          <select aria-label="Art" name="art" className={feldKlasse}>
            <option value="bar">Bar</option>
            <option value="karte">Karte</option>
            <option value="bank">Bank</option>
            <option value="gutschrift">Gutschrift</option>
            <option value="sonstig">Sonstiges</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-s112-text-2 mb-1">Betrag (€)</label>
          <input aria-label="Betrag (€)" name="betrag" type="text" inputMode="decimal" required
            defaultValue={betragVorschlag} placeholder="0,00" className={feldKlasse} />
        </div>
        <div>
          <label className="block text-xs text-s112-text-2 mb-1">Notiz</label>
          <input aria-label="Notiz" name="notizen" type="text" placeholder="Optional…" className={feldKlasse} />
        </div>
      </div>
      {konten.length > 0 && (
        <div>
          <label className="block text-xs text-s112-text-2 mb-1">Bezahlt über Konto</label>
          <select aria-label="Bezahlt über Konto" name="konto_id" required className={`${feldKlasse} max-w-xs`}>
            {konten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </div>
      )}
      {fehler && (
        <p role="alert" className="text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">
          {fehler}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onAbbrechen && (
          <button type="button" onClick={onAbbrechen}
            className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:bg-s112-bg transition-colors">
            Abbrechen
          </button>
        )}
        <button type="submit" disabled={speichern} aria-busy={speichern || undefined}
          className="flex-1 sm:flex-none bg-s112-teal text-s112-yellow px-4 py-3 sm:py-1.5 rounded-lg text-base sm:text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-50 disabled:cursor-wait">
          {speichern ? 'Wird gebucht…' : 'Zahlung buchen'}
        </button>
      </div>
    </form>
  )
}
