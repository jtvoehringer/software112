// POST /api/weinexport/<id>/nachweis – Ausfuhr- bzw. Gelangensnachweis zum Exportauftrag erfassen (KAN-440 Teil 2)
//
// Formularfelder: datei (PDF, JPEG, PNG, WebP; höchstens 4 MB), art, datum (JJJJ-MM-TT), notiz (optional).
// Die Datei kommt in den privaten Speicher export-nachweise (<betrieb>/<auftrag>/…), dann die Zeile in export_nachweise;
// scheitert die Zeile (z. B. Auftrag abgeschlossen), wird die Datei wieder entfernt. Als Route statt Server Action,
// weil Server Actions nur 1 MB annehmen.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { modulKonflikt } from '@/lib/auth/modul'
import { dbFehlerText } from '@/lib/fehler'
import { heuteWien } from '@/lib/datum/wien'
import { ereignisMelden } from '@/lib/system/ereignis'
import { NACHWEIS_BUCKET, nachweisDateiFehler, nachweisEingabeFehler, nachweisPfad } from '@/lib/export/nachweise'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fehler = (meldung: string, status: number) => NextResponse.json({ fehler: meldung }, { status })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const ohneModul = await modulKonflikt('modul_export')   // KAN-6: Paket-Modul auch in der Route
  if (ohneModul) return ohneModul
  const { id } = await params
  if (!UUID.test(id)) return fehler('Ungültiger Exportauftrag', 400)
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const leseSperre = leseKonflikt(membership, 'verkauf')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  const tenantId = membership?.tenantId
  if (!tenantId) return fehler('Nicht autorisiert', 401)
  const konflikt = await seitenBetriebKonflikt(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!canWrite(membership, 'warenwirtschaft')) return fehler('Keine Berechtigung', 403)

  let form: FormData
  try { form = await req.formData() } catch { return fehler('Ungültige Anfrage – bitte den Beleg erneut wählen (höchstens 4 MB).', 400) }
  const datei = form.get('datei')
  const art = form.get('art')
  const datum = form.get('datum')
  const notizRoh = form.get('notiz')
  const notiz = typeof notizRoh === 'string' && notizRoh.trim() !== '' ? notizRoh.trim() : null
  const ef = nachweisEingabeFehler({ art, datum, notiz }, heuteWien())
  if (ef) return fehler(ef, 400)
  if (!(datei instanceof File)) return fehler('Bitte den Beleg als Datei wählen.', 400)
  const df = nachweisDateiFehler(datei)
  if (df) return fehler(df, 400)

  // Auftrag im eigenen Betrieb und noch offen? (Die Datenbank prüft dasselbe – so bleibt keine Datei ohne Zeile liegen)
  // storno-sichtbar: der stornierte Auftrag wird bewusst gelesen, um den Nachweis mit einer klaren Meldung abzulehnen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: auftrag, error: ae } = await (supabase.from('exportauftraege') as any)
    .select('id, status, storniert_am').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (ae) return fehler(dbFehlerText(ae, 'Exportauftrag konnte nicht geladen werden'), 500)
  const a = auftrag as R | null
  if (!a) return fehler('Exportauftrag nicht gefunden', 404)
  if (a.storniert_am) return fehler('Der Exportauftrag ist storniert – Nachweise lassen sich nicht mehr ändern.', 409)
  if (a.status === 'abgeschlossen') return fehler('Der Exportauftrag ist abgeschlossen – Nachweise lassen sich nicht mehr ändern.', 409)

  const pfad = nachweisPfad(tenantId, id, datei.name, Date.now())
  const { error: ue } = await supabase.storage.from(NACHWEIS_BUCKET).upload(pfad, datei, { contentType: datei.type, upsert: false })
  if (ue) return fehler(`Der Beleg konnte nicht gespeichert werden: ${dbFehlerText(ue)}`, 500)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: zeile, error: ie } = await (supabase.from('export_nachweise') as any)
    .insert({ tenant_id: tenantId, exportauftrag_id: id, art, datum, notiz, datei_pfad: pfad, dateiname: datei.name.slice(-200) })
    .select('id')
  if (ie || !((zeile ?? []) as R[]).length) {
    // Datei wieder entfernen – sonst läge ein Beleg ohne Nachweis im Speicher
    const { error: re } = await supabase.storage.from(NACHWEIS_BUCKET).remove([pfad])
    if (re) void ereignisMelden({ art: 'db', quelle: 'weinexport/nachweis', meldung: `Datei ohne Nachweis blieb liegen (${pfad}): ${re.message}` })
    if (!ie) return fehler('Der Nachweis wurde nicht gespeichert – bitte die Seite neu laden.', 409)
    return fehler(ie.code === '42501' || ie.code === '23514' ? ie.message : dbFehlerText(ie, 'Nachweis konnte nicht gespeichert werden'), ie.code === '42501' ? 403 : ie.code === '23514' ? 409 : 500)
  }
  return NextResponse.json({ ok: true, id: (zeile as R[])[0].id })
}
