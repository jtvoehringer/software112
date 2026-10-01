// ── E-Mail-Spiegelung: welche Postfächer dürfen schreiben? (KAN-69, 01.10.2026) ──
//
// Die Spiegelung (lib/email/spiegel.ts) schreibt per Service-Role in `aktivitaeten` und
// `user_email_connections` – die RESTRICTIVE Policies der Abo-Sperre (KAN-5) greifen dort nicht.
// Deshalb prüft sie vorab je Verbindung selbst:
//  - aktive Mitgliedschaft des Verbindungs-Users im Betrieb der Verbindung (tenant_memberships,
//    aktiv = true) – sonst schriebe eine Verbindung mit fremder tenant_id in diesen Betrieb
//  - Abo-Stand des Betriebs: gesperrt (Nur-Lesen-Modus) → überspringen. Bewusst mit role: null
//    wie der Morgenbericht (lib/morgenbericht/lauf.ts): die Spiegelung ist ein Hintergrundlauf
//    für den Betrieb, die Ausnahme für system_admin gilt hier nicht; Sandbox/Demo bleiben frei.
//  - Betrieb nicht gefunden → überspringen (keine Aussage über das Abo möglich).
//
// Reine Funktion ohne Server-Importe – getestet in scripts/tests/kan69-email-spiegel.test.mjs.

import { aboStandBerechnen } from '@/lib/abo/regeln'

export type SpiegelVerbindung = { tenant_id: string; user_id: string }
export type SpiegelMitgliedschaft = { tenant_id: string; user_id: string; aktiv: boolean | null }
export type SpiegelBetrieb = { id: string; stripe_status: string | null; stripe_trial_ends_at: string | null }
export type SpiegelSperrGrund = 'mitgliedschaft' | 'betrieb' | 'abo'

export const SPIEGEL_SPERR_TEXT: Record<SpiegelSperrGrund, string> = {
  mitgliedschaft: 'keine aktive Mitgliedschaft im Betrieb',
  betrieb: 'Betrieb nicht gefunden',
  abo: 'Abo gesperrt (Nur-Lesen-Modus)',
}

/** Teilt die Verbindungen in freigegebene und übersprungene (mit Grund) */
export function spiegelFreigabe<V extends SpiegelVerbindung>(
  verbindungen: readonly V[],
  mitgliedschaften: readonly SpiegelMitgliedschaft[],
  betriebe: readonly SpiegelBetrieb[],
  jetzt: number = Date.now(),
): { freigegeben: V[]; uebersprungen: { verbindung: V; grund: SpiegelSperrGrund }[] } {
  const aktiv = new Set(mitgliedschaften.filter(m => m.aktiv === true).map(m => `${m.tenant_id}|${m.user_id}`))
  const betriebNachId = new Map(betriebe.map(b => [b.id, b]))
  const freigegeben: V[] = []
  const uebersprungen: { verbindung: V; grund: SpiegelSperrGrund }[] = []
  for (const v of verbindungen) {
    if (!aktiv.has(`${v.tenant_id}|${v.user_id}`)) { uebersprungen.push({ verbindung: v, grund: 'mitgliedschaft' }); continue }
    const b = betriebNachId.get(v.tenant_id)
    if (!b) { uebersprungen.push({ verbindung: v, grund: 'betrieb' }); continue }
    if (aboStandBerechnen({ tenantId: b.id, stripeStatus: b.stripe_status, trialEndsAt: b.stripe_trial_ends_at, role: null }, jetzt).gesperrt) {
      uebersprungen.push({ verbindung: v, grund: 'abo' }); continue
    }
    freigegeben.push(v)
  }
  return { freigegeben, uebersprungen }
}
