'use client'

// Stornieren bzw. Löschen mit Pflicht-Grund (KAN-145, KAN-166; 30.09.2026). Stornieren: Die Buchung bleibt stehen und
// wird gekennzeichnet (storno_grund). Löschen (modus="loeschen", z. B. Maßnahmen, Lagerbewegungen): die Zeile geht,
// der Grund steht im Änderungsprotokoll (bestandsprotokoll.grund). Grund jeweils mind. 10 Zeichen – Vorgabe:
// Stornieren und Löschen werden dokumentiert, Bearbeiten nicht.

import { useId, useState } from 'react'
import { Trash2, Undo2 } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { STORNO_GRUND_MIN, stornoGrundFehler } from '@/lib/storno/grund'
import { stornoDatumFehler } from '@/lib/storno/datum'

interface Props {
  /** Server Action mit dem Grund, dem optionalen Datum (siehe `datumFeld`) und dem Storno-Datum (siehe `stornoDatum`);
   *  `feld: 'datum'` zeigt die Ablehnung am Storno-Datum */
  action: (grund: string, datum: string | null, stornoDatum: string | null) => Promise<void | { error?: string; feld?: 'datum' }>
  /** Was passiert (z. B. „Quelle und Ziel werden zurückgebucht …“) */
  hinweis: string
  /** Beschriftung (Tooltip/Screenreader); Standard je Modus */
  label?: string
  /** 'storno' (Standard) oder 'loeschen' */
  modus?: 'storno' | 'loeschen'
  /** Nach Erfolg (z. B. router.refresh) */
  danach?: () => void
  /** KAN-149 D2b: optionales Datumsfeld (z. B. „Erstattet am“) – leer = null */
  datumFeld?: { label: string; hilfe?: string }
  /** KAN-379: Pflichtfeld „Storno-Datum“ (Stornobeleg, Rückbuchung) – vorbelegt mit heute, nicht vor `ab`
   *  (Beleg-/Rechnungsdatum), nicht in der Zukunft; den gesperrten Zeitraum prüft die Datenbank */
  stornoDatum?: { heute: string; ab?: string | null; hilfe?: string }
  /** Formular schwebend unter dem Knopf (rechtsbündig) statt in der Zelle – für schmale Aktionsspalten in Tabellen,
   *  deren Spaltenbreite sich beim Öffnen nicht ändern soll */
  schwebend?: boolean
}

export default function StornoButton({ action, hinweis, label, modus = 'storno', danach, datumFeld, stornoDatum, schwebend }: Props) {
  const loeschen = modus === 'loeschen'
  const text = label ?? (loeschen ? 'Löschen' : 'Stornieren')
  const id = useId()
  const [offen, setOffen] = useState(false)
  const [grund, setGrund] = useState('')
  const [datum, setDatum] = useState('')
  const [sDatum, setSDatum] = useState(stornoDatum?.heute ?? '')
  const [fehler, setFehler] = useState<string | null>(null)
  const [datumFehler, setDatumFehler] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function absenden() {
    const f = loeschen ? stornoGrundFehler(grund)?.replace('den Storno', 'das Löschen') ?? null : stornoGrundFehler(grund)
    const df = stornoDatum ? stornoDatumFehler(sDatum, stornoDatum) : null
    setFehler(f)
    setDatumFehler(df)
    if (f || df) return
    setPending(true)
    try {
      const r = await action(grund.trim(), datum || null, stornoDatum ? sDatum : null)
      if (r && 'error' in r && r.error) {
        if (r.feld === 'datum' && stornoDatum) setDatumFehler(r.error)
        else setFehler(r.error)
        return
      }
      setOffen(false)
      setGrund('')
      setDatum('')
      setSDatum(stornoDatum?.heute ?? '')
      danach?.()
    } catch (err) {
      setFehler(fehlerText(err, loeschen ? 'Löschen fehlgeschlagen' : 'Storno fehlgeschlagen'))
    } finally {
      setPending(false)
    }
  }

  const knopf = (
    <button type="button" onClick={() => { setOffen(o => (schwebend ? !o : true)); setFehler(null) }} title={text} aria-label={text}
      aria-expanded={schwebend ? offen : undefined}
      className="text-s112-err hover:text-s112-err-fg">
      {loeschen ? <Trash2 className="w-4 h-4" /> : <Undo2 className="w-4 h-4" />}
    </button>
  )

  if (!offen) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5 align-top">
        {knopf}
        {fehler && (
          <span role="alert" className="block text-[11px] leading-snug text-s112-err-fg w-[240px] max-w-[70vw] text-left whitespace-normal wrap-break-word">{fehler}</span>
        )}
      </span>
    )
  }

  const formular = (
    <span className={schwebend
      ? 'absolute right-0 top-full mt-1 z-30 flex flex-col items-stretch gap-1 w-[300px] max-w-[85vw] p-3 rounded-lg border border-s112-border bg-white shadow-lg text-left whitespace-normal'
      : 'inline-flex flex-col items-stretch gap-1 w-[280px] max-w-[80vw] text-left whitespace-normal align-top'}>
      <span className="text-[11px] leading-snug text-s112-text-2">{hinweis}</span>
      <label htmlFor={id} className="text-[11px] font-medium text-s112-text-1">
        {loeschen ? 'Grund des Löschens' : 'Grund des Stornos'} <span className="text-s112-err">*</span>
      </label>
      <textarea required id={id} value={grund} onChange={e => setGrund(e.target.value)} rows={2} autoFocus
        minLength={STORNO_GRUND_MIN} aria-invalid={!!fehler || undefined} aria-describedby={fehler ? `${id}-f` : undefined}
        placeholder="z. B. Menge falsch erfasst, doppelt gebucht"
        className="w-full border border-s112-border rounded-sm px-2 py-1 text-xs focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
      {stornoDatum && (
        <label className="text-[11px] font-medium text-s112-text-1">
          Storno-Datum <span className="text-s112-err">*</span>
          <input type="date" required value={sDatum} onChange={e => setSDatum(e.target.value)}
            min={stornoDatum.ab?.slice(0, 10) || undefined} max={stornoDatum.heute}
            aria-invalid={!!datumFehler || undefined} aria-describedby={datumFehler ? `${id}-df` : undefined}
            className="mt-0.5 block w-full border border-s112-border rounded-sm px-2 py-1 text-xs focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
          {datumFehler && <span id={`${id}-df`} role="alert" className="block font-normal text-s112-err-fg">{datumFehler}</span>}
          {stornoDatum.hilfe && <span className="block font-normal text-s112-muted">{stornoDatum.hilfe}</span>}
        </label>
      )}
      {datumFeld && (
        <label className="text-[11px] font-medium text-s112-text-1">
          {datumFeld.label}
          <input type="date" value={datum} onChange={e => setDatum(e.target.value)}
            className="mt-0.5 block w-full border border-s112-border rounded-sm px-2 py-1 text-xs focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
          {datumFeld.hilfe && <span className="block font-normal text-s112-muted">{datumFeld.hilfe}</span>}
        </label>
      )}
      {fehler && <span id={`${id}-f`} role="alert" className="text-[11px] leading-snug text-s112-err-fg">{fehler}</span>}
      <span className="flex justify-end gap-2">
        <button type="button" onClick={() => { setOffen(false); setFehler(null); setDatumFehler(null) }} disabled={pending}
          className="text-xs text-s112-text-2 hover:text-s112-text-1 px-1">Abbrechen</button>
        <button type="button" onClick={absenden} disabled={pending}
          className="text-xs bg-s112-err text-white px-2 py-0.5 rounded-sm font-medium disabled:opacity-50">
          {pending ? '…' : text}
        </button>
      </span>
    </span>
  )

  if (!schwebend) return formular
  return (
    <span className="relative inline-flex flex-col items-end align-top">
      {knopf}
      {formular}
    </span>
  )
}
