import type { NextRequest } from 'next/server'
import { GET as meldungCsv } from '@/app/(dashboard)/meldungen/[meldung]/csv/route'

// ── Alte URL des BKI-Datenblatts (bis 24.09.2026) ──────────────────────────────
//
//   GET /weinhandel/traubenverkauf/datenblatt?jahrgang=JJJJ
//
// Die EDV-Liste ist jetzt die Behördenmeldung 'bki-traubenverkauf' (Register
// lib/behoerden/register/ernte.ts, Ladefunktion lib/behoerden/traubenverkauf.ts,
// PROFIL_BKI). Diese Route bleibt für Lesezeichen erhalten und reicht die Anfrage
// unverändert an die zentrale Route /meldungen/bki-traubenverkauf/csv weiter –
// dieselbe Datei, dieselbe Zugriffsprüfung (Pflichtmeldung), dieselben Fehler als
// JSON { fehler } (unbekannter Jahrgang → 400). Neue Links nur noch über
// csvPfad('bki-traubenverkauf', { jahrgang }).

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export function GET(req: NextRequest) {
  return meldungCsv(req, { params: Promise.resolve({ meldung: 'bki-traubenverkauf' }) })
}
