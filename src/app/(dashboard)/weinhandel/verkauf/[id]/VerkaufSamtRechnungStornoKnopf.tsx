'use client'

import { useRouter } from 'next/navigation'
import StornoButton from '@/components/StornoButton'

// KAN-356 (27.10.2026): Verkauf samt Rechnung in einem Schritt stornieren – eine Transaktion in der Datenbank. Nur bei einer
// eigenen Rechnung mit genau einem Lieferschein; die Datenbank lehnt ab bei gültigen Zahlungen, BMD-Übergabe, gesperrtem
// Zeitraum oder ausgestellter Transportbescheinigung (Meldung am Knopf).
export default function VerkaufSamtRechnungStornoKnopf({ action }: { action: (grund: string) => Promise<void | { error: string }> }) {
  const router = useRouter()
  return (
    <StornoButton
      label="Verkauf samt Rechnung stornieren"
      hinweis="Rechnung und Verkauf werden gemeinsam storniert: Die Rechnung bleibt mit ihrer Nummer als storniert erhalten, der Lagerbestand wird zurückgebucht, zugehörige Traubenverkäufe (BKI) werden mitstorniert. Zahlungen bitte vorher stornieren."
      action={async (grund) => {
        try {
          return await action(grund)
        } finally {
          router.refresh()
        }
      }}
    />
  )
}
