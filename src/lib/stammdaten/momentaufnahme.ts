// Momentaufnahmen auf Belegen (KAN-150 F1c, Migration 20261001122107): verkaufsposten / traubenverkauf /
// zukauf_posten / exportauftraege.partner_daten bzw. ea_transaktionen.stamm_daten halten Käufer, Empfänger,
// Lieferant und Kategorie so fest, wie sie beim Anlegen (bzw. beim bewussten Wechsel) waren – in derselben Form wie
// die Einbettungen der Loader ({ kontakt: {vorname, nachname, …}, firma: {name, …} }). Isomorph, ohne '@/'-Importe.
//
// Die Loader laden die Momentaufnahme mit und wenden sie direkt nach dem Laden an (momentaufnahmeAnwenden): Danach
// stehen in den Einbettungen die Daten des Belegs, die Formatierung bleibt unverändert. Regel:
//  - gibt es die Momentaufnahme, gilt ihr Teil – auch ein leerer (z. B. kein Kontakt beim Barverkauf, oder eine Firma,
//    die erst durch „In Firma umwandeln“ dazukam); Felder, die sie nicht führt (id, email …), kommen aus den Stammdaten;
//  - ohne Momentaufnahme (Belege vor der Migration, Testdoppel) bleibt die Einbettung, wie sie ist.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function istMomentaufnahme(m: unknown): m is R {
  return !!m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m as R).length > 0
}

/**
 * Überschreibt die Einbettungen einer Zeile mit der Momentaufnahme.
 * teile: Name der Einbettung → Schlüssel in der Momentaufnahme (gleich, wenn als Text angegeben),
 * z. B. ['kontakt', 'firma'] oder { kontakte: 'kontakt', firmen: 'firma' }.
 */
export function momentaufnahmeAnwenden<T extends R | null | undefined>(
  zeile: T, teile: readonly string[] | Record<string, string>, spalte = 'partner_daten',
): T {
  if (!zeile) return zeile
  const m = (zeile as R)[spalte]
  if (!istMomentaufnahme(m)) return zeile
  const paare: [string, string][] = Array.isArray(teile) ? teile.map(t => [t, t]) : Object.entries(teile as Record<string, string>)
  for (const [einbettung, schluessel] of paare) {
    const teil = m[schluessel]
    const live = (zeile as R)[einbettung]
    ;(zeile as R)[einbettung] = teil && typeof teil === 'object'
      ? { ...(live && typeof live === 'object' ? live : {}), ...teil }
      : null
  }
  return zeile
}

/** Für eine Liste von Zeilen (gibt dieselbe Liste zurück) */
export function momentaufnahmenAnwenden<T extends R>(zeilen: T[], teile: readonly string[] | Record<string, string>, spalte = 'partner_daten'): T[] {
  for (const z of zeilen) momentaufnahmeAnwenden(z, teile, spalte)
  return zeilen
}
