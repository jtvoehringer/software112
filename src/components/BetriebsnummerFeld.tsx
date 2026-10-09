'use client'

// KAN-261 (09.10.2026): Betriebsart und Weinbau-Betriebsnummer – gemeinsam für Mandantenverwaltung (Betriebsart
// wählbar, Feld „betriebsart“) und Betriebseinstellungen (Betriebsart nur angezeigt). Pflicht nur für Weinproduzenten;
// dieselbe Regel prüft der Server mit weinbauBetriebsnummerPruefen(…, betriebsart).
// Zwei Rasterzellen (Fragment) – passt in die bestehenden grid-cols-2-Raster beider Formulare.

import { useState } from 'react'
import {
  BETRIEBSARTEN, BETRIEBSNUMMER_MUSTER, betriebsartAus, betriebsnummerPflicht, betriebsnummerZweck,
  weinbauBetriebsnummerFehlt,
} from '@/lib/betrieb/betriebsnummer'

export function BetriebsnummerFeld({ betriebsart, betriebsnummer, waehlbar, inputClassName }: {
  betriebsart: string | null | undefined
  betriebsnummer: string | null | undefined
  /** true: Betriebsart als Auswahl (name="betriebsart"), sonst nur Anzeige */
  waehlbar: boolean
  inputClassName: string
}) {
  const [art, setArt] = useState(betriebsartAus(betriebsart))
  const pflicht = betriebsnummerPflicht(art)
  const eintrag = BETRIEBSARTEN.find(b => b.wert === art) ?? BETRIEBSARTEN[0]
  const zweck = betriebsnummerZweck(art)
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Betriebsart</label>
        {waehlbar ? (
          <select aria-label="Betriebsart" name="betriebsart" value={art} onChange={e => setArt(betriebsartAus(e.target.value))}
            className={inputClassName}>
            {BETRIEBSARTEN.map(b => <option key={b.wert} value={b.wert}>{b.label}</option>)}
          </select>
        ) : (
          <p className="text-sm text-s112-text py-2">{eintrag.label}</p>
        )}
        <p className="text-[11px] text-s112-tertiary mt-0.5">
          {eintrag.hinweis}{waehlbar ? '' : ' – ändert die Plattform-Verwaltung'}
        </p>
      </div>
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">
          {pflicht ? 'Weinbau-Betriebsnummer *' : 'Weinbau-Betriebsnummer (falls vorhanden)'}
        </label>
        <input aria-label="Weinbau-Betriebsnummer" name="betrieb_betriebsnummer" defaultValue={betriebsnummer ?? ''} required={pflicht}
          inputMode="numeric" pattern={BETRIEBSNUMMER_MUSTER} title="Nur Ziffern (höchstens 10), z. B. 4489781"
          className={inputClassName} placeholder="z.B. 4489781" />
        {weinbauBetriebsnummerFehlt(betriebsnummer, art)
          ? <p className="text-[11px] text-s112-err-fg mt-0.5">Fehlt – bitte ergänzen. {zweck}.</p>
          : <p className="text-[11px] text-s112-tertiary mt-0.5">{zweck}</p>}
      </div>
    </>
  )
}
