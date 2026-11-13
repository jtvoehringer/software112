// ── Behördenmeldungen „Weinexport“ (24.09.2026) ─────────────────────────────────
//
//  exportauftrag   Positionsliste eines Exportauftrags als gemeinsame Anlage zu den
//                  Begleitpapieren (Begleitdokument, EUR.1, CMR, Ursprungszeugnis) und für den
//                  Spediteur: eine Zeile je Position mit Bezeichnung, TARIC, Menge,
//                  Einheit, Liter, Wert (€), Ursprung, Bestimmungsland, EORI.
//                  Seite /weinexport/[id] und CSV nutzen ladeExportauftrag().
//  exportauftraege Auftragsliste mit Dokumentstatus (auch Phytosanitär), ARC-Nummer und
//                  EMCS-Status. Seite /weinexport und CSV nutzen ladeExportauftraege().
//
// Die HTML-Papiere unter /api/weinexport bleiben das Druckformat; die CSV kommt zusätzlich. Die frühere e-AD-XML-Datei
// ist seit KAN-435 durch das EMCS-Datenblatt ersetzt (emcsDatenblatt.ts). Wert je Position = Menge × Preis, kaufmännisch auf 2 Stellen
// gerundet; Summen addieren die gerundeten Werte (Seite und CSV stimmen überein).
//
// Isomorph ohne Server-Importe (Konstanten auch für WeinexportDetailClient) – Tests: scripts/tests/verkehr.test.mjs

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
import { momentaufnahmeAnwenden } from '../stammdaten/momentaufnahme'
import { STELLEN, runden, type CsvSpalte } from '@/lib/csv'
import { alle, inBloecken as ladeInBloecken } from '@/lib/supabase/alle'
import { UUID_RE, feld, inBloecken, textOderNull, type R } from './verkehr-hilfen'
import { AktionsFehler } from '@/lib/fehler'
import { positionsGewicht, sendungsGewicht, type SendungsGewicht } from '../export/gewicht'
import {
  farbeLabel, grunddatenHinweise, grunddatenPosition, grunddatenSummen, juengsteAnalyse, lieferfall,
  type GrunddatenEingabe, type GrunddatenHinweis, type GrunddatenPosition, type GrunddatenSummen, type Lieferfall,
} from '../export/grunddaten'
import { exportBearbeitbar } from '../export/auftragEingabe'
import { EXPORT_DOKUMENT_ARTEN, EXPORT_DOKUMENT_LABEL } from '../export/dokumente'
import { befreiung, rechnungHinweise, rechnungsSumme } from '../export/rechnungTexte'
import { belegnummernText } from '../export/belegnummern'

export const EXPORT_STATUS_LABEL: Record<string, string> = {
  entwurf: 'Entwurf', bestaetigt: 'Bestätigt', versendet: 'Versendet', abgeschlossen: 'Abgeschlossen',
}

/** KAN-433: eine Liste der Dokumentarten in src/lib/export/dokumente.ts */
export const EXPORT_DOK_LABEL: Record<string, string> = EXPORT_DOKUMENT_LABEL

export const EXPORT_DOK_STATUS_LABEL: Record<string, string> = {
  ausstehend: 'Ausstehend', beantragt: 'Beantragt',
  ausgestellt: 'Ausgestellt', nicht_erforderlich: 'Nicht erforderlich',
}

export const EMCS_STATUS_LABEL: Record<string, string> = {
  draft: 'Entwurf', submitted: 'Eingereicht', accepted: 'Akzeptiert', cancelled: 'Storniert',
}

// ── Positionen ───────────────────────────────────────────────────────────────

export type ExportPositionZeile = {
  positionId: string
  referenz: string | null
  datum: string | null
  lieferdatum: string | null
  /** KAN-432 */
  versanddatum: string | null
  importeur: string | null
  /** KAN-432: UID des Kunden und Lieferfall („EU · B2B“ …) */
  kundeUid: string | null
  lieferfall: string | null
  eori: string | null
  bestimmungsland: string | null
  bestimmungsort: string | null
  ursprungsland: string | null
  incoterms: string | null
  transportart: string | null
  versenderUid: string | null
  position: number
  bezeichnung: string | null
  taric: string | null
  menge: number | null
  einheit: string | null
  flaschengroesseMl: number | null
  liter: number | null
  preisEur: number | null
  wertEur: number | null
  /** KAN-414: Gewicht der Position in kg (null, wenn Flaschengröße bzw. Leergewicht fehlen) */
  nettoKg: number | null
  bruttoKg: number | null
  /** KAN-432: aus Füllung, Prüfnummernantrag und Analyse abgeleitet (null = unbekannt, nie geschätzt) */
  flaschen: number | null
  flaschenJeKarton: number | null
  kartons: number | null
  alkohol: number | null
  pruefnummer: string | null
  farbe: string | null
  rebsorte: string | null
  jahrgang: string | null
  /** KAN-434: Nebenkosten, Rechnungsbetrag (Warenwert + Fracht + Versicherung) und Steuerbefreiung des Auftrags */
  frachtEur: number | null
  versicherungEur: number | null
  rechnungsbetragEur: number | null
  befreiung: string | null
}

export const SPALTEN_EXPORTAUFTRAG: CsvSpalte<ExportPositionZeile>[] = [
  { kopf: 'Referenz', typ: 'code', wert: z => z.referenz },
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Lieferdatum', typ: 'datum', wert: z => z.lieferdatum },
  { kopf: 'Versanddatum', typ: 'datum', wert: z => z.versanddatum },
  { kopf: 'Importeur', typ: 'text', wert: z => z.importeur },
  { kopf: 'UID Importeur', typ: 'code', wert: z => z.kundeUid },
  { kopf: 'Lieferfall', typ: 'text', wert: z => z.lieferfall },
  { kopf: 'EORI Importeur', typ: 'code', wert: z => z.eori },
  { kopf: 'Bestimmungsland', typ: 'text', wert: z => z.bestimmungsland },
  { kopf: 'Bestimmungsort', typ: 'text', wert: z => z.bestimmungsort },
  { kopf: 'Ursprungsland', typ: 'code', wert: z => z.ursprungsland },
  { kopf: 'Incoterms', typ: 'code', wert: z => z.incoterms },
  { kopf: 'Transportart', typ: 'text', wert: z => z.transportart },
  { kopf: 'UID Versender', typ: 'code', wert: z => z.versenderUid },
  { kopf: 'Pos.', typ: 'ganzzahl', wert: z => z.position },
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'TARIC', typ: 'code', wert: z => z.taric },
  { kopf: 'Menge', typ: 'dezimal', stellen: 2, wert: z => z.menge },
  { kopf: 'Einheit', typ: 'code', wert: z => z.einheit },
  { kopf: 'Flaschengröße (ml)', typ: 'ganzzahl', wert: z => z.flaschengroesseMl },
  { kopf: 'Volumen (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.liter },
  { kopf: 'Nettogewicht (kg)', typ: 'dezimal', stellen: 2, wert: z => z.nettoKg },
  { kopf: 'Bruttogewicht (kg)', typ: 'dezimal', stellen: 2, wert: z => z.bruttoKg },
  { kopf: 'Preis je Einheit (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.preisEur },
  { kopf: 'Wert (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.wertEur },
  // KAN-432: Angaben für Packliste und Begleitdokumente
  { kopf: 'Flaschen', typ: 'dezimal', stellen: 2, wert: z => z.flaschen },
  { kopf: 'Flaschen je Karton', typ: 'ganzzahl', wert: z => z.flaschenJeKarton },
  { kopf: 'Kartons', typ: 'ganzzahl', wert: z => z.kartons },
  { kopf: 'Alkohol (% vol)', typ: 'dezimal', stellen: 1, wert: z => z.alkohol },
  { kopf: 'Prüfnummer', typ: 'code', wert: z => z.pruefnummer },
  { kopf: 'Farbe', typ: 'text', wert: z => z.farbe },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'Jahrgang', typ: 'code', wert: z => z.jahrgang },
  // KAN-434: Angaben der Handelsrechnung (je Auftrag gleich)
  { kopf: 'Fracht (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.frachtEur },
  { kopf: 'Versicherung (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.versicherungEur },
  { kopf: 'Rechnungsbetrag (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.rechnungsbetragEur },
  { kopf: 'Steuerbefreiung', typ: 'text', wert: z => z.befreiung },
]

function zahlOderNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Importeur wie auf den Papieren: Firma, sonst Vor- und Nachname des Kontakts */
export function importeurName(a: R): string | null {
  momentaufnahmeAnwenden(a, { kontakte: 'kontakt', firmen: 'firma' })   // KAN-150 F1c: Empfänger wie beim Anlegen des Auftrags
  const firma = feld(a.firmen?.name)
  if (firma) return firma
  const person = [a.kontakte?.vorname, a.kontakte?.nachname].map(feld).filter(Boolean).join(' ')
  return person || null
}

/**
 * Volumen in Litern aus Menge und Einheit (Exportformular: Fl, Kiste, HL; zusätzlich l/Liter).
 * Nicht bestimmbar → null und ein Grund für die Warnung.
 */
export function literAus(menge: number | null, einheit: string | null, flaschengroesseMl: number | null, flaschenJeKiste: number | null = null): { liter: number | null; grund?: string } {
  if (menge === null) return { liter: null }
  const e = (einheit ?? '').trim().toLowerCase()
  if (e === 'hl') return { liter: runden(menge * 100, STELLEN.liter) }
  if (e === 'l' || e === 'liter') return { liter: runden(menge, STELLEN.liter) }
  if (e === 'fl' || e === 'flasche' || e === 'flaschen' || e === 'stk') {
    if (flaschengroesseMl && flaschengroesseMl > 0) return { liter: runden((menge * flaschengroesseMl) / 1000, STELLEN.liter) }
    return { liter: null, grund: 'Flaschengröße unbekannt (keine Füllung verknüpft)' }
  }
  if (e === 'kiste') {   // KAN-432: Flaschen je Karton der Position = Flaschen je Kiste
    if (!flaschenJeKiste || flaschenJeKiste < 1) return { liter: null, grund: 'Einheit „Kiste“: Flaschen je Kiste unbekannt' }
    if (flaschengroesseMl && flaschengroesseMl > 0) return { liter: runden((menge * flaschenJeKiste * flaschengroesseMl) / 1000, STELLEN.liter) }
    return { liter: null, grund: 'Flaschengröße unbekannt (keine Füllung verknüpft)' }
  }
  return { liter: null, grund: `Einheit „${einheit ?? ''}“ nicht in Liter umrechenbar` }
}

/** Wert einer Position = Menge × Preis, kaufmännisch auf 2 Stellen */
export function positionsWert(menge: number | null, preis: number | null): number | null {
  if (menge === null || preis === null) return null
  return runden(menge * preis, STELLEN.betrag)
}

/** Summe bereits gerundeter Werte (Druck-Summe = Summe der CSV-Zeilen) */
export function summeGerundet(werte: readonly (number | null)[]): number {
  return runden(werte.reduce<number>((s, w) => s + (w ?? 0), 0), STELLEN.betrag)
}

/** Positionen eines Auftrags → CSV-Zeilen; `warnungen` erhält nicht umrechenbare Liter */
export function exportZeilen(auftrag: R, positionen: readonly R[], betrieb: R, warnungen: string[], grunddaten?: readonly GrunddatenPosition[]): ExportPositionZeile[] {
  const kopf = {
    referenz: textOderNull(auftrag.referenz),
    datum: textOderNull(auftrag.datum),
    lieferdatum: textOderNull(auftrag.lieferdatum),
    versanddatum: textOderNull(auftrag.versanddatum),
    importeur: importeurName(auftrag),
    kundeUid: textOderNull(auftrag.kunde_uid),
    lieferfall: lieferfall(auftrag).label,
    eori: textOderNull(auftrag.eori_kunde),
    bestimmungsland: textOderNull(auftrag.destination_land),
    bestimmungsort: textOderNull(auftrag.destination_stadt),
    ursprungsland: textOderNull(auftrag.ursprungsland) ?? 'AT',
    incoterms: textOderNull(auftrag.incoterms),
    transportart: textOderNull(auftrag.transport_art),
    versenderUid: textOderNull(betrieb.betrieb_uid),
    befreiung: befreiung(lieferfall(auftrag)).label,
  }
  const ohneLiter: string[] = []
  const zeilen = positionen.map((p, i) => {
    const menge = zahlOderNull(p.menge)
    const preis = zahlOderNull(p.preis_eur)
    const ml = zahlOderNull(p.fuellungen?.flaschengroesse_ml)
    const einheit = textOderNull(p.einheit)
    const jeKarton = zahlOderNull(p.flaschen_je_karton)
    const l = literAus(menge, einheit, ml, jeKarton)
    const g = positionsGewicht({ menge: p.menge, einheit: p.einheit, flaschen_je_karton: p.flaschen_je_karton, fuellung: p.fuellungen ?? null })   // KAN-414
    const gd = grunddaten?.[i] ?? grunddatenPosition(grunddatenEingabe(p, null, null))   // KAN-432
    if (l.grund) ohneLiter.push(`Pos. ${i + 1}: ${l.grund}`)
    return {
      ...kopf,
      positionId: String(p.id ?? i),
      position: i + 1,
      bezeichnung: textOderNull(p.beschreibung) ?? textOderNull(p.fuellungen?.bezeichnung),
      taric: textOderNull(p.taric_code) ?? textOderNull(auftrag.taric_code),
      menge: menge === null ? null : runden(menge, 2),
      einheit,
      flaschengroesseMl: ml === null ? null : Math.trunc(ml),
      liter: l.liter,
      preisEur: preis === null ? null : runden(preis, STELLEN.betrag),
      wertEur: positionsWert(menge, preis),
      nettoKg: g.nettoKg,
      bruttoKg: g.bruttoKg,
      flaschen: gd.flaschen,
      flaschenJeKarton: gd.flaschenJeKarton,
      kartons: gd.kartons,
      alkohol: gd.alkohol,
      pruefnummer: gd.pruefnummer,
      farbe: farbeLabel(gd.farbe) || null,
      rebsorte: gd.rebsorte,
      jahrgang: gd.jahrgang,
      frachtEur: null as number | null, versicherungEur: null as number | null, rechnungsbetragEur: null as number | null,
    }
  })
  // KAN-434: Rechnungsbetrag = Summe der gerundeten Zeilenwerte + Fracht + Versicherung (wie auf der Handelsrechnung)
  const summe = rechnungsSumme(summeGerundet(zeilen.map(z => z.wertEur)), auftrag)
  for (const z of zeilen) { z.frachtEur = summe.fracht; z.versicherungEur = summe.versicherung; z.rechnungsbetragEur = summe.betrag }
  if (ohneLiter.length > 0) {
    const ref = kopf.referenz ? `${kopf.referenz}: ` : ''
    warnungen.push(`${ref}Volumen (l) leer gelassen – ${ohneLiter.slice(0, 5).join('; ')}${ohneLiter.length > 5 ? ' …' : ''}`)
  }
  return zeilen
}

/** KAN-432: Eingabe für die abgeleiteten Angaben einer Position (Füllung eingebettet, Antrag und Analyse dazugeladen) */
export function grunddatenEingabe(p: R, antrag: R | null, analyseAlkohol: unknown): GrunddatenEingabe {
  return {
    menge: p.menge, einheit: p.einheit, flaschen_je_karton: p.flaschen_je_karton, taric_code: p.taric_code, beschreibung: p.beschreibung,
    fuellung: p.fuellungen ?? null, antrag, analyseAlkohol,
  }
}

// ── Laden: einzelner Auftrag ─────────────────────────────────────────────────

type Client = any

export type ExportauftragErgebnis = {
  auftrag: R
  dokumente: R[]
  zeilen: ExportPositionZeile[]
  /** Summe der gerundeten Positionswerte */
  gesamtEur: number
  /** KAN-414: Netto-/Bruttogewicht der Sendung (Brutto inkl. Verpackung des Auftrags) */
  gewicht: SendungsGewicht
  /** KAN-432: Lieferfall, abgeleitete Angaben je Position (in der Reihenfolge von `zeilen`), Summen und Hinweisliste */
  grunddaten: { lieferfall: Lieferfall; positionen: GrunddatenPosition[]; summen: GrunddatenSummen; hinweise: GrunddatenHinweis[] }
  warnungen: string[]
}

/**
 * Exportauftrag mit Positionen und Dokumenten – für /weinexport/[id] und die CSV.
 * null = Auftrag nicht gefunden (oder keine gültige id). Das Modul „Weinexport“ prüfen
 * Seite (Umleitung) bzw. Route (Katalog-Eintrag modul_export).
 */
export async function ladeExportauftrag(supabase: Client, tenantId: string, p: { id: string }): Promise<ExportauftragErgebnis | null> {
  if (!UUID_RE.test(p.id)) return null
  const [auftragRes, posRes, dokRes, cfgRes] = await Promise.all([
    // storno-sichtbar: die Detailansicht zeigt den stornierten Auftrag mit Vermerk (KAN-150 F2)
    (supabase.from('exportauftraege') as any)
      .select('*, kontakte(vorname,nachname,email,telefon), firmen(name,email,telefon)')
      .eq('id', p.id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    // exportauftrag_positionen/export_dokumente haben keine tenant_id – sie hängen am
    // mandantengefilterten Auftrag (RLS über den Auftrag); ohne Auftrag wird unten nichts ausgegeben
    alle<R>((supabase.from('exportauftrag_positionen') as any)
      .select('id, beschreibung, menge, einheit, preis_eur, taric_code, sort_order, flaschen_je_karton, fuellungen(id,name,jahrgang,bezeichnung,flaschengroesse_ml,leergewicht_g,rebsorte,weinart,pruefnummer,weinausbau_id,dac_antrag_id)')
      .eq('exportauftrag_id', p.id)
      .order('sort_order')
      .order('id')),
    alle<R>((supabase.from('export_dokumente') as any)
      .select('*')
      .eq('exportauftrag_id', p.id)
      .order('dokument_art')
      .order('id')),
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_uid, betrieb_eori, betrieb_rex_nummer, betrieb_ea_bewilligung')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])
  if (auftragRes.error) throw new AktionsFehler(`Laden fehlgeschlagen (exportauftraege): ${auftragRes.error.message}`)
  if (posRes.error) throw new AktionsFehler(`Laden fehlgeschlagen (exportauftrag_positionen): ${posRes.error.message}`)
  if (dokRes.error) throw new AktionsFehler(`Laden fehlgeschlagen (export_dokumente): ${dokRes.error.message}`)
  if (cfgRes.error) throw new AktionsFehler(`Laden fehlgeschlagen (tenant_einstellungen): ${cfgRes.error.message}`)
  const auftrag = auftragRes.data as R | null
  if (!auftrag) return null

  // KAN-432: Alkohol und Prüfnummer – Prüfnummernantrag der Füllung, sonst die jüngste nicht stornierte Analyse der Charge.
  // Listen aus den Positionen EINES Auftrags (höchstens 200) – trotzdem in Blöcken.
  const antragIds = [...new Set(posRes.data.map(x => x.fuellungen?.dac_antrag_id).filter(Boolean))] as string[]
  const chargeIds = [...new Set(posRes.data.map(x => x.fuellungen?.weinausbau_id).filter(Boolean))] as string[]
  const [antragRes, analyseRes] = await Promise.all([
    ladeInBloecken<R>(antragIds, b => alle<R>((supabase.from('dac_antrag') as any)
      .select('id, alkohol_prozent, pruefnummer').eq('tenant_id', tenantId).in('id', b).is('storniert_am', null).order('id'))),
    ladeInBloecken<R>(chargeIds, b => alle<R>((supabase.from('weinanalysen') as any)
      .select('id, weinausbau_id, analyse_datum, created_at, alkohol_vol').eq('tenant_id', tenantId).in('weinausbau_id', b).is('storniert_am', null)
      .order('analyse_datum', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }))),
  ])
  if (antragRes.error) throw new AktionsFehler(`Laden fehlgeschlagen (dac_antrag): ${antragRes.error.message}`)
  if (analyseRes.error) throw new AktionsFehler(`Laden fehlgeschlagen (weinanalysen): ${analyseRes.error.message}`)
  const antraege = new Map((antragRes.data ?? []).map(x => [x.id as string, x]))
  const analysenJeCharge = new Map<string, R[]>()
  for (const x of analyseRes.data ?? []) analysenJeCharge.set(x.weinausbau_id, [...(analysenJeCharge.get(x.weinausbau_id) ?? []), x])
  const eingaben = posRes.data.map(x => grunddatenEingabe(x,
    x.fuellungen?.dac_antrag_id ? antraege.get(x.fuellungen.dac_antrag_id) ?? null : null,
    x.fuellungen?.weinausbau_id ? juengsteAnalyse(analysenJeCharge.get(x.fuellungen.weinausbau_id) ?? [])?.alkohol_vol ?? null : null))
  const gdPositionen = eingaben.map(grunddatenPosition)

  const warnungen: string[] = []
  const zeilen = exportZeilen(auftrag, posRes.data, (cfgRes.data ?? {}) as R, warnungen, gdPositionen)
  if (auftrag.aktiv === false) warnungen.push('Der Exportauftrag ist deaktiviert.')
  if (auftrag.storniert_am) warnungen.push(`Der Exportauftrag ist storniert${auftrag.storno_grund ? ` (${auftrag.storno_grund})` : ''}.`)   // KAN-150 F2
  const gewicht = sendungsGewicht(posRes.data.map(x => ({ menge: x.menge, einheit: x.einheit, flaschen_je_karton: x.flaschen_je_karton, fuellung: x.fuellungen ?? null })), auftrag.verpackung_kg)
  if (gewicht.hinweis) warnungen.push(gewicht.hinweis)
  const bearbeitbar = exportBearbeitbar(auftrag as { status?: string | null; storniert_am?: string | null; verkaufsposten_id?: string | null; muster_ausgebucht_am?: string | null })
  const grunddaten = {
    lieferfall: lieferfall(auftrag),
    positionen: gdPositionen,
    summen: grunddatenSummen(gdPositionen),
    hinweise: [
      ...grunddatenHinweise({
        auftragId: String(auftrag.id), auftrag, betrieb: (cfgRes.data ?? {}) as R,
        positionen: eingaben.map((eingabe, i) => ({ eingabe, daten: gdPositionen[i] })),
        bearbeitbar,
      }),
      // KAN-434: Steuerbefreiung und Ursprungserklärung der Handelsrechnung
      ...rechnungHinweise({ auftrag, betrieb: (cfgRes.data ?? {}) as R, warenwert: summeGerundet(zeilen.map(z => z.wertEur)) })
        .map(text => ({ text, href: bearbeitbar ? `/weinexport/${String(auftrag.id)}/bearbeiten` : null })),
    ],
  }
  return { auftrag, dokumente: dokRes.data, zeilen, gesamtEur: summeGerundet(zeilen.map(z => z.wertEur)), gewicht, grunddaten, warnungen }
}

// ── Laden: Auftragsliste ─────────────────────────────────────────────────────

/** Dokumentarten in fester Spaltenreihenfolge der Liste */
export const EXPORT_DOK_ARTEN: readonly string[] = EXPORT_DOKUMENT_ARTEN   // KAN-433: + Packliste, Health Certificate
export type ExportDokArt = string

export type ExportauftragListenZeile = {
  id: string
  referenz: string | null
  datum: string | null
  lieferdatum: string | null
  importeur: string | null
  eori: string | null
  bestimmungsland: string | null
  bestimmungsort: string | null
  ursprungsland: string | null
  incoterms: string | null
  transportart: string | null
  status: string | null
  statusLabel: string | null
  positionen: number
  literGesamt: number | null
  warenwertEur: number
  versicherungswertEur: number | null
  dokAusgestellt: number
  dokErforderlich: number
  /** Status-Anzeigetext je Dokumentart; null = Dokument nicht angelegt */
  dokStatus: Record<ExportDokArt, string | null>
  arcNummer: string | null
  emcsStatus: string | null
  emcsDatum: string | null
  /** KAN-437: länderspezifische Belegnummern als eine Zeile („COLA: …; Prior Notice: …“), null = keine */
  belegnummern: string | null
  /** KAN-150 F2: Storno (null = gültig) */
  storniertAm: string | null
  storniertVon: string | null
  stornoGrund: string | null
}

const SPALTEN_KOPF_LISTE: CsvSpalte<ExportauftragListenZeile>[] = [
  { kopf: 'Referenz', typ: 'code', wert: z => z.referenz },
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Lieferdatum', typ: 'datum', wert: z => z.lieferdatum },
  { kopf: 'Importeur', typ: 'text', wert: z => z.importeur },
  { kopf: 'EORI Importeur', typ: 'code', wert: z => z.eori },
  { kopf: 'Bestimmungsland', typ: 'text', wert: z => z.bestimmungsland },
  { kopf: 'Bestimmungsort', typ: 'text', wert: z => z.bestimmungsort },
  { kopf: 'Ursprungsland', typ: 'code', wert: z => z.ursprungsland },
  { kopf: 'Incoterms', typ: 'code', wert: z => z.incoterms },
  { kopf: 'Transportart', typ: 'text', wert: z => z.transportart },
  { kopf: 'Status', typ: 'text', wert: z => z.statusLabel },
  { kopf: 'Positionen', typ: 'ganzzahl', wert: z => z.positionen },
  { kopf: 'Volumen (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.literGesamt },
  { kopf: 'Warenwert (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.warenwertEur },
  { kopf: 'Versicherungswert (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.versicherungswertEur },
  { kopf: 'Dokumente ausgestellt', typ: 'ganzzahl', wert: z => z.dokAusgestellt },
  { kopf: 'Dokumente erforderlich', typ: 'ganzzahl', wert: z => z.dokErforderlich },
]

export const SPALTEN_EXPORTAUFTRAEGE: CsvSpalte<ExportauftragListenZeile>[] = [
  ...SPALTEN_KOPF_LISTE,
  ...EXPORT_DOK_ARTEN.map((art): CsvSpalte<ExportauftragListenZeile> => ({ kopf: EXPORT_DOK_LABEL[art], typ: 'text', wert: z => z.dokStatus[art] })),
  { kopf: 'EMCS ARC-Nummer', typ: 'code', wert: z => z.arcNummer },
  { kopf: 'EMCS-Status', typ: 'text', wert: z => z.emcsStatus },
  { kopf: 'EMCS-Datum', typ: 'datum', wert: z => z.emcsDatum },
  { kopf: 'Belegnummern', typ: 'text', wert: z => z.belegnummern },
  { kopf: 'Storniert am', typ: 'zeitpunkt', wert: z => z.storniertAm },
  { kopf: 'Storno-Grund', typ: 'text', wert: z => z.stornoGrund },
]

/** Auftrag + seine Positionen/Dokumente → Listenzeile (Zahlen gerundet, Summen aus gerundeten Werten) */
export function exportListenZeile(a: R, positionen: readonly R[], dokumente: readonly R[], warnungen: string[]): ExportauftragListenZeile {
  const zeilen = exportZeilen(a, positionen, {}, warnungen)
  const literBekannt = zeilen.every(z => z.liter !== null)
  const status = textOderNull(a.status)
  const dokStatus = Object.fromEntries(EXPORT_DOK_ARTEN.map(art => [art, null])) as Record<ExportDokArt, string | null>
  for (const d of dokumente) {
    const art = feld(d.dokument_art) as ExportDokArt
    if (!(EXPORT_DOK_ARTEN as readonly string[]).includes(art)) continue
    const st = feld(d.status)
    dokStatus[art] = st ? (EXPORT_DOK_STATUS_LABEL[st] ?? st) : null
  }
  const emcs = textOderNull(a.emcs_status)
  const versicherung = zahlOderNull(a.versicherungswert)
  return {
    id: String(a.id),
    referenz: textOderNull(a.referenz),
    datum: textOderNull(a.datum),
    lieferdatum: textOderNull(a.lieferdatum),
    importeur: importeurName(a),
    eori: textOderNull(a.eori_kunde),
    bestimmungsland: textOderNull(a.destination_land),
    bestimmungsort: textOderNull(a.destination_stadt),
    ursprungsland: textOderNull(a.ursprungsland) ?? 'AT',
    incoterms: textOderNull(a.incoterms),
    transportart: textOderNull(a.transport_art),
    status,
    statusLabel: status ? (EXPORT_STATUS_LABEL[status] ?? status) : null,
    positionen: zeilen.length,
    literGesamt: zeilen.length > 0 && literBekannt ? runden(zeilen.reduce((s, z) => s + (z.liter ?? 0), 0), STELLEN.liter) : null,
    warenwertEur: summeGerundet(zeilen.map(z => z.wertEur)),
    versicherungswertEur: versicherung === null ? null : runden(versicherung, STELLEN.betrag),
    dokAusgestellt: dokumente.filter(d => d.status === 'ausgestellt').length,
    dokErforderlich: dokumente.filter(d => d.status !== 'nicht_erforderlich').length,
    dokStatus,
    arcNummer: textOderNull(a.emcs_arc_nummer),
    emcsStatus: emcs ? (EMCS_STATUS_LABEL[emcs] ?? emcs) : 'nicht eingereicht',
    emcsDatum: textOderNull(a.emcs_datum),
    belegnummern: belegnummernText(a.laender_belege) || null,
    storniertAm: textOderNull(a.storniert_am),
    storniertVon: textOderNull(a.storniert_von_name),
    stornoGrund: textOderNull(a.storno_grund),
  }
}

/** Alle aktiven Exportaufträge (neueste zuerst) mit Positionssummen und Dokumentstatus – für /weinexport und die CSV */
export async function ladeExportauftraege(supabase: Client, tenantId: string): Promise<{ zeilen: ExportauftragListenZeile[]; warnungen: string[] }> {
  // storno-sichtbar: Liste und CSV zeigen stornierte Aufträge gekennzeichnet (KAN-150 F2)
  const auftraegeRes = await alle<R>((supabase.from('exportauftraege') as any)
    .select('id, referenz, datum, lieferdatum, incoterms, transport_art, destination_land, destination_stadt, eori_kunde, taric_code, ursprungsland, versicherungswert, status, emcs_arc_nummer, emcs_status, emcs_datum, created_at, partner_daten, storniert_am, storniert_von_name, storno_grund, laender_belege, kontakte(vorname, nachname), firmen(name)')
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .order('created_at', { ascending: false })
    .order('id'))
  if (auftraegeRes.error) throw new AktionsFehler(`Laden fehlgeschlagen (exportauftraege): ${auftraegeRes.error.message}`)
  const auftraege = auftraegeRes.data
  const ids = auftraege.map(a => String(a.id))

  const posJe = new Map<string, R[]>()
  const dokJe = new Map<string, R[]>()
  for (const block of inBloecken(ids)) {
    // Kindtabellen ohne tenant_id: nur Positionen/Dokumente der oben mandantengefilterten Aufträge
    const [pos, dok] = await Promise.all([
      alle<R>((supabase.from('exportauftrag_positionen') as any)
        .select('id, exportauftrag_id, beschreibung, menge, einheit, preis_eur, taric_code, sort_order, fuellungen(bezeichnung,flaschengroesse_ml)')
        .in('exportauftrag_id', block)
        .order('exportauftrag_id')
        .order('sort_order')
        .order('id')),
      alle<R>((supabase.from('export_dokumente') as any)
        .select('id, exportauftrag_id, dokument_art, status')
        .in('exportauftrag_id', block)
        .order('exportauftrag_id')
        .order('id')),
    ])
    if (pos.error) throw new AktionsFehler(`Laden fehlgeschlagen (exportauftrag_positionen): ${pos.error.message}`)
    if (dok.error) throw new AktionsFehler(`Laden fehlgeschlagen (export_dokumente): ${dok.error.message}`)
    for (const p of pos.data) posJe.set(String(p.exportauftrag_id), [...(posJe.get(String(p.exportauftrag_id)) ?? []), p])
    for (const d of dok.data) dokJe.set(String(d.exportauftrag_id), [...(dokJe.get(String(d.exportauftrag_id)) ?? []), d])
  }

  const warnungen: string[] = []
  const zeilen = auftraege.map(a => exportListenZeile(a, posJe.get(String(a.id)) ?? [], dokJe.get(String(a.id)) ?? [], warnungen))
  return { zeilen, warnungen }
}
