'use client'

// KAN-326 (UAT 11.10.2026): Felder „Einkauf (mit E/A-Ausgabe)“ für das PSM- und das Dünger-Lager – wie beim Betriebsmittel-
// Einkauf (KAN-167/KAN-223): Netto-Betrag, USt-Satz, Ausgaben-Kategorie und Lieferant. Gebucht wird über die RPC
// s112_lager_einkauf (Lagerbuchung und Ausgabe in einer Transaktion).

import { useState } from 'react'
import { zahlAus, zahlLokal } from '@/lib/format'
import { bmBrutto } from '@/lib/behandlungen/betriebsmittel'

export type Auswahl = { id: string; name: string }
export type EinkaufCtx = {
  kategorien: Auswahl[]
  lieferanten: Auswahl[]
  /** null = Einkauf mit Ausgabe möglich; sonst der Grund (Modul E&A aus, kein Schreibrecht E&A) */
  einkaufSperre: string | null
}

/** Wert der Typ-Auswahl für den Einkauf mit Ausgabe (die Lagerbuchung selbst hat typ 'einkauf') */
export const TYP_EINKAUF_EA = 'einkauf_ea'

const feld = 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
const lbl = 'block text-xs font-medium text-s112-text-2 mb-1'

export default function EinkaufAusgabeFelder({ ctx }: { ctx: EinkaufCtx }) {
  const [netto, setNetto] = useState('')
  const [ust, setUst] = useState('20')
  const nettoZahl = zahlAus(netto) ?? NaN
  return (
    <>
      <div>
        <label className={lbl}>Betrag netto (€) *</label>
        <input aria-label="Betrag netto" name="betrag_netto" type="text" inputMode="decimal" required value={netto} onChange={e => setNetto(e.target.value)} className={feld} />
      </div>
      <div>
        <label className={lbl}>USt-Satz</label>
        <select aria-label="USt-Satz" name="ust_satz" value={ust} onChange={e => setUst(e.target.value)} className={feld}>
          {['20', '13', '10', '0'].map(s => <option key={s} value={s}>{s} %</option>)}
        </select>
      </div>
      <div>
        <label className={lbl}>Ausgaben-Kategorie (E&A) *</label>
        <select aria-label="Ausgaben-Kategorie" name="ea_kategorie_id" required defaultValue="" className={feld}>
          <option value="">– Auswählen –</option>
          {ctx.kategorien.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </div>
      <div>
        <label className={lbl}>Lieferant</label>
        <select aria-label="Lieferant" name="lieferant_firma_id" defaultValue="" className={feld}>
          <option value="">– ohne –</option>
          {ctx.lieferanten.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <p className="col-span-2 text-xs text-s112-muted">
        Beim Speichern wird zugleich die Ausgabe unter Belege &amp; BMD gebucht
        {Number.isFinite(nettoZahl) ? ` (brutto € ${zahlLokal(bmBrutto(nettoZahl, Number(ust)), { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : ''}.
        Ein Einkauf lässt sich danach nicht mehr ändern, nur stornieren – die Ausgabe wird dabei mitstorniert.
      </p>
    </>
  )
}
