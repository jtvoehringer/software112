// POST /api/buchhaltung/belege/[id]/loesen – einen angehängten Beleg von seiner Buchung lösen (KAN-415, UAT 12.11.2026)
//
// Body: { grund } (mindestens 10 Zeichen – steht im Änderungsprotokoll). Der Beleg liegt danach wieder bei den nicht
// verbuchten Belegen (dort verwerfen oder neu zuordnen); die Datei bleibt erhalten. Nur im offenen Zeitraum der
// Buchung – im abgeschlossenen Monat bzw. übermittelten UVA-Zeitraum bleibt er als Nachweis (§ 132 BAO). Die Regeln
// prüft die RPC s112_ea_beleg_loesen in der Datenbank; ein verbuchter Beleg ist direkt weiterhin unveränderlich.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { dbFehlerText } from '@/lib/fehler'
import { belegLoesenGrundFehler } from '@/lib/buchhaltung/belegAnhang'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id } = await params

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 403 })
  const konflikt = await seitenBetriebKonflikt(tenantId, 'error')   // KAN-30: Anfrage aus einem veralteten Tab?
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!canWrite(membership, 'ea')) return NextResponse.json({ error: 'Keine Berechtigung – dafür ist die Freigabe E&A nötig.' }, { status: 403 })
  if (!UUID.test(id)) return NextResponse.json({ error: 'Beleg nicht gefunden.' }, { status: 404 })

  let body: { grund?: unknown } = {}
  try { body = await req.json() } catch { /* ohne Body fehlt der Grund – unten abgelehnt */ }
  const grundFehler = belegLoesenGrundFehler(body.grund)
  if (grundFehler) return NextResponse.json({ error: grundFehler }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_ea_beleg_loesen', { p_tenant_id: tenantId, p_beleg_id: id, p_grund: String(body.grund).trim() })
  if (error) {
    // erwartbare Ablehnungen der Datenbank (abgeschlossener Zeitraum, schon gelöst, nicht gefunden) als Meldung am Formular
    const status = error.code === 'P0002' ? 404 : error.code === '42501' ? 403 : error.code === '23514' ? 400 : 500
    return NextResponse.json({ error: dbFehlerText(error, 'Der Beleg wurde nicht entfernt') }, { status })
  }
  return NextResponse.json({ ok: true })
}
