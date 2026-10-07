// Mostgewicht in °KMW (Klosterneuburger Mostwaage) und °Oe (Öchsle) – Rechenkern
// KAN-128 Teil A, S1 (26.09.2026). Ohne Importe und isomorph: Server Actions, Client-Komponenten
// und node:test (scripts/tests/mostgewicht.test.mjs) rechnen mit denselben Funktionen.
//
// Umrechnung (BKI-Anreicherungstabelle, Anlage Ia, nachgerechnet; nicht rechtsverbindlich):
//   °Oe  = °KMW × (4,54 + 0,022 × °KMW)
//   °KMW = (√(4,54² + 0,088 × °Oe) − 4,54) / 0,044
//
// Rechenregeln (KAN-128, Abschnitt „Datenmodell“):
//   1. Die °KMW-Spalte ist gesetzlich führend (Stufen, Mittel- und Mindestwerte lesen nur sie).
//   2. Gemessen in °KMW (≤ 2 Stellen): °Oe = f(°KMW), kaufmännisch auf 1 Stelle.
//   3. Gemessen in °Oe (≤ 1 Stelle): °KMW auf 0,01 nach Variante B (Entscheidung 6) – der
//      größte Wert, dessen f(°KMW) kaufmännisch auf 0,1 gerundet den Messwert nicht übersteigt
//      (Gleichsetzung wie die BKI-Tabelle: 83,5 / 94,2 / 105,0 °Oe = 17,00 / 19,00 / 21,00 °KMW).
//      Variante A (abgerundete exakte Umkehrung) nur als Vergleich: kmwVarianteA().
//   5. Umgerechnete Werte bestimmen nie eine Stufe: Stufe nur aus ausMessung().kmw, nie aus
//      kmwAusOechsle() – in JavaScript ist f⁻¹(156,0) = 29,99999999999999 statt 30.
//   7. Mittelwerte massegewichtet in °KMW, auf 2 Stellen abgerundet, °Oe daraus: mischen().
//   8./9. °KMW mit weniger Stellen als gespeichert abrunden (Entscheidung 8), °Oe mit 1 Stelle.
//
// Gleichlauf mit der Datenbank (Migration A: s112_oechsle_aus_kmw, s112_kmw_aus_oechsle): die
// Golden-Tabelle scripts/tests/golden/mostgewicht_golden.csv (50,0–250,0 °Oe, 10,00–40,00 °KMW)
// stammt aus derselben Formel in SQL und wird im Test vollständig verglichen, der Gesamtbereich
// 0–350 °Oe / 0–60 °KMW per md5 gegen SQL (B mit zwei Schritten, siehe unten). Für Werte auf dem
// 0,01-°KMW-Raster rechnet der Kern f in ganzen Zahlen (exakt wie numeric in PostgreSQL):
//   f(h / 100) = (22·h² + 454 000·h) / 10⁷   (h = °KMW-Hundertstel)

/** Gemessene bzw. bevorzugte Einheit – Werte wie in `mostgewicht_einheit` (DB). */
export type MostgewichtEinheit = 'kmw' | 'oechsle'

/** Ein Mostgewicht mit beiden Werten und der gemessenen Einheit. */
export interface Mostgewicht {
  /** °KMW auf 0,01 – führend für Stufen, Mittel- und Mindestwerte */
  kmw: number
  /** °Oe auf 0,1 */
  oechsle: number
  /** Einheit, in der gemessen wurde; die andere ist umgerechnet („≈“) */
  einheit: MostgewichtEinheit
}

export const MOSTGEWICHT_EINHEITEN: readonly MostgewichtEinheit[] = ['kmw', 'oechsle']

export const EINHEIT_ZEICHEN: Readonly<Record<MostgewichtEinheit, string>> = { kmw: '°KMW', oechsle: '°Oe' }

/** Gespeicherte Nachkommastellen (numeric(5,2) bzw. numeric(5,1)) = höchstens eingebbare */
export const KMW_STELLEN = 2
export const OECHSLE_STELLEN = 1

/** Eingabebereich wie die CHECKs der Migration A (<tabelle>_<°KMW-Spalte>_bereich_check,
 *  <tabelle>_oechsle_bereich_check). 350 °Oe = 59,78 °KMW: eine °Oe-Messung bleibt so immer unter
 *  60 °KMW (bis 26.09.2026: 0–360 °Oe – zwischen 351,7 und 360 °Oe hätte der °KMW-CHECK abgelehnt).
 *  Umgekehrt ergeben 59,79–60 °KMW gerechnet 350,1–351,6 °Oe – der °Oe-CHECK erlaubt bei Einheit
 *  'kmw' deshalb bis 351,6 (= f(60 °KMW)); ausMessung(60, 'kmw') ist gültig. */
export const KMW_MAX = 60
export const OECHSLE_MAX = 350

/** Grenzfall-Band um eine Stufenschwelle in °Oe, einschließlich (KAN-134, Jörgen 26.09.2026: ±0,5 °Oe
 *  statt bisher ±0,2 °KMW – bei 17 °KMW rund ±0,1 °KMW). Verglichen wird in °Oe, siehe imGrenzbereich(). */
export const GRENZ_BAND_OECHSLE = 0.5

/** Toleranz in Einheiten der letzten Stelle (n · 10^stellen) gegen Gleitkomma-Reste wie 1739,9999999999998 */
const TOLERANZ = 1e-9

export function istMostgewichtEinheit(x: unknown): x is MostgewichtEinheit {
  return x === 'kmw' || x === 'oechsle'
}

function pruefeEinheit(einheit: unknown): asserts einheit is MostgewichtEinheit {
  if (!istMostgewichtEinheit(einheit)) throw new RangeError(`Unbekannte Mostgewicht-Einheit: ${String(einheit)}`)
}

function faktor(stellen: number): number {
  if (!Number.isInteger(stellen) || stellen < 0 || stellen > 10) {
    throw new RangeError(`Nachkommastellen 0–10 erwartet: ${stellen}`)
  }
  return 10 ** stellen
}

// ── Formel (ungerundet) ─────────────────────────────────────────────────────

/** °Oe aus °KMW, ungerundet (nur zum Weiterrechnen; Anzeige und Speicherung über ausMessung) */
export function oechsleAusKmw(kmw: number): number {
  return kmw * (4.54 + 0.022 * kmw)
}

/** °KMW aus °Oe, ungerundet – bestimmt nie eine Stufe (Rechenregel 5), dafür ausMessung() */
export function kmwAusOechsle(oechsle: number): number {
  return (Math.sqrt(20.6116 + 0.088 * oechsle) - 4.54) / 0.044
}

// ── Rundung ─────────────────────────────────────────────────────────────────

/** Kaufmännisch gerundet (halbe Einheit vom Nullpunkt weg) mit Toleranz 1e-9 in Einheiten der
 *  letzten Stelle: runden(73.05, 1) = 73,1, obwohl die Gleitkommazahl 73.05 knapp darunter liegt
 *  (wie round() auf numeric in PostgreSQL). */
export function runden(n: number, stellen: number): number {
  const f = faktor(stellen)
  if (!Number.isFinite(n)) return n
  const r = Math.floor(Math.abs(n) * f + 0.5 + TOLERANZ)
  return (n < 0 && r !== 0 ? -r : r) / f
}

/** Abgerundet (Richtung −∞; bei Mostgewichten ≥ 0 = überzählige Stellen abschneiden) mit
 *  Toleranz 1e-9 in Einheiten der letzten Stelle: abrunden(18.95, 1) = 18,9, abrunden(17.4, 2) = 17,4
 *  (17.4 · 100 = 1739,9999999999998). Für °KMW mit weniger Stellen als gespeichert
 *  (Entscheidung 8) – hebt nie über eine Stufenschwelle. */
export function abrunden(n: number, stellen: number): number {
  const f = faktor(stellen)
  if (!Number.isFinite(n)) return n
  const r = Math.floor(n * f + TOLERANZ)
  return (r === 0 ? 0 : r) / f
}

/** Kaufmännisch gerundete ganze Einheiten der letzten Stelle (17.4, 2 → 1740) */
function einheiten(n: number, stellen: number): number {
  return Math.round(runden(n, stellen) * 10 ** stellen)
}

/** °Oe-Zehntel (kaufmännisch) zu °KMW-Hundertstel h ≥ 0 – exakt in ganzen Zahlen
 *  (h ≤ 6 200: Zwischenwerte < 2^53). */
function oeZehntel(h: number): number {
  const x = 22 * h * h + 454000 * h + 500000
  return (x - (x % 1000000)) / 1000000
}

/** Variante B: größte °KMW-Hundertstel h mit oeZehntel(h) ≤ z. Start bei der abgerundeten exakten
 *  Umkehrung (Variante A), dann nach oben: ab 42,1 °Oe höchstens ein Schritt, darunter bei 20
 *  Werten zwei (f steigt dort je 0,01 °KMW um weniger als 0,05 °Oe) – die SQL-Funktion muss
 *  deshalb a + 0,02 mitprüfen. Die Schleife nach unten sichert Gleitkomma-Reste ab. */
function kmwHundertstelVarianteB(z: number): number {
  let h = Math.max(0, Math.floor(kmwAusOechsle(z / 10) * 100 + TOLERANZ))
  while (h > 0 && oeZehntel(h) > z) h--
  while (oeZehntel(h + 1) <= z) h++
  return h
}

// ── Messwert → beide Werte ──────────────────────────────────────────────────

/**
 * Beide Werte zu einem Messwert (Rechenregeln 2 und 3).
 * - 'kmw': °KMW auf 0,01 (kaufmännisch, wie die numeric(5,2)-Spalte), °Oe = f(°KMW) auf 0,1.
 * - 'oechsle': °Oe auf 0,1, °KMW nach Variante B auf 0,01.
 * null/undefined → null (kein Mostgewicht). Keine endliche Zahl, negativ, über 60 °KMW bzw.
 * 350 °Oe (gemessen) oder unbekannte Einheit → RangeError (Eingaben vorher mit parseEingabe() prüfen).
 * Die Stufe (kmwZuQualitaet) nur aus dem Ergebnis `.kmw` ableiten.
 */
export function ausMessung(wert: number | null | undefined, einheit: MostgewichtEinheit): Mostgewicht | null {
  pruefeEinheit(einheit)
  if (wert == null) return null
  if (typeof wert !== 'number' || !Number.isFinite(wert)) {
    throw new RangeError(`Mostgewicht ist keine gültige Zahl: ${String(wert)}`)
  }
  if (einheit === 'kmw') {
    const h = einheiten(wert, KMW_STELLEN)
    if (wert < 0 || h > KMW_MAX * 100) throw new RangeError(`Mostgewicht außerhalb 0–${KMW_MAX} °KMW: ${wert}`)
    return { kmw: h / 100, oechsle: oeZehntel(h) / 10, einheit: 'kmw' }
  }
  const z = einheiten(wert, OECHSLE_STELLEN)
  if (wert < 0 || z > OECHSLE_MAX * 10) throw new RangeError(`Mostgewicht außerhalb 0–${OECHSLE_MAX} °Oe: ${wert}`)
  return { kmw: kmwHundertstelVarianteB(z) / 100, oechsle: z / 10, einheit: 'oechsle' }
}

/**
 * NUR VERGLEICH (Tests, Entscheidung 6): °KMW aus °Oe nach Variante A – exakte Umkehrung auf
 * 0,01 abgerundet, floor(f⁻¹(°Oe) · 100 + 1e-9) / 100. Nie speichern, nie für Stufen verwenden;
 * verbindlich ist Variante B in ausMessung().
 */
export function kmwVarianteA(oechsle: number): number {
  return abrunden(kmwAusOechsle(runden(oechsle, OECHSLE_STELLEN)), KMW_STELLEN)
}

/**
 * Kleinster °Oe-Messwert (mit `stellen` Nachkommastellen: 1 = 0,1-Raster, 0 = ganze °Oe), der
 * nach Variante B mindestens `kmw` °KMW ergibt – z. B. 17 °KMW (Kabinett): 83,5 bzw. 84 °Oe,
 * 21 °KMW (Auslese): 105,0 bzw. 105 °Oe. Eine Schwelle mit mehr als 2 Stellen zählt ab dem
 * nächsten 0,01-°KMW-Wert.
 */
export function mindestOechsle(kmw: number, stellen: 0 | 1 = 1): number {
  if (stellen !== 0 && stellen !== 1) throw new RangeError(`mindestOechsle: 0 oder 1 Nachkommastelle erwartet: ${stellen}`)
  if (typeof kmw !== 'number' || !Number.isFinite(kmw) || kmw < 0 || kmw > KMW_MAX) {
    throw new RangeError(`mindestOechsle: °KMW 0–${KMW_MAX} erwartet: ${String(kmw)}`)
  }
  const z = oeZehntel(Math.ceil(kmw * 100 - TOLERANZ))
  return stellen === 1 ? z / 10 : Math.ceil(z / 10)
}

// ── Mittelwerte ─────────────────────────────────────────────────────────────

export interface MischTeil {
  /** Menge in kg (Standard) oder Liter (mengeneinheit 'l') – beides direkt als Gewicht */
  menge: number | null | undefined
  /** °KMW des Teils (die führende Spalte, nie aus °Oe zurückgerechnet) */
  kmw: number | null | undefined
}

/**
 * Mengengewichtetes Mostgewicht mehrerer Teile (Rechenregel 7), immer in °KMW gemittelt – nie °Oe mitteln
 * (je 50 % 14 und 22 °KMW = 18,00 °KMW = 88,8 °Oe; das °Oe-Mittel wäre 89,2). Gewicht: kg (Lese, Pressung,
 * Erntemeldung – nur Trauben-kg) bzw. Liter (mengeneinheit 'l', Kellerkette: Umzug, Verschnitt, Zusammenführen –
 * Entscheidung Jörgen 07.10.2026, KAN-130: nach Litern, je 500 L 14/22 °KMW = 18,00 statt 18,07 über die Dichte).
 * Ergebnis auf 2 Stellen abgerundet, °Oe daraus, Einheit 'kmw'.
 * Teile ohne gültige Menge > 0 oder ohne °KMW zählen nicht (wie heute im Pressungs-Ø);
 * ohne zählenden Teil → null. Fehlende Quellen (KAN-130, Jörgen 01.10.2026): nur die Teile mit Wert zählen,
 * das Ergebnis gilt dann als „teilweise“ – siehe mischenMitAnteil().
 */
export function mischen(teile: readonly MischTeil[], mengeneinheit: 'kg' | 'l' = 'kg'): Mostgewicht | null {
  if (mengeneinheit !== 'kg' && mengeneinheit !== 'l') throw new RangeError(`mischen: Mengeneinheit 'kg' oder 'l' erwartet: ${String(mengeneinheit)}`)
  let masse = 0
  let zucker = 0
  for (const t of teile) {
    const { menge, kmw } = t
    if (typeof menge !== 'number' || !Number.isFinite(menge) || menge <= 0) continue
    if (typeof kmw !== 'number' || !Number.isFinite(kmw) || kmw < 0) continue
    // KAN-130 (07.10.2026): Liter direkt als Gewicht, keine Umrechnung über die Dichte
    masse += menge
    zucker += menge * kmw
  }
  if (!(masse > 0)) return null
  const h = Math.round(abrunden(zucker / masse, KMW_STELLEN) * 100)
  return { kmw: h / 100, oechsle: oeZehntel(h) / 10, einheit: 'kmw' }
}

/** Ergebnis von mischenMitAnteil(): Mittel plus Anzahl der Teile mit Menge (gesamt) bzw. mit Menge und °KMW (mitWert) */
export interface MischErgebnis {
  mostgewicht: Mostgewicht | null
  /** true, wenn mindestens ein Teil mit Menge > 0 kein °KMW hat, aber andere eines haben */
  teilweise: boolean
  mitWert: number
  gesamt: number
}

/**
 * mischen() samt Kennzeichnung fehlender Quellen (KAN-130, Entscheidung 1, Jörgen 01.10.2026): Teile ohne
 * Mostgewicht bleiben draußen, das Mittel heißt dann „teilweise“. Pressungs-Ø (Formular und Server Action)
 * und später Umzug/Verschnitt rechnen damit, damit Anzeige, Stufe und gespeicherter Wert gleich sind.
 */
export function mischenMitAnteil(teile: readonly MischTeil[], mengeneinheit: 'kg' | 'l' = 'kg'): MischErgebnis {
  const mitMenge = teile.filter(t => typeof t.menge === 'number' && Number.isFinite(t.menge) && t.menge > 0)
  const mitWert = mitMenge.filter(t => typeof t.kmw === 'number' && Number.isFinite(t.kmw) && t.kmw >= 0).length
  const mostgewicht = mischen(mitMenge, mengeneinheit)
  return { mostgewicht, teilweise: mostgewicht != null && mitWert < mitMenge.length, mitWert, gesamt: mitMenge.length }
}

// ── Grenzfall ───────────────────────────────────────────────────────────────

/** °Oe-Zehntel zu einem °KMW-Wert nach der Formel, kaufmännisch auf 0,1 – wie ausMessung(k, 'kmw'):
 *  auf dem 0,01-°KMW-Raster exakt in ganzen Zahlen, sonst über die Gleitkomma-Formel.
 *  Keine endliche Zahl oder negativ → null. */
function oechsleZehntelAusKmw(kmw: unknown): number | null {
  if (typeof kmw !== 'number' || !Number.isFinite(kmw) || kmw < 0) return null
  const h = Math.round(kmw * 100)
  if (Math.abs(kmw * 100 - h) < 1e-6 && h <= KMW_MAX * 100) return oeZehntel(h)
  return Math.round(runden(oechsleAusKmw(kmw), OECHSLE_STELLEN) * 10)
}

/** °Oe-Zehntel eines Mostgewichts für den Grenzfall: gemessen in °Oe → der Messwert, sonst aus °KMW
 *  nach der Formel (ein gespeicherter, umgerechneter °Oe-Wert zählt nicht). Zahl = °KMW. */
function grenzOechsleZehntel(wert: Mostgewicht | number | null | undefined): number | null {
  if (wert == null) return null
  if (typeof wert === 'number') return oechsleZehntelAusKmw(wert)
  if (typeof wert !== 'object') return null
  if (wert.einheit === 'oechsle' && typeof wert.oechsle === 'number' && Number.isFinite(wert.oechsle) && wert.oechsle >= 0) {
    return Math.round(runden(wert.oechsle, OECHSLE_STELLEN) * 10)
  }
  return oechsleZehntelAusKmw(wert.kmw)
}

/**
 * Liegt das Mostgewicht höchstens `band` °Oe (Standard ±0,5 °Oe, einschließlich) von einer der
 * Schwellen entfernt? Liefert die nächstgelegene Schwelle (in °KMW), sonst null.
 *
 * Verglichen wird in °Oe (KAN-134): der °Oe-Wert des Mostgewichts – gemessen, sonst aus °KMW nach
 * der Formel auf 0,1 gerundet – gegen den °Oe-Wert der Schwelle nach derselben Formel
 * (17 °KMW = 83,5 °Oe). Beispiele um Kabinett: 83,0–84,0 °Oe gemessen und 16,9 °KMW (= 83,0 °Oe)
 * → 17; 16,8 °KMW (82,5 °Oe) und 17,2 °KMW (84,6 °Oe) → null. `wert` als Zahl = °KMW.
 *
 * Schwellen in °KMW als Parameter (z. B. die Mindest-°KMW der Stufen aus lib/weinqualitaet), damit
 * der Kern ohne Importe bleibt. Für den Hinweis auf die BKI-Tabelle; bei Prädikatswein zählt die
 * Bestätigung der Mostwäger (§ 11 Abs. 2, § 12 Abs. 6 WeinG).
 */
export function imGrenzbereich(
  wert: Mostgewicht | number | null | undefined,
  schwellenKmw: readonly number[],
  band: number = GRENZ_BAND_OECHSLE,
): number | null {
  const z = grenzOechsleZehntel(wert)
  if (z == null) return null
  if (!(band >= 0)) throw new RangeError(`imGrenzbereich: Band ≥ 0 °Oe erwartet: ${band}`)
  let treffer: number | null = null
  let bester = Infinity
  for (const s of schwellenKmw) {
    const zs = oechsleZehntelAusKmw(s)
    if (zs == null) continue
    // in ganzen °Oe-Zehnteln: 84,0 − 83,5 ist exakt 5, nicht 0,5000000000000142 · 10
    const abstand = Math.abs(z - zs)
    if (abstand <= band * 10 + TOLERANZ && abstand < bester) {
      treffer = s
      bester = abstand
    }
  }
  return treffer
}

// ── Eingabe ─────────────────────────────────────────────────────────────────

export type MostgewichtParseErgebnis =
  | { ok: true; wert: number | null }
  | { ok: false; fehler: string }

/**
 * Prüft eine Texteingabe in der angegebenen Einheit: Komma oder Punkt als Dezimaltrennzeichen,
 * °KMW mit höchstens 2 und °Oe mit höchstens 1 Nachkommastelle (Nullen am Ende zählen nicht:
 * „83,50“ = 83,5), Bereich 0–60 °KMW bzw. 0–350 °Oe. Leer (auch nur Leerzeichen) = null.
 */
export function parseEingabe(text: string | null | undefined, einheit: MostgewichtEinheit): MostgewichtParseErgebnis {
  pruefeEinheit(einheit)
  const zeichen = EINHEIT_ZEICHEN[einheit]
  const s = String(text ?? '').trim()
  if (s === '') return { ok: true, wert: null }
  if (/^[-−]/.test(s)) return { ok: false, fehler: 'Das Mostgewicht darf nicht negativ sein.' }
  const m = /^(\d*)(?:[.,](\d*))?$/.exec(s)
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) {
    return { ok: false, fehler: `Bitte gib das Mostgewicht als Zahl in ${zeichen} ein (z. B. ${einheit === 'kmw' ? '17,4' : '84'}).` }
  }
  const nachkomma = (m[2] ?? '').replace(/0+$/, '')
  if (einheit === 'kmw' && nachkomma.length > KMW_STELLEN) {
    return { ok: false, fehler: `°KMW bitte mit höchstens ${KMW_STELLEN} Nachkommastellen eingeben (z. B. 17,45).` }
  }
  if (einheit === 'oechsle' && nachkomma.length > OECHSLE_STELLEN) {
    return { ok: false, fehler: '°Oe bitte mit höchstens einer Nachkommastelle eingeben (z. B. 83,5).' }
  }
  const wert = Number(`${m[1] || '0'}.${nachkomma || '0'}`)
  const max = einheit === 'kmw' ? KMW_MAX : OECHSLE_MAX
  if (!Number.isFinite(wert) || wert > max) {
    return { ok: false, fehler: `Das Mostgewicht muss zwischen 0 und ${max} ${zeichen} liegen.` }
  }
  return { ok: true, wert }
}

// ── Anzeige ─────────────────────────────────────────────────────────────────

/** °KMW als Text mit Dezimalkomma: höchstens `stellen` Nachkommastellen (abgerundet,
 *  Entscheidung 8), mindestens eine – 17.4 → „17,4“, 17.09 → „17,09“, 18.95 mit 1 → „18,9“. */
export function formatKmw(kmw: number, stellen: 1 | 2 = KMW_STELLEN): string {
  if (stellen !== 1 && stellen !== 2) throw new RangeError(`formatKmw: 1 oder 2 Nachkommastellen erwartet: ${stellen}`)
  let t = abrunden(kmw, stellen).toFixed(stellen)
  if (stellen === 2 && t.endsWith('0')) t = t.slice(0, -1)
  return t.replace('.', ',')
}

/** °Oe als Text mit genau einer Nachkommastelle und Dezimalkomma (84 → „84,0“) */
export function formatOechsle(oechsle: number): string {
  return runden(oechsle, OECHSLE_STELLEN).toFixed(OECHSLE_STELLEN).replace('.', ',')
}

/**
 * Beide Werte, die bevorzugte Einheit zuerst (ohne Angabe: die gemessene), der umgerechnete
 * Wert mit „≈“: „84,0 °Oe · ≈ 17,09 °KMW“ (gemessen in °Oe), „17,4 °KMW · ≈ 85,7 °Oe“
 * (gemessen in °KMW). °KMW mit höchstens `kmwStellen` Stellen, abgerundet (Entscheidung 8);
 * °Oe mit 1 Stelle. Ohne Mostgewicht: ''.
 */
export function format(
  m: Mostgewicht | null | undefined,
  bevorzugt?: MostgewichtEinheit | null,
  optionen: { kmwStellen?: 1 | 2 } = {},
): string {
  if (!m) return ''
  const kmw = `${m.einheit === 'kmw' ? '' : '≈ '}${formatKmw(m.kmw, optionen.kmwStellen ?? 2)} °KMW`
  const oe = `${m.einheit === 'oechsle' ? '' : '≈ '}${formatOechsle(m.oechsle)} °Oe`
  return (bevorzugt ?? m.einheit) === 'oechsle' ? `${oe} · ${kmw}` : `${kmw} · ${oe}`
}
