'use client'

// ── „Zurück“ und Bestätigung nach dem Abschluss (KAN-224, 07.10.2026) ──
// Rückmeldung Jörgen 07.10.2026: auf jeder Unterseite ein „Zurück“-Knopf; nach Speichern/Abbrechen zurück, woher man kam.
// Im App-Rahmen über dem Seiteninhalt: führt den Seitenverlauf des Tabs (merkeSeite), zeigt auf Unterseiten (nicht auf
// den Hauptpunkten der Navigation) „← Zurück“ zur vorherigen Seite bzw. zur übergeordneten Seite.
// KAN-359 (22.10.2026): Die Bestätigung aus `erledigt=<Schlüssel>` (Text aus ERLEDIGT_TEXT) erscheint als Erfolgs-Pop-up
// (zeigeErfolg → MeldungsPopup, eine Stelle für die ganze App) statt als grüner Kasten über dem Inhalt; der Parameter
// fällt danach aus der URL, damit Neuladen bzw. Zurück die Meldung nicht wiederholt.

import { useEffect, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { elternZiel, erledigtText, ERLEDIGT_PARAM } from '@/lib/navigation/zurueck'
import { merkeSeite, zurueckZiel } from '@/lib/navigation/zurueckBrowser'
import { zeigeErfolg } from '@/lib/ui/erfolg'

export default function ZurueckLeiste({ navHrefs }: { navHrefs: string[] }) {
  const pathname = usePathname()
  const sp = useSearchParams()
  const router = useRouter()
  const suche = sp.toString()
  const eltern = useMemo(() => elternZiel(navHrefs, pathname), [navHrefs, pathname])

  useEffect(() => {
    merkeSeite(`${pathname}${suche ? `?${suche}` : ''}`)
  }, [pathname, suche])

  const erledigt = erledigtText(sp.get(ERLEDIGT_PARAM))
  useEffect(() => {
    if (!erledigt) return
    zeigeErfolg(erledigt)
    const p = new URLSearchParams(suche)
    p.delete(ERLEDIGT_PARAM)
    // KAN-335/336: { scroll: false } – Next.js' scrollIntoView verschob sonst auch Rahmen bzw. Dokument
    router.replace(`${pathname}${p.toString() ? `?${p}` : ''}`, { scroll: false })
  }, [erledigt, pathname, suche, router])

  if (!eltern) return null
  return (
    <div className="mb-3 print:hidden">
      {/* Ziel erst beim Klick: zurueck-Parameter, sonst vorherige Seite im Verlauf, sonst die übergeordnete Seite */}
      <button type="button" onClick={() => router.push(zurueckZiel(eltern))}
        className="inline-flex items-center gap-1.5 text-sm text-s112-text-2 hover:text-s112-blue-700 transition-colors">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Zurück
      </button>
    </div>
  )
}
