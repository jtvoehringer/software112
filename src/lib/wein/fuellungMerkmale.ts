// ── Merkmale einer neuen Füllung aus der Charge (KAN-84, 04.10.2026) ────────────────────────────────────
// Jahrgang und Rebsorte kommen aus der Kellerbuch-Charge; Formular- bzw. Assistentenwerte zählen nur, wenn die
// Charge keinen Wert hat (z. B. Eröffnungsbestand ohne Jahrgang). Weichen sie ab, werden sie ignoriert, mit Hinweis.
// Qualität und Herkunft bleiben an der Füllung abstufbar (Entscheidung Jörgen, 04.10.2026; Prüfung in der Action).
//
// Isomorph, ohne Importe (node:test: scripts/tests/kan84-fuellung-merkmale.test.mjs).

export type FuellungMerkmale = { jahrgang: number | null; rebsorte: string | null }

const text = (v: string | null | undefined) => (v ?? '').trim() || null
const gleich = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base' }) === 0

export function merkmaleAusCharge(eingabe: FuellungMerkmale, charge: FuellungMerkmale): FuellungMerkmale & { hinweis: string | null } {
  const abweichung: string[] = []
  const chJahrgang = charge.jahrgang ?? null
  const chRebsorte = text(charge.rebsorte)
  const einRebsorte = text(eingabe.rebsorte)
  if (chJahrgang != null && eingabe.jahrgang != null && eingabe.jahrgang !== chJahrgang) {
    abweichung.push(`Jahrgang ${eingabe.jahrgang} → ${chJahrgang}`)
  }
  if (chRebsorte && einRebsorte && !gleich(einRebsorte, chRebsorte)) {
    abweichung.push(`Rebsorte „${einRebsorte}“ → „${chRebsorte}“`)
  }
  return {
    jahrgang: chJahrgang ?? eingabe.jahrgang ?? null,
    rebsorte: chRebsorte ?? einRebsorte,
    hinweis: abweichung.length
      ? `Jahrgang und Rebsorte kommen aus der Charge – abweichende Angaben wurden ignoriert (${abweichung.join(', ')}).`
      : null,
  }
}
