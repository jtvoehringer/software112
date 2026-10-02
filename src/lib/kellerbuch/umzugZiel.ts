// ── Ziel-Charge eines Umzugs im Ziel-Gebinde (KAN-94/KAN-83, 01.10.2026) ──────
//
// Reine Funktion ohne Importe (node:test-fähig: scripts/tests/kan94-83-umzug.test.mjs). Dieselbe
// Regel bestimmt in umziehen() die Zusammenführung (Phase 2) und vorab die Charge, deren
// Prüfnummer durch den Umzug erlöschen würde (KAN-83) – beide Stellen dürfen nicht auseinanderlaufen.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/**
 * Rebsortenmix-Check: erste Quell-Rebsorte vs. bestehende Charge(n) im Zielbehälter.
 * Wichtig: eine bestehende Charge OHNE eindeutige Rebsorte (rebsorte = null, typischerweise
 * weil sie selbst schon ein Verschnitt ist, z.B. "Sortenverschnitt") zählt HIER ebenfalls als
 * Mix, nicht als "unbedenklich gleich" – vorher wurde in diesem Fall stillschweigend
 * zusammengeführt, weil `vorhanden.rebsorte != null` fehlschlug, obwohl real zwei
 * unterschiedliche Herkünfte im selben Tank landeten (Bugreport 5.8.2026: Weisser Riesling
 * wurde stillschweigend mit einem bestehenden Sortenverschnitt vermischt, ohne dass der
 * Verschneiden-Dialog bzw. eine Verschneidungs-Buchung ausgelöst wurde).
 *
 * Liegt bereits eine Charge MIT EXAKT DERSELBEN Rebsorte im Ziel-Gebinde (auch wenn dort noch
 * weitere, andere Chargen herumstehen), wird direkt in DIESE zusammengeführt. Sonst ist die
 * Anker-Charge (falls mehrere lose Chargen im Ziel liegen) die mengenmäßig größte als
 * sinnvollster Ausgangspunkt für eine Verschneidung – der User kann im Verschneiden-Formular
 * ohnehin beliebig weitere Chargen aus demselben Tank ergänzen.
 *
 * `quellen`: eine Zeile je Quelle des Umzugs (mit rebsorte); nur bei genau einer Quelle gibt es
 * eine Quell-Rebsorte – mehrere Quellen ergeben nie einen Rebsortenmix (wie bisher).
 */
export function waehleZielCharge(vorhandenListe: readonly R[], quellen: readonly (R | null | undefined)[]): { vorhanden: R | null; istRebsortenmix: boolean } {
  const quelleRebsorte = quellen.length === 1 ? (quellen[0]?.rebsorte ?? null) : null
  const gleicheRebsorte = quelleRebsorte != null
    ? vorhandenListe.find(v => v.rebsorte === quelleRebsorte) ?? null
    : null
  const vorhanden = gleicheRebsorte
    ?? (vorhandenListe.length > 0
          ? [...vorhandenListe].sort((a, b) => (parseFloat(b.menge_liter) || 0) - (parseFloat(a.menge_liter) || 0))[0]
          : null)
  const istRebsortenmix = vorhanden != null
    && quelleRebsorte != null
    && (vorhanden.rebsorte == null || quelleRebsorte !== vorhanden.rebsorte)
  return { vorhanden, istRebsortenmix }
}
