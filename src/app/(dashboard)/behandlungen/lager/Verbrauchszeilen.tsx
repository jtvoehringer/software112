// Bestand & Bewegungen (30.09.2026, Rückmeldung Jörgen): Buchungen und der Verbrauch je Maßnahme in EINER Liste,
// chronologisch von oben (älteste) nach unten (jüngste). Der Verbrauch steht je Maßnahme mit Datum (read-only, aus
// den Maßnahmen berechnet); die Summe zeigt die Kachel „Verbrauch (Maßnahmen)“.

import { fmtNum } from '@/lib/format'
import type { VerbrauchZeile } from '@/lib/behandlungen/lagerVerbrauch'

export type ChronoZeile<B> = { datum: string; buchung: B | null; verbrauch: VerbrauchZeile | null }

/** Buchungen und Verbrauchszeilen nach Datum aufsteigend; am selben Tag die Buchungen zuerst */
export function zeilenChronologisch<B extends { datum: string }>(
  buchungen: readonly B[], verbrauch: readonly VerbrauchZeile[],
): ChronoZeile<B>[] {
  return [
    ...buchungen.map(b => ({ datum: b.datum, buchung: b, verbrauch: null })),
    ...verbrauch.map(v => ({ datum: v.datum, buchung: null, verbrauch: v })),
  ].sort((a, b) => a.datum.localeCompare(b.datum))
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Zeile „Verbrauch“ einer Maßnahme (read-only) */
export function VerbrauchTr({ v, einheit, mitAktionen }: { v: VerbrauchZeile; einheit: string; mitAktionen: boolean }) {
  return (
    <tr className="border-b border-s112-border/40 last:border-0 bg-s112-blue-50/30">
      <td className="px-3 py-2 tabular-nums text-s112-muted">{fmtDate(v.datum)}</td>
      <td className="px-3 py-2">
        <span className="text-xs px-2 py-0.5 rounded-full border bg-s112-blue-50 text-s112-blue-700 border-s112-blue-100 font-medium">
          Verbrauch
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-medium text-s112-blue-700">
        –{fmtNum(v.menge, { max: 3 })} {einheit}
      </td>
      <td className="px-3 py-2 text-xs text-s112-muted">{[v.art, v.ort].filter(Boolean).join(' · ')}</td>
      {mitAktionen && <td />}
    </tr>
  )
}
