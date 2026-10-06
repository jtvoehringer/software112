'use client'

// Stornieren bzw. Löschen mit Pflicht-Grund (KAN-145, KAN-166; 30.09.2026). Stornieren: Die Buchung bleibt stehen und
// wird gekennzeichnet (storno_grund). Löschen (modus="loeschen", z. B. Maßnahmen, Lagerbewegungen): die Zeile geht,
// der Grund steht im Änderungsprotokoll (bestandsprotokoll.grund). Grund jeweils mind. 10 Zeichen – Vorgabe:
// Stornieren und Löschen werden dokumentiert, Bearbeiten nicht.

import { useId, useState } from 'react'
import { Trash2, Undo2 } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { STORNO_GRUND_MIN, stornoGrundFehler } from '@/lib/storno/grund'

interface Props {
  /** Server Action mit dem Grund (und dem optionalen Datum, siehe `datumFeld`) */
  action: (grund: string, datum: string | null) => Promise<void | { error?: string }>
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
  /** Formular schwebend unter dem Knopf (rechtsbündig) statt in der Zelle – für schmale Aktionsspalten in Tabellen,
   *  deren Spaltenbreite sich beim Öffnen nicht ändern soll */
  schwebend?: boolean
}

export default function StornoButton({ action, hinweis, label, modus = 'storno', danach, datumFeld, schwebend }: Props) {
  const loeschen = modus === 'loeschen'
  const text = label ?? (loeschen ? 'Löschen' : 'Stornieren')
  const id = useId()
  const [offen, setOffen] = useState(false)
  const [grund, setGrund] = useState('')
  const [datum, setDatum] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function absenden() {
    const f = loeschen ? stornoGrundFehler(grund)?.replace('den Storno', 'das Löschen') ?? null : stornoGrundFehler(grund)
    if (f) { setFehler(f); return }
    setFehler(null)
    setPending(true)
    try {
      const r = await action(grund.trim(), datum || null)
      if (r && 'error' in r && r.error) { setFehler(r.error); return }
      setOffen(false)
      setGrund('')
      setDatum('')
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
      <textarea id={id} value={grund} onChange={e => setGrund(e.target.value)} rows={2} autoFocus
        minLength={STORNO_GRUND_MIN} aria-invalid={!!fehler || undefined} aria-describedby={fehler ? `${id}-f` : undefined}
        placeholder="z. B. Menge falsch erfasst, doppelt gebucht"
        className="w-full border border-s112-border rounded-sm px-2 py-1 text-xs focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
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
        <button type="button" onClick={() => { setOffen(false); setFehler(null) }} disabled={pending}
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
