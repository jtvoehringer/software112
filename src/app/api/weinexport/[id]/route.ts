import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { modulKonflikt } from '@/lib/auth/modul'
import { exportauftragFehler, exportKopf, exportPositionen, verpackungFehler, verpackungWert } from '@/lib/export/auftragEingabe'
import { normalisiereLand } from '@/lib/katalog/laender'
import { dbFehlerText } from '@/lib/fehler'
import { istExportStatus } from '@/lib/export/workflow'
import { ausfuhranmeldungFehler, mrnBereinigt } from '@/lib/export/nachweise'
import { heuteWien } from '@/lib/datum/wien'
import { belegnummernAus, belegnummernFehler } from '@/lib/export/belegnummern'
import { verbrauchsteuerFehler, verbrauchsteuerWerte, type VerbrauchsteuerEingabe } from '@/lib/export/verbrauchsteuer'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// Whitelist gegen Mass Assignment: nur diese Felder dürfen per PATCH geändert werden –
// status (Detailseite, seit KAN-440 nur über die RPC s112_exportauftrag_status_setzen, optional mit grund) und die
// EMCS-Daten (EmcsPanel). tenant_id, id, referenz, created_at,
// aktiv usw. werden nie aus dem Request-Body übernommen.
// KAN-414: dazu das Verpackungsgewicht (Kartons, Palette) – steht oft erst beim Kommissionieren fest
// KAN-440 Teil 2: dazu MRN und Datum der Ausfuhranmeldung (stehen oft erst beim Versand fest; ab „Abgeschlossen“ gesperrt)
// KAN-437 Teil 3: dazu die länderspezifischen Belegnummern (COLA, Prior Notice …; ebenfalls bis „Abgeschlossen“)
// KAN-435 D2: dazu Verbrauchsteuerverfahren, MVV-Code, Nummer des Begleitdokuments, Verbrauchsteuernummer des Empfängers
const AENDERBAR = ['status', 'grund', 'emcs_arc_nummer', 'emcs_status', 'verpackung_kg', 'ausfuhr_mrn', 'ausfuhr_anmeldung_datum', 'laender_belege',
  'verbrauchsteuer_verfahren', 'mvv_code', 'begleitdokument_nr', 'empfaenger_verbrauchsteuernr'] as const
const EMCS_STATUS = ['draft', 'submitted', 'accepted', 'cancelled']
// ARC (Administrative Reference Code) besteht nur aus Buchstaben und Ziffern (21 Zeichen);
// (die frühere e-AD-XML-Datei gibt es seit KAN-435 nicht mehr).
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
  const ohneModul = await modulKonflikt('modul_export')   // KAN-6: Paket-Modul auch in der Route
  if (ohneModul) return ohneModul
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

  // KAN-440: Statuswechsel nur über die RPC (Übergangsmatrix, Rechnung vor „Versendet“, zurück nur Betriebsleitung mit
  // Grund) – immer als eigener Aufruf, nie zusammen mit anderen Feldern
  if ('status' in b) {
    if (!istExportStatus(b.status)) return fehler('Ungültiger Status', 400)
    if (Object.keys(b).some(k => k !== 'status' && k !== 'grund')) return fehler('Der Status wird als eigener Schritt geändert.', 400)
    if (b.grund != null && typeof b.grund !== 'string') return fehler('Ungültiger Grund', 400)
    const { error: se } = await (supabase as any).rpc('s112_exportauftrag_status_setzen', { // eslint-disable-line @typescript-eslint/no-explicit-any
      p_tenant_id: tenantId, p_auftrag_id: id, p_status: b.status, p_grund: typeof b.grund === 'string' ? b.grund : null,
    })
    if (se) {
      // Ablehnungen der Datenbank tragen den Text für den Benutzer (Matrix, Rechnung fehlt, Grund, Betriebsleitung)
      const code = se.code === 'P0002' ? 404 : se.code === '42501' ? 403 : se.code === '23514' || se.code === '22023' ? 409 : 500
      return fehler(code === 500 ? dbFehlerText(se, 'Statuswechsel fehlgeschlagen') : se.message, code)
    }
    return NextResponse.json({ ok: true })
  }
  if ('grund' in b) return fehler('Nicht änderbare Felder: grund', 400)

  const update: R = {}
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
  if ('verpackung_kg' in b) {
    const vf = verpackungFehler(b.verpackung_kg)
    if (vf) return fehler(vf, 400)
    update.verpackung_kg = verpackungWert(b.verpackung_kg)
  }
  if ('ausfuhr_mrn' in b || 'ausfuhr_anmeldung_datum' in b) {
    const mrn = optionalerText(b.ausfuhr_mrn ?? null)
    const datum = optionalerText(b.ausfuhr_anmeldung_datum ?? null)
    if (mrn === undefined || datum === undefined) return fehler('Ungültige Angaben zur Ausfuhranmeldung', 400)
    const af = ausfuhranmeldungFehler({ mrn, datum }, heuteWien())
    if (af) return fehler(af, 400)
    if ('ausfuhr_mrn' in b) update.ausfuhr_mrn = mrnBereinigt(mrn) || null
    if ('ausfuhr_anmeldung_datum' in b) update.ausfuhr_anmeldung_datum = datum
  }
  if ('laender_belege' in b) {
    const bf = belegnummernFehler(b.laender_belege)
    if (bf) return fehler(bf, 400)
    update.laender_belege = belegnummernAus(b.laender_belege)   // nur Bezeichnung und Nummer, getrimmt – nichts sonst aus dem Body
  }
  // KAN-435 D2: nur die übergebenen Felder; leer → null, Nummern bereinigt
  const vst: VerbrauchsteuerEingabe = {}
  for (const k of ['verbrauchsteuer_verfahren', 'mvv_code', 'begleitdokument_nr', 'empfaenger_verbrauchsteuernr'] as const) if (k in b) vst[k] = b[k]
  if (Object.keys(vst).length > 0) {
    const vf = verbrauchsteuerFehler(vst)
    if (vf) return fehler(vf, 400)
    Object.assign(update, verbrauchsteuerWerte(vst))
  }
  if (Object.keys(update).length === 0) return fehler('Keine Änderungen übergeben', 400)

  // Zusätzlich zu RLS (tenant_exportauftraege + modul_update) explizit auf den aktiven Tenant filtern
  const { data, error } = await (supabase.from('exportauftraege') as any)
    .update(update).eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) return fehler(error.message, error.code === '42501' ? 409 : 500)   // KAN-150 F2: stornierter Auftrag ist unveränderlich
  if (!data || data.length === 0) return fehler('Nicht gefunden', 404)
  return NextResponse.json({ ok: true })
}

// ── PUT: Exportauftrag bearbeiten (KAN-429) ─────────────────────────────────────────────────────────────────────────
// Kopfdaten und Positionen eines Auftrags in Entwurf oder Bestätigt ersetzen – in einer Transaktion über die RPC
// s112_exportauftrag_aendern (prüft Rollen, Abo-Sperre, Paket-Modul, Status und die Positionen erneut; setzt
// ausgestellte Dokumente zurück auf „ausstehend“). Ab „Versendet“ lehnt die Datenbank ab (Freeze).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const ohneModul = await modulKonflikt('modul_export')
  if (ohneModul) return ohneModul
  const { id } = await params
  const supabase = await createSupabaseServerClient()
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

  const destLandRoh = typeof b.destination_land === 'string' ? b.destination_land.trim() : ''
  const destinationLand = normalisiereLand(destLandRoh)
  if (destLandRoh && !destinationLand) return fehler(`Unbekanntes Land „${destLandRoh}“ – bitte ein Land aus der Liste wählen.`, 400)
  if (typeof b.datum !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.datum)) return fehler('Bitte das Auftragsdatum angeben.', 400)
  const eingabeFehler = exportauftragFehler(b)
  if (eingabeFehler) return fehler(eingabeFehler, 400)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('s112_exportauftrag_aendern', {
    p_tenant_id: tenantId, p_auftrag_id: id, p_kopf: exportKopf(b, destinationLand), p_positionen: exportPositionen(b),
  })
  if (error) {
    const status = error.code === 'P0002' ? 404 : error.code === '42501' ? 409 : ['23514', '22023', '23503', '22001', '22P02'].includes(error.code ?? '') ? 400 : 500
    return fehler(dbFehlerText(error, 'Der Exportauftrag wurde nicht gespeichert'), status)
  }
  const erg = (Array.isArray(data) ? data[0] : data) as R | null
  return NextResponse.json({ ok: true, id, dokumente_zurueck: Number(erg?.dokumente_zurueck) || 0 })
}
