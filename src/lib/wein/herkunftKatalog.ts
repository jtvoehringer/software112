// ── Amtliche Herkunftskataloge für das BKI-Blatt „Weingärten“ (KAN-47 Schritt 2, 09.10.2026) ──
//
// Statisch erfasst aus dem RIS, je Weinbaugebiet ein Block (bisher: Thermenregion, Kremstal). Schlüssel sind die
// Gemeindekennziffer (GKZ, Statistik Austria) bzw. – wo eine Verordnung einzelne Katastralgemeinden nennt – die KG-Nr. (BEV).
// Reihenfolge: Ried vor KG vor Gemeinde (Beispiel: KG Oeynhausen gehört zur Gemeinde Traiskirchen, aber zur Großlage
// Steinfeld; die Kremser Großlagen sind über Rieden festgelegt). Ohne `@/`-Importe (node:test).
//
// Quellen:
//   Großlagen: Großlagenverordnung 2018, BGBl. II Nr. 184/2018 i. d. F. BGBl. II Nr. 30/2022, § 1 Z 2
//   Thermenregion: DAC-Verordnung „Thermenregion“, BGBl. II Nr. 191/2023 i. d. F. BGBl. II Nr. 250/2024, Anhang A und B
//   Kremstal: DAC-Verordnung „Kremstal“, BGBl. II Nr. 273/2017 i. d. F. BGBl. II Nr. 30/2022, Anlage 1 (Ortsangaben)
//
// Annahmen (am Ticket KAN-47 dokumentiert):
//   K1 Wiener Neustadt (Statutarstadt, GKZ 30401) zählt zum Ortswein „Wiener Neustadt“, obwohl Anhang A nur die
//      umliegenden Gemeinden aufzählt.
//   K2 Gemeinden aus Anhang B tragen ihren eigenen Gemeindenamen als Ortswein; Sollenau steht in A und B → „Wiener Neustadt“.
//   K3 DAC-Riedenwein = amtliche Ried der Lage, wenn die Gemeinde im DAC-Gebiet liegt. Ob die Ried in der NÖ
//      Riedenverordnung steht, wird nicht geprüft.
//   K4 Gemeindeteil = Name der KG, wenn er vom Gemeindenamen abweicht (die BKI-Spezifikation definiert das Feld nicht).
//   K5 Erste/Große Lage: in Thermenregion und Kremstal nicht gesetzlich geregelt (ÖTW-Lagen sind privat) → leer.
//   K6 Kremstal-DAC-Gebiet = die Gemeinden Krems an der Donau, Rohrendorf bei Krems, Gedersdorf, Stratzing, Droß,
//      Senftenberg, Furth bei Göttweig und Paudorf (alle mit Ortsangabe in Anlage 1). KGs dieser Gemeinden ohne Ortsangabe
//      (z. B. Neustift an der Donau ist Teil der Gemeinde Rohrendorf und zählt mit; Reichaueramt in Senftenberg nicht)
//      sind DAC-Gebiet ohne Ortswein. „Rohrendorf (Ober- und Unterrohrendorf)“ = die ganze Gemeinde.
//   K7 Ried-Großlagen: Vergleich mit der amtlichen Ried ohne Groß-/Kleinschreibung und ohne vorangestelltes „Ried“.

type Gebiet = {
  name: string
  /** Großlage je GKZ und Riedname (vorrangig; Riedname klein geschrieben) */
  grosslageRied?: Record<string, Record<string, string>>
  /** Großlage je KG-Nr. */
  grosslageKg: Record<string, string>
  /** Großlage je GKZ */
  grosslageGkz: Record<string, string>
  /** DAC-Ortswein je KG-Nr. (vorrangig) */
  ortsweinKg: Record<string, string>
  /** DAC-Ortswein je GKZ; null = Gemeinde im DAC-Gebiet, Ortswein mit eigenem Gemeindenamen (Anhang B Thermenregion) */
  ortsweinGkz: Record<string, string | null>
  /** weitere Gemeinden im DAC-Gebiet ohne eigenen Ortswein (K6) */
  dacGkz?: readonly string[]
}

const jeSchluessel = (zuordnung: Record<string, readonly string[]>) =>
  Object.fromEntries(Object.entries(zuordnung).flatMap(([wert, schluessel]) => schluessel.map(s => [s, wert])))
const jeRied = (zuordnung: Record<string, readonly string[]>) =>
  Object.fromEntries(Object.entries(zuordnung).flatMap(([wert, rieden]) => rieden.map(r => [r.toLowerCase(), wert])))

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

const KREMSTAL: Gebiet = {
  name: 'Kremstal',
  grosslageRied: {
    '30101': jeRied({                                                   // Krems an der Donau, § 1 Z 2 lit. w–y
      'Kremser Sandgrube': ['Thalland', 'Obere Sandgrube', 'Weinzierlberg', 'Holzgasse', 'Thurnerberg', 'Gebling', 'Marthal', 'Kapuzinerberg', 'Steinbad', 'Wolfsgraben'],
      'Kremser Kreuzberg': ['Steiner Hund', 'Hinters Kirchl', 'Grillenparz', 'Schreck', 'Braunsdorfer', 'Steiner Goldberg', 'Wachtberg', 'Kögl', 'Faucha', 'Spiegel', 'Kremserl'],
      'Kremser Sommerleithen': ['Obere Sommerleiten', 'Lemberg', 'Aufeneck', 'Satzen', 'Retter', 'Groß Rehberg', 'Küberg', 'Leithaus', 'Frauenberg', 'Im Berg'],
    }),
  },
  grosslageKg: {},
  grosslageGkz: jeSchluessel({
    'Kaiserstiege': ['31337', '31310'],                                 // Rohrendorf bei Krems, Gedersdorf
    'Göttweiger Berg': ['31309', '31333'],                              // Furth bei Göttweig, Paudorf
  }),
  ortsweinKg: jeSchluessel({
    'Krems': ['12114', '12146', '12172', '12158', '12115', '12109', '12123', '12106'],   // Krems, Angern, Thallern, Hollenburg, Landersdorf, Gneixendorf, Rehberg, Egelsee
    'Stein': ['12132'],
    'Senftenberg': ['12130', '12112', '12122'],                         // Senftenberg, Imbach, Priel
    'Furth': ['12154', '12152', '12166', '12171', '12145'],             // Furth, Oberfucha, Palt, Steinaweg, Aigen
    'Höbenbach': ['12157', '12151', '12147', '12164', '12159'],         // Höbenbach, Eggendorf, Paudorf, Meidling, Hörfarth
    'Krustetten': ['12160', '12153'],                                   // Krustetten, Tiefenfucha
  }),
  ortsweinGkz: jeSchluessel({
    'Rohrendorf': ['31337'],
    'Gedersdorf': ['31310'],
    'Stratzing': ['31347', '31356'],                                    // Stratzing, Droß
  }),
  dacGkz: ['30101', '31343', '31309', '31333'],                         // K6: Krems, Senftenberg, Furth, Paudorf (übrige KGs)
}

const GEBIETE: readonly Gebiet[] = [THERMENREGION, KREMSTAL]

export type HerkunftKatalog = {
  gebiet: string | null
  grosslage: string | null
  dacOrtswein: string | null
  /** liegt im DAC-Gebiet – Voraussetzung für DAC-Riedenwein */
  imDacGebiet: boolean
}

const LEER: HerkunftKatalog = { gebiet: null, grosslage: null, dacOrtswein: null, imDacGebiet: false }

/** K7: amtliche Ried für den Vergleich – klein, ohne „Ried“ davor, Leerzeichen vereinheitlicht */
const riedSchluessel = (ried: string | null | undefined) =>
  (ried ?? '').trim().replace(/^ried\s+/i, '').replace(/\s+/g, ' ').toLowerCase()

/** Großlage und DAC-Ortswein zu KG-Nr., GKZ und amtlicher Ried; `gemeinde` = Gemeindename für Ortsweine nach Anhang B */
export function herkunftKatalog(kgNr: string | null | undefined, gkz: string | null | undefined, gemeinde?: string | null, ried?: string | null): HerkunftKatalog {
  const kg = kgNr ? String(Number(kgNr)) : null   // ohne führende Nullen
  const r = riedSchluessel(ried)
  for (const g of GEBIETE) {
    const grosslage = (gkz && r && g.grosslageRied?.[gkz]?.[r]) || (kg && g.grosslageKg[kg]) || (gkz && g.grosslageGkz[gkz]) || null
    const ortKg = kg ? g.ortsweinKg[kg] : undefined
    const gkzImAnhang = !!gkz && gkz in g.ortsweinGkz
    const imDac = !!ortKg || gkzImAnhang || (!!gkz && !!g.dacGkz?.includes(gkz))
    if (!grosslage && !imDac) continue
    const ort = ortKg ?? (gkzImAnhang ? g.ortsweinGkz[gkz!] ?? gemeinde ?? null : null)
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
