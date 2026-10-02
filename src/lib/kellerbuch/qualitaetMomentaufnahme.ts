// Momentaufnahmen der Qualitätsangabe für den Storno (KAN-145, KAN-186 Etappe 2b/2c, 02.10.2026)
//
// Umzug (keller_umzuege): qualitaet_vorher/_nachher + zusatz_vorher/_nachher + erzeugnis_vorher/_nachher.
// Verschnitt (verschneidungen): ziel_qualitaet_vorher + ziel_zusatz_vorher + ziel_erzeugnis_vorher.
// Die Spalten zusatz_*/erzeugnis_* legt die Migration kan186c an. Altdaten haben sie nicht (NULL) – dort steht ggf.
// noch ein Altwert im Qualitätsfeld ('reserve', 'sekt' …), den normalisiereQualitaet() zurückführt. Noch ältere
// Umzüge ohne Momentaufnahme liest der Storno aus dem Vermerk „Abstufung von X auf Y“ (qualitaetAusText).
//
// Isomorph, ohne '@/'-Importe (node:test lädt die Datei direkt, scripts/tests/kan186-qualitaet.test.mjs).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (wie lib/buchhaltung/bmd.ts)
import { normalisiereQualitaet, gleicheQualitaet, qualitaetsSpalten, type QualitaetsAngabe } from '../wein/qualitaetsrang.ts'
// @ts-expect-error TS5097 – siehe oben
import { qualitaetAusText } from '../weinqualitaet.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Spalten der Momentaufnahme an einer Umzugszeile (vorher/nachher) – nie ein Altwert im Qualitätsfeld */
export function umzugQualitaetsSpalten(vorher: QualitaetsAngabe | null | undefined, nachher: QualitaetsAngabe | null | undefined): R {
  return {
    qualitaet_vorher:  vorher?.stufe ?? null,
    qualitaet_nachher: nachher?.stufe ?? null,
    zusatz_vorher:     vorher?.zusatz ?? null,
    zusatz_nachher:    nachher?.zusatz ?? null,
    erzeugnis_vorher:  vorher?.erzeugnis ?? null,
    erzeugnis_nachher: nachher?.erzeugnis ?? null,
  }
}

/** Momentaufnahme der Ziel-Charge an einem Verschnitt */
export function verschnittQualitaetsSpalten(vorher: QualitaetsAngabe | null | undefined): R {
  return {
    ziel_qualitaet_vorher: vorher?.stufe ?? null,
    ziel_zusatz_vorher:    vorher?.zusatz ?? null,
    ziel_erzeugnis_vorher: vorher?.erzeugnis ?? null,
  }
}

/** Angabe aus einer Momentaufnahme (Altwerte normalisiert); ohne Stufe null */
function ausMomentaufnahme(stufe: unknown, zusatz: unknown, erzeugnis: unknown): QualitaetsAngabe | null {
  if (typeof stufe !== 'string' || !stufe) return null
  return normalisiereQualitaet({
    qualitaetsstufe: stufe,
    zusatzbezeichnung: typeof zusatz === 'string' ? zusatz : null,
    erzeugnis: typeof erzeugnis === 'string' ? erzeugnis : null,
  })
}

/**
 * Qualität der Ziel-Charge beim Storno eines Umzugs zurücknehmen – Spalten zum Schreiben oder null (unverändert).
 *  - Momentaufnahme an der Zielzeile (ab 30.09.2026): zurück auf „vorher“, wenn die Charge noch auf „nachher“ steht
 *  - sonst Vermerk „Abstufung von X auf Y“ an der Zielzeile UND „… (Zusammenführung per Umziehen)“ in den Notizen
 *    der Charge, die noch auf Y steht
 * `charge` = aktuelle Zeile (qualitaetsstufe, zusatzbezeichnung, erzeugnis, notizen).
 */
export function umzugQualitaetZurueck(zeile: R, charge: R): R | null {
  const aktuell = normalisiereQualitaet(charge)
  const vorher = ausMomentaufnahme(zeile.qualitaet_vorher, zeile.zusatz_vorher, zeile.erzeugnis_vorher)
  const nachher = ausMomentaufnahme(zeile.qualitaet_nachher, zeile.zusatz_nachher, zeile.erzeugnis_nachher)
  if (vorher && nachher) {
    if (gleicheQualitaet(vorher, nachher)) return null
    return gleicheQualitaet(aktuell, nachher) ? qualitaetsSpalten(vorher) : null
  }
  const m = /^Abstufung von (.+) auf (.+)$/.exec(String(zeile.notizen ?? '').trim())
  if (!m) return null
  const von = qualitaetAusText(m[1])
  const nach = qualitaetAusText(m[2])
  const vermerk = `Abstufung von ${m[1]} auf ${m[2]} (Zusammenführung per Umziehen)`
  if (!von || !nach || !gleicheQualitaet(aktuell, nach) || !String(charge.notizen ?? '').includes(vermerk)) return null
  return qualitaetsSpalten(von)
}

/**
 * Qualität der Ziel-Charge beim Storno eines Verschnitts – Spalten aus der Momentaufnahme oder null (ohne
 * Momentaufnahme bleibt die Charge unverändert, wie bisher).
 */
export function verschnittQualitaetZurueck(v: R): R | null {
  const vorher = ausMomentaufnahme(v.ziel_qualitaet_vorher, v.ziel_zusatz_vorher, v.ziel_erzeugnis_vorher)
  return vorher ? qualitaetsSpalten(vorher) : null
}
