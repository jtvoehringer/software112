// /api/weinexport/<id>/nachweis/<nid> – Beleg eines Nachweises öffnen (GET) bzw. Nachweis entfernen (DELETE), KAN-440 Teil 2
//
// GET leitet auf eine kurzlebige signierte Adresse der Datei im Speicher export-nachweise weiter; lesen darf jedes
// Mitglied des Betriebs (wie die Tabelle). DELETE entfernt die Zeile (nur solange der Auftrag weder abgeschlossen noch
// storniert ist – das prüft die Datenbank) und danach die Datei.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { modulKonflikt } from '@/lib/auth/modul'
import { dbFehlerText } from '@/lib/fehler'
import { ereignisMelden } from '@/lib/system/ereignis'
import { NACHWEIS_BUCKET } from '@/lib/export/nachweise'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Gültigkeit der signierten Adresse in Sekunden */
const GUELTIG_S = 300
const fehler = (meldung: string, status: number) => NextResponse.json({ fehler: meldung }, { status })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; nid: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const ohneModul = await modulKonflikt('modul_export')   // KAN-6: Paket-Modul auch in der Route
  if (ohneModul) return ohneModul
  const { id, nid } = await params
  if (!UUID.test(id) || !UUID.test(nid)) return fehler('Ungültiger Nachweis', 400)
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return fehler('Nicht angemeldet', 401)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('export_nachweise') as any)
    .select('datei_pfad').eq('id', nid).eq('exportauftrag_id', id).eq('tenant_id', tenantId).maybeSingle()
  if (error) return fehler(dbFehlerText(error, 'Nachweis konnte nicht geladen werden'), 500)
  const pfad = (data as R | null)?.datei_pfad as string | undefined
  if (!pfad) return fehler('Nachweis nicht gefunden', 404)

  const { data: signiert, error: sErr } = await supabase.storage.from(NACHWEIS_BUCKET).createSignedUrl(pfad, GUELTIG_S)
  if (sErr || !signiert?.signedUrl) return fehler(`Die Datei konnte nicht geöffnet werden${sErr ? `: ${dbFehlerText(sErr)}` : ''}.`, 500)
  return NextResponse.redirect(signiert.signedUrl, { status: 302, headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; nid: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const ohneModul = await modulKonflikt('modul_export')   // KAN-6: Paket-Modul auch in der Route
  if (ohneModul) return ohneModul
  const { id, nid } = await params
  if (!UUID.test(id) || !UUID.test(nid)) return fehler('Ungültiger Nachweis', 400)
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return fehler('Nicht autorisiert', 401)
  const konflikt = await seitenBetriebKonflikt(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!canWrite(membership, 'warenwirtschaft')) return fehler('Keine Berechtigung', 403)

  // KAN-243: die gelöschte Zeile zurückholen – 0 Zeilen heißt „nicht gelöscht“ (RLS, schon entfernt)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('export_nachweise') as any)
    .delete().eq('id', nid).eq('exportauftrag_id', id).eq('tenant_id', tenantId).select('id, datei_pfad')
  if (error) return fehler(error.code === '42501' ? error.message : dbFehlerText(error, 'Nachweis konnte nicht entfernt werden'), error.code === '42501' ? 409 : 500)
  const zeilen = (data ?? []) as R[]
  if (zeilen.length === 0) return fehler('Der Nachweis wurde nicht entfernt – bitte die Seite neu laden.', 404)

  // Datei erst nach der Zeile entfernen; bleibt sie liegen, ist der Nachweis trotzdem entfernt (Meldung an den Betrieb der Plattform)
  const { error: re } = await supabase.storage.from(NACHWEIS_BUCKET).remove(zeilen.map(z => String(z.datei_pfad)))
  if (re) void ereignisMelden({ art: 'db', quelle: 'weinexport/nachweis', meldung: `Datei eines entfernten Nachweises blieb liegen (${zeilen[0].datei_pfad}): ${re.message}` })
  return NextResponse.json({ ok: true })
}
