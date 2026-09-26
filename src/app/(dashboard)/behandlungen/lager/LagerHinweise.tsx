'use client'

import Link from '@/components/ui/Link'
import type { LagerHinweis } from '@/lib/behandlungen/lagerVerbrauch'

// Hinweise einer Lager-Karte (KAN-133): Maßnahmen, deren Mittelmenge nicht vom Bestand abgezogen
// wurde (ohne Aufwand, kg ↔ l ohne Dichte), und Buchungen in einer anderen Dimension als das Lager.

const SICHTBAR = 5

export default function LagerHinweise({ hinweise, writeOk }: { hinweise: LagerHinweis[]; writeOk: boolean }) {
  if (hinweise.length === 0) return null

  const zeile = (h: LagerHinweis, i: number) => (
    <li key={i}>
      {h.text}
      {writeOk && h.behandlungId && (
        <>
          {' '}
          <Link href={`/behandlungen/${h.behandlungId}/edit`} className="underline hover:no-underline">
            Maßnahme bearbeiten
          </Link>
        </>
      )}
    </li>
  )

  return (
    <div role="note" className="mb-4 p-2.5 bg-s112-warn-bg border border-s112-warn/30 rounded-lg text-xs text-s112-warn-fg">
      <p className="font-medium">Nicht im Bestand berücksichtigt ({hinweise.length}):</p>
      <ul className="list-disc pl-4 mt-1 space-y-0.5">
        {hinweise.slice(0, SICHTBAR).map(zeile)}
      </ul>
      {hinweise.length > SICHTBAR && (
        <details className="mt-1">
          <summary className="cursor-pointer">{hinweise.length - SICHTBAR} weitere anzeigen</summary>
          <ul className="list-disc pl-4 mt-1 space-y-0.5">
            {hinweise.slice(SICHTBAR).map((h, i) => zeile(h, i + SICHTBAR))}
          </ul>
        </details>
      )}
    </div>
  )
}
