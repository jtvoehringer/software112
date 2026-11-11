// KAN-414 (11.11.2026): Leergewicht der Flasche an der Füllung (g, inkl. Verschluss, Kapsel, Etikett) – optional,
// Grundlage für das Bruttogewicht im Weinexport (src/lib/export/gewicht.ts). Dieselbe Grenze wie in der Datenbank
// (CHECK fuellungen_leergewicht_chk, RPC s112_fuellung_aendern): 1 … 5.000 g oder leer.
// Isomorph, ohne '@/'-Importe (node:test).

export const LEERGEWICHT_MAX_G = 5000

/** Prüfung der Eingabe: `roh` ist der Formularwert, `wert` die daraus gelesene Zahl (null = leer oder keine Zahl); null = in Ordnung */
export function leergewichtFehler(roh: unknown, wert: number | null): string | null {
  const text = roh == null ? '' : String(roh).trim()
  if (!text) return null
  if (wert === null || !Number.isFinite(wert)) return 'Das Leergewicht der Flasche ist keine gültige Zahl (Angabe in Gramm).'
  if (!(wert > 0) || wert > LEERGEWICHT_MAX_G) return 'Das Leergewicht der Flasche muss zwischen 1 und 5.000 g liegen (oder leer bleiben).'
  return null
}
