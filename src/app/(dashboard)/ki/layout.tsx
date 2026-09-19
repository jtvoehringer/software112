import { requireAuswertungen } from '@/lib/auth/modul'

// Benutzerkonzept (Migration 218): Frag dein Weingut zeigt alle Betriebsdaten
// inkl. Umsätze - Mitarbeiter sehen es nur mit Modul „auswertungen“ in der Matrix.
export default async function KiLayout({ children }: { children: React.ReactNode }) {
  await requireAuswertungen()
  return <>{children}</>
}
