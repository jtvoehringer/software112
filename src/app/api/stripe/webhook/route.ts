import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import Stripe from 'stripe'

// Vercel streamt den Body — wir brauchen ihn als Buffer für die Signatur-Prüfung
export const runtime = 'nodejs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function updateTenantStripe(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  where: { customer_id?: string; subscription_id?: string },
  data: Partial<{
    stripe_subscription_id: string | null
    stripe_status:          string | null
    stripe_plan:            string | null
    stripe_current_period_end: string | null
  }>,
) {
  const col = where.customer_id ? 'stripe_customer_id' : 'stripe_subscription_id'
  const val = where.customer_id ?? where.subscription_id
  const { error } = await (admin.from('tenants') as any).update(data).eq(col, val)
  if (error) console.error('[Stripe Webhook] DB-Update fehlgeschlagen:', error.message)
}

function planFromPrice(priceId: string | null | undefined): string {
  if (!priceId) return 'base'
  if (priceId === process.env.STRIPE_PRICE_KI_BASIC)     return 'ki_basic'
  if (priceId === process.env.STRIPE_PRICE_KI_STANDARD)  return 'ki_standard'
  if (priceId === process.env.STRIPE_PRICE_KI_UNLIMITED) return 'ki_unlimited'
  return 'base'
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
      await updateTenantStripe(admin,
        { customer_id: customerId },
        {
          stripe_subscription_id:   sub.id,
          stripe_status:            sub.status,
          stripe_plan:              planFromPrice(priceId),
          stripe_current_period_end: (sub as R).current_period_end ? new Date((sub as R).current_period_end * 1000).toISOString() : null,
        },
      )
      break
    }

    // ── Subscription gekündigt ──────────────────────────────────────────────
    case 'customer.subscription.deleted': {
      const sub        = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === 'string' ? sub.customer : (sub.customer as R).id as string
      await updateTenantStripe(admin,
        { customer_id: customerId },
        {
          stripe_subscription_id:   null,
          stripe_status:            'cancelled',
          stripe_plan:              null,
          stripe_current_period_end: null,
        },
      )
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
