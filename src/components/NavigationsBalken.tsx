'use client'

// Ladebalken für Seitenwechsel (Rückmeldung 17.9.2026: Klick auf "Controlling"
// dauerte 4 s ohne sichtbare Reaktion). Startet beim Klick auf einen Link
// (Ereignis aus components/ui/Link.tsx) oder beim Browser-Zurück und läuft
// asymptotisch bis 90 %; sobald sich Pfad oder Suchparameter ändern, füllt er
// sich und blendet aus. Sicherheitsnetz: nach 20 s ohne Seitenwechsel aus.
// Farbe Weiß (KAN-142, 26.09.2026): der Balken liegt oben auf der Kopfleiste in
// CD-Blau #2F63AC – Weiß erreicht dort 6,0:1, die Primärfarbe (Standard #4677BE)
// nur 1,3:1.
import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { NAVIGATION_EVENT } from '@/components/ui/Link'

export default function NavigationsBalken() {
  const pathname = usePathname()
  const suche = useSearchParams()
  const [breite, setBreite] = useState(0)     // 0 = aus
  const [fertig, setFertig] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const notaus = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aktiv = useRef(false)

  function stoppen() {
    if (timer.current) clearInterval(timer.current)
    if (notaus.current) clearTimeout(notaus.current)
    timer.current = null; notaus.current = null
  }

  function starten() {
    if (aktiv.current) return
    aktiv.current = true
    setFertig(false)
    setBreite(12)
    stoppen()
    timer.current = setInterval(() => {
      setBreite(b => b + Math.max(0.3, (90 - b) * 0.08))
    }, 150)
    notaus.current = setTimeout(beenden, 20000)
  }

  function beenden() {
    if (!aktiv.current) return
    aktiv.current = false
    stoppen()
    setBreite(100)
    setFertig(true)
    setTimeout(() => { setBreite(0); setFertig(false) }, 250)
  }

  useEffect(() => {
    const onNav = () => starten()
    window.addEventListener(NAVIGATION_EVENT, onNav)
    window.addEventListener('popstate', onNav)
    return () => {
      window.removeEventListener(NAVIGATION_EVENT, onNav)
      window.removeEventListener('popstate', onNav)
      stoppen()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Neue Seite ist da → Balken abschließen
  const schluessel = `${pathname}?${suche?.toString() ?? ''}`
  useEffect(() => { beenden() }, [schluessel]) // eslint-disable-line react-hooks/exhaustive-deps

  if (breite <= 0) return null
  return (
    <div aria-hidden className="pointer-events-none fixed left-0 right-0 top-0 z-[100] h-[3px]">
      <div
        className={`h-full transition-[width,opacity] ${fertig ? 'duration-200 opacity-0' : 'duration-150 opacity-100'}`}
        style={{ width: `${Math.min(100, breite)}%`, backgroundColor: '#FFFFFF', boxShadow: '0 0 8px rgba(255,255,255,.7)' }}
      />
    </div>
  )
}
