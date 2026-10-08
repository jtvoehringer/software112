// KAN-104 (08.10.2026): Summen einer Rechnung für den Druck – wie die Rechnung auf der Verkaufsseite
// (weinhandel/verkauf/[id]): Brutto je Position × (1 − Rabatt) × (1 − Sonderrabatt), Positionen ohne Preis zählen nicht,
// fehlender Satz = 13 %; Netto je Satz = Σ Brutto / (1 + Satz), USt = Netto × Satz.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type RechnungSummen = { brutto: number; netto: number; ust: { satz: number; netto: number; betrag: number }[] }

export function rechnungSummen(positionen: readonly R[]): RechnungSummen {
  const jeSatz = new Map<number, number>()
  let brutto = 0
  for (const p of positionen) {
    if (p.preis_brutto == null) continue
    const b = Number(p.preis_brutto) * Number(p.menge) * (1 - Number(p.rabatt_pct ?? 0) / 100) * (1 - Number(p.sonderrabatt_pct ?? 0) / 100)
    const satz = Number(p.ust_satz ?? 13)
    brutto += b
    jeSatz.set(satz, (jeSatz.get(satz) ?? 0) + b / (1 + satz / 100))
  }
  const ust = [...jeSatz.entries()].sort((a, b) => b[0] - a[0]).map(([satz, netto]) => ({ satz, netto, betrag: netto * satz / 100 }))
  return { brutto, netto: ust.reduce((s, u) => s + u.netto, 0), ust }
}
