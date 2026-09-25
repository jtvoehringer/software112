// ── Stripe-Abo → Betrieb abgleichen (KAN-5 Nachschliff, 25.09.2026) ──────────
//
// Kern des Stripe-Webhooks (app/api/stripe/webhook/route.ts), ohne Stripe-SDK und ohne
// Server-Importe: Datenbank, Stripe-Abruf und Paket-Anwendung werden übergeben – so ist der
// Ablauf mit einem Fake-Admin-Client testbar (scripts/tests/abo-nurlesen.test.mjs).
//
// Ablauf je Betrieb mit dieser Stripe-Kunden-ID:
//  1. aboZuordnung() (lib/abo/regeln.ts): betrifft das Ereignis das Abo des Betriebs?
//     Bei abweichender gespeicherter Abo-ID wird deren Stand bei Stripe nachgefragt (beendet?).
//  2. uebernehmen: Abo-ID, Status, Periodenende und Testphase schreiben – der Status kommt
//     FRISCH von Stripe (der Aufrufer ruft subscriptions.retrieve), nie aus der Ereignisart.
//     Danach paketEntscheidung(): Module und stripe_plan nur mit Zahlung.
//     beenden: Abo-ID leeren, 'cancelled', stripe_plan leeren – Module bleiben (Nur-Lesen-Modus).
//  3. Jeder Schreibzugriff ist an die zuvor gelesene Abo-ID gebunden (optimistische Sperre):
//     zwei gleichzeitig zugestellte Ereignisse überschreiben sich nicht gegenseitig.
// Fehler beim Lesen/Schreiben werfen – der Webhook antwortet dann 500 und Stripe stellt das
// Ereignis erneut zu (alle Schritte sind wiederholbar).

import { paketAusPlan, type PaketKey } from '@/lib/pakete'
import { aboZuordnung, paketEntscheidung, ABO_BEENDET_STATUS, type AboEreignis, type AboZuordnung } from '@/lib/abo/regeln'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Was vom Stripe-Abo gebraucht wird (aus subscriptions.retrieve bzw. dem deleted-Ereignis) */
export type StripeAbo = {
  id: string
  status: string | null
  priceId: string | null
  /** Unix-Sekunden */
  periodeEnde: number | null
  /** Unix-Sekunden */
  testphaseEnde: number | null
}

export type AbgleichDeps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any
  /** Stripe-Abo frisch laden (subscriptions.retrieve) – wirft bei Fehler */
  aboLaden: (aboId: string) => Promise<StripeAbo>
  /** Paket-Vorgaben anwenden (lib/pakete-server.ts: wendePaketAn) – Fehlertext oder null */
  paketAnwenden: (tenantId: string, paket: PaketKey | null) => Promise<string | null>
  /** Preis-ID → Paket (lib/pakete.ts: paketFromPriceId) */
  paketAusPreis: (priceId: string | null) => PaketKey | null
  /** Tenant-Kopf-Cache ablaufen lassen (lib/tenant/kopf.ts) */
  invalidieren: (tenantId: string) => void
  log?: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
}

export type AbgleichErgebnis = { tenantId: string; aktion: AboZuordnung['aktion'] | 'uebersprungen'; grund: string }

const iso = (sek: number | null | undefined) => (sek ? new Date(sek * 1000).toISOString() : null)

/** Gespeicherte Abo-ID als Bedingung an ein UPDATE hängen (null → IS NULL) */
function mitAboId(q: R, aboId: string | null): R {
  return aboId === null ? q.is('stripe_subscription_id', null) : q.eq('stripe_subscription_id', aboId)
}

export async function aboEreignisAbgleichen(
  deps: AbgleichDeps,
  e: { ereignis: AboEreignis; kundeId: string; abo: StripeAbo },
): Promise<AbgleichErgebnis[]> {
  const log = deps.log ?? console
  const { data: zeilen, error } = await (deps.admin.from('tenants') as R)
    .select('id, stripe_subscription_id, stripe_plan').eq('stripe_customer_id', e.kundeId)
  if (error) throw new Error(`Betriebe zu Stripe-Kunde ${e.kundeId} nicht lesbar: ${error.message}`)
  const ergebnisse: AbgleichErgebnis[] = []

  for (const t of (zeilen ?? []) as R[]) {
    const tenantId = t.id as string
    const gespeichert = (t.stripe_subscription_id as string | null) || null

    let gespeichertesAboBeendet: boolean | undefined
    if (e.ereignis === 'aktualisiert' && gespeichert && gespeichert !== e.abo.id) {
      try {
        gespeichertesAboBeendet = ABO_BEENDET_STATUS.includes((await deps.aboLaden(gespeichert)).status ?? '')
      } catch (err) {
        log.error(`[Stripe-Abgleich] gespeichertes Abo ${gespeichert} von ${tenantId} nicht abrufbar:`, (err as Error).message)
        gespeichertesAboBeendet = false   // im Zweifel das gespeicherte Abo behalten
      }
    }

    const z = aboZuordnung({ ereignis: e.ereignis, gespeicherteAboId: gespeichert, aboId: e.abo.id, aktuellerStatus: e.abo.status, gespeichertesAboBeendet })
    if (z.aktion === 'ignorieren') {
      log.info(`[Stripe-Abgleich] ${tenantId}: Ereignis zu Abo ${e.abo.id} ignoriert – ${z.grund}`)
      ergebnisse.push({ tenantId, aktion: 'ignorieren', grund: z.grund })
      continue
    }

    const daten = z.aktion === 'beenden'
      ? { stripe_subscription_id: null, stripe_status: 'cancelled', stripe_current_period_end: null, stripe_trial_ends_at: null }
      : {
          stripe_subscription_id: e.abo.id,
          stripe_status: e.abo.status,
          stripe_current_period_end: iso(e.abo.periodeEnde),
          // trial_end bleibt in Stripe nach der Testphase als Zeitpunkt stehen – ausgewertet wird er
          // nur, solange stripe_status 'trialing' ist (istTrialAbgelaufen, lib/abo/regeln.ts)
          stripe_trial_ends_at: iso(e.abo.testphaseEnde),
        }
    const { data: geschrieben, error: ue } = await mitAboId((deps.admin.from('tenants') as R).update(daten).eq('id', tenantId), gespeichert).select('id')
    if (ue) throw new Error(`Abo-Stand von ${tenantId} nicht gespeichert: ${ue.message}`)
    deps.invalidieren(tenantId)
    if (((geschrieben ?? []) as R[]).length === 0) {
      // Abo-ID hat sich seit dem Lesen geändert (paralleles Ereignis) – das andere Ereignis gewinnt
      log.info(`[Stripe-Abgleich] ${tenantId}: Abo-ID inzwischen geändert – Ereignis zu ${e.abo.id} übersprungen`)
      ergebnisse.push({ tenantId, aktion: 'uebersprungen', grund: 'Abo-ID inzwischen geändert' })
      continue
    }

    // Paket-Vorgaben: nur mit Zahlung (paketEntscheidung, dieselbe Regel wie der Paketwechsel auf /abo)
    const p = paketEntscheidung({
      ereignis: z.aktion === 'beenden' ? 'geloescht' : 'aktualisiert',
      status: z.aktion === 'beenden' ? 'cancelled' : e.abo.status,
      neuesPaket: z.aktion === 'beenden' ? null : deps.paketAusPreis(e.abo.priceId),
      bisherigesPaket: paketAusPlan(t.stripe_plan),
    })
    if (p.planSetzen) {
      const { error: pe } = await (deps.admin.from('tenants') as R).update({ stripe_plan: p.plan }).eq('id', tenantId)
      if (pe) throw new Error(`stripe_plan von ${tenantId} nicht gesetzt: ${pe.message}`)
    }
    if (p.moduleAnwenden) {
      const fehler = await deps.paketAnwenden(tenantId, p.plan)
      if (fehler) throw new Error(`Paket-Vorgaben für ${tenantId}: ${fehler}`)
    } else {
      log.info(`[Stripe-Abgleich] Paket-Vorgaben für ${tenantId} unverändert: ${p.grund}`)
    }
    deps.invalidieren(tenantId)
    ergebnisse.push({ tenantId, aktion: z.aktion, grund: `${z.grund}; ${p.grund}` })
  }
  return ergebnisse
}
