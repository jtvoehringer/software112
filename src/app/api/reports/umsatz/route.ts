import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { NextRequest, NextResponse } from 'next/server'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ladeMonat(supabase: any, ziel: MonatsZiel, tenantId: string): Promise<UmsatzMonat> {
  const von = new Date(ziel.jahr, ziel.monatIdx, 1).toISOString().split('T')[0]
  const bis = new Date(ziel.jahr, ziel.monatIdx + 1, 0).toISOString().split('T')[0]

  const { data } = await (supabase.from('verkaufsposten') as any)
    .select('id, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
    .eq('tenant_id', tenantId)
    .eq('aktiv', true).eq('storniert', false)
    .gte('datum', von).lte('datum', bis)

  const posten = (data ?? []) as R[]
  const summe = posten.reduce((s: number, p: R) =>
    s + ((p.verkauf_positionen ?? []) as R[]).reduce((ps: number, pos: R) => {
      const b = (Number(pos.preis_brutto) || 0) * (Number(pos.menge) || 0)
      return ps + b * (1 - (Number(pos.rabatt_pct) || 0) / 100) * (1 - (Number(pos.sonderrabatt_pct) || 0) / 100)
    }, 0), 0)

  return {
    monat: new Date(ziel.jahr, ziel.monatIdx, 1).toLocaleDateString('de-AT', { month: 'short', year: '2-digit' }),
    umsatz: summe,
    anzahl: posten.length,
    von, bis,
  }
}

// Dynamische Umsatz-Auswertung (Nachfolger der statischen 12-Monats-Ansicht in /reports).
// Zwei Modi über Query-Parameter:
//   ?von=YYYY-MM&bis=YYYY-MM   -> fortlaufender Zeitraum (für "Von/Bis"-Auswahl)
//   ?monate=YYYY-MM,YYYY-MM,…  -> einzelne, nicht zwingend zusammenhängende Monate
//                                  in genau der übergebenen Reihenfolge (für Monatsvergleich)
// Ohne Parameter: Fallback auf die letzten 12 Monate (gleicher Einstiegspunkt wie bisher).
export async function GET(req: NextRequest) {
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

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
    const heute = new Date()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(heute.getFullYear(), heute.getMonth() - i, 1)
      ziele.push({ jahr: d.getFullYear(), monatIdx: d.getMonth() })
    }
  }

  const supabase = await createSupabaseServerClient()
  const monate = await Promise.all(ziele.map(z => ladeMonat(supabase, z, tenantId)))

  return NextResponse.json({ monate })
}
