'use client'

// ── „Zurück“ und Bestätigung nach dem Abschluss (KAN-224, 07.10.2026) ──
// Rückmeldung Jörgen 07.10.2026: auf jeder Unterseite ein „Zurück“-Knopf; nach Speichern/Abbrechen zurück, woher man kam.
// Im App-Rahmen über dem Seiteninhalt: führt den Seitenverlauf des Tabs (merkeSeite), zeigt auf Unterseiten (nicht auf
// den Hauptpunkten der Navigation) „← Zurück“ zur vorherigen Seite bzw. zur übergeordneten Seite und blendet eine
// Bestätigung ein, wenn die URL `erledigt=<Schlüssel>` trägt (Text aus ERLEDIGT_TEXT).

import { useEffect, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, X } from 'lucide-react'
import { elternZiel, erledigtText, ERLEDIGT_PARAM } from '@/lib/navigation/zurueck'
import { merkeSeite, zurueckZiel } from '@/lib/navigation/zurueckBrowser'

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
  // KAN-335/336: Bestätigung sichtbar machen – nur den Inhaltsbereich <main id="inhalt"> scrollen. Formulare, die auf der
  // Seite bleiben, navigieren mit { scroll: false }: Next.js' scrollIntoView verschob sonst auch Rahmen bzw. Dokument
  // (Kopfleiste weg, leerer Streifen unten, nach dem Neuladen von Chrome wiederhergestellt).
  useEffect(() => {
    if (erledigt) document.getElementById('inhalt')?.scrollTo({ top: 0 })
  }, [erledigt])
  const schliessen = () => {
    const p = new URLSearchParams(suche)
    p.delete(ERLEDIGT_PARAM)
    router.replace(`${pathname}${p.toString() ? `?${p}` : ''}`, { scroll: false })
  }

  if (!eltern && !erledigt) return null
  return (
    <div className="mb-3 space-y-2 print:hidden">
      {eltern && (
        // Ziel erst beim Klick: zurueck-Parameter, sonst vorherige Seite im Verlauf, sonst die übergeordnete Seite
        <button type="button" onClick={() => router.push(zurueckZiel(eltern))}
          className="inline-flex items-center gap-1.5 text-sm text-s112-text-2 hover:text-s112-blue-700 transition-colors">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Zurück
        </button>
      )}
      {erledigt && (
        <div role="status" className="flex items-center gap-2 bg-s112-ok-bg border border-s112-ok/30 text-s112-ok-fg rounded-lg px-4 py-2.5 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="font-medium">{erledigt}</span>
          <button type="button" onClick={schliessen} aria-label="Hinweis schließen" className="ml-auto hover:opacity-70">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
