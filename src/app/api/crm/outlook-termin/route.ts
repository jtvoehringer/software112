import { NextRequest, NextResponse } from 'next/server'
import { ladeOutlookVerbindung, ladeOutlookKollegen } from '@/lib/m365/benutzer'
import { kalenderTerminAnlegen } from '@/lib/m365/graph'
import { ereignisMelden } from '@/lib/system/ereignis'

export const dynamic = 'force-dynamic'

// POST /api/crm/outlook-termin – Termin im Outlook-Kalender des angemeldeten Benutzers
// anlegen und Kollegen (user_ids) als Teilnehmer einladen. Outlook stellt die Einladung
// zu, der Termin landet damit auch in deren Kalendern (kein Zugriff auf fremde Kalender).
// Antwort immer HTTP 200 mit { ok } oder { ok:false, grund, meldung } – das CRM-Speichern
// selbst ist davon unabhängig (Aktivität ist zu dem Zeitpunkt schon gespeichert).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    betreff?: string; datum?: string; bis_datum?: string | null; ganztags?: boolean
    von?: string | null; bis?: string | null; beschreibung?: string | null; teilnehmer?: string[]
  }
  if (!body.betreff || !body.datum) return NextResponse.json({ ok: false, grund: 'eingabe', meldung: 'Betreff und Datum fehlen' })

  const r = await ladeOutlookVerbindung()
  if (!r.ok) return NextResponse.json({ ok: false, grund: r.grund, meldung: r.meldung ?? null })
  if (!r.v.schreiben) {
    return NextResponse.json({ ok: false, grund: 'kein_schreibrecht',
      meldung: r.v.schreibenAktiv
        ? 'Ihre Outlook-Verbindung hat noch kein Schreibrecht auf den Kalender – unter Nachrichten einmal „Trennen“ und neu verbinden.'
        : 'Termine in Outlook anlegen ist für diesen Betrieb noch nicht freigeschaltet (Mein Betrieb → M365, Berechtigung Calendars.ReadWrite in Entra).' })
  }

  const kollegen = await ladeOutlookKollegen(r.v.tenantId, r.v.userId)
  const gewuenscht = new Set((body.teilnehmer ?? []).filter(Boolean))
  const teilnehmer = kollegen.filter(k => gewuenscht.has(k.id)).map(k => ({ email: k.email, name: k.name }))
  const ohneOutlook = [...gewuenscht].filter(id => !kollegen.some(k => k.id === id)).length

  try {
    const ev = await kalenderTerminAnlegen(r.v.token, {
      betreff: body.betreff, datum: body.datum, bisDatum: body.bis_datum ?? null, ganztags: !!body.ganztags,
      von: body.von ?? null, bis: body.bis ?? null, beschreibung: body.beschreibung ?? null, teilnehmer,
    })
    return NextResponse.json({ ok: true, id: ev.id, webLink: ev.webLink, eingeladen: teilnehmer.length, ohneOutlook })
  } catch (err) {
    const meldung = err instanceof Error ? err.message : String(err)
    void ereignisMelden({ art: 'server', quelle: 'crm/outlook-termin', meldung, tenantId: r.v.tenantId })
    // 403 = Berechtigung fehlt trotz Scope (Entra-Consent nicht erteilt)
    const grund = /403/.test(meldung) ? 'kein_schreibrecht' : 'graph'
    return NextResponse.json({ ok: false, grund, meldung })
  }
}
