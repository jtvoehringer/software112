// /api/support/rueckruf – Rückruf anfordern (KAN-236, 08.10.2026)
//
// POST { telefon, anliegen?, zeitfenster?, seite? }: Anfrage vom Typ „Rückruf“ in SUP im Namen des Benutzers, Priorität
// Highest, Telefonnummer im Betreff. Kunde, Organisation, Rate-Limit und Kontextblock wie bei „Problem melden“.
// Jedes Mitglied darf (auch Leser); Support muss auch im Nur-Lesen-Modus erreichbar sein.

import { NextRequest, NextResponse } from 'next/server'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { KEIN_CACHE, supportKontext } from '@/lib/support/kontext'
import {
  RUECKRUF_ANFRAGETYP, RUECKRUF_PRIORITAET, beschreibungMitKontext, rateLimitFehler, rueckrufFehler, rueckrufText, seiteBereinigen, telefonNormalisieren,
} from '@/lib/support/anfrage'
import { JsmFehler, anfrageAnlegen, anfragenImFenster, anfragetypId, jsmKonfiguriert, kundeSicherstellen, organisationZuordnen } from '@/lib/support/jsm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// schreibsperre-ausnahme: Rückruf-Anfrage an Jira (keine Betriebsdaten in software:112) – auch im Nur-Lesen-Modus
export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const k = await supportKontext()
  if ('fehler' in k) return k.fehler
  const konflikt = await seitenBetriebKonflikt(k.membership.tenantId)
  if (konflikt) return konflikt
  if (!jsmKonfiguriert()) return NextResponse.json({ fehler: 'Die Support-Anbindung ist nicht eingerichtet.' }, { status: 503, headers: KEIN_CACHE })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const eingabe = { telefon: body?.telefon, anliegen: body?.anliegen, zeitfenster: body?.zeitfenster }
  const fehler = rueckrufFehler(eingabe)
  if (fehler) return NextResponse.json({ fehler }, { status: 400, headers: KEIN_CACHE })
  const telefon = telefonNormalisieren(eingabe.telefon)!
  const { betreff, text } = rueckrufText({
    telefon,
    anliegen: typeof eingabe.anliegen === 'string' ? eingabe.anliegen : null,
    zeitfenster: typeof eingabe.zeitfenster === 'string' ? eingabe.zeitfenster : null,
  })

  try {
    const accountId = await kundeSicherstellen(k.user.email!, k.benutzerName ?? k.user.email!)
    const limit = rateLimitFehler(await anfragenImFenster(accountId))
    if (limit) return NextResponse.json({ fehler: limit }, { status: 429, headers: KEIN_CACHE })
    const organisationId = await organisationZuordnen(k.betriebName, accountId)
    const beschreibung = beschreibungMitKontext(text, {
      betriebName: k.betriebName,
      tenantId: k.membership.tenantId,
      benutzerName: k.benutzerName,
      benutzerEmail: k.user.email!,
      rolle: k.membership.role ?? 'unbekannt',
      seite: seiteBereinigen(body?.seite),
      userAgent: req.headers.get('user-agent'),
      appVersion: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
      zeitpunkt: new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna' }),
    })
    const ergebnis = await anfrageAnlegen({
      accountId,
      anfragetypId: await anfragetypId(RUECKRUF_ANFRAGETYP),
      betreff,
      beschreibung,
      organisationId,
      prioritaet: RUECKRUF_PRIORITAET,
      screenshot: null,
    })
    return NextResponse.json(ergebnis, { status: 201, headers: KEIN_CACHE })
  } catch (e) {
    if (e instanceof JsmFehler) return NextResponse.json({ fehler: e.message }, { status: e.status, headers: KEIN_CACHE })
    console.error('[support] Rückruf fehlgeschlagen:', e)
    return NextResponse.json({ fehler: 'Der Rückruf konnte nicht angefordert werden. Bitte rufen Sie uns an oder schreiben Sie uns eine E-Mail.' }, { status: 500, headers: KEIN_CACHE })
  }
}
