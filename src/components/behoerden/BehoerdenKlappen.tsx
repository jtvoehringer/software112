'use client'

// ── Sprungleiste, „Alle auf/zu“ und Merken für die Behördenmeldungen (KAN-471 Nebenbefund, 19.11.2026) ─────────────
//
// Die Stellen der Übersicht sind native Klappleisten (<details data-stelle="…">, gerendert von BehoerdenUebersicht –
// funktionieren auch ohne JavaScript). Dieser Baustein ergänzt nur: Knöpfe je Stelle (öffnen und hinspringen),
// alle auf- bzw. zuklappen und merkt im localStorage dieses Browsers, welche Stellen offen waren. Ausgangszustand
// beim ersten Besuch: alle zu (Entscheidung Jörgen). localStorage kann fehlen oder werfen – dann eben ohne Merken.

import { useEffect, useRef, type ReactNode } from 'react'
import { KLAPP_SPEICHER, offeneStellenAus } from '@/lib/behoerden/stellen'

function leistenIn(el: HTMLElement | null): HTMLDetailsElement[] {
  return Array.from(el?.querySelectorAll<HTMLDetailsElement>('details[data-stelle]') ?? [])
}

export default function BehoerdenKlappen({ stellen, children }: {
  stellen: { gruppe: string; kurz: string }[]
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const leisten = () => leistenIn(ref.current)

  useEffect(() => {
    const el = ref.current
    const liste = leistenIn(el)
    let offen: string[] = []
    try { offen = offeneStellenAus(window.localStorage.getItem(KLAPP_SPEICHER), liste.map(d => d.dataset.stelle ?? '')) } catch { /* ohne Speicher */ }
    for (const d of liste) if (offen.includes(d.dataset.stelle ?? '')) d.open = true
    const merken = () => {
      try { window.localStorage.setItem(KLAPP_SPEICHER, JSON.stringify(leistenIn(el).filter(d => d.open).map(d => d.dataset.stelle))) } catch { /* ohne Speicher */ }
    }
    for (const d of liste) d.addEventListener('toggle', merken)
    return () => { for (const d of liste) d.removeEventListener('toggle', merken) }
  }, [])

  function springe(gruppe: string) {
    const d = leisten().find(x => x.dataset.stelle === gruppe)
    if (!d) return
    d.open = true
    d.scrollIntoView({ block: 'start', behavior: 'smooth' })
    d.querySelector('summary')?.focus({ preventScroll: true })
  }
  function alle(offen: boolean) {
    for (const d of leisten()) d.open = offen
  }

  const knopf = 'text-[12px] font-medium rounded-full border border-s112-line-str px-2.5 py-1 hover:bg-s112-bg whitespace-nowrap'
  return (
    <div ref={ref}>
      <nav aria-label="Stellen" className="flex flex-wrap items-center gap-1.5 mb-3">
        {stellen.map(s => (
          <button key={s.gruppe} type="button" onClick={() => springe(s.gruppe)} className={`${knopf} text-s112-blue-700`}>
            {s.kurz}
          </button>
        ))}
        <span className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => alle(true)} className={`${knopf} text-s112-text-2`}>Alle aufklappen</button>
          <button type="button" onClick={() => alle(false)} className={`${knopf} text-s112-text-2`}>Alle zuklappen</button>
        </span>
      </nav>
      {children}
    </div>
  )
}
