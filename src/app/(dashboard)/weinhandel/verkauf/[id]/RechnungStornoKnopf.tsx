'use client'

import { useRouter } from 'next/navigation'
import StornoButton from '@/components/StornoButton'

// KAN-103 (08.10.2026): Rechnung stornieren – der Lieferschein ist danach wieder „nicht berechnet“, der Bestand bleibt.
// KAN-355: erwartbare Ablehnungen (Zahlungen, BMD, gesperrter Zeitraum) kommen als { error } und erscheinen am Formular.
// KAN-379 (27.10.2026): Storno als eigener Stornobeleg (ST-…) am Storno-Datum (vorbelegt heute, nicht vor dem
// Rechnungsdatum, nicht im gesperrten Zeitraum) – die Rechnung bleibt in ihrem Zeitraum unverändert.
export default function RechnungStornoKnopf({ action, stornoDatum }: {
  action: (grund: string, stornoDatum: string | null) => Promise<void | { error: string; feld?: 'datum' }>
  stornoDatum: { heute: string; ab?: string | null }
}) {
  const router = useRouter()
  return (
    <StornoButton
      mitText
      label="Rechnung stornieren"
      hinweis="Es entsteht ein Stornobeleg (ST-…) mit negativen Beträgen am Storno-Datum; die Rechnung bleibt in ihrem Zeitraum unverändert. Der Lieferschein ist danach wieder nicht berechnet, der Bestand bleibt. Zahlungen bitte vorher stornieren."
      stornoDatum={{ ...stornoDatum, hilfe: 'Datum des Stornobelegs – nicht in einem abgeschlossenen Monat oder übermittelten UVA-Zeitraum.' }}
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
