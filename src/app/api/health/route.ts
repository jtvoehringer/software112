import { NextResponse } from 'next/server'
import { pruefeVerfuegbarkeit } from '@/lib/system/verfuegbarkeit'

export const dynamic = 'force-dynamic'

// GET /api/health – Prüf-Endpunkt für den externen Verfügbarkeitsmonitor (KAN-401, Anlage 3, Punkt 3.3).
// 200 { ok: true, teile } wenn Datenbank und Anmeldedienst antworten, sonst 503 mit dem Teilstatus.
// Keine Fehlertexte, keine Versionen, keine Mandantendaten; nie zwischenspeichern.

// zwei-faktor-ausnahme: Verfügbarkeitsmonitor ohne Anmeldung – liefert nur ok/fehler je Teil, liest keine Mandantendaten
export async function GET() {
  const ergebnis = await pruefeVerfuegbarkeit({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
  return NextResponse.json(ergebnis, {
    status: ergebnis.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
