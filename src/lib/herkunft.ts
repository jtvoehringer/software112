// Herkunft-Code (BKI) – weinrechtliche Herkunftspyramide für ganz Österreich (KAN-165, 01.10.2026).
//
// Bis KAN-165 eine lineare Rangfolge (wein < wlnoe < thermenregion_*). Seither ein BAUM:
//   Österreich (Wein) › Weinbauregion (Landwein) › Weinbaugebiet (Qualitätswein) › DAC Gebiets-/Orts-/Riedenwein.
// Abstufen heißt im Baum nach oben gehen; der Verschnitt verschiedener Herkünfte bekommt den
// gemeinsamen Oberbegriff (Kremstal + Kamptal → Niederösterreich; Niederösterreich + Wien → Landwein
// Weinland; Niederösterreich + Steiermark → Österreich). Aufstufen ist nie erlaubt.
//
// Die gespeicherten Codes der v1 (wein, wlnoe, thermenregion_*) bleiben unverändert – bestehende
// Daten brauchen keine Migration. Eigene Weinbaugebiete (weinbaugebiete_custom, Freitext) und
// „sonstiges“ liegen außerhalb des Baums: keine Abstufung, kein Sortenspiegel.
//
// Quellen (RIS, geltende Fassung, abgerufen 01.10.2026):
//  - Regionen und Gebiete: § 21 Abs. 2 und 3 Weingesetz 2009 (BGBl. I Nr. 111/2009 idF BGBl. I Nr. 91/2023);
//    Landwein § 9 Abs. 2, Qualitätswein § 10, Herkunftsangaben § 21 Abs. 6 und 7.
//  - Sortenspiegel: die DAC-Verordnungen (§ 34 Abs. 1 WeinG), Gesetzesnummer im RIS je Knoten (`quelle`).
//  - BKI-Kürzel: „Kürzelliste für Weinformulare“ der Bundeskellereiinspektion, Stand 01.10.2024.
// Sortenspiegel als BKI-Sortenkürzel (lib/wein/bki_kuerzel.ts) – Synonyme wie Morillon/Chardonnay oder
// Weißburgunder/Weißer Burgunder/Pinot Blanc treffen so dieselbe Sorte. Wo eine Verordnung Verschnitte
// aus den genannten Sorten erlaubt, ist der passende Sortenverschnitt (SW weiß, SO rot) zugelassen – dessen
// Zusammensetzung prüft die Software nicht.

import { bkiRebsorteKuerzel, HERKUNFT_BKI } from '@/lib/wein/bki_kuerzel'

export type HerkunftEbene = 'oesterreich' | 'landwein' | 'qualitaetswein' | 'dac_gebiet' | 'dac_ort' | 'dac_ried'

export type HerkunftKnoten = {
  code: string
  label: string
  /** Übergeordneter Code (eine Stufe breiter); null nur bei „wein“ (Österreich) */
  eltern: string | null
  ebene: HerkunftEbene
  /** Amtliches BKI-Herkunftskürzel (Datenblatt, Weindatenbank) */
  bki: string
  /** Weinbaugebiet bzw. Weinbauregion, z. B. „Kremstal“, „Niederösterreich“, „Weinland“ */
  gebiet: string
  /** Weinbauregion (Weinland, Steirerland, Bergland); null bei Österreich */
  region: 'Weinland' | 'Steirerland' | 'Bergland' | null
  /** Zulässige Rebsorten als BKI-Sortenkürzel; null = keine Einschränkung auf dieser Stufe */
  sorten: readonly string[] | null
  /** Rechtsgrundlage (RIS-Gesetzesnummer bzw. Paragraph) */
  quelle: string
}

const WEING = 'WeinG 2009 § 21'
const ris = (nr: string, vo: string) => `${vo}, RIS ${nr}`

// Sortenlisten (BKI-Kürzel) ──────────────────────────────────────────────────────────────────────────
const THERMEN_GEBIET = ['RG', 'ZF', 'WB', 'GR', 'CH', 'NB', 'BB', 'SL', 'BP', 'ZW', 'GW'] as const   // § 3 inkl. „Gemischter Satz“-Flächen
const THERMEN_ORT    = ['RG', 'ZF', 'WB', 'GR', 'CH', 'BB', 'SL', 'ZW'] as const                     // § 4
const THERMEN_RIED   = ['RG', 'ZF', 'WB', 'CH', 'BB', 'SL'] as const                                 // § 5
const GV_RR          = ['GV', 'RR'] as const                                                         // Kremstal, Traisental
const KAMPTAL        = ['GV', 'RR', 'CH', 'WB', 'GR', 'SW'] as const                                 // § 3 Z 1, sortenrein oder Cuvée
const WACHAU_GEBIET  = ['GV', 'RR', 'WB', 'GR', 'CH', 'NB', 'MU', 'SB', 'TR', 'FV', 'MT', 'MO', 'RV', 'GW', 'BB', 'SL', 'ZW'] as const
const WACHAU_ORT     = ['GV', 'RR', 'WB', 'GR', 'CH', 'NB', 'MU', 'SB', 'TR'] as const
const WAGRAM_GEBIET  = ['CH', 'FV', 'GR', 'GV', 'MU', 'RV', 'SB', 'TR', 'WB', 'RR', 'BB', 'SL', 'ZW', 'SW', 'SO', 'GW'] as const
const WAGRAM_ORT     = ['CH', 'GV', 'RV', 'WB', 'RR', 'BB', 'ZW'] as const                           // nur sortenrein
const WAGRAM_RIED    = ['GV', 'RV', 'RR'] as const
const CARNUNTUM      = ['CH', 'WB', 'GV', 'ZW', 'BF', 'SW', 'SO'] as const                           // Verschnitt mind. 2/3 aus diesen Sorten
const STMK_GEBIET    = ['WR', 'WB', 'CH', 'GR', 'RR', 'MU', 'SB', 'TR', 'SW'] as const               // § 2 Z 7, „sowie Verschnitte daraus“
// Ortswein: Leitsorten je Ort laut Anhang – der Ort ist nicht Teil des Codes, geprüft wird die
// Vereinigung aller Leitsorten des Gebiets (notwendige Bedingung).
const SUEDSTMK_ORT   = ['SB', 'RR', 'MU', 'CH'] as const
const VULKAN_ORT     = ['SB', 'WB', 'CH', 'TR', 'GR'] as const                                       // „Burgundercuvée“ (Tieschen) ist nicht definiert – offen
const WESTSTMK_ORT   = ['BW', 'SB'] as const

function k(
  code: string, label: string, eltern: string | null, ebene: HerkunftEbene, bki: string, gebiet: string,
  region: HerkunftKnoten['region'], sorten: readonly string[] | null, quelle: string,
): HerkunftKnoten {
  return { code, label, eltern, ebene, bki, gebiet, region, sorten, quelle }
}

/** Alle Herkunftsstufen, vom Breitesten zum Engsten je Ast (Reihenfolge = Auswahllisten). */
export const HERKUNFT_KATALOG: readonly HerkunftKnoten[] = [
  k('wein', 'Wein aus Österreich', null, 'oesterreich', 'OEST', 'Österreich', null, null, `${WEING} Abs. 1`),

  // ── Weinland (Burgenland, Niederösterreich, Wien) ──
  k('weinland', 'Landwein Weinland', 'wein', 'landwein', 'WLXX', 'Weinland', 'Weinland', null, `${WEING} Abs. 2 Z 1, § 9 Abs. 2`),
  k('wlnoe', 'Niederösterreich – Qualitätswein', 'weinland', 'qualitaetswein', 'WLNO', 'Niederösterreich', 'Weinland', null, `${WEING} Abs. 3 Z 1 lit. k`),
  k('weinviertel_dac', 'Weinviertel DAC', 'wlnoe', 'dac_gebiet', 'WLWV', 'Weinviertel', 'Weinland', ['GV'], ris('20006693', 'Weinviertel-DAC-VO')),
  k('kremstal_gebietswein', 'Kremstal DAC – Gebietswein', 'wlnoe', 'dac_gebiet', 'WLKT', 'Kremstal', 'Weinland', GV_RR, ris('20010006', 'Kremstal-DAC-VO')),
  k('kremstal_ortswein', 'Kremstal DAC – Ortswein', 'kremstal_gebietswein', 'dac_ort', 'WLKT', 'Kremstal', 'Weinland', GV_RR, ris('20010006', 'Kremstal-DAC-VO')),
  k('kremstal_riedenwein', 'Kremstal DAC – Riedenwein', 'kremstal_ortswein', 'dac_ried', 'WLKT', 'Kremstal', 'Weinland', GV_RR, ris('20010006', 'Kremstal-DAC-VO (Ried nur mit Ortsangabe)')),
  k('kamptal_gebietswein', 'Kamptal DAC – Gebietswein', 'wlnoe', 'dac_gebiet', 'WLKA', 'Kamptal', 'Weinland', KAMPTAL, ris('20012689', 'Kamptal-DAC-VO')),
  k('kamptal_ortswein', 'Kamptal DAC – Ortswein', 'kamptal_gebietswein', 'dac_ort', 'WLKA', 'Kamptal', 'Weinland', KAMPTAL, ris('20012689', 'Kamptal-DAC-VO')),
  k('kamptal_riedenwein', 'Kamptal DAC – Riedenwein', 'kamptal_ortswein', 'dac_ried', 'WLKA', 'Kamptal', 'Weinland', KAMPTAL, ris('20012689', 'Kamptal-DAC-VO')),
  k('traisental_gebietswein', 'Traisental DAC – Gebietswein', 'wlnoe', 'dac_gebiet', 'WLTT', 'Traisental', 'Weinland', GV_RR, ris('20010004', 'Traisental-DAC-VO')),
  k('traisental_ortswein', 'Traisental DAC – Ortswein', 'traisental_gebietswein', 'dac_ort', 'WLTT', 'Traisental', 'Weinland', GV_RR, ris('20010004', 'Traisental-DAC-VO')),
  k('traisental_riedenwein', 'Traisental DAC – Riedenwein', 'traisental_ortswein', 'dac_ried', 'WLTT', 'Traisental', 'Weinland', GV_RR, ris('20010004', 'Traisental-DAC-VO')),
  k('wachau_gebietswein', 'Wachau DAC – Gebietswein', 'wlnoe', 'dac_gebiet', 'WLWA', 'Wachau', 'Weinland', WACHAU_GEBIET, ris('20011163', 'Wachau-DAC-VO')),
  k('wachau_ortswein', 'Wachau DAC – Ortswein', 'wachau_gebietswein', 'dac_ort', 'WLWA', 'Wachau', 'Weinland', WACHAU_ORT, ris('20011163', 'Wachau-DAC-VO')),
  k('wachau_riedenwein', 'Wachau DAC – Riedenwein', 'wachau_ortswein', 'dac_ried', 'WLWA', 'Wachau', 'Weinland', GV_RR, ris('20011163', 'Wachau-DAC-VO')),
  k('wagram_gebietswein', 'Wagram DAC – Gebietswein', 'wlnoe', 'dac_gebiet', 'WLWG', 'Wagram', 'Weinland', WAGRAM_GEBIET, ris('20011803', 'Wagram-DAC-VO')),
  k('wagram_ortswein', 'Wagram DAC – Ortswein', 'wagram_gebietswein', 'dac_ort', 'WLWG', 'Wagram', 'Weinland', WAGRAM_ORT, ris('20011803', 'Wagram-DAC-VO')),
  k('wagram_riedenwein', 'Wagram DAC – Riedenwein', 'wagram_ortswein', 'dac_ried', 'WLWG', 'Wagram', 'Weinland', WAGRAM_RIED, ris('20011803', 'Wagram-DAC-VO')),
  k('carnuntum_gebietswein', 'Carnuntum DAC – Gebietswein', 'wlnoe', 'dac_gebiet', 'WLCA', 'Carnuntum', 'Weinland', CARNUNTUM, ris('20010766', 'Carnuntum-DAC-VO')),
  k('carnuntum_ortswein', 'Carnuntum DAC – Ortswein', 'carnuntum_gebietswein', 'dac_ort', 'WLCA', 'Carnuntum', 'Weinland', CARNUNTUM, ris('20010766', 'Carnuntum-DAC-VO')),
  k('carnuntum_riedenwein', 'Carnuntum DAC – Riedenwein', 'carnuntum_ortswein', 'dac_ried', 'WLCA', 'Carnuntum', 'Weinland', CARNUNTUM, ris('20010766', 'Carnuntum-DAC-VO')),
  k('thermenregion_gebietswein', 'Thermenregion DAC – Gebietswein', 'wlnoe', 'dac_gebiet', 'WLTH', 'Thermenregion', 'Weinland', THERMEN_GEBIET, ris('20012293', 'Thermenregion-DAC-VO')),
  k('thermenregion_ortswein', 'Thermenregion DAC – Ortswein', 'thermenregion_gebietswein', 'dac_ort', 'WLTH', 'Thermenregion', 'Weinland', THERMEN_ORT, ris('20012293', 'Thermenregion-DAC-VO')),
  k('thermenregion_riedenwein', 'Thermenregion DAC – Riedenwein', 'thermenregion_ortswein', 'dac_ried', 'WLTH', 'Thermenregion', 'Weinland', THERMEN_RIED, ris('20012293', 'Thermenregion-DAC-VO')),

  k('burgenland', 'Burgenland – Qualitätswein', 'weinland', 'qualitaetswein', 'WLBL', 'Burgenland', 'Weinland', null, `${WEING} Abs. 3 Z 1 lit. j`),
  // Neusiedlersee: Zweigelt; fruchtsüß/edelsüß alle weißen Qualitätsrebsorten – hängt am Prädikat, daher hier keine Sortenprüfung
  k('neusiedlersee_dac', 'Neusiedlersee DAC', 'burgenland', 'dac_gebiet', 'WLNS', 'Neusiedlersee', 'Weinland', null, ris('20011293', 'Neusiedlersee-DAC-VO')),
  k('leithaberg_dac', 'Leithaberg DAC', 'burgenland', 'dac_gebiet', 'WLLB', 'Leithaberg', 'Weinland', ['BF', 'WB', 'CH', 'NB', 'GV', 'SW'], ris('20006414', 'Leithaberg-DAC-VO')),
  k('mittelburgenland_dac', 'Mittelburgenland DAC', 'burgenland', 'dac_gebiet', 'WLMB', 'Mittelburgenland', 'Weinland', ['BF'], ris('20006694', 'Mittelburgenland-DAC-VO')),
  k('eisenberg_gebietswein', 'Eisenberg DAC – Gebietswein', 'burgenland', 'dac_gebiet', 'WLEB', 'Eisenberg', 'Weinland', ['BF'], ris('20012292', 'Eisenberg-DAC-VO')),
  k('eisenberg_ortswein', 'Eisenberg DAC – Ortswein', 'eisenberg_gebietswein', 'dac_ort', 'WLEB', 'Eisenberg', 'Weinland', ['BF', 'WR'], ris('20012292', 'Eisenberg-DAC-VO')),
  k('eisenberg_riedenwein', 'Eisenberg DAC – Riedenwein', 'eisenberg_ortswein', 'dac_ried', 'WLEB', 'Eisenberg', 'Weinland', ['BF', 'WR'], ris('20012292', 'Eisenberg-DAC-VO')),
  // Rosalia DAC: Blaufränkisch oder Zweigelt; „Rosalia DAC Rosé“ aus roten Qualitätsrebsorten (Sortenverschnitt Rosé)
  k('rosalia_dac', 'Rosalia DAC', 'burgenland', 'dac_gebiet', 'WLRO', 'Rosalia', 'Weinland', ['BF', 'ZW', 'SR'], ris('20010167', 'Rosalia-DAC-VO')),
  // Ruster Ausbruch: weiße Qualitätsrebsorten, Anforderungen einer Trockenbeerenauslese – hängt am Prädikat
  k('ruster_ausbruch_dac', 'Ruster Ausbruch DAC', 'burgenland', 'dac_gebiet', 'WLRU', 'Ruster Ausbruch', 'Weinland', null, ris('20011292', 'Ruster-Ausbruch-DAC-VO')),

  k('wien', 'Wien – Qualitätswein', 'weinland', 'qualitaetswein', 'WIEN', 'Wien', 'Weinland', null, `${WEING} Abs. 3 Z 1 lit. i`),
  // Wiener Gemischter Satz: mind. 3 weiße Qualitätsrebsorten aus einem Gemischten-Satz-Weingarten (BKI GW)
  k('wiener_gemischter_satz_dac', 'Wiener Gemischter Satz DAC', 'wien', 'dac_gebiet', 'WIEN', 'Wien', 'Weinland', ['GW'], ris('20008544', 'Wiener-Gemischter-Satz-DAC-VO')),

  // ── Steirerland (Steiermark) ──
  k('steirerland', 'Landwein Steirerland', 'wein', 'landwein', 'SLXX', 'Steirerland', 'Steirerland', null, `${WEING} Abs. 2 Z 3, § 9 Abs. 2`),
  k('steiermark', 'Steiermark – Qualitätswein', 'steirerland', 'qualitaetswein', 'SLST', 'Steiermark', 'Steirerland', null, `${WEING} Abs. 3 Z 3`),
  // Steiermark: Riedenwein hängt am Gebietswein (Rieden auch außerhalb der Ortsgebiete, § 9 Abs. 7), Sorten wie Gebietswein (§ 9)
  k('suedsteiermark_gebietswein', 'Südsteiermark DAC – Gebietswein', 'steiermark', 'dac_gebiet', 'SLSS', 'Südsteiermark', 'Steirerland', STMK_GEBIET, ris('20010438', 'Südsteiermark-DAC-VO')),
  k('suedsteiermark_ortswein', 'Südsteiermark DAC – Ortswein', 'suedsteiermark_gebietswein', 'dac_ort', 'SLSS', 'Südsteiermark', 'Steirerland', SUEDSTMK_ORT, ris('20010438', 'Südsteiermark-DAC-VO, Anhang Leitsorten')),
  k('suedsteiermark_riedenwein', 'Südsteiermark DAC – Riedenwein', 'suedsteiermark_gebietswein', 'dac_ried', 'SLSS', 'Südsteiermark', 'Steirerland', STMK_GEBIET, ris('20010438', 'Südsteiermark-DAC-VO § 9')),
  k('vulkanland_gebietswein', 'Vulkanland Steiermark DAC – Gebietswein', 'steiermark', 'dac_gebiet', 'SLVL', 'Vulkanland Steiermark', 'Steirerland', STMK_GEBIET, ris('20010439', 'Vulkanland-Steiermark-DAC-VO')),
  k('vulkanland_ortswein', 'Vulkanland Steiermark DAC – Ortswein', 'vulkanland_gebietswein', 'dac_ort', 'SLVL', 'Vulkanland Steiermark', 'Steirerland', VULKAN_ORT, ris('20010439', 'Vulkanland-Steiermark-DAC-VO, Anhang Leitsorten')),
  k('vulkanland_riedenwein', 'Vulkanland Steiermark DAC – Riedenwein', 'vulkanland_gebietswein', 'dac_ried', 'SLVL', 'Vulkanland Steiermark', 'Steirerland', STMK_GEBIET, ris('20010439', 'Vulkanland-Steiermark-DAC-VO § 9')),
  k('weststeiermark_gebietswein', 'Weststeiermark DAC – Gebietswein', 'steiermark', 'dac_gebiet', 'SLWS', 'Weststeiermark', 'Steirerland', ['BW', ...STMK_GEBIET], ris('20010440', 'Weststeiermark-DAC-VO')),
  k('weststeiermark_ortswein', 'Weststeiermark DAC – Ortswein', 'weststeiermark_gebietswein', 'dac_ort', 'SLWS', 'Weststeiermark', 'Steirerland', WESTSTMK_ORT, ris('20010440', 'Weststeiermark-DAC-VO, Anhang Leitsorten')),
  k('weststeiermark_riedenwein', 'Weststeiermark DAC – Riedenwein', 'weststeiermark_gebietswein', 'dac_ried', 'SLWS', 'Weststeiermark', 'Steirerland', ['BW', ...STMK_GEBIET], ris('20010440', 'Weststeiermark-DAC-VO § 9')),

  // ── Bergland (Kärnten, Oberösterreich, Salzburg, Tirol, Vorarlberg) – keine DAC ──
  k('bergland', 'Landwein Bergland', 'wein', 'landwein', 'BLXX', 'Bergland', 'Bergland', null, `${WEING} Abs. 2 Z 2, § 9 Abs. 2`),
  k('kaernten', 'Kärnten – Qualitätswein', 'bergland', 'qualitaetswein', 'BLKA', 'Kärnten', 'Bergland', null, `${WEING} Abs. 3 Z 2`),
  k('oberoesterreich', 'Oberösterreich – Qualitätswein', 'bergland', 'qualitaetswein', 'BLOO', 'Oberösterreich', 'Bergland', null, `${WEING} Abs. 3 Z 2`),
  k('salzburg', 'Salzburg – Qualitätswein', 'bergland', 'qualitaetswein', 'BLSB', 'Salzburg', 'Bergland', null, `${WEING} Abs. 3 Z 2`),
  k('tirol', 'Tirol – Qualitätswein', 'bergland', 'qualitaetswein', 'BLTI', 'Tirol', 'Bergland', null, `${WEING} Abs. 3 Z 2`),
  k('vorarlberg', 'Vorarlberg – Qualitätswein', 'bergland', 'qualitaetswein', 'BLVO', 'Vorarlberg', 'Bergland', null, `${WEING} Abs. 3 Z 2`),
]

const KNOTEN = new Map(HERKUNFT_KATALOG.map(n => [n.code, n]))

/** Alle Codes des Baums in Katalog-Reihenfolge (Auswahllisten, Tests). */
export const HERKUNFT_ORDER: readonly string[] = HERKUNFT_KATALOG.map(n => n.code)

export type HerkunftCode = string | null

export const HERKUNFT_LABEL: Record<string, string> = {
  ...Object.fromEntries(HERKUNFT_KATALOG.map(n => [n.code, n.label])),
  sonstiges: 'Sonstiges',
}

/** Katalogeintrag zu einem Code (undefined bei eigenen Weinbaugebieten, „sonstiges“, leer). */
export function herkunftKnoten(code: string | null | undefined): HerkunftKnoten | undefined {
  return code ? KNOTEN.get(code) : undefined
}

/** Weinbaugebiet (bzw. Region) eines Codes, z. B. „Kremstal“ – null außerhalb des Katalogs. */
export function herkunftGebiet(code: string | null | undefined): string | null {
  return herkunftKnoten(code)?.gebiet ?? null
}

function gebietSchluessel(s: string): string {
  return s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')
}
let breitesterJeKuerzel: Map<string, HerkunftKnoten> | null = null
let breitesterJeGebiet: Map<string, HerkunftKnoten> | null = null

/**
 * Wie herkunftKnoten, aber auch für Werte außerhalb des Katalogs, die ein Gebiet eindeutig nennen (KAN-165):
 * ein BKI-Herkunftskürzel („WLTH“, z. B. als eigenes Weinbaugebiet angelegt) oder der Name eines Gebiets
 * („Kremstal“, Freitext an Ried bzw. Lage) → die breiteste Stufe dieses Gebiets (Gebietswein bzw. DAC).
 */
export function herkunftKnotenTolerant(wert: string | null | undefined): HerkunftKnoten | undefined {
  const roh = typeof wert === 'string' ? wert.trim() : ''
  if (!roh) return undefined
  const direkt = KNOTEN.get(roh)
  if (direkt) return direkt
  if (!breitesterJeKuerzel || !breitesterJeGebiet) {
    breitesterJeKuerzel = new Map()
    breitesterJeGebiet = new Map()
    for (const n of HERKUNFT_KATALOG) {   // Katalog-Reihenfolge: je Ast zuerst die breiteste Stufe
      if (!breitesterJeKuerzel.has(n.bki)) breitesterJeKuerzel.set(n.bki, n)
      const g = gebietSchluessel(n.gebiet)
      if (!breitesterJeGebiet.has(g)) breitesterJeGebiet.set(g, n)
    }
    // Bezeichnungen der BKI-Kürzelliste („Österreich“, „Niederösterreich“) zusätzlich über das Kürzel
    for (const [name, kuerzel] of Object.entries(HERKUNFT_BKI)) {
      const n = breitesterJeKuerzel.get(kuerzel)
      if (n && !breitesterJeGebiet.has(gebietSchluessel(name))) breitesterJeGebiet.set(gebietSchluessel(name), n)
    }
  }
  return breitesterJeKuerzel.get(roh.toUpperCase()) ?? breitesterJeGebiet.get(gebietSchluessel(roh))
}

/**
 * Bundesland-Gebiet einer Herkunft (KAN-165, Entscheidung Jörgen 01.10.2026): Niederösterreich, Burgenland, Wien,
 * Steiermark bzw. das Bergland-Bundesland – die Qualitätswein-Stufe des Asts. Geografisch immer richtig, auch wenn
 * der Code abgestuft ist (ein Grüner Veltliner der Thermenregion steht auf „wlnoe“). Gliederung der Erntemeldung.
 * null bei Österreich bzw. Landwein (mehrere Bundesländer) und bei Werten außerhalb des Katalogs.
 */
export function herkunftBundesland(wert: string | null | undefined): string | null {
  for (const c of herkunftKette(herkunftKnotenTolerant(wert)?.code)) {
    const n = KNOTEN.get(c)
    if (n?.ebene === 'qualitaetswein') return n.gebiet
  }
  return null
}

/** Genauestes Gebiet einer Herkunft (z. B. „Kremstal“, „Thermenregion“, „Niederösterreich“) – auch tolerant. */
export function herkunftGebietTolerant(wert: string | null | undefined): string | null {
  return herkunftKnotenTolerant(wert)?.gebiet ?? null
}

/** Auswahlgruppen für Formulare: Österreich, dann je Weinbauregion. */
export const HERKUNFT_GRUPPEN: readonly { label: string; codes: readonly string[] }[] = [
  { label: 'Österreich', codes: HERKUNFT_KATALOG.filter(n => n.region === null).map(n => n.code) },
  ...(['Weinland', 'Steirerland', 'Bergland'] as const).map(r => ({
    label: r === 'Weinland' ? 'Weinland (Niederösterreich, Burgenland, Wien)' : r === 'Steirerland' ? 'Steirerland (Steiermark)' : 'Bergland',
    codes: HERKUNFT_KATALOG.filter(n => n.region === r).map(n => n.code),
  })),
]

/** Auswahl-Optionen samt Gruppe (Weinbauregion) – optional auf bestimmte Codes beschränkt (Abstufung). */
export function herkunftOptionen(nur?: readonly string[]): { value: string; label: string; gruppe: string }[] {
  const erlaubt = nur ? new Set(nur) : null
  return HERKUNFT_GRUPPEN.flatMap(g => g.codes
    .filter(c => !erlaubt || erlaubt.has(c))
    .map(c => ({ value: c, label: HERKUNFT_LABEL[c], gruppe: g.label })))
}

/** Der Code selbst und alle übergeordneten Stufen, vom Engsten zum Breitesten. Leer außerhalb des Katalogs. */
export function herkunftKette(code: string | null | undefined): string[] {
  const kette: string[] = []
  let n = herkunftKnoten(code)
  while (n) { kette.push(n.code); n = n.eltern ? KNOTEN.get(n.eltern) : undefined }
  return kette
}

/** Prüft ob eine Rebsorte auf der gegebenen Herkunftsstufe laut Sortenspiegel zulässig ist. */
export function istRebsorteZulaessig(code: string | null | undefined, rebsorte: string | null | undefined): boolean {
  const n = herkunftKnoten(code)
  if (!n || n.sorten === null) return true        // außerhalb des Katalogs bzw. keine Einschränkung
  if (!rebsorte) return true                       // Rebsorte (noch) unbekannt → nicht blockieren
  const kuerzel = bkiRebsorteKuerzel(rebsorte)
  return !!kuerzel && n.sorten.includes(kuerzel)
}

/** Gemeinsamer Oberbegriff aller übergebenen Herkünfte (Abstufung beim Verschneiden bzw. Pressen):
 *  engste Stufe, die alle enthält. Eigene Weinbaugebiete, „sonstiges“ und leere Werte zählen nicht. */
export function minHerkunft(codes: (string | null | undefined)[]): string | null {
  let gemeinsam: string[] | null = null
  for (const c of codes) {
    const kette = herkunftKette(c)
    if (kette.length === 0) continue
    gemeinsam = gemeinsam === null ? kette : gemeinsam.filter(x => kette.includes(x))
  }
  return gemeinsam?.[0] ?? null
}

/** Engste der übergebenen Herkünfte (für „abgestuft von X auf Y“-Meldungen): größte Tiefe im Baum. */
export function maxHerkunft(codes: (string | null | undefined)[]): string | null {
  let best: string | null = null
  let bestTiefe = -1
  for (const c of codes) {
    const tiefe = herkunftKette(c).length
    if (tiefe > bestTiefe) { bestTiefe = tiefe; best = c ?? null }
  }
  return bestTiefe > 0 ? best : null
}

/** Ist `a` eine echte übergeordnete (breitere) Stufe von `b`? Nur dann ist b → a eine Abstufung. */
export function istNiedrigerAls(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a === b) return false
  return herkunftKette(b).includes(a)
}

/** Sucht ausgehend von `code` nach oben die engste Herkunftsstufe, auf der `rebsorte` laut
 *  Sortenspiegel zulässig ist (automatische Abstufung bei Sortenspiegel-Verstoß).
 *  Gibt den ursprünglichen Code zurück, falls er bereits zulässig ist oder die Rebsorte unbekannt ist. */
export function findePassendeHerkunftsstufe(
  code: string | null | undefined,
  rebsorte: string | null | undefined,
): { code: string | null; abgestuft: boolean } {
  if (!code || !rebsorte || !herkunftKnoten(code)) return { code: code ?? null, abgestuft: false }
  for (const kandidat of herkunftKette(code)) {
    if (istRebsorteZulaessig(kandidat, rebsorte)) return { code: kandidat, abgestuft: kandidat !== code }
  }
  return { code: 'wein', abgestuft: true }   // „wein“ hat keine Einschränkung – nur zur Sicherheit
}

/**
 * KAN-111 (04.10.2026): Herkünfte, die ein Erzeugnis aus einer Charge mit der Herkunft `charge` tragen darf (Füllung):
 * die Herkunft selbst und alle breiteren Stufen im Baum – keine Aufstufung und kein Wechsel in einen anderen Ast
 * (Kremstal → Kamptal). Eigenes Weinbaugebiet: über herkunftKnotenTolerant, sonst nur es selbst und „Wein aus
 * Österreich“. Ohne Herkunft der Charge: null (keine Einschränkung).
 */
export function zulaessigeHerkuenfte(charge: string | null | undefined): string[] | null {
  const roh = typeof charge === 'string' ? charge.trim() : ''
  if (!roh) return null
  const k = herkunftKnotenTolerant(roh)
  return [...new Set([roh, ...(k ? herkunftKette(k.code) : ['wein'])])]
}

/** KAN-111: Darf `wahl` aus einer Charge mit der Herkunft `charge` gewählt werden? Leere Wahl ist immer zulässig. */
export function herkunftZulaessig(charge: string | null | undefined, wahl: string | null | undefined): boolean {
  const w = typeof wahl === 'string' ? wahl.trim() : ''
  if (!w) return true
  const z = zulaessigeHerkuenfte(charge)
  return !z || z.includes(w)
}
