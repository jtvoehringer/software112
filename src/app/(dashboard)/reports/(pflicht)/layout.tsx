import { requirePflichtmeldungen } from '@/lib/auth/modul'

// Pflichtmeldungen (Entscheidung 24.9.2026, „Behördenmeldungen als CSV“):
// AMA-Erntemeldung samt Weinbestandsmeldung (/reports/ama), Behandlungsprotokoll
// (Pflanzenschutz-Aufzeichnungen), Cu-Bilanz, Nährstoffbilanz und Weinbuch-
// Sammlung sind für Betriebsleiter (system_admin, tenant_admin, winzer) auch ohne
// Modul „Controlling“ und ohne Auswertungsrecht erreichbar; Leser wie bisher nur
// mit Modul Controlling + Auswertungsrecht (lib/auth/modul.ts).
// Die Route Group (pflicht) ändert die URLs nicht. Alle übrigen Seiten unter
// /reports – auch die Übersicht /reports selbst – sichert weiterhin
// reports/(controlling)/layout.tsx. Die Navigation spiegelt die Regel
// (lib/navigation/index.ts, NavItem.pflichtmeldung).
export default async function PflichtmeldungenLayout({ children }: { children: React.ReactNode }) {
  await requirePflichtmeldungen()
  return <>{children}</>
}
