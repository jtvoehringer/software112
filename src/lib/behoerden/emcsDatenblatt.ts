// ── Behördenaufzeichnung „EMCS-Datenblatt“ (KAN-435 D1, 13.11.2026 – Epic KAN-431) ──────────────────────────────────────
//
// Die frühere e-AD-XML-Datei (/api/weinexport/[id]/emcs) war nicht einreichbar: Verbrauchsteuernummer = UID, Produktcode
// für alles „W200“, Menge in der eingegebenen Einheit statt Liter, kein Alkoholgehalt. Sie sah aber aus wie eine gültige
// EMCS-Meldung. An ihre Stelle tritt dieses Datenblatt: die Angaben des Exportauftrags so aufbereitet, wie sie in EMCS
// zu erfassen sind – kein amtliches Dokument, keine Übermittlung.
//
// Entscheidungen Jörgen 13.11.2026 (alle A): XML entfernen (1), Datenblatt auch als CSV (2), Produktcode als Vorschlag
// aus dem KN-Code mit dem Zusatz „in EMCS prüfen“ (6). Fehlende Werte bleiben leer bzw. „–“, nie geschätzt; was fehlt,
// steht in `fehlt` (dieselbe Hinweisliste wie am Exportauftrag).
//
// Seite /weinexport/[id]/emcs-datenblatt und CSV nutzen ladeEmcsDatenblatt(). Tests: scripts/tests/kan435-emcs-datenblatt.test.mjs

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
import { STELLEN, type CsvSpalte } from '@/lib/csv'
import { AktionsFehler } from '@/lib/fehler'
import { ladeExportauftrag, importeurName, type ExportPositionZeile } from './exportauftrag'
import { textOderNull, type R } from './verkehr-hilfen'
import { knZiffern } from '../export/grunddaten'
import { vstVerfahrenLabel } from '../export/verbrauchsteuer'

/** Kopfzeile von Druckansicht und Hinweis in der Hilfe */
export const DATENBLATT_VERMERK = 'Kein amtliches Dokument – Daten zum Erfassen in EMCS'
export const PRODUKTCODE_VERMERK = 'Vorschlag – in EMCS prüfen'

/**
 * Verbrauchsteuer-Produktcode als Vorschlag aus dem KN-Code: 2204 10 (Schaumwein) → W300, übriger Wein in Behältnissen
 * (2204 21/22/29) → W200. Alles andere (Traubenmost 2204 30, Wermut, Zwischenerzeugnisse …) bleibt ohne Vorschlag.
 */
export function produktcodeVorschlag(kn: unknown): 'W200' | 'W300' | null {
  const z = knZiffern(kn)
  if (z.startsWith('220410')) return 'W300'
  if (z.startsWith('220421') || z.startsWith('220422') || z.startsWith('220429')) return 'W200'
  return null
}

/** Verkehrszweig wie in EMCS (Codeliste „Beförderungsart“); unbekannte Transportart → null */
export function verkehrszweig(transportArt: unknown): { code: string; text: string } | null {
  const t = typeof transportArt === 'string' ? transportArt.trim().toLowerCase() : ''
  if (t === 'schiff') return { code: '1', text: 'Seeverkehr' }
  if (t === 'bahn') return { code: '2', text: 'Eisenbahnverkehr' }
  if (t === 'lkw') return { code: '3', text: 'Straßenverkehr' }
  if (t === 'flugzeug') return { code: '4', text: 'Luftverkehr' }
  return null
}

export type DatenblattKopf = {
  referenz: string | null
  versanddatum: string | null
  versenderName: string | null
  versenderAnschrift: string | null
  versenderUid: string | null
  /** KAN-435 D2: Verbrauchsteuernummer (ATV/SEED) des Betriebs */
  versenderVerbrauchsteuernr: string | null
  empfaengerName: string | null
  empfaengerOrt: string | null
  empfaengerLand: string | null
  empfaengerUid: string | null
  empfaengerVerbrauchsteuernr: string | null
  lieferfall: string | null
  verfahren: string | null
  verkehrszweigCode: string | null
  verkehrszweigText: string | null
  arc: string | null
  mvvCode: string | null
  begleitdokumentNr: string | null
  ausfuhrMrn: string | null
}

export type DatenblattZeile = DatenblattKopf & {
  positionId: string
  position: number
  produktcode: string | null
  knCode: string | null
  bezeichnung: string | null
  liter: number | null
  alkohol: number | null
  nettoKg: number | null
  bruttoKg: number | null
  packstuecke: number | null
  flaschen: number | null
  flaschengroesseMl: number | null
}

export const SPALTEN_EMCS_DATENBLATT: CsvSpalte<DatenblattZeile>[] = [
  { kopf: 'Referenz', typ: 'code', wert: z => z.referenz },
  { kopf: 'Versanddatum', typ: 'datum', wert: z => z.versanddatum },
  { kopf: 'Versender', typ: 'text', wert: z => z.versenderName },
  { kopf: 'Anschrift Versender', typ: 'text', wert: z => z.versenderAnschrift },
  { kopf: 'UID Versender', typ: 'code', wert: z => z.versenderUid },
  { kopf: 'Verbrauchsteuernummer Versender', typ: 'code', wert: z => z.versenderVerbrauchsteuernr },
  { kopf: 'Empfänger', typ: 'text', wert: z => z.empfaengerName },
  { kopf: 'Bestimmungsort', typ: 'text', wert: z => z.empfaengerOrt },
  { kopf: 'Bestimmungsland', typ: 'text', wert: z => z.empfaengerLand },
  { kopf: 'UID Empfänger', typ: 'code', wert: z => z.empfaengerUid },
  { kopf: 'Verbrauchsteuernummer Empfänger', typ: 'code', wert: z => z.empfaengerVerbrauchsteuernr },
  { kopf: 'Lieferfall', typ: 'text', wert: z => z.lieferfall },
  { kopf: 'Verbrauchsteuerverfahren', typ: 'text', wert: z => z.verfahren },
  { kopf: 'Verkehrszweig (Code)', typ: 'code', wert: z => z.verkehrszweigCode },
  { kopf: 'Verkehrszweig', typ: 'text', wert: z => z.verkehrszweigText },
  { kopf: 'ARC', typ: 'code', wert: z => z.arc },
  { kopf: 'MVV-Code', typ: 'code', wert: z => z.mvvCode },
  { kopf: 'Begleitdokument-Nr.', typ: 'code', wert: z => z.begleitdokumentNr },
  { kopf: 'MRN Ausfuhranmeldung', typ: 'code', wert: z => z.ausfuhrMrn },
  { kopf: 'Pos.', typ: 'ganzzahl', wert: z => z.position },
  { kopf: 'Produktcode (Vorschlag – in EMCS prüfen)', typ: 'code', wert: z => z.produktcode },
  { kopf: 'KN-Code', typ: 'code', wert: z => z.knCode },
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'Menge (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.liter },
  { kopf: 'Alkohol (% vol)', typ: 'dezimal', stellen: 1, wert: z => z.alkohol },
  { kopf: 'Nettogewicht (kg)', typ: 'dezimal', stellen: 2, wert: z => z.nettoKg },
  { kopf: 'Bruttogewicht (kg)', typ: 'dezimal', stellen: 2, wert: z => z.bruttoKg },
  { kopf: 'Packstücke (Kartons)', typ: 'ganzzahl', wert: z => z.packstuecke },
  { kopf: 'Flaschen', typ: 'dezimal', stellen: 2, wert: z => z.flaschen },
  { kopf: 'Flaschengröße (ml)', typ: 'ganzzahl', wert: z => z.flaschengroesseMl },
]

export function datenblattKopf(auftrag: R, betrieb: R, lieferfallLabel: string | null): DatenblattKopf {
  const vz = verkehrszweig(auftrag.transport_art)
  const anschrift = [textOderNull(betrieb.betrieb_strasse), [textOderNull(betrieb.betrieb_plz), textOderNull(betrieb.betrieb_ort)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return {
    referenz: textOderNull(auftrag.referenz),
    versanddatum: textOderNull(auftrag.versanddatum),
    versenderName: textOderNull(betrieb.betrieb_name),
    versenderAnschrift: anschrift || null,
    versenderUid: textOderNull(betrieb.betrieb_uid),
    versenderVerbrauchsteuernr: textOderNull(betrieb.betrieb_verbrauchsteuernr),
    empfaengerName: importeurName(auftrag),
    empfaengerOrt: textOderNull(auftrag.destination_stadt),
    empfaengerLand: textOderNull(auftrag.destination_land),
    empfaengerUid: textOderNull(auftrag.kunde_uid),
    empfaengerVerbrauchsteuernr: textOderNull(auftrag.empfaenger_verbrauchsteuernr),
    lieferfall: lieferfallLabel,
    verfahren: vstVerfahrenLabel(auftrag.verbrauchsteuer_verfahren) || null,
    verkehrszweigCode: vz?.code ?? null,
    verkehrszweigText: vz?.text ?? textOderNull(auftrag.transport_art),
    arc: textOderNull(auftrag.emcs_arc_nummer),
    mvvCode: textOderNull(auftrag.mvv_code),
    begleitdokumentNr: textOderNull(auftrag.begleitdokument_nr),
    ausfuhrMrn: textOderNull(auftrag.ausfuhr_mrn),
  }
}

/** Positionszeilen des Exportauftrags (aus ladeExportauftrag) → Zeilen des Datenblatts; Zahlen sind dort schon gerundet */
export function datenblattZeilen(kopf: DatenblattKopf, positionen: readonly ExportPositionZeile[]): DatenblattZeile[] {
  return positionen.map(p => ({
    ...kopf,
    positionId: p.positionId,
    position: p.position,
    produktcode: produktcodeVorschlag(p.taric),
    knCode: knZiffern(p.taric) || null,
    bezeichnung: p.bezeichnung,
    liter: p.liter,
    alkohol: p.alkohol,
    nettoKg: p.nettoKg,
    bruttoKg: p.bruttoKg,
    packstuecke: p.kartons,
    flaschen: p.flaschen,
    flaschengroesseMl: p.flaschengroesseMl,
  }))
}

export type EmcsDatenblatt = {
  kopf: DatenblattKopf
  zeilen: DatenblattZeile[]
  /** Summen über die Positionen; null, sobald einer Position der Wert fehlt */
  literGesamt: number | null
  bruttoKgGesamt: number | null
  nettoKgGesamt: number | null
  /** Angaben, die für die Erfassung in EMCS noch fehlen (Hinweisliste des Auftrags) */
  fehlt: string[]
  warnungen: string[]
  storniert: boolean
}

type Client = any

/**
 * Datenblatt eines Exportauftrags – für /weinexport/[id]/emcs-datenblatt und die CSV.
 * null = Auftrag nicht gefunden. Das Modul „Weinexport“ prüfen Seite (Umleitung) bzw. Route (Katalog-Eintrag).
 */
export async function ladeEmcsDatenblatt(supabase: Client, tenantId: string, p: { id: string }): Promise<EmcsDatenblatt | null> {
  const erg = await ladeExportauftrag(supabase, tenantId, p)
  if (!erg) return null
  const { data: betrieb, error } = await (supabase.from('tenant_einstellungen') as any)
    .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, betrieb_verbrauchsteuernr')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new AktionsFehler(`Laden fehlgeschlagen (tenant_einstellungen): ${error.message}`)

  const kopf = datenblattKopf(erg.auftrag, (betrieb ?? {}) as R, erg.grunddaten.lieferfall.label || null)
  const zeilen = datenblattZeilen(kopf, erg.zeilen)
  const fehlt = erg.grunddaten.hinweise.map(h => h.text)
  if (erg.gewicht.hinweis) fehlt.push(erg.gewicht.hinweis)
  if (!kopf.versanddatum) fehlt.push('Versanddatum fehlt.')
  // KAN-435 D2: die Nummern braucht EMCS bei Beförderungen in andere Mitgliedstaaten
  if (erg.grunddaten.lieferfall.gebiet === 'eu') {
    if (!kopf.versenderVerbrauchsteuernr) fehlt.push('Verbrauchsteuernummer des Betriebs fehlt (Betrieb › Einstellungen).')
    if (!kopf.empfaengerVerbrauchsteuernr) fehlt.push('Verbrauchsteuernummer des Empfängers fehlt (Kasten „Verbrauchsteuer und Begleitdokument“ am Auftrag).')
  }
  if (!kopf.verkehrszweigCode) fehlt.push('Transportart fehlt bzw. lässt sich keinem Verkehrszweig zuordnen.')
  zeilen.forEach(z => { if (!z.produktcode) fehlt.push(`Pos. ${z.position}: kein Produktcode-Vorschlag (KN-Code fehlt oder ist kein Wein in Behältnissen) – in EMCS selbst wählen.`) })
  return {
    kopf, zeilen,
    literGesamt: erg.grunddaten.summen.liter,
    bruttoKgGesamt: erg.gewicht.bruttoKg ?? null,
    nettoKgGesamt: erg.gewicht.nettoKg ?? null,
    fehlt: [...new Set(fehlt)],
    warnungen: erg.warnungen,
    storniert: !!erg.auftrag.storniert_am,
  }
}
