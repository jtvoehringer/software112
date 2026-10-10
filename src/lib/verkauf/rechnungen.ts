// KAN-105 (08.10.2026): Folgesysteme lesen die Rechnung (Tabelle rechnungen, KAN-102), nicht mehr den Lieferschein.
// Eine Rechnung umfasst einen oder mehrere Lieferscheine (verkaufsposten.rechnung_id). Die Leser (BMD, Rechnungsjournal,
// offene Posten …) rechnen weiter mit „verkauf_positionen“ je Beleg – positionenDerRechnung() legt die Positionen aller
// Lieferscheine der Rechnung zusammen, damit die bestehende Rechenlogik unverändert bleibt.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt (wie lib/buchhaltung/bmd.ts)
import { dezimal } from '../format.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler } from '../fehler.ts'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** select-Teil: Lieferscheine einer Rechnung mit ihren Positionen (Spaltenliste der Positionen wie bisher beim Leser) */
export function lieferscheineSelect(positionen: string, lieferscheinFelder = 'id, lieferscheinnummer, datum'): string {
  return `lieferscheine:verkaufsposten!rechnung_id(${lieferscheinFelder}, verkauf_positionen(${positionen}))`
}

/** Lieferscheine einer geladenen Rechnung, sortiert nach Lieferdatum und Nummer */
export function lieferscheineDerRechnung(r: R): R[] {
  return [...((r.lieferscheine ?? []) as R[])].sort((a, b) =>
    String(a.datum ?? '').localeCompare(String(b.datum ?? '')) || String(a.lieferscheinnummer ?? '').localeCompare(String(b.lieferscheinnummer ?? '')))
}

/** Alle Positionen der Lieferscheine einer Rechnung (Reihenfolge: Lieferschein, dann Position) */
export function positionenDerRechnung(r: R): R[] {
  return lieferscheineDerRechnung(r).flatMap(l => (l.verkauf_positionen ?? []) as R[])
}

/**
 * Rechnung in die Form bringen, die die Leser bisher vom Verkaufsposten kannten: verkauf_positionen = Positionen aller
 * Lieferscheine, lieferscheine = sortiert, verkaufsposten_ids = Lieferscheine (für Verknüpfungen wie den BMD-Export).
 */
export function alsBeleg<T extends R>(r: T): T & { verkauf_positionen: R[]; lieferscheine: R[]; verkaufsposten_ids: string[] } {
  const lieferscheine = lieferscheineDerRechnung(r)
  // KAN-103: Eine stornierte Rechnung hat keine Lieferscheine mehr (die sind wieder „nicht berechnet“) – ihre Beträge
  // stehen in der Momentaufnahme storno_positionen (Rechnungsjournal: stornierte Rechnungen mit ihren Beträgen)
  if (lieferscheine.length === 0 && Array.isArray(r.storno_positionen)) {
    return { ...r, lieferscheine: [], verkauf_positionen: r.storno_positionen as R[], verkaufsposten_ids: [] }
  }
  return { ...r, lieferscheine, verkauf_positionen: lieferscheine.flatMap(l => (l.verkauf_positionen ?? []) as R[]), verkaufsposten_ids: lieferscheine.map(l => String(l.id)) }
}

/** Bruttobetrag einer Position wie im Trigger sync_*_bezahlt (je Position auf Cent gerundet) */
export function positionBrutto(p: R): number {
  return rund((Number(p.menge) || 0) * (Number(p.preis_brutto) || 0)
    * (1 - (Number(p.rabatt_pct) || 0) / 100) * (1 - (Number(p.sonderrabatt_pct) || 0) / 100), 2)
}

/**
 * KAN-103: Preise je Position aus dem Formular „Rechnung erstellen“ (Felder preis_<positionId>, rabatt_<positionId>;
 * Dezimalkomma erlaubt) für s112_rechnung_erstellen. Leere Felder bleiben unverändert; ungültige Werte → Fehler.
 */
export function rechnungPreiseAusFormular(formData: { forEach(cb: (wert: unknown, schluessel: string) => void): void }): { position_id: string; preis_brutto: number; rabatt_pct?: number }[] {
  const zahl = (v: unknown) => {
    const t = dezimal(v)   // „1.250,50“ wie „1250.50“ (lib/format)
    if (t === '') return null
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0) throw new AktionsFehler('Bitte gültige Preise bzw. Rabatte angeben.')
    return n
  }
  const preise = new Map<string, { position_id: string; preis_brutto: number; rabatt_pct?: number }>()
  const rabatte = new Map<string, number>()
  formData.forEach((wert, schluessel) => {
    const p = /^preis_([0-9a-f-]{36})$/.exec(schluessel)
    const r = /^rabatt_([0-9a-f-]{36})$/.exec(schluessel)
    if (p) { const n = zahl(wert); if (n != null) preise.set(p[1], { position_id: p[1], preis_brutto: n }) }
    if (r) { const n = zahl(wert); if (n != null) { if (n > 100) throw new AktionsFehler('Rabatt höchstens 100 %.'); rabatte.set(r[1], n) } }
  })
  for (const [id, n] of rabatte) {
    const e = preise.get(id)
    if (e) e.rabatt_pct = n
  }
  return [...preise.values()]
}
