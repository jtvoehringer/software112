'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { deactivateFuellung } from './actions'
import StornoButton from '@/components/StornoButton'

// Füllung aus dem Weinhandel stornieren. Seit KAN-35 (24.09.2026) nur ohne Verkäufe und
// Bestandsbuchungen; die abgefüllten Liter (und ein Abschluss-Schwund derselben Abfüllung)
// werden auf die Charge zurückgebucht. Seit KAN-145 (B3, 30.09.2026) mit Pflicht-Grund: Die Füllung
// bleibt als storniert stehen (Bewegungsbuch: Buchung und Gegenbuchung, Weinbuch: Kennzeichen).
// Ist der Storno schon absehbar gesperrt (`gesperrt`), bleibt der Knopf ausgegraut. KAN-378 (Abnahme 23.10.2026):
// Der Grund stand nur im Tooltip – am Handy unsichtbar, die Tester verstanden die Sperre nicht. Jetzt zeigt ein
// Klick (bzw. Tippen, Enter/Leertaste) eine kurze Erklärung direkt am Knopf; Escape, ein zweiter Klick oder das
// Verlassen des Knopfs schließt sie. Eine Sperre des Servers erscheint als Meldung direkt unter dem Knopf.
export default function FuellungLoeschen({ id, name, gesperrt = null }: { id: string; name: string; gesperrt?: string | null }) {
  const router = useRouter()

  if (gesperrt) return <GesperrtKnopf grund={gesperrt} />

  return (
    <StornoButton
      action={grund => deactivateFuellung(id, grund)}
      danach={() => router.refresh()}
      hinweis={`„${name}“ stornieren: Die abgefüllten Liter werden auf die Kellerbuch-Charge zurückgebucht (auch ein beim Abfüllen gebuchter Abschluss-Schwund); die Füllung bleibt als storniert stehen.`} />
  )
}

/** Ausgegrauter Mistkübel, der beim Klick den Sperrgrund zeigt (fest positioniert – die Tabelle scrollt waagrecht und schnitte eine absolute Blase ab) */
function GesperrtKnopf({ grund }: { grund: string }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const knopf = useRef<HTMLButtonElement>(null)
  const hinweisId = useId()

  useEffect(() => {
    if (!pos) return
    const zu = () => setPos(null)
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') zu() }
    // Beim Scrollen (auch in <main>) oder Größenändern passt die feste Position nicht mehr – schließen
    window.addEventListener('scroll', zu, true)
    window.addEventListener('resize', zu)
    window.addEventListener('keydown', taste)
    return () => {
      window.removeEventListener('scroll', zu, true)
      window.removeEventListener('resize', zu)
      window.removeEventListener('keydown', taste)
    }
  }, [pos])

  function umschalten() {
    if (pos) { setPos(null); return }
    const r = knopf.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
  }

  return (
    <>
      <button ref={knopf} type="button" aria-disabled="true" title={grund}
        aria-label={`Stornieren nicht möglich – Grund anzeigen: ${grund}`}
        aria-expanded={!!pos} aria-controls={pos ? hinweisId : undefined}
        onClick={umschalten} onBlur={() => setPos(null)}
        data-testid="fuellung-storno-gesperrt"
        className="text-s112-tertiary opacity-40 cursor-help hover:opacity-70 focus-visible:opacity-70">
        <Trash2 className="w-4 h-4" aria-hidden />
      </button>
      {pos && (
        <span id={hinweisId} role="status"
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 w-72 max-w-[calc(100vw-2rem)] whitespace-normal text-left text-xs leading-snug text-s112-text-1 bg-s112-surface border border-s112-border rounded-lg shadow-lg px-3 py-2">
          {grund}
        </span>
      )}
    </>
  )
}
