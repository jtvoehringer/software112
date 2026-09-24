import 'server-only'
import { NextResponse } from 'next/server'
import { csvDateinameAus, csvKopfzeilen, type CsvDateiname } from '@/lib/csv'

// HTTP-Antworten der Behörden-CSV (Standard Punkt 11, 24.09.2026):
//   Erfolg  → csvAntwort(): text/csv; charset=utf-8, attachment mit filename + filename*,
//             Cache-Control: private, no-store, nosniff, X-Dateiname (URI-kodiert),
//             X-Zeilen (0 = Leermeldung), X-Warnungen (URI-kodiert, \n-getrennt) + X-Warnungen-Anzahl
//   Fehler  → fehlerAntwort(): immer JSON { fehler } mit 400/401/403/404/500, nie Klartext.
// Den Download im Browser übernimmt src/components/CsvExportKnopf.tsx (liest die X-Header).

export type FehlerStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500

/** CSV-Datei als Download-Antwort. `dateiname` aus csvDateiname(); ein fertiger String wird bereinigt. */
export function csvAntwort(text: string, dateiname: CsvDateiname | string, zeilen: number, warnungen: readonly string[] = []): NextResponse {
  const name = typeof dateiname === 'string' ? csvDateinameAus(dateiname) : dateiname
  return new NextResponse(text, { status: 200, headers: csvKopfzeilen(name, zeilen, warnungen) })
}

/** Fehler als JSON { fehler } – der CsvExportKnopf zeigt den Text an. */
export function fehlerAntwort(status: FehlerStatus, fehler: string): NextResponse {
  return NextResponse.json({ fehler }, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' },
  })
}
