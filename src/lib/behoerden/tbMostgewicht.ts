// Mostgewicht je Position der Transportbescheinigung – KAN-130 Etappe 3 (02.10.2026)
//
// Isomorph (Formular im Browser, Vorbelegung auf dem Server, Tests: scripts/tests/kan130-charge-tb.test.mjs).
// Die Formulardaten liegen als JSONB in transportbescheinigungen.formular_daten; je Position stehen
// Messwert und Einheit als Text:
//   kmw                  °KMW mit Dezimalkomma („17,09“; bis 02.10.2026 nur bei Trauben, 1 Stelle)
//   oechsle              °Oe mit Dezimalkomma („84“)
//   mostgewicht_einheit  gemessene Einheit 'kmw' | 'oechsle' (eigener Name – `einheit` ist schon die
//                        Mengeneinheit l/kg der Position)
// Gespeicherte Altformulare ohne diese Felder: °KMW (bzw. °Oe) aus dem Freitext `alkohol_pct`
// („18,5 °KMW“). Die Formblatt-Spalte „Alkohol % vol / °KMW“ bleibt Text; Druck und CSV mit °Oe sind
// Teil C (KAN-131).

import { abrunden, KMW_STELLEN, OECHSLE_STELLEN, type Mostgewicht } from '../wein/mostgewicht'
import { mostgewichtAusGespeichert } from '../wein/mostgewichtFormular'
import { zahlAus } from '../format'
import { feld, formularZahl } from './verkehr-hilfen'

/** Stellen der °KMW auf dem Formblatt (wie STELLEN.kmwBki in lib/csv: 1, abgerundet) */
const KMW_FORMBLATT_STELLEN = 1

/** Mostgewicht-Felder einer Position */
export type TBMostgewichtFelder = { kmw: string; oechsle?: string; mostgewicht_einheit?: string }

/** Position mit den Feldern, die die Mostgewicht-Logik liest und schreibt */
export type TBPositionMitMostgewicht = TBMostgewichtFelder & { alkohol_pct: string }

/** Mostgewicht → Formularfelder (beide Werte und die gemessene Einheit; null = alle leer) */
export function tbMostgewichtFelder(m: Mostgewicht | null | undefined): Required<TBMostgewichtFelder> {
  if (!m) return { kmw: '', oechsle: '', mostgewicht_einheit: '' }
  return {
    kmw: formularZahl(m.kmw, KMW_STELLEN),
    oechsle: formularZahl(m.oechsle, OECHSLE_STELLEN),
    mostgewicht_einheit: m.einheit,
  }
}

/** Text für die Formblatt-Spalte „Alkohol % vol / °KMW“: °KMW auf 1 Stelle ABGERUNDET (KAN-128,
 *  Entscheidung 8 – nie über eine Stufenschwelle); ohne Mostgewicht leer */
export function tbAlkoholText(m: Mostgewicht | null | undefined): string {
  if (!m) return ''
  const t = formularZahl(abrunden(m.kmw, KMW_FORMBLATT_STELLEN), KMW_FORMBLATT_STELLEN)
  return t ? `${t} °KMW` : ''
}

/** Zahl aus einem Formulartext mit Komma oder Punkt („17,09“, „17.09“, „84“); sonst null */
function textZahl(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = feld(v).replace(/\s/g, '')
  if (!/^\d+(?:[.,]\d+)?$/.test(t)) return null
  return zahlAus(t)
}

/** °KMW bzw. °Oe im Freitext „Alkohol % vol / °KMW“ (Altformulare): „18,5 °KMW“, „18,5 KMW“, „84 °Oe“ */
const ALKOHOL_MOSTGEWICHT_RE = /(\d+(?:[.,]\d+)?)\s*°?\s*(KMW|Oe|Öchsle|Oechsle)\b/i

/**
 * Mostgewicht einer gespeicherten Position, ohne neu zu rechnen: kmw/oechsle/mostgewicht_einheit;
 * fehlen beide Werte (Altformular), der °KMW- bzw. °Oe-Wert aus `alkohol_pct`. Kein Mostgewicht → null.
 */
export function tbPositionMostgewicht(p: Partial<TBPositionMitMostgewicht> | null | undefined): Mostgewicht | null {
  if (!p) return null
  const kmw = textZahl(p.kmw)
  const oechsle = textZahl(p.oechsle)
  if (kmw !== null || oechsle !== null) {
    return mostgewichtAusGespeichert({ kmw, oechsle, einheit: feld(p.mostgewicht_einheit) || null })
  }
  const treffer = ALKOHOL_MOSTGEWICHT_RE.exec(feld(p.alkohol_pct))
  if (!treffer) return null
  const wert = textZahl(treffer[1])
  if (wert === null) return null
  return /^kmw$/i.test(treffer[2])
    ? mostgewichtAusGespeichert({ kmw: wert, einheit: 'kmw' })
    : mostgewichtAusGespeichert({ oechsle: wert, einheit: 'oechsle' })
}

/**
 * Neues Mostgewicht (Eingabe im Formular) in eine Position übernehmen. Die Formblatt-Spalte
 * `alkohol_pct` zieht nur mit, solange sie leer ist oder noch den Text des bisherigen Mostgewichts
 * trägt – ein von Hand eingetragener Alkoholgehalt („12,5 % vol“) bleibt stehen.
 */
export function tbPositionMitMostgewicht<P extends TBPositionMitMostgewicht>(p: P, m: Mostgewicht | null): P {
  const bisher = tbAlkoholText(tbPositionMostgewicht(p))
  const alkohol = feld(p.alkohol_pct)
  const mitziehen = alkohol === '' || alkohol === bisher
  return { ...p, ...tbMostgewichtFelder(m), ...(mitziehen ? { alkohol_pct: tbAlkoholText(m) } : {}) }
}
