// /api/support/anfragen/<SUP-n> – eine eigene Support-Anfrage im Detail (KAN-235, 08.10.2026)
//
// GET:  Status, Beschreibung (ohne Kontextblock) und öffentliche Kommentare – nur für Anfragen, die der Benutzer
//       sehen darf (eigene bzw. Anfrage eines seiner Betriebe, KAN-438); sonst 404. Interne Kommentare bleiben verborgen.
// POST: Antwort { text } als öffentlicher Kommentar mit dem Namen des Benutzers in der ersten Zeile.
// Ersetzt den Link ins Kundenportal, für das die Kunden kein Passwort haben (Entscheidung Jörgen 08.10.2026).

import { NextRequest, NextResponse } from 'next/server'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { KEIN_CACHE, supportKontext, supportZugriff } from '@/lib/support/kontext'
import { antwortFehler, supportKeyGueltig } from '@/lib/support/anfrage'
import { JsmFehler, anfrageDetail, antwortSenden, jsmKonfiguriert } from '@/lib/support/jsm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const nichtGefunden = () => NextResponse.json({ fehler: 'Anfrage nicht gefunden.' }, { status: 404, headers: KEIN_CACHE })

function jsmFehler(e: unknown, text: string) {
  if (e instanceof JsmFehler) return NextResponse.json({ fehler: e.message }, { status: e.status, headers: KEIN_CACHE })
  console.error('[support] ' + text, e)
  return NextResponse.json({ fehler: text }, { status: 500, headers: KEIN_CACHE })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const k = await supportKontext()
  if ('fehler' in k) return k.fehler
  const { key } = await params
  if (!supportKeyGueltig(key)) return nichtGefunden()
  if (!jsmKonfiguriert()) return NextResponse.json({ fehler: 'Die Support-Anbindung ist nicht eingerichtet.' }, { status: 503, headers: KEIN_CACHE })
  try {
    const detail = await anfrageDetail(await supportZugriff(k.user.id, k.user.email!), key)
    return detail ? NextResponse.json(detail, { headers: KEIN_CACHE }) : nichtGefunden()
  } catch (e) {
    return jsmFehler(e, 'Die Anfrage konnte nicht geladen werden.')
  }
}

// schreibsperre-ausnahme: Antwort an den Support (Jira, keine Betriebsdaten in software:112) – auch im Nur-Lesen-Modus
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const k = await supportKontext()
  if ('fehler' in k) return k.fehler
  const konflikt = await seitenBetriebKonflikt(k.membership.tenantId)
  if (konflikt) return konflikt
  const { key } = await params
  if (!supportKeyGueltig(key)) return nichtGefunden()
  if (!jsmKonfiguriert()) return NextResponse.json({ fehler: 'Die Support-Anbindung ist nicht eingerichtet.' }, { status: 503, headers: KEIN_CACHE })

  const body = await req.json().catch(() => null) as { text?: unknown } | null
  const fehler = antwortFehler(body?.text)
  if (fehler) return NextResponse.json({ fehler }, { status: 400, headers: KEIN_CACHE })
  try {
    // KAN-438: antworten darf, wer die Anfrage sehen darf – eigene bzw. Anfrage eines seiner Betriebe (dieselbe Prüfung wie GET)
    const zugriff = await supportZugriff(k.user.id, k.user.email!)
    const detail = await anfrageDetail(zugriff, key)
    if (!detail) return nichtGefunden()
    await antwortSenden(key, k.benutzerName ?? k.user.email!, String(body!.text))
    const neu = await anfrageDetail(zugriff, key)
    return NextResponse.json(neu ?? detail, { status: 201, headers: KEIN_CACHE })
  } catch (e) {
    return jsmFehler(e, 'Die Antwort konnte nicht gesendet werden.')
  }
}
