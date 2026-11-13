import { requireAuswertungen } from '@/lib/auth/modul'
import { requireLesen } from '@/lib/auth/lesen'

// Benutzerkonzept (Migration 218): Frag dein Weingut zeigt alle Betriebsdaten
// inkl. Umsätze - Mitarbeiter sehen es nur mit Modul „auswertungen“ in der Matrix.
export default async function KiLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('ki')   // KAN-456: Lesebereich je Profil
  await requireAuswertungen()
  return <>{children}</>
}
