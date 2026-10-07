// ── Lese-Auswertung je Jahrgang (KAN-147, 07.10.2026) ───────────────────────────────────────────────────
// Frage Jörgen 26.09.2026: „Verwenden wir aus der Lese etwas? Generieren wir einen Bericht außer der AMA-Erntemeldung?“
// Betriebliche Auswertung (keine Behördenmeldung) aus denselben Lesedaten wie Lese-Seite und Erntemeldung
// (ladeLesedaten, ohne stornierte Einträge):
//   1. Ertrag je Ried: kg, hl, WI-Fläche, kg/ha und Abstand zum Hektarhöchstertrag (nur Stufen, für die er gilt)
//   2. Mostgewicht je Sorte und Ried: Mittel massegewichtet über °KMW (mischen(), nie °Oe mitteln), Min/Max,
//      Verteilung der Qualitätsstufen in kg
//   3. Lesefortschritt: gelesene/offene Rieden und Fläche, Tagesmengen mit kumulierter Summe
//   4. Vorjahresvergleich je Sorte: kg und Mostgewicht, dazu kg/ha des Betriebs je Jahrgang
// Rein und isomorph (node:test): die Seite lädt, hier wird gerechnet.

import { mischen } from './mostgewicht'
import type { CsvSpalte } from '../csv'

/** Lesezeile (Ausschnitt von LeseZeile aus lib/behoerden/erntemeldung.ts) */
export type LeseDaten = {
  weingartenId: string | null
  ried: string | null
  rebsorte: string | null
  datum: string | null
  mengeKg: number | null
  mengeHl: number | null
  kmw: number | null
  qualitaetsstufe: string | null
}

export type RiedFlaeche = { id: string; name: string; flaecheHa: number }

export type ErtragZeile = {
  weingartenId: string | null
  ried: string
  kg: number
  hl: number
  flaecheHa: number | null
  kgHa: number | null
  /** kg/ha, die für den Höchstertrag zählen (Stufen ab Landwein) */
  kgHaHoechstertrag: number | null
  /** Höchstertrag − kg/ha (negativ = überschritten), null ohne Fläche */
  abstandKgHa: number | null
}

export type MostgewichtZeile = {
  rebsorte: string
  ried: string | null
  kg: number
  kmw: number | null
  oechsle: number | null
  kmwMin: number | null
  kmwMax: number | null
  /** kg je Qualitätsstufe */
  stufen: Record<string, number>
}

export type Tagesmenge = { datum: string; kg: number; kumuliert: number }

export type Fortschritt = {
  riedenGesamt: number
  riedenGelesen: number
  flaecheGesamtHa: number
  flaecheGelesenHa: number
  offen: string[]
  tage: Tagesmenge[]
}

export type VorjahrZeile = { rebsorte: string; jahre: Record<number, { kg: number; kmw: number | null }> }

const r2 = (n: number) => Math.round(n * 100) / 100
const kgVon = (z: LeseDaten) => (z.mengeKg != null && z.mengeKg > 0 ? z.mengeKg : 0)
const kmwListe = (zs: readonly LeseDaten[]) => zs.map(z => z.kmw).filter((k): k is number => k != null && Number.isFinite(k))

/** 1. Ertrag je Ried (alphabetisch); Rieden ohne Lese erscheinen nicht – die stehen im Lesefortschritt */
export function ertragJeRied(
  zeilen: readonly LeseDaten[], flaechen: readonly RiedFlaeche[],
  hoechstKgHa: number, unterliegt: (stufe: string | null) => boolean,
): ErtragZeile[] {
  const fl = new Map(flaechen.map(f => [f.id, f.flaecheHa]))
  const gruppen = new Map<string, LeseDaten[]>()
  for (const z of zeilen) {
    const k = z.weingartenId ?? `ohne:${z.ried ?? ''}`
    gruppen.set(k, [...(gruppen.get(k) ?? []), z])
  }
  return [...gruppen.entries()].map(([k, zs]) => {
    const kg = zs.reduce((s, z) => s + kgVon(z), 0)
    const hl = zs.reduce((s, z) => s + (z.mengeHl ?? 0), 0)
    const id = k.startsWith('ohne:') ? null : k
    const ha = id ? fl.get(id) ?? null : null
    const kgHo = zs.filter(z => unterliegt(z.qualitaetsstufe)).reduce((s, z) => s + kgVon(z), 0)
    const kgHa = ha && ha > 0 ? r2(kg / ha) : null
    const kgHaHo = ha && ha > 0 ? r2(kgHo / ha) : null
    return {
      weingartenId: id, ried: zs[0].ried ?? '–', kg: r2(kg), hl: r2(hl), flaecheHa: ha, kgHa, kgHaHoechstertrag: kgHaHo,
      abstandKgHa: kgHaHo === null ? null : r2(hoechstKgHa - kgHaHo),
    }
  }).sort((a, b) => a.ried.localeCompare(b.ried, 'de'))
}

/** 2. Mostgewicht je Sorte und Ried (Sorte alphabetisch, darin Ried); Mittel kg-gewichtet über °KMW */
export function mostgewichtJeSorte(zeilen: readonly LeseDaten[]): MostgewichtZeile[] {
  const gruppen = new Map<string, LeseDaten[]>()
  for (const z of zeilen) {
    const k = `${z.rebsorte ?? 'ohne Rebsorte'}\u0000${z.ried ?? ''}`
    gruppen.set(k, [...(gruppen.get(k) ?? []), z])
  }
  return [...gruppen.entries()].map(([k, zs]) => {
    const [rebsorte, ried] = k.split('\u0000')
    const m = mischen(zs.map(z => ({ menge: kgVon(z), kmw: z.kmw })))
    const ks = kmwListe(zs)
    const stufen: Record<string, number> = {}
    for (const z of zs) { const s = z.qualitaetsstufe ?? 'ohne'; stufen[s] = r2((stufen[s] ?? 0) + kgVon(z)) }
    return {
      rebsorte, ried: ried || null, kg: r2(zs.reduce((s, z) => s + kgVon(z), 0)),
      kmw: m?.kmw ?? null, oechsle: m?.oechsle ?? null,
      kmwMin: ks.length ? Math.min(...ks) : null, kmwMax: ks.length ? Math.max(...ks) : null, stufen,
    }
  }).sort((a, b) => a.rebsorte.localeCompare(b.rebsorte, 'de') || (a.ried ?? '').localeCompare(b.ried ?? '', 'de'))
}

/** 3. Lesefortschritt: erntebare Rieden mit Fläche gegen die Rieden mit Lese; Tagesmengen chronologisch */
export function lesefortschritt(zeilen: readonly LeseDaten[], rieden: readonly RiedFlaeche[]): Fortschritt {
  const gelesen = new Set(zeilen.filter(z => kgVon(z) > 0 || z.datum).map(z => z.weingartenId).filter(Boolean) as string[])
  const tage = new Map<string, number>()
  for (const z of zeilen) if (z.datum) tage.set(z.datum.slice(0, 10), (tage.get(z.datum.slice(0, 10)) ?? 0) + kgVon(z))
  let summe = 0
  const liste = [...tage.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([datum, kg]) => {
    summe += kg
    return { datum, kg: r2(kg), kumuliert: r2(summe) }
  })
  return {
    riedenGesamt: rieden.length,
    riedenGelesen: rieden.filter(r => gelesen.has(r.id)).length,
    flaecheGesamtHa: r2(rieden.reduce((s, r) => s + r.flaecheHa, 0)),
    flaecheGelesenHa: r2(rieden.filter(r => gelesen.has(r.id)).reduce((s, r) => s + r.flaecheHa, 0)),
    offen: rieden.filter(r => !gelesen.has(r.id)).map(r => r.name).sort((a, b) => a.localeCompare(b, 'de')),
    tage: liste,
  }
}

/** 4. Vorjahresvergleich je Sorte über mehrere Jahrgänge (kg und Mostgewicht) */
export function vorjahresvergleich(jahrgaenge: readonly { jahrgang: number; zeilen: readonly LeseDaten[] }[]): VorjahrZeile[] {
  const sorten = new Map<string, VorjahrZeile>()
  for (const j of jahrgaenge) {
    const je = new Map<string, LeseDaten[]>()
    for (const z of j.zeilen) { const s = z.rebsorte ?? 'ohne Rebsorte'; je.set(s, [...(je.get(s) ?? []), z]) }
    for (const [s, zs] of je) {
      const v = sorten.get(s) ?? { rebsorte: s, jahre: {} }
      v.jahre[j.jahrgang] = { kg: r2(zs.reduce((a, z) => a + kgVon(z), 0)), kmw: mischen(zs.map(z => ({ menge: kgVon(z), kmw: z.kmw })))?.kmw ?? null }
      sorten.set(s, v)
    }
  }
  return [...sorten.values()].sort((a, b) => a.rebsorte.localeCompare(b.rebsorte, 'de'))
}

/** kg/ha des Betriebs (Summe kg ÷ Weingartenfläche), null ohne Fläche */
export function kgJeHa(zeilen: readonly LeseDaten[], flaecheHa: number): number | null {
  return flaecheHa > 0 ? r2(zeilen.reduce((s, z) => s + kgVon(z), 0) / flaecheHa) : null
}

// ── CSV (Standardprofil, keine Behördenmeldung) ─────────────────────────────────────────────────────────
export const SPALTEN_ERTRAG: CsvSpalte<ErtragZeile>[] = [
  { kopf: 'Ried', typ: 'text', wert: z => z.ried },
  { kopf: 'Menge (kg)', typ: 'dezimal', stellen: 2, wert: z => z.kg },
  { kopf: 'Menge (hl)', typ: 'dezimal', stellen: 2, wert: z => z.hl },
  { kopf: 'Weingartenfläche (ha)', typ: 'dezimal', stellen: 4, wert: z => z.flaecheHa },
  { kopf: 'Ertrag (kg/ha)', typ: 'dezimal', stellen: 0, wert: z => z.kgHa },
  { kopf: 'Ertrag mit Höchstertrag (kg/ha)', typ: 'dezimal', stellen: 0, wert: z => z.kgHaHoechstertrag },
  { kopf: 'Abstand zum Hektarhöchstertrag (kg/ha)', typ: 'dezimal', stellen: 0, wert: z => z.abstandKgHa },
]

export const SPALTEN_MOSTGEWICHT: CsvSpalte<MostgewichtZeile>[] = [
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'Ried', typ: 'text', wert: z => z.ried },
  { kopf: 'Menge (kg)', typ: 'dezimal', stellen: 2, wert: z => z.kg },
  { kopf: 'Mostgewicht Mittel (°KMW)', typ: 'dezimal', stellen: 2, wert: z => z.kmw },
  { kopf: 'Mostgewicht Mittel (°Oe)', typ: 'dezimal', stellen: 1, wert: z => z.oechsle },
  { kopf: 'Mostgewicht Min (°KMW)', typ: 'dezimal', stellen: 2, wert: z => z.kmwMin },
  { kopf: 'Mostgewicht Max (°KMW)', typ: 'dezimal', stellen: 2, wert: z => z.kmwMax },
  { kopf: 'Qualitätsstufen (kg)', typ: 'text', wert: z => Object.entries(z.stufen).map(([s, kg]) => `${s} ${kg}`).join(', ') },
]
