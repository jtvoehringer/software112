import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { paketFromPriceId, type PaketKey } from '@/lib/pakete'
import { wendePaketAn } from '@/lib/pakete-server'
import Stripe from 'stripe'
import { tenantKopfInvalidieren } from '@/lib/tenant/kopf'
import { aboEreignisAbgleichen, type AbgleichDeps, type StripeAbo } from '@/lib/abo/stripeAbgleich'

// Vercel streamt den Body — wir brauchen ihn als Buffer für die Signatur-Prüfung
export const runtime = 'nodejs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Paketmodell Basis / Standard / Premium (Rückmeldung 2.9.2026): der
// Stripe-Preis bestimmt das Paket (lib/pakete.ts, inkl. Abbildung der
// Alt-Preise Professional/Professional+/Enterprise), das Paket bestimmt hart
// die Modul-Flags (Newsletter, E&A, Controlling, Export, bot:112, KI-Abfragen)
// und das Benutzerlimit. Manuelle Toggles in Administration → Mandanten wirken
// weiterhin als Override - bis zum nächsten Subscription-Event, dann gilt wieder
// das Paket (Entscheidung: Downgrade schaltet hart ab, Daten bleiben erhalten).
function planFromPrice(priceId: string | null | undefined): PaketKey | null {
  const paket = paketFromPriceId(priceId)
  if (!paket && priceId) console.error('[Stripe Webhook] Unbekannte Preis-ID, kein Paket zugeordnet:', priceId)
  return paket
}

// ── Abo-Stand nur aus Stripe, nie aus der Ereignisart (KAN-5, 25.9.2026) ─────
// Bisher schrieb jedes invoice.payment_succeeded blind 'active' und jedes payment_failed
// 'past_due' über die customer_id – ohne Abo-ID, ohne Reihenfolge. Eine nach der Kündigung
// bezahlte Schlussrechnung entsperrte so einen gekündigten Betrieb dauerhaft (samt den seit
// KAN-5 stehenbleibenden Modulen), ein spätes payment_failed überschrieb 'unpaid' mit einer
// bloßen Warnung. Jetzt:
//  - Bei jedem Abo- und Rechnungsereignis wird das Abo frisch von Stripe geladen
//    (subscriptions.retrieve) – es gilt der aktuelle Status, egal in welcher Reihenfolge die
//    Ereignisse ankommen.
//  - Ob das Ereignis den Betrieb betrifft (gespeicherte Abo-ID), entscheidet aboZuordnung(); das
//    Schreiben samt Paket-Vorgaben (paketEntscheidung: Module nur mit Zahlung, bei Kündigung
//    bleiben sie für den Nur-Lesen-Modus stehen) macht aboEreignisAbgleichen()
//    (lib/abo/stripeAbgleich.ts, mit Tests).
//  - Scheitert etwas (Stripe nicht erreichbar, DB-Fehler), antwortet der Webhook 500 – Stripe
//    stellt das Ereignis dann erneut zu; alle Schritte sind wiederholbar.

function aboAus(sub: Stripe.Subscription): StripeAbo {
  const s = sub as unknown as R
  const item = s.items?.data?.[0] as R | undefined
  return {
    id: sub.id,
    status: sub.status ?? null,
    priceId: (item?.price?.id as string | undefined) ?? null,
    // current_period_end: je nach Stripe-API-Version am Abo oder an der Position
    periodeEnde: (s.current_period_end as number | undefined) ?? (item?.current_period_end as number | undefined) ?? null,
    testphaseEnde: sub.trial_end ?? null,
  }
}

function kundeVon(x: { customer: string | Stripe.Customer | Stripe.DeletedCustomer | null }): string | null {
  return typeof x.customer === 'string' ? x.customer : (x.customer as R | null)?.id ?? null
}

/** Abo-ID einer Rechnung – je nach Stripe-API-Version direkt oder unter parent.subscription_details */
function aboIdVonRechnung(inv: Stripe.Invoice): string | null {
  const i = inv as unknown as R
  const roh = i.subscription ?? i.parent?.subscription_details?.subscription ?? null
  return typeof roh === 'string' ? roh : (roh as R | null)?.id ?? null
}

function abgleichDeps(admin: ReturnType<typeof createSupabaseAdminClient>): AbgleichDeps {
  const stripe = getStripe()
  return {
    admin,
    aboLaden: async (id) => aboAus(await stripe.subscriptions.retrieve(id)),
    paketAnwenden: (tenantId, paket) => wendePaketAn(admin, tenantId, paket),
    paketAusPreis: planFromPrice,
    invalidieren: tenantKopfInvalidieren,
    log: { info: (...a) => console.info('[Stripe Webhook]', ...a), error: (...a) => console.error('[Stripe Webhook]', ...a) },
  }
}

// Rückmeldung 31.8.2026 ("Zahlungstracking in die Hohenstein Suite übernehmen
// und bei den Kunden im E&A-Modul anhängen"): protokolliert jede erfolgreiche
// Zahlung in stripe_zahlungen_log (Migration 183) - die Hohenstein Suite holt
// sich neue Zeilen per Service-Role ab und bucht sie automatisch als
// E&A-Einnahme. Idempotent über die unique-Spalte stripe_invoice_id (Stripe
// kann Webhooks mehrfach zustellen) - ein Konflikt wird bewusst ignoriert.
// KAN-5: unabhängig vom Abo-Abgleich – auch eine nach der Kündigung bezahlte
// Schlussrechnung ist eine Zahlung (sie entsperrt den Betrieb aber nicht mehr).
async function protokolliereZahlung(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  customerId: string,
  inv: Stripe.Invoice,
) {
  const { data: tenantRow } = await (admin.from('tenants') as any)
    .select('id, stripe_plan').eq('stripe_customer_id', customerId).maybeSingle()
  const tenantId = (tenantRow as R | null)?.id as string | undefined
  if (!tenantId) {
    console.error('[Stripe Webhook] Kein Mandant zu Stripe-Customer gefunden, Zahlung nicht protokolliert:', customerId)
    return
  }
  const periode = (inv as R).lines?.data?.[0]?.period as { start?: number; end?: number } | undefined
  const bezahltAm = (inv as R).status_transitions?.paid_at ?? inv.created

  const { error } = await (admin.from('stripe_zahlungen_log') as any)
    .insert({
      tenant_id:              tenantId,
      stripe_invoice_id:      inv.id,
      stripe_customer_id:     customerId,
      stripe_subscription_id: aboIdVonRechnung(inv),
      stripe_plan:            (tenantRow as R).stripe_plan ?? null,
      betrag_brutto:          (inv.amount_paid ?? 0) / 100,
      waehrung:               inv.currency ?? 'eur',
      periode_start:          periode?.start ? new Date(periode.start * 1000).toISOString() : null,
      periode_ende:           periode?.end ? new Date(periode.end * 1000).toISOString() : null,
      bezahlt_am:             new Date(bezahltAm * 1000).toISOString(),
    })
  if (error && (error as R).code !== '23505') {
    // 23505 = unique_violation (bereits protokolliert, z.B. erneut zugestelltes Webhook-Event)
    throw new Error(`Zahlung konnte nicht protokolliert werden: ${(error as R).message}`)
  }
}

// zwei-faktor-ausnahme: Stripe-Webhook ohne Benutzersitzung – echt nur mit gültiger stripe-signature (constructEvent, STRIPE_WEBHOOK_SECRET)
// schreibsperre-ausnahme: Stripe-Webhook ohne Benutzersitzung – setzt selbst den Abo-Status (Weg aus der Sperre)
export async function POST(req: NextRequest) {
  const body      = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''
  const secret    = process.env.STRIPE_WEBHOOK_SECRET ?? ''

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret)
  } catch (err) {
    console.error('[Stripe Webhook] Signatur ungültig:', err)
    return NextResponse.json({ fehler: 'Ungültige Signatur' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  try {
    switch (event.type) {
      // ── Abo angelegt / aktualisiert: aktueller Stand frisch von Stripe ─────
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const kundeId = kundeVon(sub)
        if (!kundeId) break
        const deps = abgleichDeps(admin)
        const abo = await deps.aboLaden(sub.id)
        await aboEreignisAbgleichen(deps, { ereignis: 'aktualisiert', kundeId, abo })
        break
      }

      // ── Abo beendet: endgültig, Stand aus dem Ereignis genügt ─────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const kundeId = kundeVon(sub)
        if (!kundeId) break
        await aboEreignisAbgleichen(abgleichDeps(admin), { ereignis: 'geloescht', kundeId, abo: aboAus(sub) })
        break
      }

      // ── Rechnung bezahlt / fehlgeschlagen: Status des Abos frisch von Stripe ─
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice
        const kundeId = kundeVon(inv)
        const aboId = aboIdVonRechnung(inv)
        if (!kundeId || !aboId) break
        const deps = abgleichDeps(admin)
        const abo = await deps.aboLaden(aboId)
        await aboEreignisAbgleichen(deps, { ereignis: 'rechnung', kundeId, abo })
        // danach: scheitert das Protokoll, stellt Stripe erneut zu (Abgleich ist wiederholbar,
        // das Protokoll über stripe_invoice_id idempotent)
        if (event.type === 'invoice.payment_succeeded') await protokolliereZahlung(admin, kundeId, inv)
        break
      }

      default:
        // Nicht behandelte Events ignorieren
        break
    }
  } catch (err) {
    // 500 → Stripe stellt das Ereignis erneut zu (bis zu 3 Tage)
    console.error(`[Stripe Webhook] ${event.type} (${event.id}) nicht verarbeitet:`, (err as Error).message)
    return NextResponse.json({ fehler: 'Ereignis nicht verarbeitet – Stripe stellt erneut zu' }, { status: 500 })
  }

  return NextResponse.json({ erhalten: true })
}
