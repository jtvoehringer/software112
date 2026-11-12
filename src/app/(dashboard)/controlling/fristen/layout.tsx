import { requireModul, requireAuswertungen } from '@/lib/auth/modul'

// Modul-Guard „Controlling“ wie bei den anderen Seiten des Bereichs: Die Sicht selbst sieht unter Übersicht jeder,
// diese Adresse gehört aber zum Bereich Controlling (Paket-Modul, Mitarbeiter nur mit Auswertungsrecht).
export default async function ControllingFristenLayout({ children }: { children: React.ReactNode }) {
  await requireModul('modul_controlling')
  await requireAuswertungen()
  return <>{children}</>
}
