// ── Betriebsbeginn / Systemstart der E&A-Rechnung (Migration 180) ────────────
// Gemeinsame Regel für Monatsabschluss, UVA und Dashboard: Ein Monat bzw. eine
// UVA-Periode, die VOLLSTÄNDIG vor dem Betriebsbeginn endet, existiert
// fachlich nicht – sie erscheint nicht als offen und braucht keinen Abschluss.
// NULL/undefined = keine Einschränkung. Ohne Server-Imports (client-tauglich).

/** true, wenn der Monat (1-basiert) vollständig vor dem Betriebsbeginn endet */
export function monatVorBeginn(jahr: number, monat: number, betriebsbeginn: string | null | undefined): boolean {
  if (!betriebsbeginn) return false
  const beginn = new Date(betriebsbeginn)
  if (Number.isNaN(beginn.getTime())) return false
  const monatsende = new Date(jahr, monat, 0) // Tag 0 des Folgemonats = letzter Tag
  return monatsende < beginn
}

/** Monate einer UVA-Periode ('Q1'…'Q4' oder '01'…'12'), 1-basiert */
export function monateDerPeriode(zeitraum: string): number[] {
  return zeitraum.startsWith('Q')
    ? [1, 2, 3].map(i => (parseInt(zeitraum[1]) - 1) * 3 + i)
    : [parseInt(zeitraum)]
}

/** true, wenn die gesamte UVA-Periode vor dem Betriebsbeginn endet */
export function periodeVorBeginn(jahr: number, zeitraum: string, betriebsbeginn: string | null | undefined): boolean {
  const monate = monateDerPeriode(zeitraum)
  return monatVorBeginn(jahr, monate[monate.length - 1], betriebsbeginn)
}
