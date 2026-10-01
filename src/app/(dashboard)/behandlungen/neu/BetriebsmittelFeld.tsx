'use client'

// KAN-167 (01.10.2026): Betriebsmittel (Weinbehandlungs- bzw. Produktionsmittel) bei „Sonstiges“ und „Laubarbeit“ –
// statt eines Pflanzenschutzmittels. Aufwand je ha (× Fläche der gewählten Grundstücke) oder gesamt; der Verbrauch
// wird vom Lager des Mittels abgezogen. Felder: betriebsmittel_id, bm_aufwand, bm_aufwand_einheit (Server Action).

import { fmtNum, zahlAus } from '@/lib/format'
import {
  BM_AUFWAND_EINHEITEN, BM_AUFWAND_LABEL, BM_EINHEIT_LABEL, GRUPPE_LABEL, bmVerbrauch, type BetriebsmittelGruppe,
} from '@/lib/behandlungen/betriebsmittel'

export type BmMassnahmeOption = { id: string; name: string; gruppe: BetriebsmittelGruppe; einheit: string; preis_pro_einheit: number | null }

const feld = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'

/** Standard-Aufwandseinheit zur Einheit des Mittels (je ha) */
export function bmStandardAufwand(einheit: string | undefined): string {
  return einheit === 'kg' || einheit === 'g' ? 'kg_ha' : einheit === 'l' || einheit === 'ml' ? 'l_ha' : einheit === 'm' ? 'm_ha' : 'stk_ha'
}

/** Verbrauch der Maßnahme in der Einheit des Mittels (für Anzeige und Material-Vorschlag) */
export function bmVerbrauchFormular(opt: BmMassnahmeOption | undefined, aufwand: string, einheit: string, flaecheHa: number) {
  if (!opt) return null
  const a = zahlAus(aufwand)
  return bmVerbrauch({ aufwand: a, aufwandEinheit: einheit, flaecheHa }, opt.einheit)
}

export default function BetriebsmittelFeld({
  optionen, wert, aufwand, aufwandEinheit, flaecheHa, gesperrtDurchPsm, onWert, onAufwand, onAufwandEinheit,
}: {
  optionen: BmMassnahmeOption[]
  wert: string; aufwand: string; aufwandEinheit: string; flaecheHa: number
  /** Sonstiges: ein Pflanzenschutzmittel ist gewählt – entweder PSM oder Betriebsmittel */
  gesperrtDurchPsm: boolean
  onWert: (v: string) => void; onAufwand: (v: string) => void; onAufwandEinheit: (v: string) => void
}) {
  const gewaehlt = optionen.find(o => o.id === wert)
  const v = bmVerbrauchFormular(gewaehlt, aufwand, aufwandEinheit, flaecheHa)
  return (
    <div className="space-y-2">
      <div>
        <label className="block text-sm font-medium text-s112-text-1 mb-1">Betriebsmittel (Weinbehandlungs- bzw. Produktionsmittel)</label>
        <select aria-label="Betriebsmittel" name="betriebsmittel_id" value={wert} disabled={gesperrtDurchPsm}
          onChange={e => { onWert(e.target.value); onAufwandEinheit(bmStandardAufwand(optionen.find(o => o.id === e.target.value)?.einheit)) }}
          className={feld}>
          <option value="">– keines –</option>
          {(['weinbehandlung', 'produktion'] as const).map(g => {
            const liste = optionen.filter(o => o.gruppe === g)
            return liste.length > 0 && (
              <optgroup key={g} label={GRUPPE_LABEL[g]}>
                {liste.map(o => <option key={o.id} value={o.id}>{o.name} ({BM_EINHEIT_LABEL[o.einheit] ?? o.einheit})</option>)}
              </optgroup>
            )
          })}
        </select>
        {gesperrtDurchPsm && <p className="text-xs text-s112-muted mt-1">Es ist bereits ein Pflanzenschutzmittel gewählt – je Maßnahme entweder PSM oder Betriebsmittel.</p>}
      </div>
      {gewaehlt && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Aufwand</label>
            <input aria-label="Aufwand Betriebsmittel" name="bm_aufwand" type="text" inputMode="decimal" value={aufwand}
              onChange={e => onAufwand(e.target.value)} placeholder="optional" className={feld} />
          </div>
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Einheit</label>
            <select aria-label="Einheit Aufwand Betriebsmittel" name="bm_aufwand_einheit" value={aufwandEinheit}
              onChange={e => onAufwandEinheit(e.target.value)} className={feld}>
              {BM_AUFWAND_EINHEITEN.map(e => <option key={e} value={e}>{BM_AUFWAND_LABEL[e]}</option>)}
            </select>
          </div>
          {aufwand.trim() !== '' && v && (
            <p className={`col-span-2 text-xs ${v.menge !== null ? 'text-s112-blue-700' : 'text-s112-warn-fg'}`}>
              {v.menge !== null
                ? `Verbrauch: ${fmtNum(v.menge, { max: 3 })} ${BM_EINHEIT_LABEL[gewaehlt.einheit] ?? gewaehlt.einheit} (${v.basis}) – wird vom Lager abgezogen.`
                : `Kein Abzug vom Lager: ${v.warnung}.`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
