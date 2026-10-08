// KAN-105 (08.10.2026): Folgesysteme lesen die Rechnung (Tabelle rechnungen, KAN-102), nicht mehr den Lieferschein.
// Eine Rechnung umfasst einen oder mehrere Lieferscheine (verkaufsposten.rechnung_id). Die Leser (BMD, Rechnungsjournal,
// offene Posten …) rechnen weiter mit „verkauf_positionen“ je Beleg – positionenDerRechnung() legt die Positionen aller
// Lieferscheine der Rechnung zusammen, damit die bestehende Rechenlogik unverändert bleibt.

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
  return { ...r, lieferscheine, verkauf_positionen: lieferscheine.flatMap(l => (l.verkauf_positionen ?? []) as R[]), verkaufsposten_ids: lieferscheine.map(l => String(l.id)) }
}

/** Bruttobetrag einer Position wie im Trigger sync_*_bezahlt (je Position auf Cent gerundet) */
export function positionBrutto(p: R): number {
  return Math.round((Number(p.menge) || 0) * (Number(p.preis_brutto) || 0)
    * (1 - (Number(p.rabatt_pct) || 0) / 100) * (1 - (Number(p.sonderrabatt_pct) || 0) / 100) * 100) / 100
}
