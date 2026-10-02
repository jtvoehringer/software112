// ── Datenexporte „Controlling › Datenexport“ (KAN-54, 25.09.2026) ─────────────
//
// Kontakte, Firmen, Lagerbestand und Verkaufshistorie als CSV für Excel – keine
// Behördenmeldungen, aber dieselbe CSV-Norm wie diese: Text ausschließlich über
// csvDatei() aus src/lib/csv mit PROFIL_EXCEL_AT (UTF-8 mit BOM, Semikolon, CRLF,
// Dezimalkomma mit festen Stellen, TT.MM.JJJJ, Formelschutz). Bis 25.09.2026 bauten die
// Routen unter src/app/api/export/ die CSV von Hand (Kontakte/Firmen Komma-getrennt).
//
// Hier steht nur die reine Aufbereitung Supabase-Zeile → CSV-Zeile samt Spalten; Laden,
// Rechteprüfung (KAN-54) und Antwort (csvAntwort aus lib/csv/antwort) bleiben in den Routen
// /api/export/kontakte|firmen|lager|verkauf. Spalteninhalt und -reihenfolge wie bisher.
//
// Ohne '@/'-Importe und nur mit „löschbarer“ TypeScript-Syntax: scripts/tests/kan54-exporte.test.mjs
// lädt die Datei direkt mit Node (Type-Stripping) – deshalb der Pfad mit .ts-Endung wie in
// lib/buchhaltung/bmd.ts. Das Rebsorten-Kürzel (lib/wein/bki_kuerzel, importiert selbst mit '@/')
// reicht die Route als Funktion herein.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt (tsconfig ohne allowImportingTsExtensions)
import { csvDatei, runden, PROFIL_EXCEL_AT, STELLEN, type CsvSpalte, type CsvErgebnis } from '../csv/index.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Weitere E-Mail-Adressen (text[]) in einer Zelle, getrennt durch „; “ wie bisher */
function weitereEmails(v: unknown): string | null {
  if (!Array.isArray(v)) return null
  const liste = v.filter(x => typeof x === 'string' && x.trim() !== '') as string[]
  return liste.length ? liste.join('; ') : null
}

/** Zahl aus numeric-Spalten (PostgREST liefert number, vereinzelt String) – leer bleibt null */
function zahlOderNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── Kontakte ─────────────────────────────────────────────────────────────────

export type KontaktExportZeile = {
  accountnummer: string | null
  vorname: string | null
  nachname: string | null
  segment: string | null
  email: string | null
  emailWeitere: string | null
  telefonVorwahl: string | null
  telefon: string | null
  mobilVorwahl: string | null
  mobil: string | null
  strasse: string | null
  plz: string | null
  ort: string | null
  land: string | null
  stammkunde: boolean
  lead: boolean
  sonderrabattPct: number
  notizen: string | null
  /** kontakte.erstellt_am (timestamptz) – Kalendertag in Wiener Zeit */
  erstelltAm: string | null
  /** kontakte.position – Funktion der Person (Freitext, 02.10.2026) */
  position: string | null
  /** kontakte.quelle – woher der Kontakt kommt (02.10.2026) */
  quelle: string | null
}

/** Spalten für kontakte.select('accountnummer, vorname, nachname, segment, email, email_weitere, telefon,
 *  telefon_vorwahl, mobil, mobil_vorwahl, strasse, plz, ort, land, stammkunde, is_lead, sonderrabatt_pct,
 *  notizen, erstellt_am, position, quelle') – Position und Quelle (02.10.2026) hinten angehängt, damit
 *  bestehende Excel-Auswertungen ihre Spaltenpositionen behalten */
export const SPALTEN_KONTAKTE: CsvSpalte<KontaktExportZeile>[] = [
  { kopf: 'Accountnummer', typ: 'code', wert: z => z.accountnummer },
  { kopf: 'Vorname', typ: 'text', wert: z => z.vorname },
  { kopf: 'Nachname', typ: 'text', wert: z => z.nachname },
  { kopf: 'Segment', typ: 'text', wert: z => z.segment },
  { kopf: 'E-Mail', typ: 'text', wert: z => z.email },
  { kopf: 'Weitere E-Mails', typ: 'text', wert: z => z.emailWeitere },
  { kopf: 'Tel.-Vorwahl', typ: 'code', wert: z => z.telefonVorwahl },
  { kopf: 'Telefon', typ: 'code', wert: z => z.telefon },
  { kopf: 'Mobil-Vorwahl', typ: 'code', wert: z => z.mobilVorwahl },
  { kopf: 'Mobil', typ: 'code', wert: z => z.mobil },
  { kopf: 'Straße', typ: 'text', wert: z => z.strasse },
  { kopf: 'PLZ', typ: 'code', wert: z => z.plz },
  { kopf: 'Ort', typ: 'text', wert: z => z.ort },
  { kopf: 'Land', typ: 'code', wert: z => z.land },
  { kopf: 'Stammkunde', typ: 'janein', wert: z => z.stammkunde },
  { kopf: 'Lead', typ: 'janein', wert: z => z.lead },
  { kopf: 'Sonderrabatt (%)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.sonderrabattPct },
  { kopf: 'Notizen', typ: 'text', wert: z => z.notizen },
  { kopf: 'Angelegt am', typ: 'datum', wert: z => z.erstelltAm },
  { kopf: 'Position', typ: 'text', wert: z => z.position },
  { kopf: 'Quelle', typ: 'text', wert: z => z.quelle },
]

export function kontaktExportZeile(r: R): KontaktExportZeile {
  return {
    accountnummer: r.accountnummer ?? null,
    vorname: r.vorname ?? null,
    nachname: r.nachname ?? null,
    segment: r.segment ?? null,
    email: r.email ?? null,
    emailWeitere: weitereEmails(r.email_weitere),
    telefonVorwahl: r.telefon_vorwahl ?? null,
    telefon: r.telefon ?? null,
    mobilVorwahl: r.mobil_vorwahl ?? null,
    mobil: r.mobil ?? null,
    strasse: r.strasse ?? null,
    plz: r.plz ?? null,
    ort: r.ort ?? null,
    land: r.land ?? null,
    stammkunde: !!r.stammkunde,
    lead: !!r.is_lead,
    // wie bisher: ohne Sonderrabatt 0 % (kein fehlender Wert, sondern „kein Rabatt“)
    sonderrabattPct: zahlOderNull(r.sonderrabatt_pct) ?? 0,
    notizen: r.notizen ?? null,
    erstelltAm: r.erstellt_am ?? null,
    position: r.position ?? null,
    quelle: r.quelle ?? null,
  }
}

export function kontakteCsv(rows: readonly R[]): CsvErgebnis {
  return csvDatei(rows.map(kontaktExportZeile), SPALTEN_KONTAKTE, PROFIL_EXCEL_AT)
}

// ── Firmen ───────────────────────────────────────────────────────────────────

export type FirmaExportZeile = {
  accountnummer: string | null
  name: string | null
  segment: string | null
  email: string | null
  emailWeitere: string | null
  telefonVorwahl: string | null
  telefon: string | null
  strasse: string | null
  plz: string | null
  ort: string | null
  land: string | null
  uid: string | null
  zahlungszielTage: number | null
  lead: boolean
  sonderrabattPct: number
  notizen: string | null
}

/** Spalten für firmen.select('accountnummer, name, segment, email, email_weitere, telefon, telefon_vorwahl,
 *  strasse, plz, ort, land, uid_nummer, zahlungsziel_tage, is_lead, sonderrabatt_pct, notizen') */
export const SPALTEN_FIRMEN: CsvSpalte<FirmaExportZeile>[] = [
  { kopf: 'Accountnummer', typ: 'code', wert: z => z.accountnummer },
  { kopf: 'Firmenname', typ: 'text', wert: z => z.name },
  { kopf: 'Segment', typ: 'text', wert: z => z.segment },
  { kopf: 'E-Mail', typ: 'text', wert: z => z.email },
  { kopf: 'Weitere E-Mails', typ: 'text', wert: z => z.emailWeitere },
  { kopf: 'Tel.-Vorwahl', typ: 'code', wert: z => z.telefonVorwahl },
  { kopf: 'Telefon', typ: 'code', wert: z => z.telefon },
  { kopf: 'Straße', typ: 'text', wert: z => z.strasse },
  { kopf: 'PLZ', typ: 'code', wert: z => z.plz },
  { kopf: 'Ort', typ: 'text', wert: z => z.ort },
  { kopf: 'Land', typ: 'code', wert: z => z.land },
  { kopf: 'UID-Nummer', typ: 'code', wert: z => z.uid },
  { kopf: 'Zahlungsziel (Tage)', typ: 'ganzzahl', stellen: STELLEN.ganzzahl, wert: z => z.zahlungszielTage },
  { kopf: 'Lead', typ: 'janein', wert: z => z.lead },
  { kopf: 'Sonderrabatt (%)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.sonderrabattPct },
  { kopf: 'Notizen', typ: 'text', wert: z => z.notizen },
]

export function firmaExportZeile(r: R): FirmaExportZeile {
  return {
    accountnummer: r.accountnummer ?? null,
    name: r.name ?? null,
    segment: r.segment ?? null,
    email: r.email ?? null,
    emailWeitere: weitereEmails(r.email_weitere),
    telefonVorwahl: r.telefon_vorwahl ?? null,
    telefon: r.telefon ?? null,
    strasse: r.strasse ?? null,
    plz: r.plz ?? null,
    ort: r.ort ?? null,
    land: r.land ?? null,
    uid: r.uid_nummer ?? null,
    zahlungszielTage: zahlOderNull(r.zahlungsziel_tage),
    lead: !!r.is_lead,
    sonderrabattPct: zahlOderNull(r.sonderrabatt_pct) ?? 0,
    notizen: r.notizen ?? null,
  }
}

export function firmenCsv(rows: readonly R[]): CsvErgebnis {
  return csvDatei(rows.map(firmaExportZeile), SPALTEN_FIRMEN, PROFIL_EXCEL_AT)
}

// ── Lagerbestand (Füllungen) ─────────────────────────────────────────────────

/** Flaschengrößen in Liter wie auf dem Etikett; andere Größen als „<ml> ml“ */
export const FLASCHENGROESSE: Readonly<Record<number, string>> = Object.freeze({
  187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
  1000: '1,0 L', 1500: '1,5 L', 3000: '3,0 L', 6000: '6,0 L',
})

export function flaschengroesseText(ml: unknown): string | null {
  const n = zahlOderNull(ml)
  if (n === null) return null
  return FLASCHENGROESSE[n] ?? `${n} ml`
}

export type LagerExportZeile = {
  name: string | null
  jahrgang: number | null
  rebsorte: string | null
  kuerzel: string | null
  flaschengroesse: string | null
  bestandFlaschen: number | null
  vkPreisBrutto: number | null
  /** Bestand × VK-Preis, kaufmännisch auf 2 Stellen; ohne VK-Preis leer */
  lagerwert: number | null
}

/** Spalten für fuellungen.select('name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto') */
export const SPALTEN_LAGER: CsvSpalte<LagerExportZeile>[] = [
  { kopf: 'Name', typ: 'text', wert: z => z.name },
  { kopf: 'Jahrgang', typ: 'ganzzahl', stellen: STELLEN.ganzzahl, wert: z => z.jahrgang },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Flaschengröße', typ: 'text', wert: z => z.flaschengroesse },
  { kopf: 'Bestand (Fl.)', typ: 'ganzzahl', stellen: STELLEN.ganzzahl, wert: z => z.bestandFlaschen },
  { kopf: 'VK-Preis (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.vkPreisBrutto },
  { kopf: 'Lagerwert (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.lagerwert },
]

/** Rebsorte → Kürzel; die Route übergibt getRebsorteKuerzel aus lib/wein/bki_kuerzel */
export type KuerzelFunktion = (rebsorte: string) => string | null | undefined

export function lagerExportZeile(r: R, kuerzel: KuerzelFunktion): LagerExportZeile {
  const preis = zahlOderNull(r.vk_preis_brutto)
  const bestand = zahlOderNull(r.bestand_flaschen)
  return {
    name: r.name ?? null,
    jahrgang: zahlOderNull(r.jahrgang),
    rebsorte: r.rebsorte ?? null,
    kuerzel: r.rebsorte ? kuerzel(r.rebsorte) || null : null,
    flaschengroesse: flaschengroesseText(r.flaschengroesse_ml),
    bestandFlaschen: bestand,
    vkPreisBrutto: preis,
    lagerwert: preis === null ? null : runden((bestand ?? 0) * preis, STELLEN.betrag),
  }
}

export function lagerCsv(rows: readonly R[], kuerzel: KuerzelFunktion): CsvErgebnis {
  return csvDatei(rows.map(r => lagerExportZeile(r, kuerzel)), SPALTEN_LAGER, PROFIL_EXCEL_AT)
}

// ── Verkaufshistorie (eine Zeile je Verkaufsposition) ────────────────────────

export type VerkaufExportZeile = {
  /** verkaufsposten.datum (DATE) */
  datum: string | null
  rechnungsnummer: string | null
  /** Accountnummer des Kontakts, sonst der Firma */
  accountnummer: string | null
  /** BMD-Debitorenkonto der Firma (Migration 191) */
  debitorNr: string | null
  /** Kontaktname, sonst Firmenname; ohne Kunde (Barverkauf) leer */
  kunde: string | null
  artikel: string | null
  menge: number | null
  einheit: string | null
  preisBrutto: number | null
  rabattPct: number | null
  sonderrabattPct: number | null
  ustSatz: number | null
  /** Preis × Menge × (1 − Rabatt) × (1 − Sonderrabatt), kaufmännisch auf 2 Stellen */
  zeilenbetrag: number
  bezahlt: boolean
  storniert: boolean
}

// DebitorNr. (BMD-Konto der Firma, Migration 191) als eigene Spalte neben der internen
// Accountnummer – für die Buchhaltung/BMD-Zuordnung, ohne die Bedeutung der bestehenden
// Accountnummer-Spalte zu verändern.
export const SPALTEN_VERKAUF: CsvSpalte<VerkaufExportZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Rechnungsnummer', typ: 'code', wert: z => z.rechnungsnummer },
  { kopf: 'Accountnummer', typ: 'code', wert: z => z.accountnummer },
  { kopf: 'DebitorNr.', typ: 'code', wert: z => z.debitorNr },
  { kopf: 'Kunde', typ: 'text', wert: z => z.kunde },
  { kopf: 'Artikel', typ: 'text', wert: z => z.artikel },
  { kopf: 'Menge', typ: 'dezimal', stellen: 2, wert: z => z.menge },
  { kopf: 'Einheit', typ: 'text', wert: z => z.einheit },
  { kopf: 'Preis (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.preisBrutto },
  { kopf: 'Rabatt (%)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.rabattPct },
  { kopf: 'Sonderrabatt (%)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.sonderrabattPct },
  { kopf: 'USt (%)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.ustSatz },
  { kopf: 'Zeilenbetrag (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.zeilenbetrag },
  { kopf: 'Bezahlt', typ: 'janein', wert: z => z.bezahlt },
  { kopf: 'Storniert', typ: 'janein', wert: z => z.storniert },
]

/** Ein Verkaufsbeleg (verkaufsposten mit kontakt, firma, verkauf_positionen) → eine Zeile je Position */
export function verkaufExportZeilen(p: R): VerkaufExportZeile[] {
  const kontakt: R | null = p.kontakt ?? null
  const firma: R | null = p.firma ?? null
  const kontaktName = kontakt ? [kontakt.vorname, kontakt.nachname].filter(Boolean).join(' ') : ''
  const kopf = {
    datum: p.datum ?? null,
    rechnungsnummer: p.rechnungsnummer ?? null,
    accountnummer: kontakt?.accountnummer ?? firma?.accountnummer ?? null,
    debitorNr: firma?.debitor_nr ?? null,
    kunde: (kontakt ? kontaktName : firma?.name) || null,
    bezahlt: !!p.bezahlt,
    storniert: !!p.storniert,
  }
  return ((p.verkauf_positionen ?? []) as R[]).map(pos => {
    const preis = zahlOderNull(pos.preis_brutto)
    const menge = zahlOderNull(pos.menge)
    const rabatt = zahlOderNull(pos.rabatt_pct)
    const sonderrabatt = zahlOderNull(pos.sonderrabatt_pct)
    const betrag = (preis ?? 0) * (menge ?? 0) * (1 - (rabatt ?? 0) / 100) * (1 - (sonderrabatt ?? 0) / 100)
    return {
      ...kopf,
      artikel: pos.name ?? null,
      menge,
      einheit: pos.einheit ?? null,
      preisBrutto: preis,
      rabattPct: rabatt,
      sonderrabattPct: sonderrabatt,
      ustSatz: zahlOderNull(pos.ust_satz),
      zeilenbetrag: runden(betrag, STELLEN.betrag),
    }
  })
}

export function verkaufCsv(posten: readonly R[]): CsvErgebnis {
  return csvDatei(posten.flatMap(verkaufExportZeilen), SPALTEN_VERKAUF, PROFIL_EXCEL_AT)
}
