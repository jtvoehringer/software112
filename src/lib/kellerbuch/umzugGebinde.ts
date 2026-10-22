// ── KAN-340 (22.10.2026): Umzug in dasselbe Gebinde ─────────────────────────────────────────────────────
//
// Befund UAT: Paul hat 500 L aus „Immervoll 10“ nach „Immervoll 10“ umgezogen – danach lagen zwei Chargen im selben
// Gebinde. Ursache: Die Ziel-Charge wird ohne die Quell-Chargen gewählt (KAN-112, waehleZielCharge); ist die Quelle die
// einzige Charge im Gebinde, gilt es dadurch als leer, und der Umzug legt eine neue Charge daneben an.
//
// Ein Umzug, dessen Ziel-Gebinde zugleich das Gebinde einer Quell-Charge ist, bewegt keinen Wein – er wird abgelehnt
// (Server: umziehen() und Umzug bearbeiten) und das Formular bietet die Gebinde der gewählten Quellen nicht als Ziel an
// (Umziehen-Seite, Umziehen-Widget an der Charge, Umzug bearbeiten). Der Kellerplan sperrt das Ziehen auf sich selbst
// über dieselbe Prüfung (bewerteZiel). Isomorph und importfrei (node:test: scripts/tests/kan340-umzug-selbes-gebinde.test.mjs).

/** Meldung, wenn ein Ziel-Gebinde zugleich das Gebinde einer Quell-Charge ist */
export const UMZUG_SELBES_GEBINDE = 'Quelle und Ziel sind dasselbe Gebinde.'

type Id = string | null | undefined

/** Gebinde der Quell-Chargen (ohne Chargen ohne Gebinde) */
export function quellGebinde(quellen: Iterable<{ behaelter_id?: Id } | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const q of quellen) if (q?.behaelter_id) out.add(q.behaelter_id)
  return out
}

/** Ist das Gebinde `zielId` zugleich das Gebinde einer Quelle? */
export function istQuellGebinde(zielId: Id, quellGebindeIds: ReadonlySet<string>): boolean {
  return !!zielId && quellGebindeIds.has(zielId)
}

/** Fehlertext, wenn eines der Ziel-Gebinde das Gebinde einer Quelle ist – sonst null */
export function selbesGebindeFehler(quellGebindeIds: ReadonlySet<string>, zielIds: Iterable<Id>): string | null {
  for (const z of zielIds) if (istQuellGebinde(z, quellGebindeIds)) return UMZUG_SELBES_GEBINDE
  return null
}

/**
 * Wählbare Ziel-Gebinde: ohne die Gebinde der gewählten Quellen. Ein bereits gewähltes Ziel (`behalten`) bleibt in der
 * Liste, damit die Auswahl nicht unbemerkt verschwindet – der Hinweis bzw. der Server meldet es dann.
 */
export function zielGebindeOhneQuellen<T extends { id: string }>(gebinde: readonly T[], quellGebindeIds: ReadonlySet<string>, behalten?: Id): T[] {
  return gebinde.filter(g => !quellGebindeIds.has(g.id) || g.id === behalten)
}
