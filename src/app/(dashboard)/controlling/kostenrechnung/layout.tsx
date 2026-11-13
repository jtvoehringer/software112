import { requireModul, requireAuswertungen } from '@/lib/auth/modul'
import type { Metadata } from 'next'
import { requireLesen } from '@/lib/auth/lesen'

// Sweep 115: Seitentitel der Client-Seite (die Seite selbst kann keine Metadaten exportieren)
export const metadata: Metadata = { title: 'Kostenrechnung' }

// Modul-Guard "Controlling" (Migration 193, Rückmeldung 2.9.2026): ohne
// Freischaltung ist dieser Bereich nur über die Sidebar ausgeblendet - dieser
// Layout-Guard sichert zusätzlich den direkten URL-Aufruf ab.
export default async function ControllingModulLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('controlling')   // KAN-456: Lesebereich je Profil
  await requireModul('modul_controlling')
  await requireAuswertungen()   // Mitarbeiter nur mit Modul „auswertungen“ (Migration 218)
  return <>{children}</>
}
