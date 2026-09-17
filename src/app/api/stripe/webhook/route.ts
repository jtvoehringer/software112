import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { paketFromPriceId, type PaketKey } from '@/lib/pakete'
import { wendePaketAn } from '@/lib/pakete-server'
import Stripe from 'stripe'
import { tenantKopfInvalidieren } from '@/lib/tenant/kopf'

// Vercel streamt den Body — wir brauchen ihn als Buffer für die Signatur-Prüfung
export const runtime = 'nodejs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Aktualisiert tenants und gibt die betroffene(n) tenant_id(s) zurück (für Folge-Sync wie Modul-Flags). */
async function updateTenantStripe(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  where: { customer_id?: string; subscription_id?: string },
  data: Partial<{
    stripe_subscription_id: string | null
    stripe_status:          string | null
    stripe_plan:            string | null
    stripe_current_period_end: string | null
    stripe_trial_ends_at:   string | null
  }>,
): Promise<string[]> {
  const col = where.customer_id ? 'stripe_customer_id' : 'stripe_subscription_id'
  const val = where.customer_id ?? where.subscription_id
  const { data: betroffen, error } = await (admin.from('tenants') as any).update(data).eq(col, val).select('id')
  if (error) { console.error('[Stripe Webhook] DB-Update fehlgeschlagen:', error.message); return [] }
  const ids = ((betroffen ?? []) as R[]).map(t => t.id as string)
  ids.forEach(tenantKopfInvalidieren) // Layout-Cache (Abo-Status) sofort aktualisieren
  return ids
}

// Paketmodell Basis / Standard / Premium (Rückmeldung 2.9.2026): der
// Stripe-Preis bestimmt das Paket (lib/pakete.ts, inkl. Abbildung der
// Alt-Preise Professional/Professional+/Enterprise), das Paket bestimmt hart
// die Modul-Flags (Newsletter, E&A, Controlling, Export, bot:112, KI-Abfragen)
// und das Benutzerlimit. Bisher hing am Preis nur das KI-Kontingent, alle
// anderen Module wurden händisch geschaltet. Manuelle Toggles in
// Administration → Mandanten wirken weiterhin als Override - bis zum nächsten
// Subscription-Event, dann gilt wieder das Paket (Entscheidung: Downgrade
// schaltet hart ab, Daten bleiben erhalten).
function planFromPrice(priceId: string | null | undefined): PaketKey | null {
  const paket = paketFromPriceId(priceId)
  if (!paket && priceId) console.error('[Stripe Webhook] Unbekannte Preis-ID, kein Paket zugeordnet:', priceId)
  return paket
}

async function synchronisiereModule(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  tenantIds: string[],
  paket: PaketKey | null,
) {
  for (const tenantId of tenantIds) {
    const fehler = await wendePaketAn(admin, tenantId, paket)
    if (fehler) console.error('[Stripe Webhook]', fehler)
    tenantKopfInvalidieren(tenantId) // Modul-Flags im Layout-Cache erneuern
  }
}

// Rückmeldung 31.8.2026 ("Zahlungstracking in die Hohenstein Suite übernehmen
// und bei den Kunden im E&A-Modul anhängen"): protokolliert jede erfolgreiche
// Zahlung in stripe_zahlungen_log (Migration 183) - die Hohenstein Suite holt
// sich neue Zeilen per Service-Role ab und bucht sie automatisch als
// E&A-Einnahme. Idempotent über die unique-Spalte stripe_invoice_id (Stripe
// kann Webhooks mehrfach zustellen) - ein Konflikt wird bewusst ignoriert.
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
  const subscriptionId = typeof (inv as R).subscription === 'string'
    ? (inv as R).subscription as string
    : ((inv as R).subscription as R | null)?.id ?? null
  const periode = (inv as R).lines?.data?.[0]?.period as { start?: number; end?: number } | undefined
  const bezahltAm = (inv as R).status_transitions?.paid_at ?? inv.created

  const { error } = await (admin.from('stripe_zahlungen_log') as any)
    .insert({
      tenant_id:              tenantId,
      stripe_invoice_id:      inv.id,
      stripe_customer_id:     customerId,
      stripe_subscription_id: subscriptionId,
      stripe_plan:            (tenantRow as R).stripe_plan ?? null,
      betrag_brutto:          (inv.amount_paid ?? 0) / 100,
      waehrung:               inv.currency ?? 'eur',
      periode_start:          periode?.start ? new Date(periode.start * 1000).toISOString() : null,
      periode_ende:           periode?.end ? new Date(periode.end * 1000).toISOString() : null,
      bezahlt_am:             new Date(bezahltAm * 1000).toISOString(),
    })
  if (error && (error as R).code !== '23505') {
    // 23505 = unique_violation (bereits protokolliert, z.B. erneut zugestelltes Webhook-Event)
    console.error('[Stripe Webhook] Zahlung konnte nicht protokolliert werden:', (error as R).message)
  }
}

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

  switch (event.type) {
    // ── Subscription angelegt / aktualisiert ────────────────────────────────
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub        = event.data.object as Stripe.Subscription
      const priceId    = (sub.items.data[0]?.price?.id) ?? null
      const customerId = typeof sub.customer === 'string' ? sub.customer : (sub.customer as R).id as string
      const plan       = planFromPrice(priceId)
      const tenantIds  = await updateTenantStripe(admin,
        { customer_id: customerId },
        {
          stripe_subscription_id:   sub.id,
          stripe_status:            sub.status,
          // 'basis' | 'standard' | 'premium' (lib/pakete.ts); null bei unbekanntem Preis
          stripe_plan:              plan,
          stripe_current_period_end: (sub as R).current_period_end ? new Date((sub as R).current_period_end * 1000).toISOString() : null,
          // Trial-Ablauf ("14 Tage, dann Sperre wie bei unpaid"): trial_end
          // bleibt in Stripe auch nach Trial-Ende als historischer Zeitpunkt
          // stehen - ausgewertet wird das nur, solange stripe_status noch
          // 'trialing' ist (siehe istTrialAbgelaufen in lib/stripe/client.ts).
          stripe_trial_ends_at:     sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        },
      )
      await synchronisiereModule(admin, tenantIds, plan)
      break
    }

    // ── Subscription gekündigt ──────────────────────────────────────────────
    case 'customer.subscription.deleted': {
      const sub        = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === 'string' ? sub.customer : (sub.customer as R).id as string
      const tenantIds  = await updateTenantStripe(admin,
        { customer_id: customerId },
        {
          stripe_subscription_id:   null,
          stripe_status:            'cancelled',
          stripe_plan:              null,
          stripe_current_period_end: null,
          stripe_trial_ends_at:     null,
        },
      )
      await synchronisiereModule(admin, tenantIds, null)
      break
    }

    // ── Zahlung erfolgreich ─────────────────────────────────────────────────
    case 'invoice.payment_succeeded': {
      const inv        = event.data.object as Stripe.Invoice
      const customerId = typeof inv.customer === 'string' ? inv.customer : (inv.customer as R).id as string
      if ((inv as R).subscription) {
        await updateTenantStripe(admin,
          { customer_id: customerId },
          { stripe_status: 'active' },
        )
        await protokolliereZahlung(admin, customerId, inv)
      }
      break
    }

    // ── Zahlung fehlgeschlagen ──────────────────────────────────────────────
    case 'invoice.payment_failed': {
      const inv        = event.data.object as Stripe.Invoice
      const customerId = typeof inv.customer === 'string' ? inv.customer : (inv.customer as R).id as string
      if ((inv as R).subscription) {
        await updateTenantStripe(admin,
          { customer_id: customerId },
          { stripe_status: 'past_due' },
        )
      }
      break
    }

    default:
      // Nicht behandelte Events ignorieren
      break
  }

  return NextResponse.json({ erhalten: true })
}
