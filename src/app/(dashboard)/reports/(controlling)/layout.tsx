import { requireModul, requireAuswertungen } from '@/lib/auth/modul'

// Modul-Guard "Controlling" (Migration 193, Rückmeldung 2.9.2026): ohne
// Freischaltung ist dieser Bereich nur über die Sidebar ausgeblendet - dieser
// Layout-Guard sichert zusätzlich den direkten URL-Aufruf ab.
// Seit 24.9.2026 gilt er über die Route Group (controlling) für die Übersicht
// /reports und alle übrigen Auswertungen – die Pflichtmeldungen liegen in
// reports/(pflicht)/ mit eigenem Guard (Betriebsleiter auch ohne Controlling).
export default async function ControllingModulLayout({ children }: { children: React.ReactNode }) {
  await requireModul('modul_controlling')
  await requireAuswertungen()   // Mitarbeiter nur mit Modul „auswertungen“ (Migration 218)
  return <>{children}</>
}
