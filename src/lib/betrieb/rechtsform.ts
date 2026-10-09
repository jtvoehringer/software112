// Rechtsform des Betriebs (KAN-48 AP11, 09.10.2026) – entscheidet für das BKI-Blatt „Betriebsdaten“, ob Vor- und Nachname
// (natürliche Person) oder der Firmenname gemeldet wird. Werte wie der CHECK tenant_einstellungen_rechtsform_check.
// Isomorph, ohne '@/'-Importe (Formular und node:test).

export const RECHTSFORMEN = {
  natuerliche_person: 'Natürliche Person (Einzelunternehmen)',
  personengesellschaft: 'Personengesellschaft (OG, KG, GesbR)',
  kapitalgesellschaft: 'Kapitalgesellschaft (GmbH, AG)',
  sonstige: 'Sonstige (Verein, Genossenschaft …)',
} as const

export type Rechtsform = keyof typeof RECHTSFORMEN

export const istRechtsform = (v: unknown): v is Rechtsform => typeof v === 'string' && Object.hasOwn(RECHTSFORMEN, v)

/** Formularwert → Spaltenwert: leer = nicht gesetzt, unbekannt = Fehler (null) */
export function rechtsformAus(roh: unknown): { ok: true; wert: Rechtsform | null } | { ok: false } {
  const s = typeof roh === 'string' ? roh.trim() : ''
  if (!s) return { ok: true, wert: null }
  return istRechtsform(s) ? { ok: true, wert: s } : { ok: false }
}
