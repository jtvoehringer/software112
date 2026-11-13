import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { NextRequest, NextResponse } from 'next/server'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { ladeUmsatzBelege, umsatzNetto } from '@/lib/verkauf/umsatz'
import { umsatzBasis, type UmsatzBasis } from '@/lib/verkauf/umsatzBasis'
import { dbFehlerText } from '@/lib/fehler'
import { lokalerTag, wienJetzt } from '@/lib/datum/wien'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type UmsatzMonat = { monat: string; umsatz: number; anzahl: number; von: string; bis: string }

type MonatsZiel = { jahr: number; monatIdx: number }

const MAX_MONATE = 36 // Obergrenze gegen zu lange/teure Anfragen

function parseYYYYMM(s: string): MonatsZiel | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s.trim())
  if (!m) return null
  const jahr = parseInt(m[1], 10)
  const monatIdx = parseInt(m[2], 10) - 1
  if (monatIdx < 0 || monatIdx > 11) return null
  return { jahr, monatIdx }
}

function monatsBereich(von: MonatsZiel, bis: MonatsZiel): MonatsZiel[] {
  const [start, ende] = (von.jahr < bis.jahr || (von.jahr === bis.jahr && von.monatIdx <= bis.monatIdx))
    ? [von, bis] : [bis, von]
  const ziele: MonatsZiel[] = []
  let cursor: MonatsZiel = { ...start }
  let guard = 0
  while (guard < MAX_MONATE && (cursor.jahr < ende.jahr || (cursor.jahr === ende.jahr && cursor.monatIdx <= ende.monatIdx))) {
    ziele.push({ ...cursor })
    cursor = cursor.monatIdx === 11 ? { jahr: cursor.jahr + 1, monatIdx: 0 } : { jahr: cursor.jahr, monatIdx: cursor.monatIdx + 1 }
    guard++
  }
  return ziele
}

// KAN-346/348: Monatsumsatz netto über die zentrale Umsatzfunktion (lib/verkauf/umsatz) – Standard nach Rechnungsdatum
// wie Dashboard und Finanzübersicht, mit ?basis=lieferung nach Lieferdatum (KAN-105, Lieferscheine auch nicht berechnet;
// Entscheidung Jörgen 22.10.2026). Ein Lesefehler kommt zurück (KAN-253) – vorher wurde der Fehler verworfen und der
// Monat zeigte still 0 bzw. eine Teilsumme.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ladeMonat(supabase: any, ziel: MonatsZiel, tenantId: string, basis: UmsatzBasis): Promise<{ monat: UmsatzMonat; error: R | null }> {
  const von = lokalerTag(new Date(ziel.jahr, ziel.monatIdx, 1))   // KAN-255: über die lokalen Felder, nie toISOString()
  const bis = lokalerTag(new Date(ziel.jahr, ziel.monatIdx + 1, 0))
  const { data, error } = await ladeUmsatzBelege(supabase, tenantId, von, bis, basis)
  return {
    monat: {
      monat: new Date(ziel.jahr, ziel.monatIdx, 1).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', month: 'short', year: '2-digit' }),
      umsatz: umsatzNetto(data),
      anzahl: data.length,
      von, bis,
    },
    error,
  }
}

// Dynamische Umsatz-Auswertung (Nachfolger der statischen 12-Monats-Ansicht in /reports).
// Zwei Modi über Query-Parameter:
//   ?von=YYYY-MM&bis=YYYY-MM   -> fortlaufender Zeitraum (für "Von/Bis"-Auswahl)
//   ?monate=YYYY-MM,YYYY-MM,…  -> einzelne, nicht zwingend zusammenhängende Monate
//                                  in genau der übergebenen Reihenfolge (für Monatsvergleich)
// Ohne Parameter: Fallback auf die letzten 12 Monate (gleicher Einstiegspunkt wie bisher).
export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const leseSperre = leseKonflikt(membership, 'verkauf')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

  const basis       = umsatzBasis(req.nextUrl.searchParams.get('basis'))
  const monateParam = req.nextUrl.searchParams.get('monate')
  const vonParam    = req.nextUrl.searchParams.get('von')
  const bisParam    = req.nextUrl.searchParams.get('bis')

  let ziele: MonatsZiel[] = []

  if (monateParam) {
    ziele = monateParam.split(',')
      .map(s => parseYYYYMM(s))
      .filter((z): z is MonatsZiel => z !== null)
      .slice(0, MAX_MONATE)
    if (ziele.length === 0) {
      return NextResponse.json({ fehler: 'Ungültige Monatsangabe(n).' }, { status: 400 })
    }
  } else if (vonParam && bisParam) {
    const von = parseYYYYMM(vonParam)
    const bis = parseYYYYMM(bisParam)
    if (!von || !bis) {
      return NextResponse.json({ fehler: 'von/bis müssen im Format YYYY-MM angegeben werden.' }, { status: 400 })
    }
    ziele = monatsBereich(von, bis)
  } else {
    const heute = wienJetzt()   // Sweep 79: letzte 12 Monate ab dem Wiener Monat
    for (let i = 11; i >= 0; i--) {
      const d = new Date(heute.getFullYear(), heute.getMonth() - i, 1)
      ziele.push({ jahr: d.getFullYear(), monatIdx: d.getMonth() })
    }
  }

  const supabase = await createSupabaseServerClient()
  const ergebnisse = await Promise.all(ziele.map(z => ladeMonat(supabase, z, tenantId, basis)))
  const fehler = ergebnisse.find(e => e.error)?.error
  if (fehler) return NextResponse.json({ fehler: dbFehlerText(fehler, 'Umsatz konnte nicht geladen werden') }, { status: 500 })

  return NextResponse.json({ monate: ergebnisse.map(e => e.monat) })
}
