// KAN-216: Eingabe des E-Labels prüfen und in eine Zeile für elabels umsetzen (Server Action und Tests).
// Isomorph und ohne @/-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (wie lib/wein/qualitaet.ts)
import { berechneNaehrwerte, naehrwertFehler, rundeNaehrwert, type Naehrwerte } from './naehrwerte.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ElabelEingabe = {
  zutatenIds: string[]
  analyseId: string | null
  alkoholVol: number | null
  restzuckerGl: number | null
  gesamtsaeureGl: number | null
  glycerinGl: number | null
  manuell: boolean
  manuellGrund: string | null
  /** nur bei manuell: Werte je 100 ml */
  werte: Partial<Naehrwerte> | null
}

export type ElabelZeile = {
  zutaten_ids: string[]
  analyse_id: string | null
  alkohol_vol: number | null
  restzucker_gl: number | null
  gesamtsaeure_gl: number | null
  glycerin_gl: number | null
  energie_kj: number | null
  energie_kcal: number | null
  kohlenhydrate_g: number | null
  zucker_g: number | null
  fett_g: number
  fett_gesaettigt_g: number
  eiweiss_g: number
  salz_g: number
  manuell: boolean
  manuell_grund: string | null
}

const zahl = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/** Prüft die Eingabe und rechnet die Nährwerte (außer „von Hand“). */
export function elabelZeile(e: ElabelEingabe): { fehler: string } | { zeile: ElabelZeile } {
  const ids = Array.isArray(e.zutatenIds) ? e.zutatenIds.map(String) : []
  if (ids.some(id => !UUID_RE.test(id))) return { fehler: 'Ungültige Zutat in der Liste.' }
  if (new Set(ids).size !== ids.length) return { fehler: 'Eine Zutat ist doppelt in der Liste.' }
  if (e.analyseId != null && !UUID_RE.test(e.analyseId)) return { fehler: 'Ungültige Analyse.' }
  const ein = {
    alkoholVol: zahl(e.alkoholVol), restzuckerGl: zahl(e.restzuckerGl),
    gesamtsaeureGl: zahl(e.gesamtsaeureGl), glycerinGl: zahl(e.glycerinGl),
  }
  if (ein.alkoholVol != null && (ein.alkoholVol < 0 || ein.alkoholVol > 25)) return { fehler: 'Alkohol muss zwischen 0 und 25 % vol liegen.' }
  if (ein.restzuckerGl != null && (ein.restzuckerGl < 0 || ein.restzuckerGl > 700)) return { fehler: 'Restzucker muss zwischen 0 und 700 g/l liegen.' }
  if (ein.gesamtsaeureGl != null && (ein.gesamtsaeureGl < 0 || ein.gesamtsaeureGl > 30)) return { fehler: 'Gesamtsäure muss zwischen 0 und 30 g/l liegen.' }
  if (ein.glycerinGl != null && (ein.glycerinGl < 0 || ein.glycerinGl > 40)) return { fehler: 'Glycerin muss zwischen 0 und 40 g/l liegen.' }

  let n: Naehrwerte | null
  let grund: string | null = null
  if (e.manuell) {
    grund = (e.manuellGrund ?? '').trim()
    if (grund.length < 10) return { fehler: 'Bitte begründen, warum die Nährwerte von Hand eingetragen werden (mindestens 10 Zeichen).' }
    const w = e.werte ?? {}
    const kj = zahl(w.energieKj), kcal = zahl(w.energieKcal), kh = zahl(w.kohlenhydrateG), z = zahl(w.zuckerG)
    if (kj == null || kcal == null || kh == null || z == null) {
      return { fehler: 'Von Hand: Brennwert (kJ und kcal), Kohlenhydrate und Zucker sind Pflicht.' }
    }
    if ([kj, kcal, kh, z].some(x => x < 0)) return { fehler: 'Nährwerte können nicht negativ sein.' }
    if (z > kh) return { fehler: 'Zucker kann nicht höher sein als die Kohlenhydrate.' }
    n = {
      energieKj: rundeNaehrwert('energie', kj), energieKcal: rundeNaehrwert('energie', kcal),
      kohlenhydrateG: rundeNaehrwert('makro', kh), zuckerG: rundeNaehrwert('makro', z),
      fettG: rundeNaehrwert('makro', zahl(w.fettG) ?? 0), fettGesaettigtG: rundeNaehrwert('gesaettigt', zahl(w.fettGesaettigtG) ?? 0),
      eiweissG: rundeNaehrwert('makro', zahl(w.eiweissG) ?? 0), salzG: rundeNaehrwert('salz', zahl(w.salzG) ?? 0),
    }
  } else {
    n = berechneNaehrwerte(ein)
  }
  return {
    zeile: {
      zutaten_ids: ids,
      analyse_id: e.analyseId ?? null,
      alkohol_vol: ein.alkoholVol, restzucker_gl: ein.restzuckerGl,
      gesamtsaeure_gl: ein.gesamtsaeureGl, glycerin_gl: ein.glycerinGl,
      energie_kj: n?.energieKj ?? null, energie_kcal: n?.energieKcal ?? null,
      kohlenhydrate_g: n?.kohlenhydrateG ?? null, zucker_g: n?.zuckerG ?? null,
      fett_g: n?.fettG ?? 0, fett_gesaettigt_g: n?.fettGesaettigtG ?? 0, eiweiss_g: n?.eiweissG ?? 0, salz_g: n?.salzG ?? 0,
      manuell: !!e.manuell, manuell_grund: e.manuell ? grund : null,
    },
  }
}

/** Fehlende Angaben für die Freigabe (leer = freigabefähig). */
export function freigabeFehler(z: Pick<ElabelZeile, 'zutaten_ids' | 'energie_kj' | 'energie_kcal' | 'kohlenhydrate_g' | 'zucker_g'
  | 'manuell' | 'alkohol_vol' | 'restzucker_gl' | 'gesamtsaeure_gl'>): string[] {
  const f: string[] = []
  if (!z.zutaten_ids || z.zutaten_ids.length === 0) f.push('Zutatenliste')
  if (!z.manuell) {
    f.push(...naehrwertFehler({ alkoholVol: z.alkohol_vol, restzuckerGl: z.restzucker_gl, gesamtsaeureGl: z.gesamtsaeure_gl }))
  } else if (z.energie_kj == null || z.energie_kcal == null || z.kohlenhydrate_g == null || z.zucker_g == null) {
    f.push('Nährwerte')
  }
  return f
}
