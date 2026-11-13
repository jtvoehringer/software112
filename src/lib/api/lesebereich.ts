import { NextResponse } from 'next/server'
import { canRead, type Lesebereich } from '@/lib/auth/lesebereiche'

// ── Lesebereich je Profil für API-Routen (KAN-455, 13.11.2026) ───────────────
//
// Mitarbeiter mit Profil („Vertrieb“, „Extern“) lesen nur ihre Lesebereiche (docs/Leserechte.md). Die Tabellen
// sperrt die Datenbank (Policy „lesebereich“) – API-Routen laden aber oft per Service-Role bzw. liefern Dateien,
// Mails und PDFs, an denen keine Policy hängt. Jeder Handler unter src/app/api ruft deshalb direkt nach
// getCurrentMembership():
//
//     const leseSperre = leseKonflikt(membership, 'crm')
//     if (leseSperre) return leseSperre
//
// null = weiter, sonst eine fertige 403-Antwort { fehler, error }. Ohne Mitgliedschaft liefert die Prüfung null:
// „kein Betrieb“ meldet die Route wie bisher selbst. Mehrere Bereiche = alle nötig.
// Welcher Bereich zu welcher Route gehört, steht in scripts/lesebereich-routen.json; der Wächter
// scripts/check-lesebereich-routen.js (prebuild) meldet Routen ohne Eintrag bzw. ohne passenden Aufruf.

export const LESE_MELDUNG = 'Für diesen Bereich fehlt dir das Leserecht.'

export function leseKonflikt(
  membership: { role?: unknown; profil?: unknown } | null | undefined,
  ...bereiche: Lesebereich[]
): NextResponse | null {
  if (!membership) return null
  for (const bereich of bereiche) {
    if (!canRead(membership, bereich)) return NextResponse.json({ fehler: LESE_MELDUNG, error: LESE_MELDUNG }, { status: 403 })
  }
  return null
}
