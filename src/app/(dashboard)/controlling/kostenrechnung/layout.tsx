import { requireModul } from '@/lib/auth/modul'

// Modul-Guard "Controlling" (Migration 193, Rückmeldung 2.9.2026): ohne
// Freischaltung ist dieser Bereich nur über die Sidebar ausgeblendet - dieser
// Layout-Guard sichert zusätzlich den direkten URL-Aufruf ab.
export default async function ControllingModulLayout({ children }: { children: React.ReactNode }) {
  await requireModul('modul_controlling')
  return <>{children}</>
}
