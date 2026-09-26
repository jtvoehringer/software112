// Mostgewicht zwischen Formular, Server Action und Datenbank – KAN-128 Teil A, S4 (26.09.2026)
//
// Isomorph und ohne '@/'-Importe (node:test: scripts/tests/mostgewicht-eingabe.test.mjs), also auch
// in Server Actions verwendbar. Die Eingabe-Komponente (src/components/wein/MostgewichtEingabe.tsx)
// schickt je Mostgewicht drei versteckte Felder:
//   <name>_wert     Messwert wie eingegeben („83,5“; leer = gelöscht)
//   <name>_einheit  gemessene Einheit ('kmw' | 'oechsle')
//   <altesFeld>     übergangsweise der °KMW-Wert für noch nicht umgestellte Actions
//                   (klosterneuburger, kmw_grad, kmw)
// Die Action rechnet selbst (kein Client-Wert zählt): mostgewichtAusFormular() → ausMessung(), dann
// mostgewichtSpalten() – beide Werte konsistent und die Einheit, damit das Ergebnis auch ohne den
// Abgleich-Trigger der Migration A stimmt (Rechenregeln 1–4).

import {
  abrunden, ausMessung, istMostgewichtEinheit, kmwAusOechsle, oechsleAusKmw, parseEingabe, runden,
  KMW_STELLEN, OECHSLE_STELLEN,
  type Mostgewicht, type MostgewichtEinheit,
} from './mostgewicht'

/** Gespeicherte Werte einer Zeile (Zahlen oder numerische Texte aus der Datenbank) */
export interface GespeichertesMostgewicht {
  kmw?: number | string | null
  oechsle?: number | string | null
  einheit?: string | null
}

function zahl(x: unknown): number | null {
  if (x == null) return null
  if (typeof x === 'string' && x.trim() === '') return null
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x.trim()) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Gespeicherte Werte → Mostgewicht, OHNE neu zu rechnen (Öffnen eines Formulars, Anzeige): beide
 * Werte wie gespeichert, nur ein fehlender wird aus dem Messwert berechnet. Einheit wie gespeichert;
 * ohne (Zeilen vor der Migration A) 'kmw', bei nur °Oe 'oechsle'. Wie der Trigger: eine Einheit,
 * deren Wert fehlt, fällt auf die andere zurück. Weder °KMW noch °Oe → null.
 */
export function mostgewichtAusGespeichert(g: GespeichertesMostgewicht | null | undefined): Mostgewicht | null {
  const k = zahl(g?.kmw)
  const o = zahl(g?.oechsle)
  if (k == null && o == null) return null
  const gespeichert = g?.einheit
  let einheit: MostgewichtEinheit = istMostgewichtEinheit(gespeichert) ? gespeichert : (k == null ? 'oechsle' : 'kmw')
  if (einheit === 'oechsle' && o == null) einheit = 'kmw'
  if (einheit === 'kmw' && k == null) einheit = 'oechsle'
  if (k != null && o != null) return { kmw: k, oechsle: o, einheit }
  let berechnet: Mostgewicht | null = null
  try {
    berechnet = ausMessung(k ?? o, einheit)
  } catch {
    // außerhalb des Eingabebereichs (Altbestand): trotzdem nach der Formel zeigen statt nichts
  }
  if (k != null) return { kmw: k, oechsle: berechnet?.oechsle ?? runden(oechsleAusKmw(k), OECHSLE_STELLEN), einheit }
  const oe = o as number
  return { kmw: berechnet?.kmw ?? abrunden(kmwAusOechsle(oe), KMW_STELLEN), oechsle: oe, einheit }
}

export type MostgewichtFormularErgebnis =
  /** wert null = leer bzw. gelöscht (beide Spalten NULL); uebermittelt false = Feld nicht im
   *  Formular (Spalten unverändert lassen) */
  | { ok: true; wert: Mostgewicht | null; uebermittelt: boolean }
  | { ok: false; fehler: string }

/**
 * Liest ein Mostgewicht der Eingabe-Komponente aus dem Formular (`<name>_wert`, `<name>_einheit`)
 * und rechnet beide Werte serverseitig (ausMessung, Variante B). Fehlt `<name>_wert`, aber das
 * alte Feld (`altesFeld`, z. B. 'klosterneuburger') ist da, gilt dessen Wert als °KMW-Messung
 * (Formulare, die noch nicht umgestellt sind). `bezeichnung` stellt Fehlern z. B. die
 * Grundstücksnummer voran. Stufen nur aus `wert.kmw` ableiten (Rechenregel 5).
 */
export function mostgewichtAusFormular(
  fd: FormData,
  name: string,
  optionen: { altesFeld?: string; bezeichnung?: string } = {},
): MostgewichtFormularErgebnis {
  const fehler = (text: string): MostgewichtFormularErgebnis =>
    ({ ok: false, fehler: optionen.bezeichnung ? `${optionen.bezeichnung}: ${text}` : text })

  let roh = fd.get(`${name}_wert`)
  let einheit: unknown = fd.get(`${name}_einheit`)
  if (roh === null) {
    if (!optionen.altesFeld || !fd.has(optionen.altesFeld)) return { ok: true, wert: null, uebermittelt: false }
    roh = fd.get(optionen.altesFeld)
    einheit = 'kmw'
  }
  if (typeof roh !== 'string') return fehler('Das Mostgewicht ist keine gültige Eingabe.')
  if (roh.trim() === '') return { ok: true, wert: null, uebermittelt: true }
  if (!istMostgewichtEinheit(einheit)) return fehler('Bitte gib an, ob das Mostgewicht in °KMW oder °Oe gemessen wurde.')
  const p = parseEingabe(roh, einheit)
  if (!p.ok) return fehler(p.fehler)
  return { ok: true, wert: ausMessung(p.wert, einheit), uebermittelt: true }
}

/**
 * Spaltenwerte zum Schreiben: °KMW-Spalte (`kmwSpalte`: klosterneuburger, kmw_grad, kmw), `oechsle`
 * und `mostgewicht_einheit`. Beide Werte immer gemeinsam – Löschen setzt beide auf NULL (Einheit
 * 'kmw', die Spalte ist NOT NULL); nur `oechsle = NULL` rechnete der Trigger aus dem alten °KMW
 * zurück (Rechenregel 4).
 */
export function mostgewichtSpalten<K extends string>(
  m: Mostgewicht | null,
  kmwSpalte: K,
): Record<K, number | null> & { oechsle: number | null; mostgewicht_einheit: MostgewichtEinheit } {
  return {
    [kmwSpalte]: m ? m.kmw : null,
    oechsle: m ? m.oechsle : null,
    mostgewicht_einheit: m ? m.einheit : 'kmw',
  } as Record<K, number | null> & { oechsle: number | null; mostgewicht_einheit: MostgewichtEinheit }
}
