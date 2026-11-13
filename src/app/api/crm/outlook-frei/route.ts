import { NextRequest, NextResponse } from 'next/server'
import { ladeOutlookVerbindung, ladeOutlookKollegen } from '@/lib/m365/benutzer'
import { kalenderFreiBelegt } from '@/lib/m365/graph'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { getCurrentMembership } from '@/lib/auth/roles'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const dynamic = 'force-dynamic'

// GET /api/crm/outlook-frei?datum=YYYY-MM-DD[&user=id,id]
// Frei/Belegt der Outlook-verbundenen Kollegen an einem Tag (06:00–20:00) über getSchedule –
// braucht nur Calendars.Read, funktioniert also mit jeder bestehenden Verbindung.
// Ohne `user`: alle Kollegen mit Outlook-Verbindung. Antwort immer HTTP 200.
export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const leseSperre = leseKonflikt(await getCurrentMembership(), 'crm')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  const datum = req.nextUrl.searchParams.get('datum')
  if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return NextResponse.json({ ok: false, grund: 'eingabe', kollegen: [] })
  const nurIds = (req.nextUrl.searchParams.get('user') ?? '').split(',').filter(Boolean)

  const r = await ladeOutlookVerbindung()
  if (!r.ok) return NextResponse.json({ ok: false, grund: r.grund, kollegen: [] })

  let kollegen = await ladeOutlookKollegen(r.v.tenantId, r.v.userId)
  if (nurIds.length > 0) kollegen = kollegen.filter(k => nurIds.includes(k.id))
  if (kollegen.length === 0) return NextResponse.json({ ok: true, kollegen: [] })

  try {
    const fb = await kalenderFreiBelegt(r.v.token, kollegen.map(k => k.email), `${datum}T06:00:00`, `${datum}T20:00:00`)
    const out = kollegen.map(k => {
      const s = fb.find(x => x.email.toLowerCase() === k.email.toLowerCase())
      return { id: k.id, name: k.name, email: k.email, verfuegbar: s?.verfuegbar ?? false, belegt: s?.belegt ?? [], fehler: s?.fehler ?? null }
    })
    return NextResponse.json({ ok: true, kollegen: out })
  } catch (err) {
    return NextResponse.json({ ok: false, grund: 'graph', meldung: err instanceof Error ? err.message : String(err), kollegen: [] })
  }
}
