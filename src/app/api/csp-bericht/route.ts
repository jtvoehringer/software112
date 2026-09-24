import { NextRequest, NextResponse } from 'next/server'
import { ereignisMelden } from '@/lib/system/ereignis'

export const dynamic = 'force-dynamic'

// POST /api/csp-bericht – Verstöße gegen die Content-Security-Policy (Beobachtungsmodus,
// siehe next.config.ts). Browser schicken sie ohne Anmeldung; wir speichern nur die
// Richtlinie und die blockierte Quelle (keine Seiteninhalte) im Systembericht.
// Gleiche Meldungen werden je Server-Instanz höchstens einmal pro Stunde protokolliert.

const zuletzt = new Map<string, number>()
const STUNDE = 60 * 60 * 1000

// zwei-faktor-ausnahme: Browser senden CSP-Berichte ohne Anmeldung; gespeichert werden nur Richtlinie und blockierte Quelle, gedrosselt
export async function POST(req: NextRequest) {
  try {
    const text = await req.text()
    if (text.length > 20_000) return new NextResponse(null, { status: 204 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = JSON.parse(text) as any
    const r = j?.['csp-report'] ?? (Array.isArray(j) ? j[0]?.body : j?.body) ?? {}
    const richtlinie = String(r['violated-directive'] ?? r.effectiveDirective ?? r['effective-directive'] ?? '?').slice(0, 80)
    const quelle = String(r['blocked-uri'] ?? r.blockedURL ?? '?').replace(/\?.*$/, '').slice(0, 200)
    const seite = String(r['document-uri'] ?? r.documentURL ?? '').replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '').slice(0, 120)
    const schluessel = `${richtlinie}|${quelle}`
    const jetzt = Date.now()
    if ((zuletzt.get(schluessel) ?? 0) > jetzt - STUNDE) return new NextResponse(null, { status: 204 })
    zuletzt.set(schluessel, jetzt)
    if (zuletzt.size > 500) zuletzt.clear()
    void ereignisMelden({ art: 'client', quelle: `csp:${richtlinie}`, meldung: `Blockiert (Beobachtungsmodus): ${quelle}${seite ? ` auf ${seite}` : ''}` })
  } catch { /* ungültige Meldung ignorieren */ }
  return new NextResponse(null, { status: 204 })
}
