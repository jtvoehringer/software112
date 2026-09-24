// Standardfristen-Vorlage für einen österreichischen Weinbaubetrieb – wird
// als betriebseigene Fristen (Tabelle fristen) angelegt und ist danach frei
// änderbar. Termine sind fachliche Annahmen für die Produktgestaltung, die
// vom Betrieb zu prüfen sind (keine Rechtsberatung). UVA, Erntemeldung,
// Prüfnummern und Wartefristen werden NICHT hier gepflegt, sondern zur
// Laufzeit aus den Fachtabellen abgeleitet (siehe _shared/data.ts).

export type FristVorlage = { bezeichnung: string; beschreibung: string; kategorie: 'meldung' | 'steuer' | 'weinrecht' | 'betrieb'; monat: number; tag: number; href?: string }

export const FRISTEN_VORLAGE: FristVorlage[] = [
  { bezeichnung: 'Bestandsmeldung Wein',          beschreibung: 'Stichtag 31.07. · Weinbestandsmeldung (§ 29 Weingesetz 2009) unter Rieden › AMA-Erntemeldung (Druck & CSV, derzeit Bestand am Abrufdatum) · Frist bitte prüfen', kategorie: 'weinrecht', monat: 8, tag: 15, href: '/reports/ama' },
  { bezeichnung: 'Mehrfachantrag (AMA)',           beschreibung: 'Flächenangaben Weingarten · eAMA · Frist bitte prüfen', kategorie: 'meldung', monat: 4, tag: 15, href: '/weingarten' },
  { bezeichnung: 'PSM-Aufzeichnungen Saison abschließen', beschreibung: 'Behandlungsprotokoll prüfen und exportieren', kategorie: 'weinrecht', monat: 11, tag: 30, href: '/behandlungen/berichte' },
  { bezeichnung: 'Jahresabschluss E/A-Rechnung',   beschreibung: 'Belege vollständig, Monatsabschlüsse gesperrt, Export an Steuerberatung', kategorie: 'steuer', monat: 3, tag: 31, href: '/buchhaltung' },
  { bezeichnung: 'Inventur Flaschenlager',         beschreibung: 'Bestände je Füllung zählen und im Warenlager korrigieren', kategorie: 'betrieb', monat: 12, tag: 31, href: '/weinhandel' },
]

export const KATEGORIE_LABEL: Record<string, string> = { meldung: 'Meldung', steuer: 'Steuer', weinrecht: 'Weinrecht', betrieb: 'Betrieb' }
