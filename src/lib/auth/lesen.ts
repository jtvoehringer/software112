import 'server-only'
import { redirect } from 'next/navigation'
import { getCurrentMembership } from '@/lib/auth/roles'
import { canRead, type Lesebereich } from '@/lib/auth/lesebereiche'

// ── Seiten-Guard „Lesebereich“ (KAN-456, 13.11.2026) ───────────────────────────────────────────────────────────────
//
// Mitarbeiter mit Profil („Vertrieb“, „Extern“) lesen nur ihre Lesebereiche. Die Daten sperrt die Datenbank – der
// Guard sorgt dafür, dass niemand auf einer leeren Liste oder Fehlerseite landet: Wer eine Seite eines gesperrten
// Bereichs direkt aufruft (Lesezeichen, alter Link), wird auf die Startseite geleitet, die den Grund nennt
// (Entscheidung Jörgen 13.11.2026, Jira KAN-456 Frage 5 A).
// Aufruf in layout.tsx eines Verzeichnisses bzw. in page.tsx: `await requireLesen('crm')`. Welcher Bereich zu welcher
// Seite gehört, steht in src/lib/navigation/seitenBereich.ts; scripts/check-lesebereich-seiten.js prüft jede Seite.
// Ohne Mitgliedschaft leitet der Guard nicht um – das regelt das Dashboard-Layout.

export const KEIN_LESERECHT_ZIEL = '/dashboard?kein_leserecht=1'

export async function requireLesen(bereich: Lesebereich): Promise<void> {
  const membership = await getCurrentMembership()
  if (!membership) return
  if (!canRead(membership, bereich)) redirect(KEIN_LESERECHT_ZIEL)
}
