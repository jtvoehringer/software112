// ── Was ein Profil in lesbaren Seiten NICHT tun kann (KAN-456 PR 4, 14.11.2026) ─────────────────────────────────
//
// „Vertrieb“ liest Verkauf und Lager, aber weder Kellerbuch noch Lese. Die Datenbank liefert ihm aus diesen Bereichen
// 0 Zeilen – ohne Fehler. Prüfungen, die auf solche Daten angewiesen sind, fielen deshalb still falsch aus:
//   • Zukauf von Trauben/Maische ändern oder stornieren: „schon verpresst bzw. verkauft?“ → 0 Treffer → erlaubt
//   • Verkauf mit Trauben stornieren: der Traubenverkauf (BKI) bliebe aktiv, der Verkauf gälte als storniert
//   • Tankverkauf, Zukauf von Wein/Most ins Gebinde: leere Auswahl bzw. Rechtefehler erst beim Speichern
// Regel: Was Daten eines Bereichs braucht, gibt es nur mit Leserecht auf diesen Bereich – in der Oberfläche
// ausgeblendet UND in der Server Action abgelehnt (dieselbe Funktion). Ohne Profil liest jeder alles: keine Änderung.
// Isomorph, ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – .ts-Endung für node:test (kein Bundler)
import { canRead, type Lesebereich } from './lesebereiche.ts'

type Mitglied = { role?: unknown; profil?: unknown } | null | undefined

const BEREICH_NAME: Partial<Record<Lesebereich, string>> = { keller: 'Kellerbuch', lese: 'Lese' }

function fehlt(m: Mitglied, bereich: Lesebereich, was: string): string | null {
  return canRead(m, bereich) ? null : `${was} – dafür fehlt dir das Leserecht für den Bereich ${BEREICH_NAME[bereich] ?? bereich}. Bitte an die Betriebsleitung wenden.`
}

/** Zukauf-Art: Flaschen (Handelsware) immer; Wein und Most brauchen das Kellerbuch (Gebinde, Charge), Trauben und
 *  Maische die Lese (verpresst bzw. weiterverkauft?). Gilt für Erfassen, Ändern und Stornieren. */
export function zukaufArtFehler(m: Mitglied, art: string | null | undefined): string | null {
  if (art === 'flaschen') return null
  if (art === 'trauben' || art === 'maische') return fehlt(m, 'lese', 'Zukäufe von Trauben und Maische können hier nicht erfasst, geändert oder storniert werden')
  return fehlt(m, 'keller', 'Zukäufe von Wein und Most können hier nicht erfasst, geändert oder storniert werden')
}

/** Zukauf-Arten, die das Mitglied erfassen kann (Reihenfolge wie im Formular) */
export function zukaufArtenErlaubt(m: Mitglied): string[] {
  return ['wein', 'most', 'trauben', 'maische', 'flaschen'].filter(a => zukaufArtFehler(m, a) === null)
}

/** Positionstyp eines Verkaufs: Flasche und Sonstiges immer; Tank braucht das Kellerbuch, Trauben die Lese.
 *  Gilt für Erfassen und Stornieren. */
export function verkaufTypFehler(m: Mitglied, typ: string | null | undefined): string | null {
  if (typ === 'tank') return fehlt(m, 'keller', 'Ein Tankverkauf (offener Wein) kann hier nicht erfasst oder storniert werden')
  if (typ === 'trauben') return fehlt(m, 'lese', 'Ein Verkauf von Weintrauben kann hier nicht erfasst oder storniert werden')
  return null
}

/** Positionstypen, die das Mitglied erfassen kann */
export function verkaufTypenErlaubt(m: Mitglied): string[] {
  return ['flasche', 'tank', 'sonstiges', 'trauben'].filter(t => verkaufTypFehler(m, t) === null)
}

/** Erster Fehler über alle Positionen eines Verkaufs (Storno, Erfassen) */
export function verkaufPositionenFehler(m: Mitglied, positionen: readonly { typ?: unknown; traubenverkauf_id?: unknown; weinausbau_id?: unknown }[]): string | null {
  for (const p of positionen) {
    const typ = p.traubenverkauf_id ? 'trauben' : p.weinausbau_id ? 'tank' : typeof p.typ === 'string' ? p.typ : null
    const f = verkaufTypFehler(m, typ)
    if (f) return f
  }
  return null
}
