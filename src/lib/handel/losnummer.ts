// ── Los-/Chargennummer der Füllung und Weinpass-Code (KAN-92, 07.10.2026) ──
//
// Loskennzeichnung (RL 2011/91/EU): Jede Füllung trägt eine Los-/Chargennummer (fuellungen.chargennummer), je Betrieb
// eindeutig (UNIQUE tenant_id, chargennummer) und nach dem Speichern unveränderlich (Freeze, KAN-101). Vergeben wird sie
// beim Speichern über get_next_chargennummer (Präfix-Jahr-Zähler); das Formular zeigt die nächste Nummer vorab. Eine
// eigene Nummer ist erlaubt, wenn Format und Eindeutigkeit passen.
// Entscheidung Jörgen (06.10.2026): Die Prüfnummer ist die Klammer, ein Wein kann über mehrere Lose gefüllt werden – auf
// Lieferschein, Rechnung und Transportbescheinigung stehen deshalb Prüfnummer, Los und Abfülldatum (losText).
// Die öffentliche Weinpass-URL nutzt den zufälligen, global eindeutigen weinpass_code (/w/<code>); alte Etiketten mit
// /w/<chargennummer> gehen weiter, solange die Nummer betriebsübergreifend eindeutig ist. Isomorph, ohne '@/'-Importe.

/** Erlaubtes Format einer selbst vergebenen Los-/Chargennummer: 1–40 Zeichen, Buchstaben, Ziffern, Leerzeichen . / _ - */
export const LOS_FORMAT = /^[A-Za-z0-9ÄÖÜäöü][A-Za-z0-9ÄÖÜäöü ./_-]{0,39}$/

/** Fehler bei einer selbst eingegebenen Los-/Chargennummer; leer = automatisch vergeben (kein Fehler) */
export function losnummerFehler(eingabe: string | null | undefined): string | null {
  const t = (eingabe ?? '').trim()
  if (!t) return null
  if (!LOS_FORMAT.test(t)) return 'Los-/Chargennummer: 1–40 Zeichen, nur Buchstaben, Ziffern, Leerzeichen und . / _ - (z. B. „L-2026-012“).'
  return null
}

/** Nächste automatisch vergebene Nummer – dieselbe Bildung wie get_next_chargennummer (Präfix-Jahr-Zähler) */
export function losnummerVorschau(e: { prefix?: string | null; stellen?: number | null; zaehler?: number | null }, jahr: number): string | null {
  if (e.zaehler == null || !Number.isFinite(e.zaehler)) return null
  const stellen = e.stellen != null && Number.isFinite(e.stellen) ? Math.max(1, Math.trunc(e.stellen)) : 3
  return `${e.prefix ?? 'CH'}-${jahr}-${String(Math.trunc(e.zaehler)).padStart(stellen, '0')}`
}

const datumDe = (d: string) => d.slice(0, 10).split('-').reverse().join('.')

/** „PN N 1234/26 · Los CH-2026-012 · abgefüllt 01.03.2026“ – leere Teile entfallen; null ohne Los und PN */
export function losText(f: { pruefnummer?: string | null; chargennummer?: string | null; datum?: string | null } | null | undefined): string | null {
  if (!f) return null
  const pn = (f.pruefnummer ?? '').trim()
  const los = (f.chargennummer ?? '').trim()
  if (!pn && !los) return null
  const datum = typeof f.datum === 'string' && /^\d{4}-\d{2}-\d{2}/.test(f.datum) ? `abgefüllt ${datumDe(f.datum)}` : null
  return [pn ? `PN ${pn}` : null, los ? `Los ${los}` : null, datum].filter(Boolean).join(' · ')
}

/** Weinpass-Code (zufällig, 12 Hex-Zeichen) – sonst handelt es sich um eine alte /w/<chargennummer>-URL */
export function istWeinpassCode(s: string | null | undefined): boolean {
  return typeof s === 'string' && /^[0-9a-f]{12}$/.test(s)
}

/** Pfad des öffentlichen Weinpasses: neuer Code, sonst (vor der Migration) die Chargennummer */
export function weinpassPfad(f: { weinpass_code?: string | null; chargennummer?: string | null }): string | null {
  if (f.weinpass_code) return `/w/${f.weinpass_code}`
  return f.chargennummer ? `/w/${encodeURIComponent(f.chargennummer)}` : null
}
