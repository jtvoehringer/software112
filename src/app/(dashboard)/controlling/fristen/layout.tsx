import { requireModul, requireAuswertungen } from '@/lib/auth/modul'
import { requireLesen } from '@/lib/auth/lesen'

// Modul-Guard „Controlling“ wie bei den anderen Seiten des Bereichs: Die Sicht selbst sieht unter Übersicht jeder,
// diese Adresse gehört aber zum Bereich Controlling (Paket-Modul, Mitarbeiter nur mit Auswertungsrecht).
export default async function ControllingFristenLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('betrieb')   // KAN-456: Lesebereich je Profil
  await requireModul('modul_controlling')
  await requireAuswertungen()
  return <>{children}</>
}
