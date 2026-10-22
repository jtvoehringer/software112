'use client'

// ── Rückfrage-Dialog (KAN-359, 22.10.2026) ──
// Ersetzt window.confirm in der ganzen App: einmal im Root-Layout eingebunden, zeigt die erste offene Rückfrage aus
// src/lib/ui/rueckfrage.ts (Aufruf: `await rueckfrage({ titel, text, bestaetigen, gefaehrlich })`).
//  - role="alertdialog", aria-modal, Titel und Text als Name bzw. Beschreibung
//  - Fokus beim Öffnen auf „Abbrechen“ (gefährlich) bzw. den Bestätigungsknopf; Tab bleibt im Dialog
//  - Esc = Abbrechen; ein Klick neben den Dialog schließt bewusst nicht (Rückfrage verlangt eine Antwort)
//  - danach Fokus zurück zum auslösenden Element
//  - am Handy unten angedockt, Knöpfe in voller Breite; scrollt selbst (max-h in dvh, Wächter check-dialoge)

import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import { abonniereRueckfragen, antwortAufTaste, beantworte, offeneRueckfrage, startFokus, wirtAnmelden } from '@/lib/ui/rueckfrage'

const keine = () => null

export default function RueckfrageDialog() {
  const frage = useSyncExternalStore(abonniereRueckfragen, offeneRueckfrage, keine)
  const panel = useRef<HTMLDivElement>(null)
  const abbrechenRef = useRef<HTMLButtonElement>(null)
  const bestaetigenRef = useRef<HTMLButtonElement>(null)
  const titelId = useId()
  const textId = useId()

  useEffect(() => wirtAnmelden(), [])

  const id = frage?.id ?? null
  const gefaehrlich = frage?.gefaehrlich ?? false
  useEffect(() => {
    if (id === null) return
    const vorher = document.activeElement as HTMLElement | null
    const t = window.setTimeout(() => {
      ;(startFokus({ gefaehrlich }) === 'abbrechen' ? abbrechenRef : bestaetigenRef).current?.focus()
    }, 0)
    const taste = (e: KeyboardEvent) => {
      const antwort = antwortAufTaste(e.key)
      if (antwort !== null) {
        e.preventDefault()
        e.stopPropagation()
        beantworte(id, antwort)
        return
      }
      if (e.key !== 'Tab') return
      // Fokusfalle: nur die zwei Knöpfe (Reihenfolge im DOM: Abbrechen, Bestätigen)
      const erstes = abbrechenRef.current, letztes = bestaetigenRef.current
      if (!erstes || !letztes) return
      if (e.shiftKey && document.activeElement === erstes) { e.preventDefault(); letztes.focus() }
      else if (!e.shiftKey && document.activeElement === letztes) { e.preventDefault(); erstes.focus() }
      else if (!panel.current?.contains(document.activeElement)) { e.preventDefault(); erstes.focus() }
    }
    document.addEventListener('keydown', taste, true)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', taste, true)
      if (vorher && document.contains(vorher)) vorher.focus()
    }
  }, [id, gefaehrlich])

  if (!frage) return null
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 p-4 print:hidden" data-rueckfrage>
      <div ref={panel} role="alertdialog" aria-modal="true" aria-labelledby={titelId} aria-describedby={frage.text ? textId : undefined}
        className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-xl shadow-2xl p-5">
        <div className="flex items-start gap-3">
          {frage.gefaehrlich
            ? <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-s112-err" aria-hidden="true" />
            : <HelpCircle className="w-5 h-5 mt-0.5 shrink-0 text-s112-blue-700" aria-hidden="true" />}
          <div className="min-w-0 space-y-2">
            <h2 id={titelId} className="text-base font-semibold text-s112-text break-words">{frage.titel}</h2>
            {frage.text && <p id={textId} className="text-sm text-s112-text-1 whitespace-pre-line break-words">{frage.text}</p>}
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button ref={abbrechenRef} type="button" onClick={() => beantworte(frage.id, false)} className="btn-secondary w-full sm:w-auto min-h-11 sm:min-h-0">
            {frage.abbrechen}
          </button>
          <button ref={bestaetigenRef} type="button" onClick={() => beantworte(frage.id, true)}
            className={frage.gefaehrlich
              ? 'w-full sm:w-auto min-h-11 sm:min-h-0 px-4 py-2 rounded-lg font-medium bg-s112-err text-white hover:opacity-90 focus:outline-hidden focus:ring-2 focus:ring-s112-err focus:ring-offset-2'
              : 'btn-primary w-full sm:w-auto min-h-11 sm:min-h-0'}>
            {frage.bestaetigen}
          </button>
        </div>
      </div>
    </div>
  )
}
