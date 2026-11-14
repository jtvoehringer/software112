'use client'

// ── Rückzahlung erfassen (KAN-453 G3c, 14.11.2026) ──────────────────────────────────────────────────
// Hat eine Rechnung ein Guthaben (Zahlungen + Gutschriften über dem Rechnungsbetrag), lässt es sich hier auszahlen:
// eine negative Zahlung, höchstens das Guthaben, auch in Teilen. Die Datenbank prüft endgültig (RPC
// s112_rueckzahlung_erfassen); erwartbare Ablehnungen stehen am Feld, die Eingaben bleiben erhalten.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { rueckzahlungErfassen } from '@/app/(dashboard)/weinhandel/verkauf/actions'
import { fehlerText } from '@/lib/fehler'
import { heuteWien } from '@/lib/datum/wien'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { fmtEur, fmtNum, zahlAus } from '@/lib/format'
import { rueckzahlungEingabeFehler } from '@/lib/verkauf/rueckzahlung'

type Feld = 'betrag' | 'datum'

export default function RueckzahlungErfassen({
  rechnungId, rechnungsnummer, rechnungDatum, guthaben, konten = [], onAbbrechen, onGespeichert,
  className = 'border border-s112-border rounded-lg p-3 space-y-3 bg-white', feldKlasse = 'form-input text-sm w-full',
}: {
  rechnungId: string
  rechnungsnummer: string | null
  /** Rechnungsdatum (JJJJ-MM-TT) – die Rückzahlung liegt nicht davor */
  rechnungDatum: string
  /** auszahlbares Guthaben der Rechnung (brutto) */
  guthaben: number
  /** E&A-Konten; ohne Konten kein Kontofeld */
  konten?: { id: string; name: string }[]
  onAbbrechen?: () => void
  onGespeichert?: () => void
  className?: string
  feldKlasse?: string
}) {
  const router = useRouter()
  const heute = heuteWien()
  const [betrag, setBetrag] = useState(fmtNum(guthaben, 2))
  const [datum, setDatum] = useState(heute)
  const [art, setArt] = useState('bank')
  const [kontoId, setKontoId] = useState(konten[0]?.id ?? '')
  const [notizen, setNotizen] = useState('')
  const [fehler, setFehler] = useState<{ feld: Feld | null; text: string } | null>(null)
  const [speichern, setSpeichern] = useState(false)

  async function absenden(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const zahl = zahlAus(betrag) ?? Number.NaN
    const f = rueckzahlungEingabeFehler({ betrag: zahl, datum }, { guthaben, rechnungDatum, heute })
    if (f) { setFehler(f); return }
    setFehler(null)
    setSpeichern(true)
    try {
      const r = await rueckzahlungErfassen(rechnungId, { betrag: zahl, datum, art, kontoId: kontoId || null, notizen: notizen.trim() || null })
      if ('error' in r) { setFehler({ feld: r.feld ?? null, text: r.error }); return }
      zeigeErfolg('Rückzahlung gebucht.')
      onGespeichert?.()
      router.refresh()
    } catch (err) {
      // Unerwartetes bzw. E&A-Abgleich gescheitert (Rückzahlung dann schon gebucht): Meldung statt Fehlerseite, Seite neu laden
      setFehler({ feld: null, text: fehlerText(err, 'Die Rückzahlung konnte nicht gebucht werden.') })
      router.refresh()
    } finally {
      setSpeichern(false)
    }
  }

  const meldung = (feld: Feld) => fehler?.feld === feld && <p id={`rz-fehler-${feld}`} role="alert" className="text-xs text-s112-err mt-1">{fehler.text}</p>

  return (
    <form onSubmit={absenden} className={className} aria-busy={speichern}>
      <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider">Rückzahlung erfassen</p>
      <p className="text-xs text-s112-muted">
        Guthaben zu {rechnungsnummer ? `Rechnung ${rechnungsnummer}` : 'dieser Rechnung'}: {fmtEur(guthaben)}. Die Rückzahlung erscheint als Ausgang am gewählten Konto;
        bei der Einnahmen-Ausgaben-Rechnung mindert sie die Einnahmen am Tag der Rückzahlung.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label htmlFor="rz-datum" className="block text-xs text-s112-text-2 mb-1">Datum</label>
          <input id="rz-datum" type="date" value={datum} min={rechnungDatum} max={heute} onChange={e => setDatum(e.target.value)}
            aria-describedby={fehler?.feld === 'datum' ? 'rz-fehler-datum' : undefined} className={feldKlasse} />
          {meldung('datum')}
        </div>
        <div>
          <label htmlFor="rz-art" className="block text-xs text-s112-text-2 mb-1">Art</label>
          <select id="rz-art" value={art} onChange={e => setArt(e.target.value)} className={feldKlasse}>
            <option value="bank">Bank</option>
            <option value="bar">Bar</option>
            <option value="karte">Karte</option>
            <option value="sonstig">Sonstiges</option>
          </select>
        </div>
        <div>
          <label htmlFor="rz-betrag" className="block text-xs text-s112-text-2 mb-1">Betrag der Rückzahlung (€)</label>
          <input id="rz-betrag" type="text" inputMode="decimal" required value={betrag} onChange={e => setBetrag(e.target.value)}
            aria-describedby={fehler?.feld === 'betrag' ? 'rz-fehler-betrag' : undefined} className={feldKlasse} />
          {meldung('betrag')}
        </div>
        <div>
          <label htmlFor="rz-notiz" className="block text-xs text-s112-text-2 mb-1">Notiz</label>
          <input id="rz-notiz" type="text" maxLength={300} value={notizen} onChange={e => setNotizen(e.target.value)} placeholder="Optional…" className={feldKlasse} />
        </div>
      </div>
      {konten.length > 0 && (
        <div>
          <label htmlFor="rz-konto" className="block text-xs text-s112-text-2 mb-1">Ausbezahlt über Konto</label>
          <select id="rz-konto" value={kontoId} onChange={e => setKontoId(e.target.value)} required className={`${feldKlasse} max-w-xs`}>
            {konten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </div>
      )}
      {fehler && fehler.feld === null && (
        <p role="alert" className="text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{fehler.text}</p>
      )}
      <div className="flex justify-end gap-2">
        {onAbbrechen && (
          <button type="button" onClick={onAbbrechen} disabled={speichern}
            className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:bg-s112-bg transition-colors">Abbrechen</button>
        )}
        <button type="submit" disabled={speichern} aria-busy={speichern || undefined}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-50">
          {speichern ? 'Wird gebucht…' : 'Rückzahlung buchen'}
        </button>
      </div>
    </form>
  )
}
