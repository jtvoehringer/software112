'use client'

// ── Meldungen als Pop-up (KAN-338, 14.10.2026; KAN-359, 22.10.2026) ──
// Die eine Stelle für Pop-ups der App (Root-Layout; am Handy oben unter der Kopfleiste, ab md unten rechts):
//  - Fehler-Hinweis: Erscheint eine Fehlermeldung als Antwort auf eine Aktion (Absenden, Knopf) außer Sicht – z. B. der
//    Fehlerkasten oben in einem langen Formular, während man unten auf „Speichern“ geklickt hat –, steht hier nur der
//    Hinweis „Fehlermeldung außer Sicht“ mit „Zur Meldung“ (scrollt zum Kasten). Der Text selbst steht nur am Formular
//    bzw. Feld (KAN-359: kein zweiter Ort für den Text). Der Hinweis bleibt, bis man ihn schließt.
//  - Erfolg (Toast): aus src/lib/ui/erfolg.ts (zeigeErfolg, erledigt-Parameter, grüne Kästen außer Sicht), role="status",
//    verschwindet nach OK_DAUER_MS, schließbar. Regeln in src/lib/ui/meldungen.ts bzw. erfolg.ts.
// Die Fehlermeldung am Formular trägt role="alert" und wird dort vorgelesen; der Hinweis selbst ist deshalb aria-live="off".

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { hinweisGueltig, meldungsArt, meldungsZiel, popupText, popupZeigen, vollSichtbar, OK_DAUER_MS, type MeldungsArt } from '@/lib/ui/meldungen'
import { abonniereErfolge, aktuelleErfolge, keineErfolge, letzterErfolgZeit, schliesseErfolg, zeigeErfolg } from '@/lib/ui/erfolg'

/** Hinweis auf eine Fehlermeldung außer Sicht – der Text dient nur zum Wiederfinden, angezeigt wird er nicht */
type Popup = { id: number; art: 'fehler'; text: string; ziel: WeakRef<Element>; erstellt: number }

const KANDIDATEN = '[role="alert"], [role="status"], .bg-s112-err-bg, .bg-s112-ok-bg, p.text-s112-err-fg, div.text-s112-err-fg'

function art(el: Element): MeldungsArt | null {
  return meldungsArt({ tag: el.tagName, className: typeof el.className === 'string' ? el.className : '', role: el.getAttribute('role'), text: el.textContent ?? '' })
}

/** Angezeigte Meldungen der Seite (für „Zur Meldung“ und die Gültigkeit eines Hinweises) */
function seitenKandidaten(wurzel: HTMLElement | null) {
  return Array.from(document.querySelectorAll(KANDIDATEN))
    .filter(el => !wurzel?.contains(el))
    .map(el => ({ el, art: art(el), text: el.textContent ?? '', angezeigt: el.getClientRects().length > 0 }))
}

/** KAN-359 Nachtrag (UAT 22.10.2026): Hinweis noch gültig? Sonst verschwindet er (statt „Zur Meldung“ ins Leere) */
function gueltig(p: Popup, wurzel: HTMLElement | null): boolean {
  const g = p.ziel.deref()
  return hinweisGueltig(p, g ? { el: g, verbunden: g.isConnected, angezeigt: g.getClientRects().length > 0 } : null,
    seitenKandidaten(wurzel), letzterErfolgZeit())
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
      if (el.closest('[data-rueckfrage]')) return   // der Rückfrage-Dialog ist keine Meldung
      // KAN-389 Nachtrag (31.10.2026): Kennzahl-Kacheln und Status-Abzeichen des Dashboards sind rot/gelb, aber keine
      // Meldung – nach dem Speichern der Anordnung baut die Übersicht sie neu auf, „Zur Meldung“ führte ins Leere
      if (el.closest('[data-keine-meldung]')) return
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
        // Bestätigung außer Sicht → Erfolgs-Pop-up (vorgelesen ist sie schon); Fehler → nur ein Hinweis mit „Zur Meldung“
        if (a === 'ok') { zeigeErfolg(text, { vorgelesen: true }); return }
        setPopups([{ id: naechsteId.current++, art: 'fehler', text, ziel: new WeakRef(el), erstellt: Date.now() }])
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
      // KAN-359 Nachtrag: Fehlerkasten entfernt bzw. ausgeblendet → Hinweis weg
      setPopups(alt => (alt.length === 0 ? alt : alt.filter(p => gueltig(p, wurzel.current))))
    })
    beobachter.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => beobachter.disconnect()
  }, [])

  // Seitenwechsel: alte Fehler-Hinweise weg (Erfolge bleiben – sie kommen oft erst mit dem Redirect nach dem Speichern)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Hinweise gehören zur Seite, auf der die Aktion war
  useEffect(() => { setPopups([]) }, [pfad])

  // Erfolge (KAN-359) verschwinden von selbst
  const erfolge = useSyncExternalStore(abonniereErfolge, aktuelleErfolge, keineErfolge)
  const uhren = useRef(new Map<number, number>())
  // KAN-359 Nachtrag: Eine Erfolgsmeldung nach dem Fehler heißt „korrekt weitergemacht“ – der alte Hinweis verfällt
  useEffect(() => {
    if (erfolge.length === 0) return
    setPopups(alt => (alt.length === 0 ? alt : alt.filter(p => gueltig(p, wurzel.current))))
  }, [erfolge])

  useEffect(() => {
    // je Pop-up eine Uhr ab seinem Erscheinen (ein neues setzt die Uhr der älteren nicht zurück)
    for (const e of erfolge) {
      if (uhren.current.has(e.id)) continue
      uhren.current.set(e.id, window.setTimeout(() => { uhren.current.delete(e.id); schliesseErfolg(e.id) }, OK_DAUER_MS))
    }
  }, [erfolge])

  // Esc schließt das neueste (ein offener Rückfrage-Dialog fängt Esc vorher selbst ab)
  const anzahl = popups.length + erfolge.length
  useEffect(() => {
    if (anzahl === 0) return
    const taste = (e: KeyboardEvent) => {
      if (!(e.key === 'Escape')) return
      const letzterErfolg = aktuelleErfolge().at(-1)
      if (letzterErfolg) schliesseErfolg(letzterErfolg.id)
      else setPopups(alt => alt.slice(0, -1))
    }
    document.addEventListener('keydown', taste)
    return () => document.removeEventListener('keydown', taste)
  }, [anzahl])

  const schliessen = (id: number) => setPopups(alt => alt.filter(p => p.id !== id))
  // KAN-355: ein inzwischen ersetzter Kasten (isConnected false) führt nicht mehr ins Leere – neu suchen.
  // KAN-359 Nachtrag (UAT 22.10.2026): Ist keine Fehlermeldung mehr da, ist der Hinweis veraltet und schließt sich.
  const zurMeldung = (p: Popup) => {
    const gemerkt = p.ziel.deref()
    const ziel = meldungsZiel(gemerkt ? { el: gemerkt, verbunden: gemerkt.isConnected } : null, seitenKandidaten(wurzel.current), p)
    if (ziel) ziel.scrollIntoView({ block: 'center', behavior: 'smooth' })
    schliessen(p.id)
  }

  return (
    // KAN-371: unter md oben unter der Kopfleiste – unten lägen am Handy die fixierten Speichern-/Summenleisten der Formulare
    <div ref={wurzel} aria-live="off" className="fixed top-16 inset-x-4 md:inset-x-auto md:top-auto md:bottom-4 md:right-4 z-[60] flex flex-col gap-2 md:w-[min(26rem,calc(100vw-2rem))] print:hidden" data-meldungs-popup>
      {popups.map(p => (
        // meldung-ausnahme: nur ein Hinweis – die Fehlermeldung selbst steht mit role="alert" am Formular
        <div key={p.id} data-art="fehler-hinweis" className="flex items-start gap-2.5 rounded-xl border shadow-lg px-4 py-3 text-sm bg-s112-err-bg border-s112-err/40 text-s112-err-fg">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Es gibt eine Fehlermeldung außer Sicht.</p>
            <button type="button" onClick={() => zurMeldung(p)} className="mt-1.5 text-xs font-semibold underline hover:no-underline">
              Zur Meldung
            </button>
          </div>
          <button type="button" onClick={() => schliessen(p.id)} aria-label="Hinweis schließen" className="shrink-0 hover:opacity-70">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      {erfolge.map(e => (
        // KAN-359: Erfolg als Toast – role="status"; schon vorgelesene Kästen der Seite nicht doppelt ansagen
        <div key={e.id} role="status" aria-live={e.vorgelesen ? 'off' : 'polite'} data-art="erfolg"
          className="flex items-start gap-2.5 rounded-xl border shadow-lg px-4 py-3 text-sm bg-s112-ok-bg border-s112-ok/40 text-s112-ok-fg">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 font-medium break-words line-clamp-4">{e.text}</p>
          <button type="button" onClick={() => schliesseErfolg(e.id)} aria-label="Meldung schließen" className="shrink-0 hover:opacity-70">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
