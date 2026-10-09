// ── Amtliche Herkunftskataloge für das BKI-Blatt „Weingärten“ (KAN-47 Schritt 2, 09.10.2026) ──
//
// Statisch erfasst aus dem RIS, je Weinbaugebiet ein Block (alle österreichischen Weinbaugebiete mit DAC bzw. Großlagen). Schlüssel sind die
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
//   Wagram: DAC-Verordnung „Wagram“, BGBl. II Nr. 30/2022, § 1 (Gebiet), § 7 Abs. 2 (27 Ortsangaben), § 8 (Ried);
//      Großlagen § 1 Z 2 lit. k, l
//   Wien: Weingesetz § 21 Abs. 3 Z 1 lit. i; Großlagen § 1 Z 5 (je KG)
//   Burgenland: DAC-Verordnungen „Leithaberg“ (§ 1 Gebiet samt vier Neusiedler Rieden), „Neusiedlersee“ (BGBl. II
//      Nr. 431/2020, § 1), „Mittelburgenland“ (BGBl. II Nr. 56/2010 i. d. F. 184/2018, § 1 Z 5), „Rosalia“ (BGBl. II
//      Nr. 59/2018 i. d. F. 191/2023, § 1), „Eisenberg“ (BGBl. II Nr. 191/2023 i. d. F. 250/2024, § 1, § 7);
//      Großlagen § 1 Z 1
//   Steiermark: DAC-Verordnungen „Südsteiermark“, „Vulkanland Steiermark“, „Weststeiermark“ (§ 8 und Anhang: ortsübergreifende
//      Gemeinden, § 9 Riedenwein); Weingesetz § 21 Abs. 3 Z 3; Großlage Oststeiermark § 1 Z 4; KG-Namen nach dem
//      BEV-Katastralgemeindenverzeichnis (Stichtag 24.01.2022)
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
//   K13 Wagram: Gebiet = Bezirk Tulln ohne Atzenbrugg, Sitzenberg-Reidling, Würmla, dazu Stetteldorf am Wagram und
//      Gerasdorf bei Wien (Klosterneuburg gehört seit 2017 zum Bezirk Tulln). Die 26 Ortsangaben nördlich der Donau sind
//      KG-Namen („Absdorf“ = die ganze Gemeinde, eine KG); „Klosterneuburg“ = alle Wagram-Gemeinden südlich der Donau
//      (Klosterneuburg und die Gemeinden der Großlage Tullnerfeld). Großlage Klosterneuburg = Gemeinde Klosterneuburg
//      (die übrigen Gemeinden südlich der Donau stehen ausdrücklich unter Tullnerfeld).
//   K14 Wien: Gebiet = Wien; der Wiener Gemischte Satz DAC kennt keine Ortsangaben, Riedenwein ohne Ortswein möglich.
//      Großlage Bisamberg-Wien umfasst Großjedlersdorf I und II.
//   K15 Burgenland: Ortswein = Gemeindename, wo die Verordnung eine Gemeinde als nähere Herkunft zulässt (Leithaberg,
//      Mittelburgenland, Rosalia); Neusiedlersee DAC hat keine Orts- und Riedenweine; Eisenberg nach § 7 Abs. 2 (KG Eisenberg
//      an der Pinka vor der Gemeinde Deutsch Schützen-Eisenberg). In der Gemeinde Neusiedl am See gehören nur die Rieden
//      Hausberg, Neuberg, Marthalwald und Landstraße Hutweide zum Leithaberg. Ruster Ausbruch (nur Süßwein, Rust) ist über
//      den Leithaberg abgedeckt. Großlagen: Heideboden = Neusiedlersee ohne Parndorfer Platte, Sonnenberg, Rusterberg,
//      Goldbachtal, Südburgenland.
//   K16 Steiermark: Gebiete Südsteiermark = Bezirk Leibnitz, Weststeiermark = Bezirke Deutschlandsberg und Voitsberg,
//      Vulkanland = Bezirke Hartberg-Fürstenfeld, Südoststeiermark, Weiz sowie die Leibnitzer Gemeinden/KGs der Vulkanland-
//      Ortsweinliste (St. Peter). Die Gemeinden „links der Mur“ in Leibnitz und Graz-Umgebung sind ohne Karte nicht
//      abgrenzbar: Leibnitz zählt sonst zur Südsteiermark, Graz und Graz-Umgebung bleiben leer. Ortsangaben, die nur
//      „Weinbauflächen links/rechts der Sulm, Laßnitz, Mur“ bzw. „östlich/westlich des Gnasbachs“ nennen (Heimschuh, Leibnitz,
//      Lang, Tillmitsch, Wagna, Straß in Steiermark; KG Trössing), bleiben leer mit Hinweis; KG Fresing (Kitzeck) steht in
//      keiner Ortsangabe. Feldbach (Raabau, Gniebing, Auersbach) und Edelsbach zählen zu Riegersburg; Haselbach bei Straden
//      = KG in Deutsch Goritz. Riedenwein auch außerhalb der Ortsweingebiete (§ 9 Abs. 7).

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
  /** Gemeinden, die nur mit bestimmten Rieden zum Gebiet gehören (K15, Riedname klein geschrieben) */
  dacRied?: Record<string, Record<string, string>>
  /** Gemeinden ohne Großlage trotz GKZ-Anfang (Parndorfer Platte) */
  ohneGrosslageGkz?: readonly string[]
  /** Ortswein je GKZ-Anfang (nachrangig, Oststeiermark) */
  ortsweinPraefix?: Record<string, string>
  /** Gemeinden bzw. KGs, deren Ortsangabe vom Flussufer abhängt (K16) – Ortswein leer, mit Hinweis */
  unklarGkz?: readonly string[]
  unklarKg?: readonly string[]
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

const WAGRAM_SUED = ['32144', '32120', '32119', '32141', '32112', '32131', '32134', '32135', '32116', '32143', '32140', '32142']

const WAGRAM: Gebiet = {
  name: 'Wagram',
  grosslageKg: {},
  grosslageGkz: {
    ...jeSchluessel({ 'Klosterneuburg': ['32144'] }),
    ...jeSchluessel({ 'Tullnerfeld': WAGRAM_SUED.filter(g => g !== '32144') }),
  },
  ortsweinKg: jeSchluessel({
    'Fels': ['20009'], 'Gösing': ['20013'], 'Thürnthal': ['20033'], 'Feuersbrunn': ['20010'], 'Wagram': ['20036'],
    'Großriedenthal': ['20025'], 'Ottenthal': ['20024'], 'Neudegg': ['20022'], 'Ameisthal': ['20004'], 'Baumgarten': ['20005'],
    'Großweikersdorf': ['20037'], 'Großwiesendorf': ['20038'], 'Ruppersthal': ['20026'], 'Tiefenthal': ['20034'],
    'Zaussenberg': ['20041'], 'Engelmannsbrunn': ['20008'], 'Kirchberg': ['20018'], 'Mitterstockstall': ['20030'],
    'Oberstockstall': ['20031'], 'Unterstockstall': ['20032'], 'Königsbrunn': ['20020'], 'Hippersdorf': ['20015'],
    'Eggendorf': ['11102'], 'Starnwörth': ['11139'], 'Stetteldorf': ['11141'],
  }),
  ortsweinGkz: { ...jeSchluessel({ 'Absdorf': ['32101'], 'Klosterneuburg': WAGRAM_SUED }) },
  dacGkzPraefix: ['321'],
  dacGkz: ['31228', '31235'],                                           // Stetteldorf am Wagram, Gerasdorf bei Wien
  ausserGkz: ['32104', '32132', '32139'],                               // Atzenbrugg, Sitzenberg-Reidling, Würmla (Traisental)
}

const WIEN: Gebiet = {
  name: 'Wien',
  grosslageKg: jeSchluessel({
    'Bisamberg-Wien': ['1617', '1616', '1606', '1607'],                 // Strebersdorf, Stammersdorf, Großjedlersdorf I/II
    'Kahlenberg': ['1505', '1504'],                                     // Kahlenbergerdorf, Josefsdorf
    'Nußberg': ['1507', '1503'],                                        // Nußdorf, Heiligenstadt
    'Maurerberg': ['1806', '1804', '1807', '1805'],                     // Mauer, Kalksburg, Rodaun, Liesing
    'Laaerberg': ['1105'],                                              // Oberlaa Stadt
  }),
  grosslageGkz: {},
  ortsweinKg: {},
  ortsweinGkz: {},
  dacGkzPraefix: ['9'],
  riedenweinOhneOrtswein: true,
}

const LEITHABERG: Gebiet = {
  name: 'Leithaberg',
  grosslageKg: {},
  grosslageGkz: jeSchluessel({ 'Sonnenberg': ['10101'], 'Rusterberg': ['10201'] }),
  grosslagePraefix: { '103': 'Sonnenberg' },
  ortsweinKg: {},
  ortsweinGkz: {},
  dacGkz: ['10101', '10201', '10710', '10723'],                         // Eisenstadt, Rust, Jois, Winden am See
  dacGkzPraefix: ['103'],                                               // Bezirk Eisenstadt-Umgebung
  dacRied: { '10713': jeRied({ 'Leithaberg': ['Hausberg', 'Neuberg', 'Marthalwald', 'Landstraße Hutweide'] }) },   // Neusiedl am See
  ortsweinGemeindename: true,
}

const NEUSIEDLERSEE: Gebiet = {
  name: 'Neusiedlersee',
  grosslageKg: {},
  grosslageGkz: {},
  grosslagePraefix: { '107': 'Heideboden' },
  ohneGrosslageGkz: ['10717', '10725', '10703', '10706', '10724', '10714', '10704', '10715', '10727', '10726', '10711'],   // Parndorfer Platte
  ortsweinKg: {},
  ortsweinGkz: {},
  dacGkzPraefix: ['107'],
  ausserGkz: ['10710', '10723'],                                        // Jois, Winden am See (Leithaberg)
}

const MITTELBURGENLAND: Gebiet = {
  name: 'Mittelburgenland',
  grosslageKg: {},
  grosslageGkz: {},
  grosslagePraefix: { '108': 'Goldbachtal' },
  ortsweinKg: {},
  ortsweinGkz: {},
  dacGkzPraefix: ['108'],                                               // Bezirk Oberpullendorf
  ortsweinGemeindename: true,
}

const ROSALIA: Gebiet = {
  name: 'Rosalia',
  grosslageKg: {},
  grosslageGkz: {},
  ortsweinKg: {},
  ortsweinGkz: {},
  dacGkzPraefix: ['106'],                                               // Bezirk Mattersburg
  ortsweinGemeindename: true,
}

const EISENBERG: Gebiet = {
  name: 'Eisenberg',
  grosslageKg: {},
  grosslageGkz: {},
  grosslagePraefix: { '104': 'Südburgenland', '105': 'Südburgenland', '109': 'Südburgenland' },
  ortsweinKg: jeSchluessel({ 'Eisenberg a. d. P.': ['34017'] }),       // KG Eisenberg an der Pinka
  ortsweinGkz: jeSchluessel({
    'Deutsch Schützen': ['10903'],                                      // übrige KGs von Deutsch Schützen-Eisenberg
    'Hannersdorf': ['10906'],
    'Kohfidisch': ['10908'],
    'Rechnitz': ['10919', '10913'],                                     // Rechnitz, Markt Neuhodis
    'Gaas': ['10403', '10428'],                                         // Eberau, Moschendorf
  }),
  dacGkzPraefix: ['104', '105', '109'],                                 // Bezirke Güssing, Jennersdorf, Oberwart
}

const VULKANLAND: Gebiet = {
  name: 'Vulkanland Steiermark',
  grosslageKg: {},
  grosslageGkz: {},
  grosslagePraefix: { '622': 'Oststeiermark', '617': 'Oststeiermark' },
  ortsweinKg: jeSchluessel({
    'Riegersburg': ['62032', '62023', '62031', '62008', '62010', '62013', '62035', '62015', '62147', '62116', '62102', '62109'],
    'Kapfenstein': ['62024', '62012', '62004', '62030', '62025', '62026', '62002'],
    'Straden': ['66212', '66239', '66222', '66248', '62146', '62108', '62118'],
    'St. Peter': ['62303', '62324', '62149', '62302', '66211', '66231', '66241', '66234', '66166'],
    'Gleichenberg': ['62115', '62112', '62122', '62134', '62167', '62141', '62117', '62137', '62131', '62111', '62163', '62143', '62145'],
  }),
  ortsweinGkz: jeSchluessel({
    'Kapfenstein': ['62332'],
    'St. Anna': ['62387'],
    'Tieschen': ['62368'],
    'Klöch': ['62335'],
    'Straden': ['62390'],
    'Gleichenberg': ['62375'],
    'St. Peter': ['62388', '62383', '62343', '61057', '62330', '62389', '62381', '62385'],
    'Riegersburg': ['62273', '62267', '62252', '62269', '62271', '62232', '61716', '62386', '62372'],
  }),
  ortsweinPraefix: { '622': 'Oststeiermark', '617': 'Oststeiermark' },
  unklarKg: ['66236'],                                                  // Trössing: östlich des Gnasbachs Straden, westlich St. Peter
  dacGkzPraefix: ['622', '623', '617'],
  riedenweinOhneOrtswein: true,
}

const SUEDSTEIERMARK: Gebiet = {
  name: 'Südsteiermark',
  grosslageKg: {},
  grosslageGkz: {},
  ortsweinKg: jeSchluessel({
    'Kitzeck-Sausal': ['66105', '66108', '66115', '66119', '66150', '66178', '66038'],
    'Eichberg': ['66002', '66022', '66006', '66017', '66005', '66037', '66041', '66027', '66024', '66026'],
    'Gamlitz': ['66186'],
    'Ehrenhausen': ['66180'],
  }),
  ortsweinGkz: jeSchluessel({
    'Kitzeck-Sausal': ['61030', '61033'],
    'Leutschach': ['61054'],
    'Gamlitz': ['61050'],
    'Ehrenhausen': ['61049'],
  }),
  unklarGkz: ['61016', '61053', '61020', '61043', '61045', '61061'],   // Heimschuh, Leibnitz, Lang, Tillmitsch, Wagna, Straß
  dacGkzPraefix: ['610'],
  riedenweinOhneOrtswein: true,
}

const WESTSTEIERMARK: Gebiet = {
  name: 'Weststeiermark',
  grosslageKg: {},
  grosslageGkz: {},
  ortsweinKg: jeSchluessel({
    'Ligist': ['63337', '63312', '63364', '63335', '63307', '63309', '63319', '63333', '63345', '63352', '63357', '63341', '63365', '63306', '63344', '63370'],
    'Stainz': ['61214', '61216', '61215', '61250', '61222', '61237', '61249', '61232', '61238', '61242', '61208', '61219', '61239', '61233', '61246', '61228', '61217', '61245', '61225', '61218'],
    'Deutschlandsberg': ['61209', '61205', '61226', '61059', '61004', '61066', '61207', '61201', '61073', '61072', '61022', '61045', '61005', '61068', '61055', '61076', '61012', '61023', '61024', '61063', '61001', '61043', '61037', '61057', '61040', '61054'],
    'Eibiswald': ['61127', '61128', '61109', '61115', '61150', '61136', '61104', '61103', '61113', '61146', '61122', '61147', '61145', '61151', '61132', '61118', '61131', '61124', '61114', '61119', '61143', '61102', '61101', '61141', '61133', '61144', '61123', '61116', '61078', '61077', '61120', '61108'],
  }),
  ortsweinGkz: {},
  dacGkzPraefix: ['603', '616'],                                        // Bezirke Deutschlandsberg, Voitsberg
  riedenweinOhneOrtswein: true,
}

const GEBIETE: readonly Gebiet[] = [THERMENREGION, KREMSTAL, WACHAU, KAMPTAL, TRAISENTAL, CARNUNTUM, WEINVIERTEL, WAGRAM,
  WIEN, LEITHABERG, NEUSIEDLERSEE, MITTELBURGENLAND, ROSALIA, EISENBERG, VULKANLAND, SUEDSTEIERMARK, WESTSTEIERMARK]

export type HerkunftKatalog = {
  gebiet: string | null
  grosslage: string | null
  dacOrtswein: string | null
  /** liegt im DAC-Gebiet */
  imDacGebiet: boolean
  /** DAC-Riedenwein möglich (K3): im DAC-Gebiet mit Ortswein, im Kamptal auch ohne */
  riedenwein: boolean
  /** nur gesetzt, wenn die Ortsangabe ohne Karte nicht bestimmbar ist (K16) */
  hinweis?: string
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
    const riedGebiet = !!gkz && !!r && !!g.dacRied?.[gkz]?.[r]
    const praefix = gkz && !g.ohneGrosslageGkz?.includes(gkz) ? Object.keys(g.grosslagePraefix ?? {}).find(p => gkz.startsWith(p)) : undefined
    const grosslage = (gkz && r && g.grosslageRied?.[gkz]?.[r]) || (kg && g.grosslageKg[kg]) || (gkz && g.grosslageGkz[gkz]) || (praefix && g.grosslagePraefix![praefix]) || null
    const ortKg = kg ? (r && g.ortsweinRied?.[kg]?.[r]) || g.ortsweinKg[kg] : undefined
    const gkzImAnhang = !!gkz && gkz in g.ortsweinGkz
    const imDac = !!ortKg || gkzImAnhang || riedGebiet || (!!gkz && (!!g.dacGkz?.includes(gkz) || !!g.dacGkzPraefix?.some(p => gkz.startsWith(p))))
    if (!grosslage && !imDac) continue
    const unklar = (!!kg && !!g.unklarKg?.includes(kg)) || (!!gkz && !!g.unklarGkz?.includes(gkz))
    const ortPraefix = gkz && !unklar ? Object.entries(g.ortsweinPraefix ?? {}).find(([p]) => gkz.startsWith(p))?.[1] : undefined
    const ort = unklar ? null
      : ortKg ?? (gkzImAnhang ? g.ortsweinGkz[gkz!] ?? gemeinde ?? null : null) ?? (g.ortsweinGemeindename && imDac ? gemeinde ?? null : null) ?? ortPraefix ?? null
    return {
      gebiet: g.name, grosslage, dacOrtswein: ort, imDacGebiet: imDac, riedenwein: imDac && (!!ort || !!g.riedenweinOhneOrtswein),
      ...(unklar ? { hinweis: 'Ortsangabe hängt von der Lage zum Fluss bzw. Bach ab (links/rechts, östlich/westlich) – bitte prüfen' } : {}),
    }
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
