'use client'

import { useRouter } from 'next/navigation'
import StornoButton from '@/components/StornoButton'

// Verkauf stornieren (KAN-35, 24.09.2026; KAN-149 D1, 30.09.2026): Grund Pflicht (mind. 10 Zeichen) im Dialog von
// StornoButton – Datum und Benutzer setzt die Datenbank. Erwartbare Ablehnungen („bereits storniert“, fehlende Freigabe
// Kellerbuch bei Tankpositionen, Gebinde inzwischen belegt …) erscheinen als Meldung neben dem Knopf. Die Seite lädt
// auch nach einem Fehler neu: ein Teil-Storno (z. B. E&A) zeigt so den neuen Stand.
// KAN-379: ohne Rechnung wählbares Storno-Datum (Rückbuchung des Bestands); mit 1:1-Rechnung heute (Stornobeleg).
export default function StornoKnopf({
  action,
  meldung,
  erstattung = false,
  stornoDatum,
}: {
  /** KAN-355: erwartbare Ablehnung (z. B. Rechnung im gesperrten Zeitraum) als { error } – Meldung am Knopf */
  action: (grund: string, erstattetAm: string | null, stornoDatum: string | null) => Promise<void | { error: string; feld?: 'datum' }>
  meldung: string
  /** KAN-149 D2b: Zahlungen vorhanden → Feld „Erstattet am“ (Zahlungen stornieren, Einnahmen gegenbuchen) */
  erstattung?: boolean
  /** KAN-379: Storno-Datum wählbar (nur ohne Rechnung) – sonst heute */
  stornoDatum?: { heute: string; ab?: string | null }
}) {
  const router = useRouter()
  return (
    <StornoButton
      mitText
      hinweis={meldung}
      label="Verkauf stornieren"
      datumFeld={erstattung ? { label: 'Erstattet am (optional)', hilfe: 'Nur, wenn bezahlte Beträge zurückgezahlt wurden.' } : undefined}
      stornoDatum={stornoDatum ? { ...stornoDatum, hilfe: 'Tag der Rückbuchung im Flaschenlager bzw. Kellerbuch.' } : undefined}
      action={async (grund, datum, sDatum) => {
        try {
          return await action(grund, datum, sDatum)
        } finally {
          router.refresh()
        }
      }}
    />
  )
}
