// ── Handelsrechnung und Proforma: Befreiungstext, Ursprungserklärung, Nebenkosten (KAN-434, 12.11.2026 – Epic KAN-431) ──
//
// Grundlage: Zollrecherche KAN-417 (A.4 innergemeinschaftliche Lieferung, B.2 Ausfuhrlieferung, B.5 Präferenzursprung).
// Entscheidungen Jörgen 12.11.2026 (alle A): Ursprungserklärung nur mit Ankreuzfeld am Auftrag (1A); Vereinigtes
// Königreich, Japan, Südkorea mit Wortlaut, Brasilien und – nach der Prüfung – die Schweiz nur als Hinweis (2A); über 6.000 EUR ohne Nummer wird
// die Erklärung nicht gedruckt (3A); EU ohne UID und Inland bleiben druckbar, aber ohne Befreiungstext und mit
// Warnung (4A); Fracht und Versicherung als zwei Beträge (5A); Proforma als wählbares Dokument (6A).
// Die Befreiungstexte sind ein Vorschlag – Bestätigung durch die Steuerberatung steht aus (Frage 7 der Liste zu KAN-417).
// Alles hier wird berechnet, nichts gespeichert. Isomorph, ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – wie oben
import { landName } from '../katalog/laender.ts'
// @ts-expect-error TS5097 – wie oben
import { lieferfall, type Lieferfall } from './grunddaten.ts'

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim())

// ── Steuerbefreiung ──────────────────────────────────────────────────────────────

export type BefreiungArt = 'igl' | 'ausfuhr' | 'keine'
export type Befreiung = {
  art: BefreiungArt
  /** Hinweis auf die Steuerbefreiung für die Rechnung; null = keiner (Lieferung nicht steuerfrei bzw. Fall unklar) */
  text: string | null
  /** Kurztext für Listen und CSV */
  label: string
  /** Warnung für die Hinweisleiste, wenn es keinen Befreiungstext gibt */
  warnung: string | null
}

export const BEFREIUNG_IGL = 'Steuerfreie innergemeinschaftliche Lieferung gemäß Art. 6 Abs. 1 iVm Art. 7 UStG / Tax-exempt intra-Community supply'
export const BEFREIUNG_AUSFUHR = 'Steuerfreie Ausfuhrlieferung gemäß § 6 Abs. 1 Z 1 iVm § 7 UStG / Tax-exempt export'

/** Steuerbefreiung aus dem Lieferfall: EU mit UID = innergemeinschaftliche Lieferung, Drittland = Ausfuhr, sonst keine */
export function befreiung(fall: Lieferfall): Befreiung {
  if (fall.gebiet === 'eu' && fall.kunde === 'b2b') return { art: 'igl', text: BEFREIUNG_IGL, label: 'steuerfreie innergemeinschaftliche Lieferung', warnung: null }
  if (fall.gebiet === 'drittland') return { art: 'ausfuhr', text: BEFREIUNG_AUSFUHR, label: 'steuerfreie Ausfuhrlieferung', warnung: null }
  if (fall.gebiet === 'eu') {
    return { art: 'keine', text: null, label: 'nicht steuerfrei (EU ohne UID)',
      warnung: 'Handelsrechnung: Die Lieferung ist nicht steuerfrei – ohne UID des Kunden fällt die Umsatzsteuer des Bestimmungslands an. Die Rechnung mit Steuer über die Fakturierung stellen.' }
  }
  if (fall.gebiet === 'inland') {
    return { art: 'keine', text: null, label: 'nicht steuerfrei (Inland)',
      warnung: 'Handelsrechnung: Lieferung im Inland – nicht steuerfrei. Die Rechnung mit Umsatzsteuer über die Fakturierung stellen.' }
  }
  return { art: 'keine', text: null, label: 'unklar (Bestimmungsland fehlt)', warnung: null }   // „Bestimmungsland fehlt“ meldet schon die Grunddaten-Liste
}

// ── Nebenkosten und Rechnungsbetrag ────────────────────────────────────────────────────────

export const NEBENKOSTEN_MAX = 9_999_999.99

/** Fracht bzw. Versicherung: leer oder ein Betrag von 0 bis 9.999.999,99 (JSON-Zahl oder Text mit Dezimalpunkt); null = in Ordnung */
export function nebenkostenFehler(wert: unknown, name: string): string | null {
  if (wert === null || wert === undefined || wert === '') return null
  const n = typeof wert === 'number' ? wert : /^\d+(\.\d+)?$/.test(text(wert)) ? Number(text(wert)) : NaN
  if (!Number.isFinite(n) || n < 0 || n > NEBENKOSTEN_MAX) return `${name} (EUR) muss ein Betrag von 0 bis 9.999.999,99 sein (oder leer bleiben).`
  return null
}

/** Betrag für die Datenbank, kaufmännisch auf Cent (null = leer); vorher mit nebenkostenFehler prüfen */
export function nebenkostenWert(wert: unknown): number | null {
  if (wert === null || wert === undefined || wert === '') return null
  const n = typeof wert === 'number' ? wert : Number(text(wert))
  return Number.isFinite(n) && n >= 0 ? rund(n, 2) : null
}

export type RechnungsSumme = { warenwert: number; fracht: number | null; versicherung: number | null; betrag: number }

/** Rechnungsbetrag = Warenwert (Summe der gedruckten Zeilen) + Fracht + Versicherung */
export function rechnungsSumme(warenwert: number, a: { fracht_eur?: unknown; versicherung_eur?: unknown }): RechnungsSumme {
  const fracht = nebenkostenWert(a.fracht_eur)
  const versicherung = nebenkostenWert(a.versicherung_eur)
  return { warenwert: rund(warenwert, 2), fracht, versicherung, betrag: rund(warenwert + (fracht ?? 0) + (versicherung ?? 0), 2) }
}

// ── Ursprungserklärung auf der Rechnung ──────────────────────────────────────────────────────

/** Wert der Ursprungswaren je Sendung, bis zu dem jeder Ausführer die Erklärung abgeben darf (EUR) */
export const URSPRUNG_WERTGRENZE = 6000
/** Ursprungsangabe in der Erklärung */
export const URSPRUNG_ANGABE = 'European Union'

export type AusfuehrerNummer = 'rex' | 'ea'

export type Abkommen = {
  /** ISO-Code des Bestimmungslands */
  land: string
  name: string
  /** Über der Wertgrenze nötig: REX-Nummer (Registrierter Ausführer) bzw. Bewilligung als Ermächtigter Ausführer */
  nummer: AusfuehrerNummer
  /** Amtlicher englischer Wortlaut; {klammer} = Klammer mit der Nummer des Ausführers, {ursprung} = Ursprungsangabe */
  wortlaut: string
  /** Klammer mit Nummer ({nr}) */
  klammer: string
  /** Ohne Nummer (bis zur Wertgrenze): 'leer' = Klammer bleibt, die Stelle der Nummer frei; 'weg' = Klammer entfällt */
  ohneNummer: 'leer' | 'weg'
  /** Zeilen, die der Betrieb von Hand ergänzt (z. B. Ursprungskriterium) */
  zusatzzeilen: readonly string[]
  /** Beschriftung der Zeile für Namen bzw. Unterschrift */
  unterschrift: string
  quelle: string
  /** Was über der Wertgrenze ohne Nummer gilt */
  ueberGrenze: string
  /** Hinweise für die Hinweisleiste, sobald die Erklärung angekreuzt ist */
  hinweise: readonly string[]
  /** false = kein Hinweis „nicht angekreuzt“ (die Erklärung bringt für üblichen Wein keinen Zollvorteil) */
  erinnern: boolean
}

// Wortlaute geprüft am 12.11.2026:
//  - Vereinigtes Königreich: ABl. L 149 vom 30.4.2021, Anhang 7 des Handels- und Kooperationsabkommens (im Text gelesen).
//    Fußnote 2: „Where the exporter has not been assigned a number, this field may be left blank.“
//  - Japan: Anhang 3-D des Wirtschaftspartnerschaftsabkommens laut Leitfaden der Kommission (GD TAXUD, 16.12.2019, im
//    Text gelesen); die Erklärung muss nicht unterschrieben sein, der Name des Ausführers steht in Druckschrift.
//  - Südkorea: Ursprungsprotokoll, Anhang III (ABl. L 127 vom 14.5.2011) – Satz aus Auszügen von EUR-Lex bestätigt
//    („customs authorisation No“); ohne Bewilligung entfallen die Worte in Klammern; eigenhändige Unterschrift ist Pflicht.
//  - Schweiz: bewusst ohne Text (Entscheidung Jörgen 12.11.2026 nach der Prüfung): Anhang 1 des Agrarabkommens enthält
//    für üblichen Still- und Schaumwein kein Zollzugeständnis – die Erklärung brächte keinen Präferenzzoll. Nur Hinweis.
// Ursprungsangabe „European Union“: für Japan im Leitfaden belegt, für die anderen Abkommen üblich, nicht eigens belegt.
const WORTLAUT = 'The exporter of the products covered by this document{klammer} declares that, except where otherwise clearly indicated, these products are of {ursprung} preferential origin.'
const UNTERSCHRIFT_PFLICHT = 'Unterschrift des Ausführers und Name in Blockschrift / Signature of the exporter and name in clear script'

export const ABKOMMEN: readonly Abkommen[] = [
  {
    land: 'GB', name: 'Handels- und Kooperationsabkommen EU–Vereinigtes Königreich', nummer: 'rex',
    wortlaut: WORTLAUT, klammer: ' (Exporter Reference No {nr})', ohneNummer: 'leer', zusatzzeilen: [],
    unterschrift: 'Name des Ausführers / Name of the exporter',
    quelle: 'Handels- und Kooperationsabkommen, Anhang 7 (Text der Erklärung zum Ursprung)',
    ueberGrenze: 'Dafür muss der Betrieb als Registrierter Ausführer (REX) eingetragen sein.',
    hinweise: [], erinnern: true,
  },
  {
    land: 'JP', name: 'Wirtschaftspartnerschaftsabkommen EU–Japan', nummer: 'rex',
    wortlaut: WORTLAUT, klammer: ' (Exporter Reference No {nr})', ohneNummer: 'leer',
    zusatzzeilen: ['(Origin criteria used) ............'],
    unterschrift: 'Name des Ausführers in Druckschrift / Printed name of the exporter',
    quelle: 'Wirtschaftspartnerschaftsabkommen EU–Japan, Anhang 3-D (Text der Erklärung zum Ursprung)',
    ueberGrenze: 'Dafür muss der Betrieb als Registrierter Ausführer (REX) eingetragen sein.',
    hinweise: ['Ursprungserklärung Japan: das Ursprungskriterium (Buchstabe A bis E, bei C mit Ziffer) auf der Rechnung von Hand eintragen – welches für den Wein gilt, mit dem Zollamt klären.'],
    erinnern: true,
  },
  {
    land: 'KR', name: 'Freihandelsabkommen EU–Südkorea', nummer: 'ea',
    wortlaut: WORTLAUT, klammer: ' (customs authorisation No {nr})', ohneNummer: 'weg', zusatzzeilen: [],
    unterschrift: UNTERSCHRIFT_PFLICHT,
    quelle: 'Freihandelsabkommen EU–Korea, Protokoll über Ursprungsregeln, Anhang III (Wortlaut der Ursprungserklärung)',
    ueberGrenze: 'Über 6.000 EUR darf nur ein Ermächtigter Ausführer die Erklärung abgeben.',
    hinweise: ['Ursprungserklärung Südkorea: eigenhändig unterschreiben und den Namen in Blockschrift dazusetzen.'],
    erinnern: true,
  },
]

/** Länder mit Abkommen, für die es (noch) keinen geprüften Wortlaut gibt – nur ein Hinweis (Entscheidung 2A) */
export const ABKOMMEN_NUR_HINWEIS: Readonly<Record<string, string>> = {
  CH: 'Schweiz: Für üblichen Still- und Schaumwein gibt es keinen Präferenzzoll (Zugeständnisse nur für Süßweine und Weinspezialitäten) – deshalb keine Ursprungserklärung auf der Rechnung. Bei Süßwein den Nachweis mit Zollamt bzw. Importeur klären.',
  BR: 'Brasilien: Das EU-Mercosur-Interimsabkommen wird vorläufig angewendet – Form des Ursprungsnachweises mit dem Zollamt klären (kein Text auf der Rechnung).',
}

export function abkommenFuer(land: unknown): Abkommen | null {
  const iso = text(land).toUpperCase()
  return ABKOMMEN.find(a => a.land === iso) ?? null
}

export const NUMMER_LABEL: Record<AusfuehrerNummer, string> = {
  rex: 'REX-Nummer (Registrierter Ausführer)',
  ea: 'Bewilligungsnummer als Ermächtigter Ausführer',
}

export type UrsprungStatus = 'kein_abkommen' | 'nicht_gewaehlt' | 'nummer_fehlt' | 'ok'

export type Ursprungserklaerung = {
  status: UrsprungStatus
  abkommen: Abkommen | null
  /** Zeilen für die Rechnung (nur bei status 'ok'): Wortlaut und Zusatzzeilen */
  zeilen: string[]
  /** Beschriftung der Zeile für Namen bzw. Unterschrift (nur bei status 'ok') */
  unterschrift: string | null
  /** Hinweise für Hinweisleiste und Liste am Auftrag */
  hinweise: string[]
}

/**
 * Ursprungserklärung für die Rechnung. Gedruckt wird nur, wenn das Bestimmungsland ein Abkommen mit Wortlaut hat, der
 * Betrieb sie am Auftrag angekreuzt hat und – über 6.000 EUR Warenwert – die nötige Nummer des Betriebs hinterlegt ist.
 * Bis zur Wertgrenze steht die Nummer in der Erklärung, wenn es sie gibt; sonst bleibt die Stelle frei.
 */
export function ursprungserklaerung(e: {
  land: unknown; warenwert: number; gewaehlt: unknown
  betrieb: { betrieb_rex_nummer?: unknown; betrieb_ea_bewilligung?: unknown }
}): Ursprungserklaerung {
  const iso = text(e.land).toUpperCase()
  const abkommen = abkommenFuer(iso)
  if (!abkommen) {
    const nur = ABKOMMEN_NUR_HINWEIS[iso]
    return { status: 'kein_abkommen', abkommen: null, zeilen: [], unterschrift: null, hinweise: nur ? [nur] : [] }
  }
  const land = landName(abkommen.land) || abkommen.land
  if (e.gewaehlt !== true) {
    return { status: 'nicht_gewaehlt', abkommen, zeilen: [], unterschrift: null,
      hinweise: abkommen.erinnern ? [`Für ${land} gibt es ein Präferenzabkommen (${abkommen.name}) – die Ursprungserklärung auf der Rechnung ist nicht angekreuzt.`] : [] }
  }
  const nr = text(abkommen.nummer === 'rex' ? e.betrieb.betrieb_rex_nummer : e.betrieb.betrieb_ea_bewilligung)
  if (e.warenwert > URSPRUNG_WERTGRENZE && !nr) {
    return { status: 'nummer_fehlt', abkommen, zeilen: [], unterschrift: null,
      hinweise: [`Ursprungserklärung ${land}: Der Warenwert liegt über 6.000 EUR, die ${NUMMER_LABEL[abkommen.nummer]} des Betriebs fehlt (Betrieb › Einstellungen) – die Erklärung wird nicht gedruckt. ${abkommen.ueberGrenze}`] }
  }
  const klammer = nr ? abkommen.klammer.replace('{nr}', nr) : abkommen.ohneNummer === 'weg' ? '' : abkommen.klammer.replace('{nr}', '............')
  const zeilen = [abkommen.wortlaut.replace('{klammer}', klammer).replace('{ursprung}', URSPRUNG_ANGABE), ...abkommen.zusatzzeilen]
  return { status: 'ok', abkommen, zeilen, unterschrift: abkommen.unterschrift, hinweise: [...abkommen.hinweise] }
}

// ── Hinweise für Leiste und Liste ──────────────────────────────────────────────────────────

/** Hinweise zur Rechnung (Steuerbefreiung, Ursprungserklärung) – ergänzen die Grunddaten-Liste des Auftrags */
export function rechnungHinweise(e: {
  auftrag: { destination_land?: unknown; kunde_uid?: unknown; ursprungserklaerung?: unknown }
  betrieb: { betrieb_rex_nummer?: unknown; betrieb_ea_bewilligung?: unknown }
  warenwert: number
}): string[] {
  const b = befreiung(lieferfall(e.auftrag))
  const u = ursprungserklaerung({ land: e.auftrag.destination_land, warenwert: e.warenwert, gewaehlt: e.auftrag.ursprungserklaerung, betrieb: e.betrieb })
  return [...(b.warnung ? [b.warnung] : []), ...u.hinweise]
}

/** Vermerk auf der Proforma-Rechnung (Entscheidung 6A) */
export const PROFORMA_VERMERK = 'Proforma-Rechnung – keine Zahlungsaufforderung / Pro forma invoice – not a demand for payment'
