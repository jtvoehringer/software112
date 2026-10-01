import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// Whitelist gegen Mass Assignment: nur diese Felder dürfen per PATCH geändert werden –
// status (Detailseite) und die EMCS-Daten (EmcsPanel). tenant_id, id, referenz, created_at,
// aktiv usw. werden nie aus dem Request-Body übernommen.
const AENDERBAR = ['status', 'emcs_arc_nummer', 'emcs_status'] as const
const STATUS      = ['entwurf', 'bestaetigt', 'versendet', 'abgeschlossen']
const EMCS_STATUS = ['draft', 'submitted', 'accepted', 'cancelled']
// ARC (Administrative Reference Code) besteht nur aus Buchstaben und Ziffern (21 Zeichen);
// die Einschränkung hält den Wert außerdem sicher für das e-AD-XML unter /emcs.
const ARC_MUSTER = /^[A-Za-z0-9]{1,30}$/

function fehler(meldung: string, status: number) {
  return NextResponse.json({ fehler: meldung }, { status })
}

/** Leerer String/null → null, sonst getrimmter String; alles andere ist ungültig (undefined). */
function optionalerText(wert: unknown): string | null | undefined {
  if (wert === null) return null
  if (typeof wert !== 'string') return undefined
  const t = wert.trim()
  return t === '' ? null : t
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  // tenant_id + Rolle IMMER aus aktivem Tenant (Cookie) – niemals aus dem Request-Body
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return fehler('Nicht autorisiert', 401)
  const konflikt = await seitenBetriebKonflikt(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!canWrite(membership, 'warenwirtschaft')) return fehler('Keine Berechtigung', 403)

  let body: unknown
  try { body = await req.json() } catch { return fehler('Ungültiger Request-Body', 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fehler('Ungültiger Request-Body', 400)
  const b = body as R

  const unbekannt = Object.keys(b).filter(k => !(AENDERBAR as readonly string[]).includes(k))
  if (unbekannt.length > 0) return fehler(`Nicht änderbare Felder: ${unbekannt.join(', ')}`, 400)

  const update: R = {}
  if ('status' in b) {
    if (typeof b.status !== 'string' || !STATUS.includes(b.status)) return fehler('Ungültiger Status', 400)
    update.status = b.status
  }
  if ('emcs_status' in b) {
    const s = optionalerText(b.emcs_status)
    if (s === undefined || (s !== null && !EMCS_STATUS.includes(s))) return fehler('Ungültiger EMCS-Status', 400)
    update.emcs_status = s
  }
  if ('emcs_arc_nummer' in b) {
    const arc = optionalerText(b.emcs_arc_nummer)
    if (arc === undefined || (arc !== null && !ARC_MUSTER.test(arc)))
      return fehler('ARC-Nummer darf nur Buchstaben und Ziffern enthalten (max. 30 Zeichen)', 400)
    update.emcs_arc_nummer = arc
  }
  if (Object.keys(update).length === 0) return fehler('Keine Änderungen übergeben', 400)

  // Zusätzlich zu RLS (tenant_exportauftraege + modul_update) explizit auf den aktiven Tenant filtern
  const { data, error } = await (supabase.from('exportauftraege') as any)
    .update(update).eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) return fehler(error.message, error.code === '42501' ? 409 : 500)   // KAN-150 F2: stornierter Auftrag ist unveränderlich
  if (!data || data.length === 0) return fehler('Nicht gefunden', 404)
  return NextResponse.json({ ok: true })
}
