'use client'

import { useRouter } from 'next/navigation'
import StornoButton from '@/components/StornoButton'

// KAN-103 (08.10.2026): Rechnung stornieren – die Rechnung behält ihre Nummer (keine eigene Stornonummer), der Lieferschein
// ist danach wieder „nicht berechnet“, der Bestand bleibt. Die Datenbank lehnt ab, solange gültige Zahlungen bestehen oder
// die Rechnung schon an BMD übergeben ist.
// KAN-355: erwartbare Ablehnungen (Rechnung im gesperrten Zeitraum, Zahlungen, BMD) kommen als { error } und erscheinen am Knopf.
export default function RechnungStornoKnopf({ action }: { action: (grund: string) => Promise<void | { error: string }> }) {
  const router = useRouter()
  return (
    <StornoButton
      label="Rechnung stornieren"
      hinweis="Die Rechnung bleibt mit ihrer Nummer als storniert erhalten; der Lieferschein ist danach wieder nicht berechnet, der Bestand bleibt. Zahlungen bitte vorher stornieren."
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
