// ── Amtliche Herkunftskataloge für das BKI-Blatt „Weingärten“ (KAN-47 Schritt 2, 09.10.2026) ──
//
// Statisch erfasst aus dem RIS, je Weinbaugebiet ein Block (bisher: Thermenregion). Schlüssel sind die Gemeindekennziffer
// (GKZ, Statistik Austria) bzw. – wo eine Verordnung einzelne Katastralgemeinden nennt – die KG-Nr. (BEV). Eine KG-Zuordnung
// geht der Gemeinde-Zuordnung vor (Beispiel: KG Oeynhausen gehört zur Gemeinde Traiskirchen, aber zur Großlage Steinfeld).
// Ohne `@/`-Importe (node:test).
//
// Quellen:
//   Großlagen: Großlagenverordnung 2018, BGBl. II Nr. 184/2018 i. d. F. BGBl. II Nr. 30/2022, § 1 Z 2 (Thermenregion)
//   DAC: Verordnung „Thermenregion“, BGBl. II Nr. 191/2023 i. d. F. BGBl. II Nr. 250/2024, Anhang A (Ortsweine) und B
//
// Annahmen (am Ticket KAN-47 dokumentiert):
//   K1 Wiener Neustadt (Statutarstadt, GKZ 30401) zählt zum Ortswein „Wiener Neustadt“, obwohl Anhang A nur die
//      umliegenden Gemeinden aufzählt.
//   K2 Gemeinden aus Anhang B tragen ihren eigenen Gemeindenamen als Ortswein; Sollenau steht in A und B → „Wiener Neustadt“.
//   K3 DAC-Riedenwein = amtliche Ried der Lage, wenn die Gemeinde im DAC-Gebiet liegt (Anhang A oder B). Ob die Ried in
//      der NÖ Riedenverordnung steht, wird nicht geprüft.
//   K4 Gemeindeteil = Name der KG, wenn er vom Gemeindenamen abweicht (die BKI-Spezifikation definiert das Feld nicht).
//   K5 Erste/Große Lage: in der Thermenregion nicht geregelt → leer.

type Gebiet = {
  name: string
  /** Großlage je KG-Nr. (vorrangig) */
  grosslageKg: Record<string, string>
  /** Großlage je GKZ */
  grosslageGkz: Record<string, string>
  /** DAC-Ortswein je KG-Nr. (vorrangig) */
  ortsweinKg: Record<string, string>
  /** DAC-Ortswein je GKZ; null = Gemeinde im DAC-Gebiet, Ortswein mit eigenem Gemeindenamen (Anhang B) */
  ortsweinGkz: Record<string, string | null>
}

const jeSchluessel = (zuordnung: Record<string, readonly string[]>) =>
  Object.fromEntries(Object.entries(zuordnung).flatMap(([wert, schluessel]) => schluessel.map(s => [s, wert])))

const THERMENREGION: Gebiet = {
  name: 'Thermenregion',
  grosslageKg: jeSchluessel({
    'Badener Berg': ['4020', '4017'],                                    // Mitterberg, Leesdorf (Baden)
    'Steinfeld': ['4028', '4010', '4032', '4040', '4022', '4105', '4112'], // Schönau, Günselsdorf, Teesdorf, Tattendorf, Oeynhausen, Oberwaltersdorf, Trumau
    'Soosser Sonnberg': ['4025', '4006', '4031'],                       // Rauhenstein, Gamingerhof (Baden), Sooß
    'Harterberg': ['4003'],                                             // Braiten (Baden)
  }),
  grosslageGkz: jeSchluessel({
    'Weißer Stein': ['31719'],                                          // Perchtoldsdorf
    'Kapellenweg': ['31710'],                                           // Guntramsdorf
    'Schatzberg': ['31709'],                                            // Gumpoldskirchen
    'Badener Berg': ['30625', '30639'],                                 // Pfaffstätten, Traiskirchen
    'Vöslauer Hauerberg': ['30603', '30605', '30608', '30615', '30618', '30620', '30621', '30629', '30633'],
  }),
  ortsweinKg: jeSchluessel({ 'Tattendorf': ['4022'] }),                 // KG Oeynhausen (sonst Traiskirchen → Gumpoldskirchen)
  ortsweinGkz: {
    ...jeSchluessel({
      'Perchtoldsdorf': ['31719', '31704', '31716', '31707'],
      'Gumpoldskirchen': ['31717', '31709', '31710', '30625', '30639'],
      'Tattendorf': ['30636', '30641', '30637', '30623', '30646', '30612', '30631'],
      'Wiener Neustadt': ['30401', '32301', '32305', '32320', '32313', '32318', '32327', '32334'],
      'Bad Vöslau': ['30618', '30605', '30603'],
    }),
    // Anhang B (Sollenau 32327 steht schon in A)
    '30604': null, '30608': null, '30620': null, '31718': null, '30629': null, '30626': null, '30635': null, '31725': null,
  },
}

const GEBIETE: readonly Gebiet[] = [THERMENREGION]

export type HerkunftKatalog = {
  gebiet: string | null
  grosslage: string | null
  dacOrtswein: string | null
  /** Gemeinde liegt im DAC-Gebiet (Anhang A oder B) – Voraussetzung für DAC-Riedenwein */
  imDacGebiet: boolean
}

const LEER: HerkunftKatalog = { gebiet: null, grosslage: null, dacOrtswein: null, imDacGebiet: false }

/** Großlage und DAC-Ortswein zu KG-Nr. und GKZ; `gemeinde` = Gemeindename für Ortsweine nach Anhang B */
export function herkunftKatalog(kgNr: string | null | undefined, gkz: string | null | undefined, gemeinde?: string | null): HerkunftKatalog {
  const kg = kgNr ? String(Number(kgNr)) : null   // ohne führende Nullen
  for (const g of GEBIETE) {
    const grosslage = (kg && g.grosslageKg[kg]) || (gkz && g.grosslageGkz[gkz]) || null
    const ortKg = kg ? g.ortsweinKg[kg] : undefined
    const imDac = !!ortKg || (!!gkz && gkz in g.ortsweinGkz)
    if (!grosslage && !imDac) continue
    const ort = ortKg ?? (gkz && gkz in g.ortsweinGkz ? g.ortsweinGkz[gkz] ?? gemeinde ?? null : null)
    return { gebiet: g.name, grosslage, dacOrtswein: ort, imDacGebiet: imDac }
  }
  return LEER
}

/** K4: Gemeindeteil = KG-Name, wenn er vom Gemeindenamen abweicht */
export function gemeindeteil(kgName: string | null | undefined, gemeinde: string | null | undefined): string | null {
  const k = kgName?.trim()
  if (!k) return null
  return gemeinde && k.localeCompare(gemeinde.trim(), 'de', { sensitivity: 'base' }) === 0 ? null : k
}

/** Gebiete, deren Kataloge erfasst sind (für den Hinweis der Meldung) */
export const KATALOG_GEBIETE = GEBIETE.map(g => g.name)
