'use client'

// KAN-176 (07.10.2026): abweichende Lieferadresse beim Verkauf – gespeicherte Adresse des Kunden wählen oder eine neue
// erfassen, mit der Frage, ob sie beim Kunden für die Zukunft (zusätzlich) gespeichert werden soll.

import { lieferadresseKurz, type Lieferadresse } from '@/lib/crm/lieferadressen'

export type LieferWahl = {
  abweichend: boolean
  /** id einer gespeicherten Adresse oder 'neu' */
  wahl: string
  neu: { bezeichnung: string; empfaenger: string; strasse: string; plz: string; ort: string; land: string }
  speichern: boolean
}

export const LIEFER_LEER: LieferWahl = {
  abweichend: false, wahl: '', speichern: true,
  neu: { bezeichnung: '', empfaenger: '', strasse: '', plz: '', ort: '', land: 'AT' },
}

const inp = 'border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white w-full'

export default function LieferadresseWahl({ adressen, wert, onChange, disabled }: {
  adressen: (Lieferadresse & { id: string })[]
  wert: LieferWahl
  onChange: (w: LieferWahl) => void
  disabled?: boolean
}) {
  const setze = (teil: Partial<LieferWahl>) => onChange({ ...wert, ...teil })
  const setzeNeu = (teil: Partial<LieferWahl['neu']>) => onChange({ ...wert, neu: { ...wert.neu, ...teil } })
  const wahl = wert.wahl || (adressen.length > 0 ? adressen[0].id : 'neu')
  const neu = wahl === 'neu'

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={wert.abweichend} disabled={disabled}
          onChange={e => setze({ abweichend: e.target.checked, wahl: e.target.checked ? wahl : '' })} className="accent-s112-teal w-4 h-4" />
        Lieferadresse abweichend von der Rechnungsadresse
      </label>
      {wert.abweichend && (
        <div className="rounded-xl border border-s112-line p-3 space-y-3">
          {adressen.length > 0 && (
            <div>
              <label htmlFor="liefer-wahl" className="block text-xs font-medium text-s112-text-2 mb-1">Lieferadresse</label>
              <select id="liefer-wahl" value={wahl} disabled={disabled} onChange={e => setze({ wahl: e.target.value })} className={inp}>
                {adressen.map(a => <option key={a.id} value={a.id}>{lieferadresseKurz(a)}</option>)}
                <option value="neu">+ Neue Lieferadresse …</option>
              </select>
            </div>
          )}
          {neu && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label htmlFor="liefer-bez" className="block text-xs text-s112-text-2 mb-0.5">Bezeichnung</label>
                <input id="liefer-bez" value={wert.neu.bezeichnung} onChange={e => setzeNeu({ bezeichnung: e.target.value })} placeholder="z. B. Lager, Filiale" className={inp} /></div>
              <div><label htmlFor="liefer-empf" className="block text-xs text-s112-text-2 mb-0.5">Empfänger (z. H.)</label>
                <input id="liefer-empf" value={wert.neu.empfaenger} onChange={e => setzeNeu({ empfaenger: e.target.value })} className={inp} /></div>
              <div className="sm:col-span-2"><label htmlFor="liefer-str" className="block text-xs text-s112-text-2 mb-0.5">Straße und Hausnummer *</label>
                <input id="liefer-str" value={wert.neu.strasse} required onChange={e => setzeNeu({ strasse: e.target.value })} className={inp} /></div>
              <div><label htmlFor="liefer-plz" className="block text-xs text-s112-text-2 mb-0.5">PLZ *</label>
                <input id="liefer-plz" value={wert.neu.plz} required onChange={e => setzeNeu({ plz: e.target.value })} className={inp} /></div>
              <div><label htmlFor="liefer-ort" className="block text-xs text-s112-text-2 mb-0.5">Ort *</label>
                <input id="liefer-ort" value={wert.neu.ort} required onChange={e => setzeNeu({ ort: e.target.value })} className={inp} /></div>
              <div><label htmlFor="liefer-land" className="block text-xs text-s112-text-2 mb-0.5">Land (ISO)</label>
                <input id="liefer-land" value={wert.neu.land} onChange={e => setzeNeu({ land: e.target.value })} className={inp} /></div>
              <label className="sm:col-span-2 flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={wert.speichern} onChange={e => setze({ speichern: e.target.checked })} className="accent-s112-teal w-4 h-4" />
                {adressen.length > 0
                  ? 'Diese Lieferadresse beim Kunden zusätzlich speichern'
                  : 'Diese Lieferadresse beim Kunden für künftige Verkäufe speichern'}
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Formularfelder für die Server Action */
export function lieferFormFelder(w: LieferWahl, adressen: { id: string }[]): Record<string, string> {
  if (!w.abweichend) return {}
  const wahl = w.wahl || (adressen.length > 0 ? adressen[0].id : 'neu')
  if (wahl !== 'neu') return { lieferadresse_id: wahl }
  return { lieferadresse_json: JSON.stringify(w.neu), lieferadresse_speichern: w.speichern ? '1' : '' }
}
