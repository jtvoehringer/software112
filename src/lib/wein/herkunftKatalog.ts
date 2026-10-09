// ── Amtliche Herkunftskataloge für das BKI-Blatt „Weingärten“ (KAN-47 Schritt 2, 09.10.2026) ──
//
// Statisch erfasst aus dem RIS, je Weinbaugebiet ein Block (bisher: Thermenregion, Kremstal, Wachau, Kamptal, Traisental, Carnuntum, Weinviertel). Schlüssel sind die
// Gemeindekennziffer (GKZ, Statistik Austria) bzw. – wo eine Verordnung einzelne Katastralgemeinden nennt – die KG-Nr. (BEV).
// Reihenfolge: Ried vor KG vor Gemeinde (Beispiel: KG Oeynhausen gehört zur Gemeinde Traiskirchen, aber zur Großlage
// Steinfeld; die Kremser Großlagen sind über Rieden festgelegt, im Kamptal lenken einzelne Rieden den Ortswein um). Ohne `@/`-Importe (node:test).
//
// Quellen:
//   Weinbaugebiete: Weingesetz 2009 § 21 Abs. 3 Z 1 (räumliche Abgrenzung je Gebiet)
//   Großlagen: Großlagenverordnung 2018, BGBl. II Nr. 184/2018 i. d. F. BGBl. II Nr. 30/2022, § 1 Z 2
//   Thermenregion: DAC-Verordnung „Thermenregion“, BGBl. II Nr. 191/2023 i. d. F. BGBl. II Nr. 250/2024, Anhang A und B
//   Kremstal: DAC-Verordnung „Kremstal“, BGBl. II Nr. 273/2017 i. d. F. BGBl. II Nr. 30/2022, Anlage 1 (Ortsangaben)
//   Wachau: DAC-Verordnung „Wachau“, BGBl. II Nr. 200/2020 i. d. F. 2023, § 3 Abs. 2 (Gemeindeangaben)
//   Kamptal: DAC-Verordnung „Kamptal“ i. d. F. BGBl. II Nr. 250/2024, Anlage 1 (ortsübergreifende Weinbaugemeinden)
//   Traisental: DAC-Verordnung „Traisental“, BGBl. II Nr. 273/2017 i. d. F. 2023 (ohne Liste der Ortsangaben) und
//      Produktspezifikation „Traisental DAC“ (BML, 28.06.2022), Abgrenzung des Gebiets
//   Carnuntum: DAC-Verordnung „Carnuntum“, BGBl. II Nr. 284/2019 i. d. F. BGBl. II Nr. 30/2022, § 6 und Anhang
//      (ortsübergreifende Gemeinden); Gebiet = politischer Bezirk Bruck an der Leitha und Gerichtsbezirk Schwechat
//   Weinviertel: DAC-Verordnung „Weinviertel“, BGBl. II Nr. 58/2010 i. d. F. BGBl. II Nr. 587/2020, § 1 Z 9 (Gemeinde,
//      Ried oder Großlage als kleinere Einheit); Großlagen § 1 Z 2 lit. m–r der Großlagenverordnung
//
// Annahmen (am Ticket KAN-47 dokumentiert):
//   K1 Wiener Neustadt (Statutarstadt, GKZ 30401) zählt zum Ortswein „Wiener Neustadt“, obwohl Anhang A nur die
//      umliegenden Gemeinden aufzählt.
//   K2 Gemeinden aus Anhang B tragen ihren eigenen Gemeindenamen als Ortswein; Sollenau steht in A und B → „Wiener Neustadt“.
//   K3 DAC-Riedenwein = amtliche Ried der Lage, wenn die Stelle einen DAC-Ortswein hat (Riedenweine setzen die
//      Ortsangabe voraus, z. B. Kremstal, Carnuntum § 7, Wachau § 4 Abs. 5); im Kamptal genügt eine Ried im Gebiet
//      (§ 2 Abs. 2 Z 3). Ob die Ried in der NÖ Riedenverordnung steht, wird nicht geprüft.
//   K4 Gemeindeteil = Name der KG, wenn er vom Gemeindenamen abweicht (die BKI-Spezifikation definiert das Feld nicht).
//   K5 Erste/Große Lage: in Thermenregion und Kremstal nicht gesetzlich geregelt (ÖTW-Lagen sind privat) → leer.
//   K6 Kremstal-DAC-Gebiet = die Gemeinden Krems an der Donau, Rohrendorf bei Krems, Gedersdorf, Stratzing, Droß,
//      Senftenberg, Furth bei Göttweig und Paudorf (alle mit Ortsangabe in Anlage 1). KGs dieser Gemeinden ohne Ortsangabe
//      (z. B. Neustift an der Donau ist Teil der Gemeinde Rohrendorf und zählt mit; Reichaueramt in Senftenberg nicht)
//      sind DAC-Gebiet ohne Ortswein. „Rohrendorf (Ober- und Unterrohrendorf)“ = die ganze Gemeinde.
//   K7 Ried-Zuordnungen: Vergleich mit der amtlichen Ried ohne Groß-/Kleinschreibung und ohne vorangestelltes „Ried“.
//   K8 Wachau: die Gemeindeangaben sind fast durchwegs KG-Namen → Ortswein je KG. KG Rührsdorf → „Rührsdorf“ (steht auch
//      unter „Rossatz“), KG Povat (Großlage Spitzer Graben ohne eigene Angabe) → „Spitzer Graben“, „Aggsbach“ = Aggsbach
//      Markt und Aggsbach Dorf. DAC-Gebiet = die Gemeinden Dürnstein, Weißenkirchen, Spitz, Mühldorf, Rossatz-Arnsdorf,
//      Mautern, Aggsbach und Bergern im Dunkelsteinerwald (Weingesetz § 21 Abs. 3 Z 1 lit. g – Schönbühel-Aggsbach mit
//      Aggsbach Dorf gehört nicht zum Weinbaugebiet Wachau).
//   K9 Kamptal: DAC-Gebiet = die Gemeinden Langenlois, Schönberg am Kamp, Straß im Straßertale, Hadersdorf-Kammern,
//      Grafenegg und Lengenfeld. „Mittelberg“ umfasst die Langenloiser Rieden Am Loiser, Auf der Setz, Sommerleithen,
//      Rothenbichl und Vogelberg; die Großlage „Retzer Land“ (Bezirk Horn) ist noch nicht erfasst.
//   K10 Traisental: Gebiet = Stadt St. Pölten, politischer Bezirk St. Pölten (alle GKZ 319xx, auch die 2017 zugekommenen
//      Gemeinden des früheren Bezirks Wien-Umgebung) sowie Atzenbrugg, Sitzenberg-Reidling und Würmla. Die Verordnung
//      zählt keine Ortsangaben auf → Ortswein = Name der politischen Gemeinde. Großlage nur „Wölblinger Urgestein“
//      (Wölbling, Obritzberg-Rust); Venusberg/Parapluiberg (östlich/westlich der Traisen) sind ohne Lagekarte nicht je KG
//      zuordenbar und bleiben leer.
//   K11 Carnuntum: Gebiet = alle GKZ 307xx (der Gerichtsbezirk Schwechat gehört seit 2017 zum Bezirk Bruck an der Leitha).
//      Die Anhang-Namen sind Ortschaften: ganze Gemeinde, wo sie die Gemeinde bilden; Hollern (Gemeinde Rohrau),
//      Wildungsmauer und Regelsbrunn (Scharndorf), Enzersdorf (KG Enzersdorf an der Fischa, samt der Ortschaft Karlsdorf),
//      Sarasdorf, Gallbrunn und Stixneusiedl (Trautmannsdorf) je KG. Keine Großlage.
//   K12 Weinviertel: Gebiet = Bezirke Gänserndorf, Mistelbach, Hollabrunn, Horn und Korneuburg ohne Stetteldorf am Wagram
//      und Gerasdorf bei Wien (beide Weinbaugebiet Wagram; Gerasdorf kam 2017 zum Bezirk Korneuburg). Die Verordnung
//      zählt keine Gemeinden auf → Ortswein = Name der politischen Gemeinde. Großlagen: Matzner Hügel, Wolkersdorfer
//      Hochleiten, Falkensteiner Hügelland, Pulkautal je Gemeinde; Retzer Land = übrige Gemeinden der Bezirke Hollabrunn
//      und Horn (Pulkautal geht vor); Bisamberg-Kreuzenstein = Bezirk Korneuburg (ohne die beiden Wagram-Gemeinden).

type Gebiet = {
  name: string
  /** Großlage je GKZ und Riedname (vorrangig; Riedname klein geschrieben) */
  grosslageRied?: Record<string, Record<string, string>>
  /** Großlage je KG-Nr. */
  grosslageKg: Record<string, string>
  /** Großlage je GKZ */
  grosslageGkz: Record<string, string>
  /** DAC-Ortswein je KG-Nr. und Riedname (vorrangig; Riedname klein geschrieben) */
  ortsweinRied?: Record<string, Record<string, string>>
  /** DAC-Ortswein je KG-Nr. */
  ortsweinKg: Record<string, string>
  /** DAC-Ortswein je GKZ; null = Gemeinde im DAC-Gebiet, Ortswein mit eigenem Gemeindenamen (Anhang B Thermenregion) */
  ortsweinGkz: Record<string, string | null>
  /** weitere Gemeinden im DAC-Gebiet ohne eigenen Ortswein (K6) */
  dacGkz?: readonly string[]
  /** GKZ-Anfänge im DAC-Gebiet (ganzer politischer Bezirk, K10) */
  dacGkzPraefix?: readonly string[]
  /** Ortswein = Name der politischen Gemeinde, wo keine Ortsangabe gilt (K10) */
  ortsweinGemeindename?: boolean
  /** Großlage je GKZ-Anfang (ganzer Bezirk; nachrangig) */
  grosslagePraefix?: Record<string, string>
  /** Gemeinden, die trotz GKZ-Anfang nicht zum Gebiet gehören */
  ausserGkz?: readonly string[]
  /** Riedenwein auch ohne Ortswein (Kamptal, K3) */
  riedenweinOhneOrtswein?: boolean
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

const WACHAU: Gebiet = {
  name: 'Wachau',
  grosslageKg: jeSchluessel({
    'Spitzer Graben': ['12319', '12358', '12362', '12307', '12341', '12348'],   // Gut am Steg, Spitz, Vießling; Elsarn am Jauerling, Mühldorf, Povat
  }),
  grosslageGkz: {},
  ortsweinKg: jeSchluessel({
    'Loiben': ['12116', '12117'],                                       // Oberloiben, Unterloiben
    'Spitzer Graben': ['12348'],                                        // Povat (K8)
    'Arnsdorf': ['12189', '12187'],                                     // Oberarnsdorf, Mitterarnsdorf
    'Rossatz': ['12167'],
    'Rührsdorf': ['12168'],
    'Dürnstein': ['12105'],
    'Weißenkirchen': ['12140'],
    'Joching': ['12185'],
    'Wösendorf': ['12192'],
    'St. Michael': ['12190'],
    'Spitz': ['12358'],
    'Gut am Steg': ['12319'],
    'Vießling': ['12362'],
    'Elsarn': ['12307'],                                                // Elsarn am Jauerling
    'Mühldorf': ['12341'],
    'Schwallenbach': ['12357'],
    'Willendorf': ['12366'],
    'Groisbach': ['12317'],
    'Aggsbach': ['12301'],                                              // Aggsbach Markt (K8)
    'Unterbergern': ['12150'],
    'Mauternbach': ['12163'],
    'Mautern': ['12162'],
    'Baumgarten': ['12148'],
  }),
  ortsweinGkz: {},
  dacGkz: ['31304', '31351', '31344', '31330', '31338', '31327', '31301', '31303'],
}

const KAMPTAL: Gebiet = {
  name: 'Kamptal',
  grosslageKg: {},
  grosslageGkz: {},
  ortsweinRied: {
    '12213': jeRied({ 'Zöbing': ['Heiligenstein'] }),                   // KG Kammern
    '12215': jeRied({ 'Mittelberg': ['Am Loiser', 'Auf der Setz', 'Sommerleithen', 'Rothenbichl', 'Vogelberg'] }),   // KG Langenlois
  },
  ortsweinKg: jeSchluessel({
    'Engabrunn': ['12206'],
    'Grafenegg': ['12207', '12203', '12231', '12237'],                  // Etsdorf, Diendorf am Kamp, Walkersdorf, Sittendorf
    'Strass': ['12229', '12205', '12232', '12220'],                     // Straß, Elsarn, Wiedendorf, Oberholz
    'Hadersdorf': ['12211'],
    'Kammern': ['12213'],
    'Langenlois': ['12215', '12212', '12224', '12225'],                 // Langenlois, Haindorf, Oberreith, Unterreith
    'Gobelsburg': ['12210'],
    'Zöbing': ['12233'],
    'Mittelberg': ['12217'],
    'Schiltern': ['12226'],
    'Schönberg': ['12227', '12219', '12218', '12228', '12230', '12201'], // Schönberg, Neustift, Mollands, Stiefern, Thürneustift, Altenhof
    'Lengenfeld': ['12216'],
  }),
  ortsweinGkz: {},
  dacGkz: ['31322', '31355', '31346', '31315', '31308', '31323'],
  riedenweinOhneOrtswein: true,
}

const TRAISENTAL: Gebiet = {
  name: 'Traisental',
  grosslageKg: {},
  grosslageGkz: jeSchluessel({ 'Wölblinger Urgestein': ['31948', '31930'] }),   // Wölbling, Obritzberg-Rust (lit. u)
  ortsweinKg: {},
  ortsweinGkz: {},
  dacGkz: ['30201', '32104', '32132', '32139'],                         // St. Pölten, Atzenbrugg, Sitzenberg-Reidling, Würmla
  dacGkzPraefix: ['319'],                                               // politischer Bezirk St. Pölten
  ortsweinGemeindename: true,
}

const CARNUNTUM: Gebiet = {
  name: 'Carnuntum',
  grosslageKg: {},
  grosslageGkz: {},
  ortsweinKg: jeSchluessel({
    'Petronell-Carnuntum': ['5023', '5115', '5111'],                    // Hollern, Wildungsmauer, Regelsbrunn
    'Stixneusiedl': ['5005', '5018', '5006', '5020'],                   // Enzersdorf an der Fischa, Sarasdorf, Gallbrunn, Stixneusiedl
  }),
  ortsweinGkz: jeSchluessel({
    'Göttlesbrunn': ['30708'],                                          // Göttlesbrunn-Arbesthal
    'Hainburg': ['30702', '30710', '30728'],                            // Bad Deutsch-Altenburg, Hainburg, Wolfsthal
    'Höflein': ['30712'],
    'Petronell-Carnuntum': ['30718', '30711'],                          // Petronell-Carnuntum, Haslau-Maria Ellend
    'Prellenkirchen': ['30703', '30719', '30715'],                      // Berg, Prellenkirchen (Deutsch Haslau, Schönabrunn), Hundsheim
  }),
  dacGkzPraefix: ['307'],
}

const WEINVIERTEL: Gebiet = {
  name: 'Weinviertel',
  grosslageKg: {},
  grosslageGkz: jeSchluessel({
    'Matzner Hügel': ['30803', '30804', '30805', '30811', '30812', '30814', '30824', '30828', '30838', '30848', '30852', '30854', '30859', '30860'],
    'Wolkersdorfer Hochleiten': ['31605', '31615', '31622', '31627', '31642', '31651', '31655'],
    'Falkensteiner Hügelland': ['31601', '31603', '31604', '31606', '30810', '31608', '31609', '31611', '31612', '31613', '31616', '31617', '31620',
      '30826', '31621', '30827', '30829', '31628', '31629', '31630', '31633', '31634', '30841', '31636', '31658', '30845', '31644', '30850', '31646',
      '31650', '30857', '31652', '31653', '31654', '30863'],
    'Pulkautal': ['31035', '31052', '31037', '31038', '31033', '31018', '31001', '31015', '31042', '31025', '31014', '31051'],
  }),
  grosslagePraefix: { '310': 'Retzer Land', '311': 'Retzer Land', '312': 'Bisamberg-Kreuzenstein' },
  ortsweinKg: {},
  ortsweinGkz: {},
  dacGkzPraefix: ['308', '310', '311', '312', '316'],
  ausserGkz: ['31228', '31235'],                                        // Stetteldorf am Wagram, Gerasdorf bei Wien
  ortsweinGemeindename: true,
}

const GEBIETE: readonly Gebiet[] = [THERMENREGION, KREMSTAL, WACHAU, KAMPTAL, TRAISENTAL, CARNUNTUM, WEINVIERTEL]

export type HerkunftKatalog = {
  gebiet: string | null
  grosslage: string | null
  dacOrtswein: string | null
  /** liegt im DAC-Gebiet */
  imDacGebiet: boolean
  /** DAC-Riedenwein möglich (K3): im DAC-Gebiet mit Ortswein, im Kamptal auch ohne */
  riedenwein: boolean
}

const LEER: HerkunftKatalog = { gebiet: null, grosslage: null, dacOrtswein: null, imDacGebiet: false, riedenwein: false }

/** K7: amtliche Ried für den Vergleich – klein, ohne „Ried“ davor, Leerzeichen vereinheitlicht */
const riedSchluessel = (ried: string | null | undefined) =>
  (ried ?? '').trim().replace(/^ried\s+/i, '').replace(/\s+/g, ' ').toLowerCase()

/** Großlage und DAC-Ortswein zu KG-Nr., GKZ und amtlicher Ried; `gemeinde` = Gemeindename für Ortsweine nach Anhang B */
export function herkunftKatalog(kgNr: string | null | undefined, gkz: string | null | undefined, gemeinde?: string | null, ried?: string | null): HerkunftKatalog {
  const kg = kgNr ? String(Number(kgNr)) : null   // ohne führende Nullen
  const r = riedSchluessel(ried)
  for (const g of GEBIETE) {
    if (gkz && g.ausserGkz?.includes(gkz)) continue
    const praefix = gkz ? Object.keys(g.grosslagePraefix ?? {}).find(p => gkz.startsWith(p)) : undefined
    const grosslage = (gkz && r && g.grosslageRied?.[gkz]?.[r]) || (kg && g.grosslageKg[kg]) || (gkz && g.grosslageGkz[gkz]) || (praefix && g.grosslagePraefix![praefix]) || null
    const ortKg = kg ? (r && g.ortsweinRied?.[kg]?.[r]) || g.ortsweinKg[kg] : undefined
    const gkzImAnhang = !!gkz && gkz in g.ortsweinGkz
    const imDac = !!ortKg || gkzImAnhang || (!!gkz && (!!g.dacGkz?.includes(gkz) || !!g.dacGkzPraefix?.some(p => gkz.startsWith(p))))
    if (!grosslage && !imDac) continue
    const ort = ortKg ?? (gkzImAnhang ? g.ortsweinGkz[gkz!] ?? gemeinde ?? null : null) ?? (g.ortsweinGemeindename && imDac ? gemeinde ?? null : null)
    return { gebiet: g.name, grosslage, dacOrtswein: ort, imDacGebiet: imDac, riedenwein: imDac && (!!ort || !!g.riedenweinOhneOrtswein) }
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
