'use client'

// Mostgewicht-Eingabe in °KMW und °Oe – KAN-128 Teil A, S4 (26.09.2026)
//
// Zwei gekoppelte Felder, die bevorzugte Einheit des Betriebs zuerst (useMostgewichtEinheit, änderbar
// per Prop). Das zuletzt bearbeitete Feld ist der Messwert, das andere zeigt den umgerechneten Wert
// mit „≈“ und bleibt eingebbar – wer es überschreibt, misst in dieser Einheit. Beim Öffnen wird
// nichts neu gerechnet (gespeicherter Messwert und Einheit). Regeln und Tests:
// lib/wein/mostgewichtEingabe.ts, scripts/tests/mostgewicht-eingabe.test.mjs.
//
// Formular: versteckte Felder <name>_wert (Messwert wie eingegeben, leer = gelöscht) und
// <name>_einheit, übergangsweise <altesFeld> mit dem °KMW-Wert. Die Server Action liest sie mit
// mostgewichtAusFormular(fd, name) aus lib/wein/mostgewichtFormular.ts und rechnet selbst.
// Eine ungültige Eingabe setzt setCustomValidity – das Formular lässt sich dann nicht absenden.

import { useEffect, useId, useRef, useState } from 'react'
import { EINHEIT_ZEICHEN, GRENZ_BAND_OECHSLE, formatKmw, formatOechsle, type Mostgewicht, type MostgewichtEinheit } from '@/lib/wein/mostgewicht'
import type { GespeichertesMostgewicht } from '@/lib/wein/mostgewichtFormular'
import {
  eingabeAendern, eingabeStart, eingabeStufe, feldReihenfolge, grenzfall, stufenwechsel, versteckteWerte,
  type EingabeZustand,
} from '@/lib/wein/mostgewichtEingabe'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { useMostgewichtEinheit } from './MostgewichtEinheit'

/** BKI-Anreicherungstabellen (Stierschneider), Anlage Ia: °KMW ↔ °Oe */
export const BKI_ANREICHERUNGSTABELLE_URL = 'https://www.bundeskellereiinspektion.at/downloads/stierschneider/anreicherungstabellen.pdf'

export interface MostgewichtEingabeProps {
  /** Basis der versteckten Felder <name>_wert und <name>_einheit */
  name: string
  /** Übergangsweise: altes Feld (z. B. 'klosterneuburger', 'kmw_grad', 'kmw') mit dem °KMW-Wert */
  altesFeld?: string
  /** Gespeicherte Werte bzw. Vorbelegung (z. B. aus der Lese) – nicht den onChange-Wert zurückgeben;
   *  ändert sich die Vorbelegung, beginnt die Eingabe neu */
  startwert?: GespeichertesMostgewicht | null
  /** Eingabezustand beim Einblenden, z. B. einer Zeile nach dem Zu- und Aufklappen (der zuletzt über
   *  onChange gemeldete, siehe zeileMostgewichtAendern) – hat Vorrang vor startwert und gilt nur beim
   *  ersten Rendern */
  anfangsZustand?: EingabeZustand | null
  /** Einheit, die zuerst steht – Standard: bevorzugte Einheit des Betriebs */
  bevorzugt?: MostgewichtEinheit
  /** Beschriftung (Legende der Feldgruppe) */
  label?: string
  /** Neues Mostgewicht (null = leer, gelöscht oder ungültig; dann steht der Grund in `fehler`) und
   *  der ganze Eingabezustand (für anfangsZustand beim Wiedereinblenden) */
  onChange?: (wert: Mostgewicht | null, info: { fehler: string | null; zustand: EingabeZustand }) => void
  /** Nur lesen (Nur-Lesen-Modus, gesperrte Lese): Felder gesperrt, die versteckten Felder tragen
   *  weiter den gespeicherten Wert */
  disabled?: boolean
  required?: boolean
  /** Rechnerische Qualitätsstufe aus °KMW neben den Feldern zeigen */
  qualitaetsVorschau?: boolean
  /** Hinweis bei höchstens ±0,5 °Oe um eine Stufenschwelle (KAN-134; Standard: an) */
  grenzfallHinweis?: boolean
  className?: string
}

function signatur(g: GespeichertesMostgewicht | null | undefined): string {
  return g ? `${g.kmw ?? ''}|${g.oechsle ?? ''}|${g.einheit ?? ''}` : ''
}

const kmwText = (kmw: number) => `${formatKmw(kmw, 2)} °KMW`
const oeText = (oe: number) => `${formatOechsle(oe)} °Oe`

export default function MostgewichtEingabe({
  name, altesFeld, startwert, anfangsZustand, bevorzugt, label = 'Mostgewicht', onChange, disabled = false, required = false,
  qualitaetsVorschau = false, grenzfallHinweis = true, className,
}: MostgewichtEingabeProps) {
  const betriebsEinheit = useMostgewichtEinheit()
  const zuerst = bevorzugt ?? betriebsEinheit
  const [zustand, setZustand] = useState<EingabeZustand>(() => anfangsZustand ?? eingabeStart(startwert, zuerst))
  const [startSignatur, setStartSignatur] = useState(() => signatur(startwert))
  const aktuelleSignatur = signatur(startwert)
  if (aktuelleSignatur !== startSignatur) {
    // Vorbelegung von außen geändert: neu beginnen (State beim Rendern anpassen statt Effekt)
    setStartSignatur(aktuelleSignatur)
    setZustand(eingabeStart(startwert, zuerst))
  }

  const kmwRef = useRef<HTMLInputElement>(null)
  const oeRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // Ungültige Eingabe blockiert das Absenden (Browser-Validierung vor dem submit-Ereignis)
    kmwRef.current?.setCustomValidity(zustand.gemessen === 'kmw' && zustand.fehler ? zustand.fehler : '')
    oeRef.current?.setCustomValidity(zustand.gemessen === 'oechsle' && zustand.fehler ? zustand.fehler : '')
  }, [zustand.gemessen, zustand.fehler])

  function aendern(einheit: MostgewichtEinheit, text: string) {
    const neu = eingabeAendern(zustand, einheit, text)
    setZustand(neu)
    onChange?.(neu.wert, { fehler: neu.fehler, zustand: neu })
  }

  const id = useId()
  const ids = { hinweis: `${id}-hinweis`, fehler: `${id}-fehler`, wechsel: `${id}-wechsel`, grenz: `${id}-grenz` }
  const wechsel = stufenwechsel(zustand)
  const grenz = grenzfallHinweis ? grenzfall(zustand.wert) : null
  const stufe = qualitaetsVorschau ? eingabeStufe(zustand) : null
  const versteckt = versteckteWerte(zustand)
  const reihenfolge = feldReihenfolge(zuerst)
  const beschreibung = [ids.hinweis, zustand.fehler && ids.fehler, wechsel && ids.wechsel, grenz && ids.grenz].filter(Boolean).join(' ')

  return (
    <fieldset className={`min-w-0 ${className ?? ''}`}>
      <legend className="block text-xs font-medium text-s112-text-2 mb-1">
        {label}{required && !disabled && <span className="text-s112-err" aria-hidden="true"> *</span>}
      </legend>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {reihenfolge.map(einheit => {
          const feldId = `${id}-${einheit}`
          const gemessen = einheit === zustand.gemessen
          const umgerechnet = !gemessen && zustand.text[einheit] !== ''
          const ungueltig = gemessen && !!zustand.fehler
          return (
            <div key={einheit} className="flex items-center gap-1">
              <span aria-hidden="true" title={umgerechnet ? 'umgerechnet' : undefined}
                className={`w-3 text-center text-sm text-s112-muted ${umgerechnet ? '' : 'invisible'}`}>≈</span>
              <input
                ref={einheit === 'kmw' ? kmwRef : oeRef}
                id={feldId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={zustand.text[einheit]}
                onChange={e => aendern(einheit, e.target.value)}
                disabled={disabled}
                required={required && !disabled && gemessen}
                placeholder={einheit === 'kmw' ? '17,4' : '84'}
                aria-invalid={ungueltig || undefined}
                aria-describedby={`${feldId}-status ${beschreibung}`}
                className={`w-24 border rounded-lg px-2.5 py-2.5 sm:py-1.5 text-base sm:text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-s112-teal/40 disabled:opacity-60 disabled:cursor-not-allowed ${
                  ungueltig ? 'border-s112-err' : umgerechnet ? 'border-dashed border-s112-border bg-s112-bg text-s112-text-2' : 'border-s112-border bg-white'
                }`}
              />
              <label htmlFor={feldId} className="text-sm text-s112-text-1 whitespace-nowrap">
                <span className="sr-only">{label} in </span>{EINHEIT_ZEICHEN[einheit]}
              </label>
              <span id={`${feldId}-status`} className="sr-only">
                {zustand.wert ? (gemessen ? 'gemessen' : 'umgerechnet, überschreibbar') : ''}
              </span>
            </div>
          )
        })}
        {stufe && (
          <span className="text-xs font-semibold px-2 py-1 rounded-full bg-s112-warn-bg text-s112-warn-fg whitespace-nowrap"
            title="Rechnerische Qualitätsstufe aus den °KMW">
            {qualitaetLabel(stufe)}
          </span>
        )}
      </div>

      <p id={ids.hinweis} className="text-[11px] text-s112-tertiary mt-1">
        {zustand.wert
          ? <>Gemessen in {EINHEIT_ZEICHEN[zustand.gemessen]}, ≈ = umgerechnet. Überschreibst du den umgerechneten Wert, gilt er als Messwert.</>
          : <>In {EINHEIT_ZEICHEN[reihenfolge[0]]} oder {EINHEIT_ZEICHEN[reihenfolge[1]]} eingeben – das andere Feld rechnet mit.</>}
      </p>

      {zustand.fehler && (
        <p id={ids.fehler} role="alert" className="text-xs text-s112-err-fg mt-1">{zustand.fehler}</p>
      )}

      {wechsel && zustand.wert && (
        <p id={ids.wechsel} role="status" className="text-xs text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-2.5 py-1.5 mt-1.5">
          <strong className="font-semibold">Stufenwechsel: {qualitaetLabel(wechsel.von)} → {qualitaetLabel(wechsel.nach)}.</strong>{' '}
          Der umgerechnete Wert gilt jetzt als Messwert in {EINHEIT_ZEICHEN[zustand.wert.einheit]}
          {' '}({zustand.wert.einheit === 'oechsle' ? `${oeText(zustand.wert.oechsle)} = ${kmwText(zustand.wert.kmw)}` : `${kmwText(zustand.wert.kmw)} = ${oeText(zustand.wert.oechsle)}`};
          {' '}vorher {wechsel.vorher.einheit === 'kmw' ? kmwText(wechsel.vorher.kmw) : oeText(wechsel.vorher.oechsle)} gemessen).
          {' '}Bitte prüfe, ob wirklich in {EINHEIT_ZEICHEN[zustand.wert.einheit]} gemessen wurde.
        </p>
      )}

      {grenz && zustand.wert && (
        <p id={ids.grenz} className="text-[11px] text-s112-text-2 bg-s112-bg border border-s112-border rounded-lg px-2.5 py-1.5 mt-1.5">
          {/* Verglichen wird in °Oe (KAN-134): gemessener °Oe-Wert, sonst der aus °KMW gerechnete */}
          <span className="font-semibold">Grenzfall:</span>{' '}
          {zustand.wert.einheit === 'oechsle'
            ? oeText(zustand.wert.oechsle)
            : <>{kmwText(zustand.wert.kmw)} (≈ {oeText(zustand.wert.oechsle)})</>} liegt nahe an der Schwelle
          für {qualitaetLabel(grenz.stufe)} (höchstens {formatOechsle(GRENZ_BAND_OECHSLE)} °Oe entfernt;
          {' '}{formatKmw(grenz.schwelleKmw, 1)} °KMW ≙ {formatOechsle(grenz.schwelleOechsle)} °Oe
          {grenz.bkiTabelle ? (
            <>
              {' '}laut{' '}
              <a href={BKI_ANREICHERUNGSTABELLE_URL} target="_blank" rel="noreferrer" className="text-s112-blue-700 underline hover:no-underline">
                BKI-Anreicherungstabelle, Anlage Ia
              </a>
            </>
          ) : (
            // Die BKI-Tabelle reicht nur von 11,5 bis 22,0 °KMW (Beerenauslese 25, TBA 30 stehen nicht darin)
            <> nach der Umrechnungsformel °Oe = °KMW × (4,54 + 0,022 × °KMW)</>
          )}). Im Zweifel nachmessen.
          {grenz.praedikatswein && <> Bei Prädikatswein zählt die Bestätigung der Mostwäger (§ 11 Abs. 2, § 12 Abs. 6 WeinG).</>}
        </p>
      )}

      <input type="hidden" name={`${name}_wert`} value={versteckt.wert} />
      <input type="hidden" name={`${name}_einheit`} value={versteckt.einheit} />
      {altesFeld && <input type="hidden" name={altesFeld} value={versteckt.kmw} />}
    </fieldset>
  )
}
