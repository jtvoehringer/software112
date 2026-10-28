// ── Reihenfolge von Vorgängen: Tag, dann Erfassungszeitpunkt, dann id (KAN-384, 28.10.2026) ───────────────────
//
// Buchungen haben meist nur ein Datum (Tag des Vorgangs), aber jede Zeile hat ihren Erfassungszeitpunkt
// (created_at bzw. erstellt_am). Sortiert nur nach dem Tag, standen mehrere Vorgänge desselben Tages zufällig bzw.
// in der Reihenfolge, in der der Code sie einsammelt (UAT 28.10.2026: Weinbuch mit Analyse, Prüfnummer, Verschnitt
// und Abstufung am selben Tag). Innerhalb des Tages entscheidet daher der Erfassungszeitpunkt, zuletzt die id –
// Zeilen aus derselben Buchung haben denselben Zeitpunkt und stehen so trotzdem immer gleich.
// Datenbank-Abfragen: .order('<datum>').order('<created_at|erstellt_am>').order('id') (Wächter check-reihenfolge).
// Ohne '@/'-Importe, damit node:test sie prüfen kann.

export type Richtung = 'auf' | 'ab'

export interface Reihenfolgeschluessel {
  /** Tag des Vorgangs ('JJJJ-MM-TT' oder Zeitstempel – verglichen werden die ersten 10 Zeichen) */
  tag: string | null | undefined
  /** Erfassungszeitpunkt (Zeitstempel); fehlt er, steht der Vorgang am Anfang seines Tages */
  zeit?: string | null
  /** letzte Stufe bei gleichem Zeitpunkt */
  id?: string | null
}

function zeitWert(z: string | null | undefined): number {
  if (!z) return Number.NEGATIVE_INFINITY
  const ms = Date.parse(z)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

/** Vergleich zweier Schlüssel: Tag, dann Zeitpunkt, dann id – aufsteigend bzw. absteigend */
export function vergleicheTagUndZeit(a: Reihenfolgeschluessel, b: Reihenfolgeschluessel, richtung: Richtung = 'auf'): number {
  const r = richtung === 'ab' ? -1 : 1
  const t = String(a.tag ?? '').slice(0, 10).localeCompare(String(b.tag ?? '').slice(0, 10))
  if (t !== 0) return r * t
  const za = zeitWert(a.zeit), zb = zeitWert(b.zeit)
  if (za !== zb) return r * (za < zb ? -1 : 1)
  // gleiche Millisekunde: Zeichenkette (Mikrosekunden aus PostgreSQL), dann id
  const zs = String(a.zeit ?? '').localeCompare(String(b.zeit ?? ''))
  if (zs !== 0) return r * zs
  return r * String(a.id ?? '').localeCompare(String(b.id ?? ''))
}

/** Vergleichsfunktion für Array.sort: nachTagUndZeit(x => ({ tag: x.datum, zeit: x.erstellt_am, id: x.id }), 'ab') */
export function nachTagUndZeit<T>(schluessel: (x: T) => Reihenfolgeschluessel, richtung: Richtung = 'auf'): (a: T, b: T) => number {
  return (a, b) => vergleicheTagUndZeit(schluessel(a), schluessel(b), richtung)
}

/** Termin (Kalender): Tag, ganztägige zuerst, dann Startzeit („HH:MM[:SS]“), zuletzt id – Ersatz für den reinen Datumsvergleich */
export interface TerminSchluessel { datum: string; ganztags?: boolean | null; uhrzeit_von?: string | null; id?: string | null }

export function vergleicheTermine(a: TerminSchluessel, b: TerminSchluessel): number {
  const t = a.datum.slice(0, 10).localeCompare(b.datum.slice(0, 10))
  if (t !== 0) return t
  const za = a.ganztags || !a.uhrzeit_von ? '' : a.uhrzeit_von
  const zb = b.ganztags || !b.uhrzeit_von ? '' : b.uhrzeit_von
  if (za !== zb) return za.localeCompare(zb)
  return String(a.id ?? '').localeCompare(String(b.id ?? ''))
}
