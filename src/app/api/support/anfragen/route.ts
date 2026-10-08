// /api/support/anfragen – Support-Anfragen an Jira Service Management (KAN-230 Phase 2, 08.10.2026)
//
// GET:  Anfragearten des Betriebs (Premium-Support nur mit aktivem Paket) und die eigenen Anfragen.
// POST: neue Anfrage im Namen des Benutzers (multipart: art, betreff, beschreibung, dringlichkeit, seite,
//       optional screenshot + screenshot_zustimmung). Regeln: src/lib/support/anfrage.ts, HTTP: jsm.ts.
// Jedes Mitglied darf melden (auch Leser); Support muss auch im Nur-Lesen-Modus erreichbar sein.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { premiumSupportAktiv } from '@/lib/abo/premiumSupport'
import {
  ANFRAGE_ARTEN, DRINGLICHKEITEN, anfrageEingabeFehler, beschreibungMitKontext, erlaubteArten, rateLimitFehler, seiteBereinigen,
  type AnfrageArt, type Dringlichkeit,
} from '@/lib/support/anfrage'
import { JsmFehler, anfrageAnlegen, anfragenImFenster, anfragetypId, jsmKonfiguriert, kundeSicherstellen, meineAnfragen, organisationZuordnen } from '@/lib/support/jsm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const keinCache = { 'Cache-Control': 'no-store' }

async function kontext() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { fehler: NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401, headers: keinCache }) } as const
  const membership = await getCurrentMembership()
  if (!membership) return { fehler: NextResponse.json({ fehler: 'Kein Betrieb ausgewählt' }, { status: 403, headers: keinCache }) } as const
  const [{ data: t }, { data: p }] = await Promise.all([
    (supabase.from('tenants') as R).select('name, premium_support_seit, premium_support_bis').eq('id', membership.tenantId).maybeSingle(),
    (supabase.from('profiles') as R).select('full_name').eq('id', user.id).maybeSingle(),
  ])
  const premium = premiumSupportAktiv({ seit: (t as R | null)?.premium_support_seit ?? null, bis: (t as R | null)?.premium_support_bis ?? null })
  return {
    user, membership, premium,
    betriebName: ((t as R | null)?.name as string | undefined) ?? 'Unbekannter Betrieb',
    benutzerName: (((p as R | null)?.full_name as string | null | undefined) ?? '').trim() || null,
  } as const
}

export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const k = await kontext()
  if ('fehler' in k) return k.fehler
  const arten = erlaubteArten(k.premium).map(a => ({ wert: a, label: ANFRAGE_ARTEN[a].label }))
  const dringlichkeiten = (Object.keys(DRINGLICHKEITEN) as Dringlichkeit[]).map(d => ({ wert: d, label: DRINGLICHKEITEN[d].label }))
  if (!jsmKonfiguriert()) return NextResponse.json({ aktiv: false, arten, dringlichkeiten, anfragen: [] }, { headers: keinCache })
  try {
    const anfragen = await meineAnfragen(k.user.email!)
    return NextResponse.json({ aktiv: true, arten, dringlichkeiten, anfragen }, { headers: keinCache })
  } catch (e) {
    const fehler = e instanceof JsmFehler ? e.message : 'Ihre Anfragen konnten nicht geladen werden.'
    return NextResponse.json({ aktiv: true, arten, dringlichkeiten, anfragen: [], fehler }, { headers: keinCache })
  }
}

// schreibsperre-ausnahme: Support-Anfrage an Jira (keine Betriebsdaten in software:112) – muss auch im Nur-Lesen-Modus gehen, gerade dann
export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const k = await kontext()
  if ('fehler' in k) return k.fehler
  const konflikt = await seitenBetriebKonflikt(k.membership.tenantId)
  if (konflikt) return konflikt
  if (!jsmKonfiguriert()) return NextResponse.json({ fehler: 'Die Support-Anbindung ist nicht eingerichtet.' }, { status: 503, headers: keinCache })

  let fd: FormData
  try {
    fd = await req.formData()
  } catch {
    return NextResponse.json({ fehler: 'Ungültige Anfrage.' }, { status: 400, headers: keinCache })
  }
  const datei = fd.get('screenshot')
  const screenshot = datei instanceof File && datei.size > 0 ? datei : null
  const eingabe = {
    art: fd.get('art'),
    betreff: fd.get('betreff'),
    beschreibung: fd.get('beschreibung'),
    dringlichkeit: fd.get('dringlichkeit'),
    screenshot: screenshot ? { typ: screenshot.type, groesse: screenshot.size } : null,
    screenshotZustimmung: fd.get('screenshot_zustimmung') === '1',
  }
  const fehler = anfrageEingabeFehler(eingabe, k.premium)
  if (fehler) return NextResponse.json({ fehler }, { status: 400, headers: keinCache })
  const art = eingabe.art as AnfrageArt
  const dringlichkeit = eingabe.dringlichkeit as Dringlichkeit

  try {
    const accountId = await kundeSicherstellen(k.user.email!, k.benutzerName ?? k.user.email!)
    const limit = rateLimitFehler(await anfragenImFenster(accountId))
    if (limit) return NextResponse.json({ fehler: limit }, { status: 429, headers: keinCache })
    const organisationId = await organisationZuordnen(k.betriebName, accountId)

    const beschreibung = beschreibungMitKontext(String(eingabe.beschreibung), {
      betriebName: k.betriebName,
      tenantId: k.membership.tenantId,
      benutzerName: k.benutzerName,
      benutzerEmail: k.user.email!,
      rolle: k.membership.role ?? 'unbekannt',
      seite: seiteBereinigen(fd.get('seite')),
      userAgent: req.headers.get('user-agent'),
      appVersion: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
      zeitpunkt: new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna' }),
    })
    const ergebnis = await anfrageAnlegen({
      accountId,
      anfragetypId: await anfragetypId(ANFRAGE_ARTEN[art].name),
      betreff: String(eingabe.betreff).trim(),
      beschreibung,
      organisationId,
      prioritaet: art === 'premium' && dringlichkeit === 'hoch' ? 'Highest' : DRINGLICHKEITEN[dringlichkeit].prioritaet,
      screenshot: screenshot ? { datei: screenshot, name: screenshot.name || 'screenshot.png' } : null,
    })
    return NextResponse.json(ergebnis, { status: 201, headers: keinCache })
  } catch (e) {
    if (e instanceof JsmFehler) return NextResponse.json({ fehler: e.message }, { status: e.status, headers: keinCache })
    console.error('[support] Anfrage fehlgeschlagen:', e)
    return NextResponse.json({ fehler: 'Die Anfrage konnte nicht gesendet werden. Bitte versuchen Sie es später noch einmal oder schreiben Sie uns eine E-Mail.' }, { status: 500, headers: keinCache })
  }
}
