'use client'

import { useRouter } from 'next/navigation'
import StornoButton from '@/components/StornoButton'

// Verkauf stornieren (KAN-35, 24.09.2026; KAN-149 D1, 30.09.2026): Grund Pflicht (mind. 10 Zeichen) im Dialog von
// StornoButton – Datum und Benutzer setzt die Datenbank. Erwartbare Ablehnungen („bereits storniert“, fehlende Freigabe
// Kellerbuch bei Tankpositionen, Gebinde inzwischen belegt …) erscheinen als Meldung neben dem Knopf. Die Seite lädt
// auch nach einem Fehler neu: ein Teil-Storno (z. B. E&A) zeigt so den neuen Stand.
export default function StornoKnopf({
  action,
  meldung,
  erstattung = false,
}: {
  action: (grund: string, erstattetAm: string | null) => Promise<void>
  meldung: string
  /** KAN-149 D2b: Zahlungen vorhanden → Feld „Erstattet am“ (Zahlungen stornieren, Einnahmen gegenbuchen) */
  erstattung?: boolean
}) {
  const router = useRouter()
  return (
    <StornoButton
      hinweis={meldung}
      label="Verkauf stornieren"
      datumFeld={erstattung ? { label: 'Erstattet am (optional)', hilfe: 'Nur, wenn bezahlte Beträge zurückgezahlt wurden.' } : undefined}
      action={async (grund, datum) => {
        try {
          await action(grund, datum)
        } finally {
          router.refresh()
        }
      }}
    />
  )
}
