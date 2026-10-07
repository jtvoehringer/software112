'use client'

// KAN-186 Etappe 2b/2c (02.10.2026): Felder „Zusatzbezeichnung“ und „Erzeugnis“ neben der Qualitätsstufe – Charge,
// Füllung, Zukauf, Eröffnungsbestand. Formularfelder: zusatzbezeichnung (leer = keine) und erzeugnis (leer = Wein).
// Die Server Actions lesen sie mit qualitaetsAngabeAusFormular() und prüfen mit qualitaetsAngabeFehler()
// (Zusatz nur auf Qualitätswein und nur bei Stillwein, Sekt g.U. ab Qualitätswein).
//
// Zwei <div>-Blöcke ohne eigenes Raster – sie fügen sich in das Raster des Formulars ein.

import { useState } from 'react'
import { ERZEUGNIS_OPTS, ERZEUGNIS_OHNE_ZUSATZ, ZUSATZ_OPTS, zusatzLabel } from '@/lib/wein/qualitaet'
import { GRUNDSTUFE_ZUSATZ } from '@/lib/wein/qualitaetsrang'

export interface ZusatzErzeugnisFelderProps {
  /** gespeicherte bzw. vorbelegte Werte (normalisiert, siehe normalisiereQualitaet) */
  zusatz?: string | null
  erzeugnis?: string | null
  /** gewählte Qualitätsstufe, falls das Formular sie kennt – Zusatzbezeichnung nur bei Qualitätswein */
  stufe?: string | null
  /** Felder nur anzeigen (z. B. Charge aus einer Pressung); die Werte gehen als versteckte Felder mit */
  nurAnzeige?: boolean
  /** CSS-Klassen der Auswahlfelder (Standard form-input) */
  feldKlasse?: string
  labelKlasse?: string
  /** KAN-190: Rückmeldung der gewählten Erzeugnis-Auswahl (z. B. Tirage-Felder nur bei Sekt g.U.) */
  onErzeugnis?: (erzeugnis: string) => void
}

export default function ZusatzErzeugnisFelder({
  zusatz = null, erzeugnis = null, stufe, nurAnzeige = false, feldKlasse = 'form-input', labelKlasse = 'form-label', onErzeugnis,
}: ZusatzErzeugnisFelderProps) {
  const [z, setZ] = useState<string>(zusatz ?? '')
  const [e, setE] = useState<string>(erzeugnis ?? '')
  const ohneZusatz = !!e && ERZEUGNIS_OHNE_ZUSATZ.includes(e)
  const stufePasst = stufe === undefined || stufe === null || stufe === '' || stufe === GRUNDSTUFE_ZUSATZ
  // Erzeugnis außerhalb der Auswahl (z. B. MOST am Zukauf) bleibt sichtbar
  const erzeugnisOptionen = erzeugnis && !ERZEUGNIS_OPTS.some(o => o.value === erzeugnis)
    ? [{ value: erzeugnis, label: `${erzeugnis} (bisheriger Wert)` }, ...ERZEUGNIS_OPTS]
    : ERZEUGNIS_OPTS
  const zusatzWert = ohneZusatz ? '' : z

  if (nurAnzeige) {
    return (
      <>
        <input type="hidden" name="zusatzbezeichnung" value={zusatz ?? ''} />
        <input type="hidden" name="erzeugnis" value={erzeugnis ?? ''} />
        <div>
          <label className={labelKlasse}>Zusatzbezeichnung</label>
          <div className={`${feldKlasse} bg-s112-bg text-s112-text-2`}>{zusatzLabel(zusatz) ?? '–'}</div>
        </div>
        <div>
          <label className={labelKlasse}>Erzeugnis</label>
          <div className={`${feldKlasse} bg-s112-bg text-s112-text-2`}>{ERZEUGNIS_OPTS.find(o => o.value === erzeugnis)?.label ?? erzeugnis ?? 'Wein'}</div>
        </div>
      </>
    )
  }

  return (
    <>
      <div>
        <label className={labelKlasse} htmlFor="zusatzbezeichnung">Zusatzbezeichnung</label>
        <select id="zusatzbezeichnung" name="zusatzbezeichnung" aria-label="Zusatzbezeichnung" className={feldKlasse}
          value={zusatzWert} disabled={ohneZusatz} onChange={ev => setZ(ev.target.value)}>
          <option value="">– keine –</option>
          {ZUSATZ_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {ohneZusatz
          ? <p className="text-xs text-s112-muted mt-1">Bei Sekt, Perlwein, Schaumwein und PetNat gibt es keine Zusatzbezeichnung.</p>
          : zusatzWert && !stufePasst
            ? <p className="text-xs text-s112-warn-fg mt-1">Nur auf Qualitätswein – bitte als Stufe „Qualitätswein“ wählen (auch bei DAC-Herkunft).</p>
            : <p className="text-xs text-s112-muted mt-1">Nur bei Stillwein auf Qualitätswein.</p>}
      </div>
      <div>
        <label className={labelKlasse} htmlFor="erzeugnis">Erzeugnis</label>
        <select id="erzeugnis" name="erzeugnis" aria-label="Erzeugnis" className={feldKlasse}
          value={e} onChange={ev => { setE(ev.target.value); onErzeugnis?.(ev.target.value) }}>
          <option value="">Wein</option>
          {erzeugnisOptionen.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {e === 'SEKTGU' && <p className="text-xs text-s112-muted mt-1">Sekt g.U. setzt Qualitätswein voraus.</p>}
      </div>
    </>
  )
}
