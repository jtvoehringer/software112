import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { STRIPE_PLAN_LABELS, STRIPE_STATUS_META } from '@/lib/stripe/client'
import { aboStandBerechnen, istTrialAbgelaufen } from '@/lib/abo/regeln'
import { PAKET_REIHENFOLGE, paketAusPlan, paketPriceId } from '@/lib/pakete'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { pruefeBenutzerlimit } from '@/lib/pakete-server'
import AboClient from './AboClient'
import { BetriebsPruefMelder } from '@/components/BetriebsWaechter'

// Rückmeldung 31.8.2026 ("die Plattform soll sich selber abrechnen können,
// damit wir zu unserem Geld kommen"): Selbstverwaltung von Abo und Zahlung.
// Bewusst AUSSERHALB der (dashboard)-Route-Gruppe angesiedelt. Seit KAN-5
// (25.9.2026) leitet das Layout gesperrte Betriebe nicht mehr hierher um – sie
// arbeiten im Nur-Lesen-Modus weiter, die Hinweisleiste verlinkt auf diese Seite.
// Umgeleitet wird nur noch ein Neukunde, der den Checkout der Registrierung nie
// abgeschlossen hat ('incomplete' ohne Abo-ID, AboStand.zahlungOffen).

export const metadata: Metadata = { title: 'Abo & Zahlung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function AboPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role       = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  if (!membership) redirect('/betrieb-waehlen')

  const { data: tenantRow } = await (supabase.from('tenants') as any)
    .select('name, kundennummer, stripe_status, stripe_plan, stripe_customer_id, stripe_subscription_id, stripe_trial_ends_at')
    .eq('id', membership.tenantId)
    .maybeSingle()

  const t = tenantRow as R | null
  const stripeStatus = (t?.stripe_status ?? null) as string | null
  const stripePlan   = (t?.stripe_plan ?? null) as string | null
  const hasCustomer  = !!t?.stripe_customer_id
  // Self-Service-Signup wurde ohne Stripe-Checkout-Abschluss abgebrochen:
  // Customer existiert ggf. schon, aber (noch) keine Subscription - dann
  // "Zahlung nachholen" statt "Zahlungsdaten verwalten" (Portal setzt ein
  // bestehendes Abo voraus).
  const hatAbo       = !!t?.stripe_subscription_id
  const trialEndsAt  = (t?.stripe_trial_ends_at ?? null) as string | null

  // KAN-5: dieselbe Regel wie Layout und Schreibsperre (lib/abo/regeln.ts) – Sandbox und
  // Demo-Musterhof über feste IDs statt über den Namen
  const abo             = aboStandBerechnen({ tenantId: membership.tenantId, stripeStatus, trialEndsAt, role })
  const trialAbgelaufen = abo.gesperrt && istTrialAbgelaufen(stripeStatus, trialEndsAt)
  const hardBlocked      = abo.gesperrt
  const warned           = abo.warnung

  const planLabel   = stripePlan ? (STRIPE_PLAN_LABELS[stripePlan] ?? stripePlan) : null
  const statusMeta  = stripeStatus ? STRIPE_STATUS_META[stripeStatus] : undefined

  // Paketmodell (2.9.2026): aktuelles Paket, verfügbare Pakete (nur mit
  // hinterlegter Stripe-Preis-ID) und Benutzerstand für den Downgrade-Hinweis.
  const aktuellesPaket = paketAusPlan(stripePlan)
  const verfuegbarePakete = PAKET_REIHENFOLGE.filter(k => !!paketPriceId(k))
  const limit = await pruefeBenutzerlimit(createSupabaseAdminClient(), membership.tenantId)
  // Migration 197: Buchhaltungsart (E&A in software:112 / Doppik beim Steuerberater)
  const { data: einstRow } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea, buchhaltungsart').eq('tenant_id', membership.tenantId).maybeSingle()
  const einst = einstRow as R | null

  return (
    <>
      {/* KAN-30: Seite außerhalb des Arbeitsbereichs (kein Wächter) – die anderen Tabs sollen
          den aktiven Betrieb prüfen. Seit KAN-5 leitet das Layout nur noch bei nie abgeschlossener
          Zahlung hierher um; der Melder bleibt für Aufrufe per Link bzw. aus Stripe zurück
          (Betrieb kann inzwischen gewechselt sein). */}
      <BetriebsPruefMelder />
      <AboClient
        aktuellesPaket={aktuellesPaket}
        verfuegbarePakete={verfuegbarePakete}
        benutzerAnzahl={limit.anzahl}
        hardBlocked={hardBlocked}
        trialAbgelaufen={trialAbgelaufen}
        warned={warned}
        darfVerwalten={canAdmin(role)}
        hasCustomer={hasCustomer}
        hatAbo={hatAbo}
        planLabel={planLabel}
        statusLabel={statusMeta?.label ?? null}
        hatEa={!!einst?.modul_ea}
        kundennummer={(t?.kundennummer as string | null) ?? null}
        betriebName={(t?.name as string | null) ?? null}
        buchhaltungsart={einst?.buchhaltungsart === 'doppik' ? 'doppik' : 'ea'}
      />
    </>
  )
}
