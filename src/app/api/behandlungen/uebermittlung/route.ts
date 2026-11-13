import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { csvDateiname } from '@/lib/csv'
import { csvAntwort, fehlerAntwort } from '@/lib/csv/antwort'
import { ladePsmUebermittlungsStand } from '@/lib/uebermittlung/psm/laden'
import { CSV_DATEI_ADAPTER } from '@/lib/uebermittlung/psm/csvDatei'
import { auswahlFuerExport, entfallenHinweis, zeilenEinesLaufs } from '@/lib/uebermittlung/psm/stand'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const dynamic = 'force-dynamic'

// ── PSM-Übermittlung (KAN-120) ──────────────────────────────────────────────────────────────────────────
// POST  – „Offene Aufzeichnungen exportieren“: offene und nach dem Export geänderte Maßnahmen als CSV (Spalten der
//         Meldung psm-uebermittlung) und Protokoll je Maßnahme (s112_psm_uebermittlung_protokollieren: Version, Hash,
//         Kanal). Kein Doppelexport: was unverändert exportiert ist, fehlt.
// GET   – ?export=<id>: einen früheren Export-Lauf erneut herunterladen (nur unveränderte Maßnahmen, ohne Seiteneffekte).
// Rechte: Schreibrecht Weingarten (Betriebsleitung, Mitarbeiter mit Modul); die RPC prüft Rolle, Abo und Modul erneut.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const leseSperre = leseKonflikt(membership, 'betriebsmittel')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  const tenantId = membership?.tenantId
  if (!tenantId) return fehlerAntwort(401, 'Kein Betrieb')
  const konflikt = await seitenBetriebKonflikt(tenantId)
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(membership)
  if (gesperrt) return gesperrt
  if (!canWrite(membership, 'rieden')) return fehlerAntwort(403, 'Kein Schreibrecht für Pflanzenschutz-Aufzeichnungen')

  const supabase = await createSupabaseServerClient()
  let stand
  try { stand = await ladePsmUebermittlungsStand(supabase, tenantId) } catch { return fehlerAntwort(500, 'Die Aufzeichnungen konnten nicht geladen werden.') }

  const auswahl = auswahlFuerExport(stand.stand)
  if (auswahl.length === 0) return fehlerAntwort(409, 'Keine offenen oder geänderten Aufzeichnungen – alles ist bereits exportiert.')

  const adapter = CSV_DATEI_ADAPTER
  const zeilen = auswahl.flatMap(s => s.zeilen)
  // Erst protokollieren, dann liefern: scheitert das Protokoll, gibt es keine Datei (kein unprotokollierter Export)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_psm_uebermittlung_protokollieren', {
    p_tenant_id: tenantId,
    p_kanal: adapter.kanal,
    p_eintraege: auswahl.map(s => ({ behandlung_id: s.behandlungId, hash: s.hash, zeilen: s.zeilen.length })),
  })
  if (error) return fehlerAntwort(error.code === '42501' ? 403 : 500, `Der Export konnte nicht protokolliert werden: ${error.message}`)

  const datei = adapter.serialisiere(zeilen, stand.betriebsnummer)
  const korrekturen = auswahl.filter(s => s.status === 'korrektur').length
  const hinweise = [
    ...(korrekturen > 0 ? [`${korrekturen} ${korrekturen === 1 ? 'Aufzeichnung ist eine Korrektur' : 'Aufzeichnungen sind Korrekturen'} eines früheren Exports – bitte den Bericht nochmals vorlegen.`] : []),
    ...[entfallenHinweis(auswahl)].filter((h): h is string => !!h),
    ...adapter.validiere(zeilen, stand.betriebsnummer),
  ]
  return csvAntwort(datei.text, csvDateiname(datei.dateiteile), datei.zeilen, hinweise)
}

export async function GET(request: Request) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const leseSperre = leseKonflikt(membership, 'betriebsmittel')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  const tenantId = membership?.tenantId
  if (!tenantId) return fehlerAntwort(401, 'Kein Betrieb')
  if (!canWrite(membership, 'rieden')) return fehlerAntwort(403, 'Kein Schreibrecht für Pflanzenschutz-Aufzeichnungen')
  const exportId = new URL(request.url).searchParams.get('export') ?? ''
  if (!UUID.test(exportId)) return fehlerAntwort(400, 'Unbekannter Export-Lauf')

  const supabase = await createSupabaseServerClient()
  let stand
  try { stand = await ladePsmUebermittlungsStand(supabase, tenantId) } catch { return fehlerAntwort(500, 'Die Aufzeichnungen konnten nicht geladen werden.') }
  const lauf = zeilenEinesLaufs(stand.stand, stand.protokoll, exportId)
  if (lauf.massnahmen === 0) return fehlerAntwort(404, 'Unbekannter Export-Lauf')

  const datei = CSV_DATEI_ADAPTER.serialisiere(lauf.zeilen, stand.betriebsnummer)
  const hinweise = lauf.fehlend > 0
    ? [`${lauf.fehlend} ${lauf.fehlend === 1 ? 'Aufzeichnung wurde' : 'Aufzeichnungen wurden'} seit diesem Export geändert oder storniert und ${lauf.fehlend === 1 ? 'fehlt' : 'fehlen'} hier – sie kommen als Korrektur mit dem nächsten Export.`]
    : []
  return csvAntwort(datei.text, csvDateiname([...datei.dateiteile, 'erneut']), datei.zeilen, hinweise)
}
