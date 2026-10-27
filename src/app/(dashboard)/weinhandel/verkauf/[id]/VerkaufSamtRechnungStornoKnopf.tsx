'use client'

import { useRouter } from 'next/navigation'
import StornoButton from '@/components/StornoButton'

// KAN-356 (27.10.2026): Verkauf samt Rechnung in einem Schritt stornieren – eine Transaktion in der Datenbank. Nur bei einer
// eigenen Rechnung mit genau einem Lieferschein; die Datenbank lehnt ab bei gültigen Zahlungen, BMD-Übergabe, gesperrtem
// Zeitraum oder ausgestellter Transportbescheinigung (Meldung am Formular).
// KAN-379: Stornobeleg (ST-…) und Rückbuchung des Bestands am Storno-Datum.
export default function VerkaufSamtRechnungStornoKnopf({ action, stornoDatum }: {
  action: (grund: string, stornoDatum: string | null) => Promise<void | { error: string; feld?: 'datum' }>
  stornoDatum: { heute: string; ab?: string | null }
}) {
  const router = useRouter()
  return (
    <StornoButton
      label="Verkauf samt Rechnung stornieren"
      hinweis="Rechnung und Verkauf werden gemeinsam storniert: Es entsteht ein Stornobeleg (ST-…) am Storno-Datum, der Lagerbestand wird an diesem Tag zurückgebucht, zugehörige Traubenverkäufe (BKI) werden mitstorniert. Die Rechnung bleibt in ihrem Zeitraum unverändert. Zahlungen bitte vorher stornieren."
      stornoDatum={{ ...stornoDatum, hilfe: 'Datum des Stornobelegs und der Rückbuchung – nicht in einem abgeschlossenen Zeitraum.' }}
      action={async (grund, _datum, sDatum) => {
        try {
          return await action(grund, sDatum)
        } finally {
          router.refresh()
        }
      }}
    />
  )
}
