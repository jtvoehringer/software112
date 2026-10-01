// ── Flächenverzeichnis (Rieden & Grundstücke) – Zeilen und CSV-Spalten (24.09.2026) ─────
//
// Grundlage für den AMA-Mehrfachantrag (eAMA) und Meldungen an den Weinbaukataster:
// eine Zeile je Grundstück (GST); Weingarten-Datensätze ohne eigene Grundstücke bekommen
// trotzdem eine eigene Zeile, sonst fehlten sie (Rückmeldung 24.8.2026). Reihenfolge wie
// in der Rieden-Übersicht (/weingarten): Ried, Name, darin GST-Nr. numerisch.
//
// Diese Datei rechnet nur (keine Datenbank, kein 'server-only') – die Ladefunktion für
// Seite UND CSV steht in ./flaechenverzeichnis.ts. scripts/tests/flaechenverzeichnis.test.mjs
// prüft Zeilen und Spalten ohne Datenbank.
//
// Werte je Grundstück, mit Rückfall auf den Weingarten-Datensatz, wo das Merkmal dort
// gepflegt wird: Weinart (GST, sonst Weingarten), Bewirtschaftung (GST, sonst Weingarten).
// Rebsorte und Pflanzjahr nur vom Grundstück (Brachen/GLÖZ-Flächen haben keine Sorte).

import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { getKgBezeichnung } from '@/lib/wein/katastralgemeinden'

/** Weingarten-Datensatz (Ried) wie ihn Seite und CSV laden – passt zu WRow in WeingartenBaum */
export type RiedStamm = {
  id: string
  name: string
  ried: string | null
  rebsorte: string | null
  weinart: string | null
  flaeche_ha: number | null
  bewirtschaftung: string | null
  aktiv: boolean
  ama_feldnummer: string | null
  codes: string | null
  interne_bezeichnung: string | null
  pflanzjahr: number | null
  zentrum_lat: number | null
  zentrum_lon: number | null
}

/** Grundstück wie es Seite und CSV laden – passt zu GSTRow in WeingartenBaum */
export type GstStamm = {
  id: string
  weingarten_id: string
  gst_nr: string
  rebsorte: string | null
  flaeche_ha: number | null
  flaeche_ha_kataster: number | null
  spritzbar: boolean
  katastralgemeinde: string | null
  kg_bezeichnung: string | null
  einlagezahl: string | null
  nutzart: string | null
  lse_stueckzahl: number | null
  ama_feldnummer: string | null
  pflanzjahr: number | null
  unterlagsrebe: string | null
  rechtsverhaeltnis: string | null
  weinart: string | null
  bewirtschaftung: string | null
  /** KAN-150: Grundstück deaktiviert (nicht mehr bewirtschaftet) ab deaktiviert_am */
  aktiv: boolean
  deaktiviert_am: string | null
}

/** Eine Zeile des Flächenverzeichnisses – Flächen bereits auf 4 Stellen gerundet */
export type FlaechenZeile = {
  ried: string | null
  interneBezeichnung: string | null
  amaFeldstueck: string | null
  codes: string | null
  kgNr: string | null
  katastralgemeinde: string | null
  gstNr: string | null
  einlagezahl: string | null
  amaSchlag: string | null
  rebsorte: string | null
  kuerzel: string | null
  nutzart: string | null
  nutzung: string | null
  lseStueck: number | null
  weinart: string | null
  bewirtschaftung: string | null
  pflanzjahr: number | null
  unterlagsrebe: string | null
  rechtsverhaeltnis: string | null
  flaecheKatasterHa: number | null
  flaecheAmaHa: number | null
  /** Weingarten und Grundstück aktiv – leer bei Grundstücken ohne Ried (KAN-150: auch das Grundstück) */
  aktiv: boolean | null
  /** KAN-150: Grundstück deaktiviert ab (JJJJ-MM-TT) */
  deaktiviertAm: string | null
}

export const WEINART_LABEL: Record<string, string> = { rot: 'Rot', weiss: 'Weiß', rose: 'Rosé' }

export const RECHTSVERHAELTNIS_LABEL: Record<string, string> = { eigentum: 'Eigentum', pacht: 'Pacht', nutzung: 'Nutzung' }

/** Spalten der CSV. Die bisherigen Spalten des Rieden-Exports behalten Namen und Reihenfolge;
 *  neu sind KG-Nr., Katastralgemeinde, Einlagezahl, LSE, Pflanzjahr, Unterlagsrebe und
 *  Rechtsverhältnis (Angaben für Mehrfachantrag und Weinbaukataster). */
export const SPALTEN_FLAECHENVERZEICHNIS: CsvSpalte<FlaechenZeile>[] = [
  { kopf: 'Ried / Lage', typ: 'text', wert: z => z.ried },
  { kopf: 'Interne Bezeichnung', typ: 'text', wert: z => z.interneBezeichnung },
  { kopf: 'AMA-Feldstücknr.', typ: 'code', wert: z => z.amaFeldstueck },
  { kopf: 'Codes', typ: 'code', wert: z => z.codes },
  { kopf: 'KG-Nr.', typ: 'code', wert: z => z.kgNr },
  { kopf: 'Katastralgemeinde', typ: 'text', wert: z => z.katastralgemeinde },
  { kopf: 'GST-Nr', typ: 'code', wert: z => z.gstNr },
  { kopf: 'Einlagezahl (EZ)', typ: 'code', wert: z => z.einlagezahl },
  { kopf: 'AMA-Schlagnr.', typ: 'code', wert: z => z.amaSchlag },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Nutzart', typ: 'code', wert: z => z.nutzart },
  { kopf: 'Nutzung', typ: 'text', wert: z => z.nutzung },
  { kopf: 'LSE (Stk.)', typ: 'ganzzahl', stellen: STELLEN.ganzzahl, wert: z => z.lseStueck },
  { kopf: 'Weinart', typ: 'text', wert: z => z.weinart },
  { kopf: 'Bewirtschaftung', typ: 'text', wert: z => z.bewirtschaftung },
  { kopf: 'Pflanzjahr', typ: 'ganzzahl', stellen: STELLEN.ganzzahl, wert: z => z.pflanzjahr },
  { kopf: 'Unterlagsrebe', typ: 'text', wert: z => z.unterlagsrebe },
  { kopf: 'Rechtsverhältnis', typ: 'text', wert: z => z.rechtsverhaeltnis },
  { kopf: 'GST-Fläche lt. Kataster (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheKatasterHa },
  { kopf: 'GST-Fläche lt. AMA (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheAmaHa },
  { kopf: 'Aktiv', typ: 'janein', wert: z => z.aktiv },
  { kopf: 'Deaktiviert ab', typ: 'datum', wert: z => z.deaktiviertAm },
]

/** Hektar auf die feste Stellenzahl der Spalte (4) – Seite und CSV rechnen mit denselben Werten */
export function hektar(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? runden(n, STELLEN.ha) : null
}

function text(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t === '' ? null : t
}

const gstSortierung = (a: GstStamm, b: GstStamm) => a.gst_nr.localeCompare(b.gst_nr, 'de', { numeric: true })

function beispiele(liste: string[]): string {
  return liste.slice(0, 5).join(', ') + (liste.length > 5 ? ' …' : '')
}

/**
 * Zeilen des Flächenverzeichnisses. `nutzungLabel` liefert die Bezeichnung zur Nutzart
 * (NUTZART_OPTIONS aus lib/wein/grundstueckStatus – als Parameter, damit diese Datei ohne
 * React-Modul testbar bleibt). Liefert zusätzlich Hinweise für X-Warnungen.
 */
export function flaechenZeilen(
  weingaerten: readonly RiedStamm[],
  grundstuecke: readonly GstStamm[],
  nutzungLabel: (nutzart: string | null) => string | null,
): { zeilen: FlaechenZeile[]; warnungen: string[] } {
  const gstMap = new Map<string, GstStamm[]>()
  for (const g of grundstuecke) {
    const arr = gstMap.get(g.weingarten_id) ?? []
    arr.push(g)
    gstMap.set(g.weingarten_id, arr)
  }

  const zeilen: FlaechenZeile[] = []
  const ohneKg: string[] = []

  const gstZeile = (w: RiedStamm | null, g: GstStamm): FlaechenZeile => {
    const kgNr = text(g.katastralgemeinde)
    const gstWeinart = g.weinart && WEINART_LABEL[g.weinart] ? g.weinart : null
    const weinart = gstWeinart ?? w?.weinart ?? null
    const rv = text(g.rechtsverhaeltnis)
    return {
      ried: w ? (w.ried ?? w.name) : null,
      interneBezeichnung: text(w?.interne_bezeichnung),
      amaFeldstueck: text(w?.ama_feldnummer),
      codes: text(w?.codes),
      kgNr,
      katastralgemeinde: text(g.kg_bezeichnung) ?? (kgNr ? getKgBezeichnung(kgNr) ?? null : null),
      gstNr: text(g.gst_nr),
      einlagezahl: text(g.einlagezahl),
      amaSchlag: text(g.ama_feldnummer),
      rebsorte: text(g.rebsorte),
      kuerzel: bkiRebsorteKuerzel(text(g.rebsorte)),
      nutzart: text(g.nutzart),
      nutzung: nutzungLabel(g.nutzart),
      lseStueck: g.nutzart === 'LSE' ? g.lse_stueckzahl ?? null : null,
      weinart: weinart ? WEINART_LABEL[weinart] ?? null : null,
      bewirtschaftung: text(g.bewirtschaftung) ?? text(w?.bewirtschaftung),
      pflanzjahr: g.pflanzjahr ?? null,
      unterlagsrebe: text(g.unterlagsrebe),
      rechtsverhaeltnis: rv ? RECHTSVERHAELTNIS_LABEL[rv] ?? rv : null,
      flaecheKatasterHa: hektar(g.flaeche_ha_kataster),
      flaecheAmaHa: hektar(g.flaeche_ha),
      aktiv: w ? w.aktiv && g.aktiv !== false : (g.aktiv === false ? false : null),
      deaktiviertAm: g.aktiv === false ? text(g.deaktiviert_am) : null,
    }
  }

  const ids = new Set<string>()
  for (const w of weingaerten) {
    ids.add(w.id)
    const gsts = [...(gstMap.get(w.id) ?? [])].sort(gstSortierung)
    if (gsts.length > 0) {
      for (const g of gsts) {
        zeilen.push(gstZeile(w, g))
        if (w.aktiv && g.aktiv !== false && !text(g.katastralgemeinde)) ohneKg.push(`GST ${g.gst_nr} (${w.ried ?? w.name})`)
      }
    } else {
      // Weingarten-Datensatz ohne eigene Grundstücke: Felder auf Ried-/Weingarten-Ebene,
      // GST-spezifische Spalten bleiben leer.
      zeilen.push({
        ried: w.ried ?? w.name,
        interneBezeichnung: text(w.interne_bezeichnung),
        amaFeldstueck: text(w.ama_feldnummer),
        codes: text(w.codes),
        kgNr: null,
        katastralgemeinde: null,
        gstNr: null,
        einlagezahl: null,
        amaSchlag: null,
        rebsorte: text(w.rebsorte),
        kuerzel: bkiRebsorteKuerzel(text(w.rebsorte)),
        nutzart: null,
        nutzung: null,
        lseStueck: null,
        weinart: w.weinart ? WEINART_LABEL[w.weinart] ?? null : null,
        bewirtschaftung: text(w.bewirtschaftung),
        pflanzjahr: w.pflanzjahr ?? null,
        unterlagsrebe: null,
        rechtsverhaeltnis: null,
        flaecheKatasterHa: null,
        flaecheAmaHa: hektar(w.flaeche_ha),
        aktiv: w.aktiv,
        deaktiviertAm: null,
      })
    }
  }

  // Grundstücke ohne (sichtbaren) Weingarten-Datensatz: nicht still weglassen
  const waisen = grundstuecke.filter(g => !ids.has(g.weingarten_id)).sort(gstSortierung)
  for (const g of waisen) zeilen.push(gstZeile(null, g))

  const warnungen: string[] = []
  if (waisen.length > 0) {
    warnungen.push(`${waisen.length} ${waisen.length === 1 ? 'Grundstück ist' : 'Grundstücke sind'} keiner Ried zugeordnet und stehen ohne Ried-Angaben am Ende (${beispiele(waisen.map(g => `GST ${g.gst_nr}`))}).`)
  }
  if (ohneKg.length > 0) {
    warnungen.push(`${ohneKg.length} aktive ${ohneKg.length === 1 ? 'Grundstück' : 'Grundstücke'} ohne KG-Nr. – die GST-Nr. ist nur zusammen mit der KG-Nr. eindeutig: ${beispiele(ohneKg)}.`)
  }
  const ohneKuerzel = [...new Set(
    [...grundstuecke.map(g => g.rebsorte), ...weingaerten.filter(w => !gstMap.has(w.id)).map(w => w.rebsorte)]
      .map(s => text(s))
      .filter((s): s is string => s !== null && !bkiRebsorteKuerzel(s)),
  )].sort((a, b) => a.localeCompare(b, 'de'))
  if (ohneKuerzel.length > 0) {
    warnungen.push(`Kein amtliches BKI-Kürzel für ${ohneKuerzel.length === 1 ? 'die Rebsorte' : `${ohneKuerzel.length} Rebsorten`} ${beispiele(ohneKuerzel)} – Spalte „BKI-Kürzel“ bleibt dort leer (KAN-36: keine Ersatzkürzel). Schreibweise am Grundstück bzw. Weingarten prüfen.`)
  }

  return { zeilen, warnungen }
}
