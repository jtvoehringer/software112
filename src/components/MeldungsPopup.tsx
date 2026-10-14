'use client'

// ── Meldungen als Pop-up (KAN-338, 14.10.2026) ──
// Zeigt eine neue Fehlermeldung bzw. Bestätigung zusätzlich als Pop-up rechts unten, wenn sie als Antwort auf eine
// Aktion (Absenden, Knopf) erscheint und gerade nicht sichtbar ist – z. B. der Fehlerkasten oben in einem langen
// Formular, während man unten auf „Speichern“ geklickt hat. Fehler bleiben, bis man sie schließt („Zur Meldung“ scrollt
// zum Kasten), Bestätigungen verschwinden nach 5 Sekunden. Regeln in src/lib/ui/meldungen.ts.
// Die Original-Meldung trägt role="alert"/"status" und wird vorgelesen; das Pop-up selbst ist deshalb aria-live="off".

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { meldungsArt, popupText, popupZeigen, vollSichtbar, OK_DAUER_MS, type MeldungsArt } from '@/lib/ui/meldungen'

type Popup = { id: number; art: MeldungsArt; text: string; ziel: WeakRef<Element> }

const KANDIDATEN = '[role="alert"], [role="status"], .bg-s112-err-bg, .bg-s112-ok-bg, p.text-s112-err-fg, div.text-s112-err-fg'

function art(el: Element): MeldungsArt | null {
  return meldungsArt({ tag: el.tagName, className: typeof el.className === 'string' ? el.className : '', role: el.getAttribute('role'), text: el.textContent ?? '' })
}

export default function MeldungsPopup() {
  const pfad = usePathname()
  const [popups, setPopups] = useState<Popup[]>([])
  const gesehen = useRef(new WeakMap<Element, string>())
  const aktion = useRef<{ zeit: number; pfad: string } | null>(null)
  const pfadRef = useRef(pfad)
  const naechsteId = useRef(1)
  const wurzel = useRef<HTMLDivElement>(null)
  const erneutPruefen = useRef<() => void>(() => {})

  useEffect(() => { pfadRef.current = pfad }, [pfad])

  // Aktionen des Benutzers: Absenden und Klicks auf Knöpfe (keine Links – das ist Navigation)
  useEffect(() => {
    const merke = (e?: Event) => {
      aktion.current = { zeit: Date.now(), pfad: window.location.pathname }
      // Absenden mit demselben Fehler wie zuvor ändert nichts im DOM – dann den Fehler nach kurzer Zeit erneut zeigen
      if (e?.type === 'submit') window.setTimeout(() => erneutPruefen.current(), 700)
    }
    const klick = (e: Event) => {
      const z = e.target as Element | null
      if (z?.closest?.('button, [role="button"], input[type="submit"]') && !wurzel.current?.contains(z)) merke()
    }
    document.addEventListener('submit', merke, true)
    document.addEventListener('click', klick, true)
    return () => { document.removeEventListener('submit', merke, true); document.removeEventListener('click', klick, true) }
  }, [])

  useEffect(() => {
    const pruefe = (el: Element) => {
      if (wurzel.current?.contains(el)) return
      const a = art(el)
      if (!a) return
      const text = popupText(el.textContent ?? '')
      if (gesehen.current.get(el) === text) return
      gesehen.current.set(el, text)
      // erst nach dem Zeichnen messen (Scrollen nach dem Speichern, Layout)
      window.setTimeout(() => {
        if (!el.isConnected) return
        const zeigen = popupZeigen({
          jetzt: Date.now(),
          letzteAktion: aktion.current?.zeit ?? null,
          pfadBeiAktion: aktion.current?.pfad ?? null,
          pfadJetzt: window.location.pathname,
          sichtbar: vollSichtbar(el.getBoundingClientRect(), window.innerHeight),
        })
        if (!zeigen) return
        setPopups(alt => alt.some(p => p.text === text) ? alt : [...alt.slice(-2), { id: naechsteId.current++, art: a, text, ziel: new WeakRef(el) }])
      }, 150)
    }
    // nach dem Absenden: alle Fehler, die dann außer Sicht stehen, gelten als Antwort (auch wenn unverändert)
    erneutPruefen.current = () => {
      document.querySelectorAll(KANDIDATEN).forEach(el => {
        if (art(el) === 'fehler') { gesehen.current.delete(el); pruefe(el) }
      })
    }
    // Bestand beim Start: gilt als gesehen
    document.querySelectorAll(KANDIDATEN).forEach(el => { if (art(el)) gesehen.current.set(el, popupText(el.textContent ?? '')) })
    const beobachter = new MutationObserver(eintraege => {
      const kandidaten = new Set<Element>()
      for (const e of eintraege) {
        const start = e.type === 'characterData' ? e.target.parentElement : (e.target as Element)
        if (start instanceof Element) {
          const m = start.closest(KANDIDATEN)
          if (m) kandidaten.add(m)
        }
        e.addedNodes.forEach(n => {
          if (!(n instanceof Element)) return
          if (n.matches(KANDIDATEN)) kandidaten.add(n)
          n.querySelectorAll(KANDIDATEN).forEach(k => kandidaten.add(k))
        })
      }
      kandidaten.forEach(pruefe)
    })
    beobachter.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => beobachter.disconnect()
  }, [])

  // Seitenwechsel: alte Pop-ups weg
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Pop-ups gehören zur Seite, auf der die Aktion war
  useEffect(() => { setPopups([]) }, [pfad])

  // Bestätigungen verschwinden von selbst
  useEffect(() => {
    const oks = popups.filter(p => p.art === 'ok')
    if (oks.length === 0) return
    const t = window.setTimeout(() => setPopups(alt => alt.filter(p => !oks.some(o => o.id === p.id))), OK_DAUER_MS)
    return () => window.clearTimeout(t)
  }, [popups])

  // Esc schließt das neueste
  useEffect(() => {
    if (popups.length === 0) return
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') setPopups(alt => alt.slice(0, -1)) }
    document.addEventListener('keydown', taste)
    return () => document.removeEventListener('keydown', taste)
  }, [popups.length])

  const schliessen = (id: number) => setPopups(alt => alt.filter(p => p.id !== id))
  const zurMeldung = (p: Popup) => {
    p.ziel.deref()?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    schliessen(p.id)
  }

  return (
    <div ref={wurzel} aria-live="off" className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(26rem,calc(100vw-2rem))] print:hidden" data-meldungs-popup>
      {popups.map(p => (
        <div key={p.id} className={`flex items-start gap-2.5 rounded-xl border shadow-lg px-4 py-3 text-sm ${
          p.art === 'fehler' ? 'bg-s112-err-bg border-s112-err/40 text-s112-err-fg' : 'bg-s112-ok-bg border-s112-ok/40 text-s112-ok-fg'}`}>
          {p.art === 'fehler'
            ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
          <div className="min-w-0 flex-1">
            <p className="font-medium break-words line-clamp-4">{p.text}</p>
            {p.art === 'fehler' && (
              <button type="button" onClick={() => zurMeldung(p)} className="mt-1.5 text-xs font-semibold underline hover:no-underline">
                Zur Meldung
              </button>
            )}
          </div>
          <button type="button" onClick={() => schliessen(p.id)} aria-label="Meldung schließen" className="shrink-0 hover:opacity-70">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
