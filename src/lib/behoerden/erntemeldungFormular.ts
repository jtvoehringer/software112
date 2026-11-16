// ── Weinerntemeldung im Aufbau des BKI-Formulars „Erntemeldung“ (KAN-472, BKI-Sitzung 16.11.2026) ──────────────────
//
// Vorgabe: Die Menge wird in LITERN ausgewiesen und ist immer 75 % der Traubenmenge (kg × 0,75) – für selbst
// verarbeitete wie für verkaufte Trauben. Das Formular hat je Rebsorte UND Qualitätsstufe eine Zeile mit
// „Selbsteingefüllter Wein in Liter“, „Verkaufte Trauben (kg × 0,75 = Liter)“ und „Summe in Liter“, darunter die
// Flächen in ha/ar, die Summen (Wein ohne Sorte getrennt nach weiß und rot/rosé) und die Beitragserklärung
// gem. §§ 21a ff AMA-Gesetz (nur über 3.000 Liter).
//
// Reine Rechnung ohne Datenbank (isomorph; Tests laden sie über die Hooks des Testgerüsts). Druckseite und CSV zeigen dieselben
// gerundeten Zeilenwerte; Summen addieren die gerundeten Zeilen.

import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { bkiFarbe, bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { mischen } from '@/lib/wein/mostgewicht'
import { katalogQualitaet } from '@/lib/katalog/bki'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { rund2 } from '@/lib/zahl/runden'

/** Liter Wein je kg Trauben laut Formular („kg × 0,75 = Liter“) – Vorgabe BKI, nicht je Betrieb änderbar */
export const LITER_JE_KG = 0.75
/** Beitragssatz gem. §§ 21a ff AMA-Gesetz in € je 100 Liter (Formular St. Dr. Lager-Nr. 155) */
export const AMA_BEITRAG_EUR_JE_100_L = 1.1
/** Beitragspflicht erst über dieser Erntemenge (Liter) */
export const AMA_BEITRAG_FREIGRENZE_L = 3000

export const REBSORTE_OHNE = 'Unbekannt'

/** Block des Formulars: Rebsorten-, Land-, Qualitäts- und Prädikatswein bzw. Wein ohne Sorte und Jahrgang */
export type FormularBlock = 'rlqp' | 'wein'

export type FormularLese = {
  rebsorte: string | null
  qualitaetsstufe: string | null
  mengeKg: number | null
  /** °KMW der Lese (für das mengengewichtete Mittel je Zeile) */
  kmw: number | null
  /** Schlüssel der Fläche (Grundstück, sonst Ried) – zählt je Zeile und je Block nur einmal */
  flaechenKey: string
  flaecheHa: number | null
}

export type FormularVerkauf = { rebsorte: string | null; qualitaetsstufe: string | null; mengeKg: number | null }

export type FormularZeile = {
  rebsorte: string
  kuerzel: string | null
  qualitaetsstufe: string | null
  /** Kürzel der Stufe wie am Formular: RSW, LDW, QUW, KAB … (null = ohne Stufe erfasst) */
  stufeKuerzel: string | null
  block: FormularBlock
  farbe: 'weiss' | 'rot' | null
  flaecheHa: number | null
  mengeKg: number
  verkauftKg: number
  /** (kg − verkaufte kg) × 0,75, ganze Liter */
  selbstLiter: number
  /** verkaufte kg × 0,75, ganze Liter */
  verkauftLiter: number
  /** Summe der beiden gerundeten Werte */
  summeLiter: number
  kmw: number | null
  oechsle: number | null
}

export type HaAr = { ha: number; ar: number }

export type ErnteFormular = {
  zeilen: FormularZeile[]
  /** Rebsorten-, Land-, Qualitäts- und Prädikatswein */
  rlqp: { flaeche: HaAr; liter: number }
  /** Wein ohne Sorte und Jahrgang (und Sturm) */
  wein: { flaeche: HaAr; liter: number; weissLiter: number; rotLiter: number }
  /** gesamte bewirtschaftete Weingartenfläche des Betriebs */
  betrieb: HaAr
  beitrag: { pflichtig: boolean; mengeLiter: number; satz: number; betrag: number }
  /** keine Ernte = Leermeldung */
  leer: boolean
  warnungen: string[]
}

/** Fläche in ha und ar (1 ha = 100 ar), ar kaufmännisch auf ganze ar */
export function haAr(ha: number | null | undefined): HaAr {
  const ar = runden((ha ?? 0) * 100, 0)
  return { ha: Math.floor(ar / 100), ar: ar % 100 }
}

/** Liter laut Formular: kg × 0,75, auf ganze Liter */
export function literAusKg(kg: number): number {
  return runden(kg * LITER_JE_KG, 0)
}

/**
 * Kürzel der Qualitätsstufe wie am Formular. „Wein“ mit Rebsorte ist Rebsortenwein (RSW) und gehört in den oberen
 * Block; ohne Rebsorte bleibt es Wein ohne Sorte und Jahrgang (unterer Block).
 */
export function formularStufe(stufe: string | null, rebsorteBekannt: boolean): { kuerzel: string | null; block: FormularBlock } {
  if (stufe === 'wein' || !stufe) {
    if (rebsorteBekannt) return { kuerzel: stufe ? 'RSW' : null, block: 'rlqp' }
    return { kuerzel: stufe ? 'WEI' : null, block: 'wein' }
  }
  return { kuerzel: katalogQualitaet(stufe)?.code ?? null, block: 'rlqp' }
}

/** Beitragserklärung: Menge = Summe beider Blöcke; pflichtig nur über 3.000 Liter; Betrag = Menge ÷ 100 × Satz */
export function amaBeitrag(mengeLiter: number, satz: number = AMA_BEITRAG_EUR_JE_100_L): ErnteFormular['beitrag'] {
  const pflichtig = mengeLiter > AMA_BEITRAG_FREIGRENZE_L
  return { pflichtig, mengeLiter, satz, betrag: pflichtig ? rund2((mengeLiter / 100) * satz) : 0 }
}

const sorteVon = (r: string | null | undefined) => r?.trim() || REBSORTE_OHNE
const zeilenKey = (sorte: string, stufe: string | null) => `${sorte}\u0000${stufe ?? ''}`

/**
 * Formular aus den Lesedaten (bis zum Stichtag, ohne stornierte) und den Traubenverkäufen aus eigener Ernte.
 * Ein Verkauf zählt in der Zeile seiner Rebsorte und Qualitätsstufe; gibt es die nicht, in den übrigen Zeilen der
 * Rebsorte (höchste Menge zuerst). Was dann noch übrig ist, passt zu keiner Lese und wird als Hinweis gemeldet.
 */
export function ernteFormular(lese: readonly FormularLese[], verkaeufe: readonly FormularVerkauf[], betriebFlaecheHa: number): ErnteFormular {
  type Gruppe = { sorte: string; stufe: string | null; kg: number; flaechen: Map<string, number>; teile: { menge: number; kmw: number }[]; verkauftKg: number }
  const gruppen = new Map<string, Gruppe>()
  for (const l of lese) {
    const kg = l.mengeKg ?? 0
    const sorte = sorteVon(l.rebsorte)
    const key = zeilenKey(sorte, l.qualitaetsstufe)
    const g: Gruppe = gruppen.get(key) ?? { sorte, stufe: l.qualitaetsstufe, kg: 0, flaechen: new Map<string, number>(), teile: [], verkauftKg: 0 }
    g.kg += kg
    if (!g.flaechen.has(l.flaechenKey)) g.flaechen.set(l.flaechenKey, l.flaecheHa ?? 0)
    if (kg > 0 && l.kmw !== null) g.teile.push({ menge: kg, kmw: l.kmw })
    gruppen.set(key, g)
  }

  const warnungen: string[] = []
  const ohneLese = new Map<string, number>()
  for (const v of verkaeufe) {
    let rest = v.mengeKg ?? 0
    if (rest <= 0) continue
    const sorte = sorteVon(v.rebsorte)
    const eigene = gruppen.get(zeilenKey(sorte, v.qualitaetsstufe))
    const andere = [...gruppen.values()].filter(g => g.sorte === sorte && g !== eigene).sort((a, b) => b.kg - a.kg)
    for (const g of [...(eigene ? [eigene] : []), ...andere]) {
      const frei = Math.max(0, g.kg - g.verkauftKg)
      const teil = Math.min(frei, rest)
      g.verkauftKg += teil
      rest -= teil
      if (rest <= 0) break
    }
    if (rest > 0.0005) ohneLese.set(sorte, (ohneLese.get(sorte) ?? 0) + rest)
  }
  for (const [sorte, kg] of ohneLese) {
    warnungen.push(`Traubenverkauf „${sorte}“: ${runden(kg, STELLEN.kg).toLocaleString('de-DE')} kg sind durch keine Lese dieser Rebsorte gedeckt und fehlen in der Erntemeldung – Lesedaten bzw. Rebsorte von Ried/Grundstück prüfen.`)
  }

  const zeilen: FormularZeile[] = [...gruppen.values()].map(g => {
    const bekannt = g.sorte !== REBSORTE_OHNE
    const { kuerzel: stufeKuerzel, block } = formularStufe(g.stufe, bekannt)
    const mengeKg = runden(g.kg, STELLEN.kg)
    const verkauftKg = runden(g.verkauftKg, STELLEN.kg)
    const selbstLiter = literAusKg(Math.max(0, mengeKg - verkauftKg))
    const verkauftLiter = literAusKg(verkauftKg)
    const m = mischen(g.teile)
    return {
      rebsorte: g.sorte, kuerzel: bekannt ? bkiRebsorteKuerzel(g.sorte) : null,
      qualitaetsstufe: g.stufe, stufeKuerzel, block, farbe: bekannt ? bkiFarbe(g.sorte) : null,
      flaecheHa: runden([...g.flaechen.values()].reduce((s, f) => s + f, 0), STELLEN.ha),
      mengeKg, verkauftKg, selbstLiter, verkauftLiter, summeLiter: selbstLiter + verkauftLiter,
      kmw: m ? runden(m.kmw, STELLEN.kmw) : null, oechsle: m ? runden(m.oechsle, STELLEN.oechsle) : null,
    }
  }).sort((a, b) => (a.block === b.block ? 0 : a.block === 'rlqp' ? -1 : 1)
    || a.rebsorte.localeCompare(b.rebsorte, 'de')
    || (katalogQualitaet(a.qualitaetsstufe)?.rang ?? -1) - (katalogQualitaet(b.qualitaetsstufe)?.rang ?? -1))

  // Fläche je Block: jedes Grundstück (bzw. Ried) nur einmal, auch wenn dort mehrere Sorten oder Stufen gelesen wurden
  const blockFlaeche = (block: FormularBlock) => {
    const f = new Map<string, number>()
    for (const g of gruppen.values()) {
      if (formularStufe(g.stufe, g.sorte !== REBSORTE_OHNE).block !== block) continue
      for (const [k, ha] of g.flaechen) if (!f.has(k)) f.set(k, ha)
    }
    return haAr([...f.values()].reduce((s, x) => s + x, 0))
  }
  const liter = (filter: (z: FormularZeile) => boolean) => zeilen.filter(filter).reduce((s, z) => s + z.summeLiter, 0)
  const rlqpLiter = liter(z => z.block === 'rlqp')
  const weinLiter = liter(z => z.block === 'wein')
  const ohneStufe = zeilen.filter(z => !z.qualitaetsstufe && z.mengeKg > 0).map(z => z.rebsorte)
  if (ohneStufe.length > 0) warnungen.push(`Ohne Qualitätsstufe erfasst (Spalte „Qualitätsstufe“ bleibt leer): ${[...new Set(ohneStufe)].join(', ')} – Qualitätsstufe in den Lesedaten ergänzen.`)

  return {
    zeilen,
    rlqp: { flaeche: blockFlaeche('rlqp'), liter: rlqpLiter },
    wein: { flaeche: blockFlaeche('wein'), liter: weinLiter, weissLiter: liter(z => z.block === 'wein' && z.farbe === 'weiss'), rotLiter: liter(z => z.block === 'wein' && z.farbe === 'rot') },
    betrieb: haAr(betriebFlaecheHa),
    beitrag: amaBeitrag(rlqpLiter + weinLiter),
    leer: zeilen.every(z => z.mengeKg <= 0),
    warnungen,
  }
}

/** CSV: dieselben Zeilen und Literwerte wie der Druck; kg, Fläche und Mostgewicht als zusätzliche Spalten */
export const SPALTEN_ERNTE_FORMULAR: CsvSpalte<FormularZeile>[] = [
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Qualitätsstufe', typ: 'text', wert: z => (z.qualitaetsstufe ? qualitaetLabel(z.qualitaetsstufe) : null) },
  { kopf: 'Kürzel Qualitätsstufe', typ: 'code', wert: z => z.stufeKuerzel },
  { kopf: 'Selbst eingefüllter Wein (l)', typ: 'ganzzahl', wert: z => z.selbstLiter },
  { kopf: 'Verkaufte Trauben (l)', typ: 'ganzzahl', wert: z => z.verkauftLiter },
  { kopf: 'Summe (l)', typ: 'ganzzahl', wert: z => z.summeLiter },
  { kopf: 'Menge (kg)', typ: 'dezimal', stellen: STELLEN.kg, wert: z => z.mengeKg },
  { kopf: 'davon als Trauben verkauft (kg)', typ: 'dezimal', stellen: STELLEN.kg, wert: z => z.verkauftKg },
  { kopf: 'Fläche (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheHa },
  // KAN-364: Mittelwerte je Zeile – nur °KMW und °Oe, ohne „gemessen in“
  { kopf: 'Mostgewicht (°KMW)', typ: 'dezimal', stellen: STELLEN.kmw, wert: z => z.kmw },
  { kopf: 'Mostgewicht (°Oe)', typ: 'dezimal', stellen: STELLEN.oechsle, wert: z => z.oechsle },
  { kopf: 'Block', typ: 'text', wert: z => (z.block === 'wein' ? 'Wein ohne Sorte und Jahrgang' : 'Rebsorten-, Land-, Qualitäts- und Prädikatswein') },
]
