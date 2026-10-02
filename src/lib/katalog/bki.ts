// ── Kataloge der BKI-Schnittstelle (KAN-39 Etappe 1, 02.10.2026) – client-sicher, ohne Imports ──
//
// Spiegel der Tabellen kat_qualitaetsstufe, kat_erzeugnis, kat_buchungsart, kat_farbe und katalog_mapping
// (Migration kan39a_kataloge). scripts/tests/kan39-kataloge.test.mjs vergleicht beide Seiten – wer hier etwas
// ändert, braucht dazu eine Migration (und umgekehrt).
//
// Kürzel für Erzeugnis, Buchungsart und Farbe sind vorläufig (Entscheidung Jörgen 02.10.2026; die BKI kennt keine,
// KAN-38 Frage 19/20) – nach der BKI-Antwort werden nur die Kürzel umbenannt. Die Qualitätsstufen sind die amtlichen
// BKI-Kürzel (Liste 01.10.2024); AUB (Ausbruch) ist ein eigener Vorschlag (KAN-36).

export type BsmSpalte = 'wein' | 'rebsortenwein' | 'landwein' | 'qualitaetswein' | 'praedikatswein' | 'perl_schaumwein' | 'sonstige'

export type KatQualitaet = { code: string; bezeichnung: string; rang: number | null; bsmSpalte: BsmSpalte | null; vorlaeufig: boolean }

/** BKI-Qualitätsstufen in Katalogreihenfolge; Rang wie die Qualitätsachse in lib/wein/qualitaetsrang.ts */
export const KAT_QUALITAETSSTUFE: readonly KatQualitaet[] = [
  { code: 'INW', bezeichnung: 'Industriewein', rang: 0, bsmSpalte: null, vorlaeufig: true },
  { code: 'WEI', bezeichnung: 'Wein (ohne Rebsorte und Jahrgang)', rang: 1, bsmSpalte: 'wein', vorlaeufig: false },
  { code: 'RSW', bezeichnung: 'Rebsortenwein (Wein mit Rebsorte bzw. Jahrgang)', rang: 2, bsmSpalte: 'rebsortenwein', vorlaeufig: false },
  { code: 'LDW', bezeichnung: 'Landwein', rang: 3, bsmSpalte: 'landwein', vorlaeufig: false },
  { code: 'QUW', bezeichnung: 'Qualitätswein', rang: 4, bsmSpalte: 'qualitaetswein', vorlaeufig: false },
  { code: 'DAC', bezeichnung: 'Districtus Austriae Controllatus (DAC)', rang: 4, bsmSpalte: 'qualitaetswein', vorlaeufig: false },
  { code: 'KAB', bezeichnung: 'Kabinett', rang: 5, bsmSpalte: 'qualitaetswein', vorlaeufig: true },
  { code: 'SPL', bezeichnung: 'Spätlese', rang: 6, bsmSpalte: 'praedikatswein', vorlaeufig: false },
  { code: 'ALW', bezeichnung: 'Auslese', rang: 7, bsmSpalte: 'praedikatswein', vorlaeufig: false },
  { code: 'BAL', bezeichnung: 'Beerenauslese', rang: 8, bsmSpalte: 'praedikatswein', vorlaeufig: false },
  { code: 'EIW', bezeichnung: 'Eiswein', rang: 8, bsmSpalte: 'praedikatswein', vorlaeufig: false },
  { code: 'STW', bezeichnung: 'Strohwein / Schilfwein', rang: 8, bsmSpalte: 'praedikatswein', vorlaeufig: false },
  { code: 'AUB', bezeichnung: 'Ausbruch', rang: 9, bsmSpalte: 'praedikatswein', vorlaeufig: true },
  { code: 'TBA', bezeichnung: 'Trockenbeerenauslese', rang: 10, bsmSpalte: 'praedikatswein', vorlaeufig: false },
  { code: 'TGT', bezeichnung: 'Teilweise gegorener Traubenmost', rang: null, bsmSpalte: 'wein', vorlaeufig: true },
  { code: 'STU', bezeichnung: 'Sturm', rang: null, bsmSpalte: 'wein', vorlaeufig: false },
  { code: 'SOE', bezeichnung: 'Sonstige Erzeugnisse', rang: null, bsmSpalte: 'sonstige', vorlaeufig: false },
]

export type KatErzeugnis = { code: string; bezeichnung: string; bsmRelevant: boolean }

/** Erzeugnisse der Schnittstelle (15) + PetNat (R8b) + Traubensaft (nicht bestandsmeldepflichtig, R10); Kürzel vorläufig */
export const KAT_ERZEUGNIS: readonly KatErzeugnis[] = [
  { code: 'MOST', bezeichnung: 'Most', bsmRelevant: true },
  { code: 'STURM', bezeichnung: 'Sturm', bsmRelevant: true },
  { code: 'WEIN', bezeichnung: 'Wein ohne Herkunft, ohne Rebsorte', bsmRelevant: true },
  { code: 'WEINSORT', bezeichnung: 'Wein ohne Herkunft, mit Rebsorte bzw. Jahrgang', bsmRelevant: true },
  { code: 'WEINGGA', bezeichnung: 'Wein mit geschützter geografischer Angabe (g.g.A.)', bsmRelevant: true },
  { code: 'WEINGU', bezeichnung: 'Wein mit geschützter Ursprungsbezeichnung (g.U.)', bsmRelevant: true },
  { code: 'PERLWEIN', bezeichnung: 'Perlwein', bsmRelevant: true },
  { code: 'SCHAUMW', bezeichnung: 'Schaumwein', bsmRelevant: true },
  { code: 'SEKTGU', bezeichnung: 'Sekt mit g.U.', bsmRelevant: true },
  { code: 'EUWEIN', bezeichnung: 'EU-Wein', bsmRelevant: true },
  { code: 'DRITTLD', bezeichnung: 'Wein aus Drittland', bsmRelevant: true },
  { code: 'LIKOERW', bezeichnung: 'Likörwein', bsmRelevant: true },
  { code: 'AROMAW', bezeichnung: 'Aromatisierter Wein', bsmRelevant: true },
  { code: 'WEINHALT', bezeichnung: 'Weinhaltiges Getränk (z. B. Spritzer)', bsmRelevant: true },
  { code: 'ENTALK', bezeichnung: 'Entalkoholisierter bzw. teilweise entalkoholisierter Wein', bsmRelevant: true },
  { code: 'PETNAT', bezeichnung: 'PetNat (Pétillant Naturel)', bsmRelevant: true },
  { code: 'TRAUBSFT', bezeichnung: 'Traubensaft (kein Wein-Erzeugnis, nicht bestandsmeldepflichtig)', bsmRelevant: false },
]

export type KatBuchungsart = {
  code: string; bezeichnung: string; richtung: 'zu' | 'ab' | 'neutral'; einheit: 'l' | 'kg' | 'stk'
  /** amtliche BSM-Buchungsart (17 Werte) */
  bsm: boolean
  /** interne Vorgangsart: Zuordnung zur BSM-Buchungsart; null = in der Bestandsmeldung neutral */
  bsmCode: string | null
}

/** 17 BSM-Buchungsarten + interne, BSM-neutrale Vorgänge; Kürzel vorläufig */
export const KAT_BUCHUNGSART: readonly KatBuchungsart[] = [
  { code: 'ERNTE', bezeichnung: 'eigene Ernte', richtung: 'zu', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'ZK_FASS', bezeichnung: 'Zukauf Fasswein ≥ 60 l', richtung: 'zu', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'ZK_TRAUB', bezeichnung: 'Zukauf Trauben', richtung: 'zu', einheit: 'kg', bsm: true, bsmCode: null },
  { code: 'ZK_MAISC', bezeichnung: 'Zukauf Maische', richtung: 'zu', einheit: 'kg', bsm: true, bsmCode: null },
  { code: 'ZK_MOST', bezeichnung: 'Zukauf Most', richtung: 'zu', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'ZK_FLA', bezeichnung: 'Zukauf Flaschen < 60 l', richtung: 'zu', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'ZU_ABW', bezeichnung: 'Zugang Abwertung', richtung: 'zu', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'ZU_BEH', bezeichnung: 'Zugang durch Behandlung', richtung: 'zu', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'AB_ABW', bezeichnung: 'Abgang Abwertung', richtung: 'ab', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'VK_FA_AT', bezeichnung: 'Fassverkauf in Österreich', richtung: 'ab', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'VK_FA_AU', bezeichnung: 'Fassverkauf ins Ausland', richtung: 'ab', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'VK_FL_AT', bezeichnung: 'Flaschenverkauf in Österreich', richtung: 'ab', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'VK_FL_AU', bezeichnung: 'Flaschenverkauf ins Ausland', richtung: 'ab', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'AB_VERAR', bezeichnung: 'Abgang durch Verarbeitung', richtung: 'ab', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'SCHWUND', bezeichnung: 'Eigenverbrauch / Schwund', richtung: 'ab', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'VS_ZU', bezeichnung: 'Verschnitt Zugang', richtung: 'zu', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'VS_AB', bezeichnung: 'Verschnitt Abgang', richtung: 'ab', einheit: 'l', bsm: true, bsmCode: null },
  { code: 'EROEFF', bezeichnung: 'Eröffnungsbestand', richtung: 'zu', einheit: 'l', bsm: false, bsmCode: null },
  { code: 'UMZUG', bezeichnung: 'Umzug', richtung: 'neutral', einheit: 'l', bsm: false, bsmCode: null },
  { code: 'FILTRAT', bezeichnung: 'Filtration', richtung: 'neutral', einheit: 'l', bsm: false, bsmCode: null },
  { code: 'FUELLUNG', bezeichnung: 'Füllung (offen → Flasche)', richtung: 'neutral', einheit: 'l', bsm: false, bsmCode: null },
  { code: 'STORNO', bezeichnung: 'Storno (Gegenbuchung zur ursprünglichen Buchungsart)', richtung: 'neutral', einheit: 'l', bsm: false, bsmCode: null },
  { code: 'INV_PLUS', bezeichnung: 'Inventurdifferenz Mehrmenge', richtung: 'zu', einheit: 'l', bsm: false, bsmCode: null },
  { code: 'INV_MIN', bezeichnung: 'Inventurdifferenz Mindermenge', richtung: 'ab', einheit: 'l', bsm: false, bsmCode: 'SCHWUND' },
  { code: 'TRAUBVK', bezeichnung: 'Traubenverkauf', richtung: 'ab', einheit: 'kg', bsm: false, bsmCode: null },
]

/** Meldefarbe (kat_farbe): W = weiß, R = rot */
export type MeldeFarbe = 'W' | 'R'
export const KAT_FARBE: Readonly<Record<MeldeFarbe, string>> = { W: 'weiß', R: 'rot' }

/** katalog_mapping: interner Wert → Katalogcode */
export const KATALOG_MAPPING = {
  qualitaetsstufe: {
    wein: 'WEI', landwein: 'LDW', qualitaetswein: 'QUW', dac: 'DAC', kabinett: 'KAB', spaetlese: 'SPL',
    auslese: 'ALW', beerenauslese: 'BAL', eiswein: 'EIW', strohwein: 'STW', ausbruch: 'AUB', trockenbeerenauslese: 'TBA',
    tba: 'TBA', reserve: 'QUW', erste_lage: 'QUW', grosses_gewachs: 'QUW', sekt: 'QUW', sonstiges: 'SOE',
  },
  erzeugnis: { sekt: 'SEKTGU', perlwein: 'PERLWEIN' },
  farbe: { weiss: 'W', rot: 'R', rose: 'R', grau: 'W' },
} as const satisfies Record<string, Record<string, string>>

/** Meldefarbe aus weinart (Charge, Füllung, Zukauf, Ried) bzw. rebsorten.farbe – Rosé zählt zu rot (R17); unbekannt → null */
export function meldeFarbe(weinartOderFarbe: string | null | undefined): MeldeFarbe | null {
  const m: Record<string, string> = KATALOG_MAPPING.farbe
  const c = weinartOderFarbe ? m[weinartOderFarbe] : undefined
  return c === 'W' || c === 'R' ? c : null
}

/** BKI-Qualitätskürzel aus dem internen Wert; null = keine Entsprechung */
export function katalogQualitaet(intern: string | null | undefined): KatQualitaet | null {
  const m: Record<string, string> = KATALOG_MAPPING.qualitaetsstufe
  const c = intern ? m[intern] : undefined
  return c ? KAT_QUALITAETSSTUFE.find(k => k.code === c) ?? null : null
}

// ── KAN-186 Etappe 2a: Erzeugnis, Zusatzbezeichnung, Ursprungsland an Charge/Füllung/Zukauf ──
// Die Spalten erzeugnis, zusatzbezeichnung und land_iso leitet der Trigger s112_katalog_ableiten (Migration
// kan186a_erzeugnis_zusatz_land) aus dem Qualitätswert ab – diese Funktion ist sein Spiegel (Test kan39-kataloge).

// KAN-186 Etappe 2c: + grosse_reserve (nur Stillwein; Migration kan186c ergänzt die drei CHECKs). Die Ableitung aus dem
// Qualitätsfeld kennt grosse_reserve nicht – den Wert gab es dort nie, er kommt nur über die Spalte selbst.
export const ZUSATZBEZEICHNUNGEN = ['reserve', 'grosse_reserve', 'erste_lage', 'grosses_gewachs'] as const
export type Zusatzbezeichnung = (typeof ZUSATZBEZEICHNUNGEN)[number]

/** Ableitung wie s112_katalog_ableiten: Zusatz aus Reserve/Erste Lage/GG, Erzeugnis aus Sekt/Perlwein bzw. Zukauf-Art Most */
export function katalogAusQualitaet(qualitaet: string | null | undefined, zukaufArt?: string | null): { zusatzbezeichnung: Zusatzbezeichnung | null; erzeugnis: string | null } {
  const zusatz = qualitaet && qualitaet !== 'grosse_reserve' && (ZUSATZBEZEICHNUNGEN as readonly string[]).includes(qualitaet) ? qualitaet as Zusatzbezeichnung : null
  const m: Record<string, string> = KATALOG_MAPPING.erzeugnis
  const erzeugnis = (qualitaet ? m[qualitaet] : undefined) ?? (zukaufArt === 'most' ? 'MOST' : null)
  return { zusatzbezeichnung: zusatz, erzeugnis }
}
