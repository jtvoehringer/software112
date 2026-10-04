// KAN-110 (04.10.2026): Herkunft eines Verschnitts nach § 21 WeinG – reine Regel über die Liter je Herkunftseinheit.
//
//  - Weinbaugebiet und Weinbauregion verlangen 100 %: gemeinsamer Oberbegriff im Herkunftsbaum (minHerkunft, KAN-165).
//    Verschiedene Bundesländer ergeben „Wein aus Österreich“, nicht Landwein Weinland (Entscheidung Jörgen 04.10.2026,
//    R13 „verschiedene Bundesländer: Abwertung zu Weinland Österreich“).
//  - Ried und Gemeinde (DAC Riedenwein bzw. Ortswein) verlangen mindestens 85 % aus DERSELBEN Ried bzw. Gemeinde, der
//    Rest aus demselben Weinbaugebiet (§ 21 Abs. 1; Entscheidung Jörgen 04.10.2026: 85 % auch bei DAC).
//    Gleicher Code allein reicht nicht – Ried A + Ried B sind beide „Riedenwein“, aber keine gemeinsame Ried.
//  - Ried = amtliche Ried der Lage (lagen.amtliche_ried), Gemeinde = politische Gemeinde der KG-Nr. des Grundstücks
//    (kgGemeinde.ts, BEV-Verzeichnis; Tribuswinkel und Traiskirchen sind dieselbe Gemeinde). Unbekannte Ried bzw.
//    Gemeinde zählt als fremd; ist sie bei ALLEN Teilen unbekannt, ist die Angabe nicht prüfbar – die Stufe bleibt
//    mit Hinweis (Eröffnungsbestände, Zukäufe).
//  - Eigene Weinbaugebiete außerhalb des Katalogs: über herkunftKnotenTolerant (Kürzel/Gebietsname); sonst bleibt nur
//    ein einheitliches eigenes Gebiet erhalten, gemischt mit anderem wird es „Wein aus Österreich“ – nie NULL.
//  - Höchste Qualitätsstufe aus der Herkunft: Landwein ohne gemeinsames Gebiet, Wein ohne gemeinsame Region
//    (§ 9 Landwein aus einer Region, § 10 Qualitätswein aus einem Gebiet) – angewendet in KAN-111.

import { herkunftBundesland, herkunftKette, herkunftKnoten, herkunftKnotenTolerant, minHerkunft, HERKUNFT_LABEL, type HerkunftKnoten } from '@/lib/herkunft'

/** Mindestanteil einer Ried bzw. Gemeinde (§ 21 Abs. 1 WeinG) */
export const RIED_ORT_MINDESTANTEIL = 0.85

/** Liter mit gleicher Herkunft: Code der Charge, Ried und Gemeinde des Ursprungs (null = unbekannt) */
export type HerkunftsTeil = {
  liter: number
  code: string | null
  ried: string | null
  /** Gemeinde-Schlüssel: beliebiger Text (z. B. „G30639“); reine Ziffern gelten als KG-Nr. („4023“ = „04023“) */
  ort: string | null
  /** Anzeigename der Gemeinde (Hinweise) */
  ortName?: string | null
}

export type HerkunftErgebnis = {
  code: string | null
  /** Höchste Qualitätsstufe, die die Herkunft zulässt: 'wein' (keine gemeinsame Region), 'landwein' (kein gemeinsames Gebiet), sonst null */
  hoechsteStufe: 'wein' | 'landwein' | null
  hinweise: string[]
}

/** Ried-Bezeichnung vergleichbar machen (Groß-/Kleinschreibung, Leerzeichen) */
export function riedSchluessel(ried: string | null | undefined): string | null {
  const s = typeof ried === 'string' ? ried.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de') : ''
  return s || null
}

/** KG-Nr. vergleichbar machen: nur Ziffern, fünfstellig („4023“ = „04023“); „0“ und leer → null */
export function kgSchluessel(kg: string | number | null | undefined): string | null {
  const ziffern = String(kg ?? '').replace(/\D/g, '')
  if (!ziffern || /^0+$/.test(ziffern)) return null
  return ziffern.padStart(5, '0')
}

/** Gemeinde-Schlüssel: reine Ziffern als KG-Nr. normalisiert, sonst getrimmt */
function ortSchluessel(ort: string | null | undefined): string | null {
  const s = typeof ort === 'string' ? ort.trim() : ''
  if (!s) return null
  return /^\d+$/.test(s) ? kgSchluessel(s) : s
}

const pct = (x: number) => `${Math.round(x * 1000) / 10} %`.replace('.', ',')
const label = (c: string) => HERKUNFT_LABEL[c] ?? c

function knotenMitEbene(code: string, ebene: HerkunftKnoten['ebene']): string | null {
  return herkunftKette(code).find(c => herkunftKnoten(c)?.ebene === ebene) ?? null
}

/** Weinbaugebiet eines Codes (DAC-Gebiet, sonst die Qualitätswein-Stufe) – Bezug für „Rest aus demselben Gebiet“ */
function gebietVon(code: string): string | null {
  return knotenMitEbene(code, 'dac_gebiet') ?? knotenMitEbene(code, 'qualitaetswein')
}

type Aufgeloest = { liter: number; code: string; ried: string | null; ort: string | null; ortName: string | null; riedRoh: string | null }

/**
 * Prüft die 85-%-Regel auf einer Ebene (dac_ried bzw. dac_ort): Teile, deren Code diese Ebene enthält, gruppiert nach
 * Stufen-Code und Einheit (Ried bzw. Gemeinde). Liefert den Code der Stufe, wenn eine Gruppe ≥ 85 % aller Liter hat
 * und der Rest aus demselben Weinbaugebiet stammt; 'nicht_pruefbar', wenn die Einheit bei allen Teilen fehlt.
 */
function pruefeEbene(
  teile: readonly Aufgeloest[], gesamt: number, ebene: 'dac_ried' | 'dac_ort', einheit: (t: Aufgeloest) => string | null,
): { code: string; anteil: number; name: string | null } | 'nicht_pruefbar' | null {
  const gruppen = new Map<string, { code: string; einheit: string | null; liter: number; name: string | null }>()
  let mitEbene = 0
  let mitEinheit = 0
  for (const t of teile) {
    const stufe = knotenMitEbene(t.code, ebene)
    if (!stufe) continue
    mitEbene += t.liter
    const e = einheit(t)
    if (e) mitEinheit += t.liter
    const key = `${stufe}|${e ?? ''}`
    const g = gruppen.get(key) ?? { code: stufe, einheit: e, liter: 0, name: ebene === 'dac_ried' ? t.riedRoh : t.ortName }
    g.liter += t.liter
    gruppen.set(key, g)
  }
  if (mitEbene <= 0) return null
  // Einheit nirgends bekannt: nur prüfbar, ob alle Teile dieselbe Stufe haben – dann bleibt sie (mit Hinweis)
  if (mitEinheit <= 0) {
    const codes = new Set([...gruppen.values()].map(g => g.code))
    return codes.size === 1 && mitEbene >= gesamt - 0.005 ? 'nicht_pruefbar' : null
  }
  const beste = [...gruppen.values()].filter(g => g.einheit).sort((a, b) => b.liter - a.liter)[0]
  if (!beste || beste.liter < RIED_ORT_MINDESTANTEIL * gesamt - 0.005) return null
  const gebiet = gebietVon(beste.code)
  if (!gebiet || teile.some(t => !herkunftKette(t.code).includes(gebiet))) return null
  return { code: beste.code, anteil: beste.liter / gesamt, name: beste.name }
}

/** Herkunft eines Verschnitts aus den Litern je Herkunftseinheit (§ 21 WeinG) */
export function ermittleHerkunft(eingabe: readonly HerkunftsTeil[]): HerkunftErgebnis {
  const hinweise: string[] = []
  const teile = eingabe.filter(t => Number.isFinite(t.liter) && t.liter > 0)
  const mitCode = teile.filter(t => typeof t.code === 'string' && t.code.trim())
  if (mitCode.length === 0) return { code: null, hoechsteStufe: null, hinweise }

  // Einheitliches eigenes Gebiet bleibt wörtlich erhalten (auch wenn es ein Kürzel wie „WLTH“ ist)
  const roh = new Set(mitCode.map(t => (t.code as string).trim()))
  if (roh.size === 1 && !herkunftKnoten([...roh][0])) return { code: [...roh][0], hoechsteStufe: null, hinweise }

  // Eigene Gebiete außerhalb des Katalogs
  const aufgeloest: Aufgeloest[] = []
  const eigene = new Set<string>()
  for (const t of mitCode) {
    const k = herkunftKnotenTolerant(t.code)
    if (k) aufgeloest.push({ liter: t.liter, code: k.code, ried: riedSchluessel(t.ried), riedRoh: t.ried?.trim() || null, ort: ortSchluessel(t.ort), ortName: t.ortName ?? null })
    else eigene.add((t.code as string).trim())
  }
  if (eigene.size > 0) {
    if (aufgeloest.length === 0 && eigene.size === 1) return { code: [...eigene][0], hoechsteStufe: null, hinweise }
    hinweise.push(`Eigenes Weinbaugebiet (${[...eigene].join(', ')}) ohne gemeinsamen Oberbegriff – Herkunft Österreich`)
    return { code: 'wein', hoechsteStufe: 'wein', hinweise }
  }

  const gesamt = aufgeloest.reduce((s, t) => s + t.liter, 0)
  let basis = minHerkunft(aufgeloest.map(t => t.code)) ?? 'wein'
  const bundeslaender = new Set(aufgeloest.map(t => herkunftBundesland(t.code)).filter(Boolean))
  if (herkunftKnoten(basis)?.ebene === 'landwein' && bundeslaender.size > 1) {
    basis = 'wein'
    hinweise.push(`Verschiedene Bundesländer (${[...bundeslaender].join(', ')}) – Wein aus Österreich`)
  }

  let code: string | null = null
  const ried = pruefeEbene(aufgeloest, gesamt, 'dac_ried', t => t.ried)
  if (ried === 'nicht_pruefbar') {
    code = basis
    hinweise.push('Amtliche Ried bei keiner Herkunft gepflegt – Riedangabe nicht prüfbar')
  } else if (ried) {
    code = ried.code
    if (ried.anteil < 0.99995) hinweise.push(`${ried.name ? `Ried ${ried.name}` : 'Ried'} mit ${pct(ried.anteil)} – Rest aus demselben Weinbaugebiet (§ 21 Abs. 1 WeinG)`)
  } else {
    const ort = pruefeEbene(aufgeloest, gesamt, 'dac_ort', t => t.ort)
    if (ort === 'nicht_pruefbar') {
      code = knotenMitEbene(basis, 'dac_ort') ?? basis
      hinweise.push('Gemeinde (KG-Nr.) bei keiner Herkunft bekannt – Ortsangabe nicht prüfbar')
    } else if (ort) {
      code = ort.code
      if (ort.anteil < 0.99995) hinweise.push(`${ort.name ? `Gemeinde ${ort.name}` : 'Gemeinde'} mit ${pct(ort.anteil)} – Rest aus demselben Weinbaugebiet (§ 21 Abs. 1 WeinG)`)
    }
  }
  if (!code) {
    // weder Ried noch Gemeinde zu 85 % einheitlich: höchstens die Gebietsstufe des gemeinsamen Oberbegriffs
    code = herkunftKette(basis).find(c => { const e = herkunftKnoten(c)?.ebene; return e !== 'dac_ried' && e !== 'dac_ort' }) ?? 'wein'
    if (aufgeloest.some(t => { const e = herkunftKnoten(t.code)?.ebene; return e === 'dac_ried' || e === 'dac_ort' })) {
      hinweise.push(`Keine Ried bzw. Gemeinde mit mindestens 85 % aus demselben Weinbaugebiet (§ 21 Abs. 1 WeinG) – ${label(code)}`)
    }
  }

  const ebene = herkunftKnoten(code)?.ebene
  return { code, hoechsteStufe: ebene === 'oesterreich' ? 'wein' : ebene === 'landwein' ? 'landwein' : null, hinweise }
}
