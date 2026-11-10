import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { STRIPE_PLAN_LABELS, STRIPE_STATUS_META } from '@/lib/stripe/client'
import { aboStandBerechnen, nochKeinPaketGebucht } from '@/lib/abo/regeln'
import { PAKET_REIHENFOLGE, PAKETE, paketAusPlan, paketPriceId } from '@/lib/pakete'
import { mandantenText } from '@/lib/abo/verbund'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { pruefeBenutzerlimit } from '@/lib/pakete-server'
import AboClient from './AboClient'
import { BetriebsPruefMelder } from '@/components/BetriebsWaechter'
import Link from '@/components/ui/Link'
import { PREMIUM_SUPPORT, heuteWien, kuendigungZumMonatsende, premiumSupportStand, premiumSupportText, tagText } from '@/lib/abo/premiumSupport'
import PremiumSupportKnopf from './PremiumSupportKnopf'
import { geladen } from '@/lib/supabase/geladen'

// Rückmeldung 31.8.2026 ("die Plattform soll sich selber abrechnen können,
// damit wir zu unserem Geld kommen"): Selbstverwaltung von Abo und Zahlung.
// Bewusst AUSSERHALB der (dashboard)-Route-Gruppe angesiedelt. Seit KAN-5
// (25.9.2026) leitet das Layout gesperrte Betriebe nicht mehr hierher um – sie
// arbeiten im Nur-Lesen-Modus weiter, die Hinweisleiste verlinkt auf diese Seite.
// Umgeleitet wird nur noch ein Neukunde, der den Checkout der Registrierung nie
// abgeschlossen hat ('incomplete' ohne Abo-ID, AboStand.zahlungOffen).

export const metadata: Metadata = { title: 'Abo & Zahlung' }
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

  // Sweep 86 (KAN-278): ein Lesefehler wirft (error.tsx) – sonst sähe der Betrieb „kein Abo“ bzw. „Zahlung nachholen“
  const tenantRow = geladen(await (supabase.from('tenants') as any)
    .select('name, kundennummer, stripe_status, stripe_plan, stripe_customer_id, stripe_subscription_id, stripe_trial_ends_at, abrechnung_ueber')
    .eq('id', membership.tenantId)
    .maybeSingle(), 'Betrieb')

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
  // KAN-402: neuer Betrieb ohne Abo – Hinweis zur Buchung statt „kein aktives Abo“ (keine Testphase mehr)
  const ohnePaket       = abo.gesperrt && nochKeinPaketGebucht(stripeStatus, hatAbo)
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
  const einstRow = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea, buchhaltungsart').eq('tenant_id', membership.tenantId).maybeSingle(), 'Einstellungen')
  const einst = einstRow as R | null

  // KAN-215/KAN-214: Submandant (über den Hauptmandanten) bzw. Hauptmandant mit Submandanten
  const adminClient = createSupabaseAdminClient()
  const [hauptRes, nebenRes] = await Promise.all([
    t?.abrechnung_ueber ? (adminClient.from('tenants') as R).select('name').eq('id', t.abrechnung_ueber).maybeSingle() : Promise.resolve({ data: null, error: null }),
    (adminClient.from('tenants') as R).select('name').eq('abrechnung_ueber', membership.tenantId).order('name'),
  ])
  const hauptRow = geladen(hauptRes, 'Hauptbetrieb')
  const nebenRows = geladen(nebenRes, 'Submandanten')
  const hauptName = (hauptRow as R | null)?.name as string | undefined

  // KAN-226: Premium-Support – getrennt und fehlertolerant (vor der Migration gibt es die Spalten nicht)
  // abfrage-ohne-fehler: Premium-Support bewusst fehlertolerant (KAN-226) – ohne Spalten bzw. bei Fehler „ohne“
  const { data: psRow } = await (supabase.from('tenants') as R)
    .select('premium_support_seit, premium_support_bis').eq('id', membership.tenantId).maybeSingle()
  const psStand = premiumSupportStand({ seit: (psRow as R | null)?.premium_support_seit ?? null, bis: (psRow as R | null)?.premium_support_bis ?? null })
  // KAN-226 Teil 2: selbst buchen/kündigen – nur Betriebsleitung, mit Stripe-Preis und eigenem Abo, nicht im Nur-Lesen-Modus
  const psSelbst = canAdmin(role) && !!(process.env.STRIPE_PRICE_PREMIUM_SUPPORT ?? '').trim() && hatAbo && !t?.abrechnung_ueber && !abo.gesperrt
  const psGebucht = psStand.status === 'aktiv' && !psStand.bis
  const psKnopf = psSelbst && (psGebucht || psStand.status === 'ohne' || psStand.status === 'beendet')
  const premiumKarte = (
    <div className="max-w-3xl mx-auto px-6 pb-6">
      <div className="card p-4 text-sm space-y-1">
        <h2 className="font-semibold text-s112-text">Premium-Support</h2>
        <p className="text-s112-text-2">
          {psStand.status === 'ohne' || psStand.status === 'beendet'
            ? <>Zu jedem Paket dazubuchbar: {PREMIUM_SUPPORT.preisMonatNetto} € netto pro Monat, monatlich kündbar – Reaktion
                innerhalb von {PREMIUM_SUPPORT.reaktionszeit} ({PREMIUM_SUPPORT.servicezeiten}).{psKnopf ? '' : ' Zum Buchen oder Kündigen wenden Sie sich bitte an uns.'}</>
            : <>{premiumSupportText(psStand)} · {PREMIUM_SUPPORT.preisMonatNetto} € netto pro Monat. Kündigung zum Monatsende{psKnopf ? '.' : ' – wenden Sie sich bitte an uns.'}</>}
          {' '}<Link href="/hilfe/support" className="text-s112-blue-700 hover:underline">Mehr zum Support</Link>
        </p>
        {psKnopf && <PremiumSupportKnopf gebucht={psGebucht} preisNetto={PREMIUM_SUPPORT.preisMonatNetto} monatsende={tagText(kuendigungZumMonatsende(heuteWien()))} />}
      </div>
    </div>
  )
  const nebenNamen = ((nebenRows ?? []) as R[]).map(n => n.name as string)

  if (t?.abrechnung_ueber) {
    return (
      <>
        <BetriebsPruefMelder />
        <div className="max-w-xl mx-auto p-6 space-y-3">
          <h1 className="text-2xl font-semibold text-s112-text">Abo</h1>
          <div className="card p-5 space-y-2 text-sm">
            <p>
              Ihr Betrieb ist Submandant von <strong>{hauptName ?? 'den Hauptmandanten'}</strong> (ohne Aufpreis,
              Paket {aktuellesPaket ? PAKETE[aktuellesPaket].label : 'des Hauptmandanten'}{statusMeta ? `, ${statusMeta.label}` : ''}).
              {/* KAN-403: Paket und Module folgen dem Hauptmandanten, das Benutzerlimit gilt je Mandant */}
            </p>
            <p className="text-s112-text-2">Rechnung, Zahlungsdaten und Kündigung verwaltet der Hauptmandant. Für ein eigenes Abo wenden Sie sich bitte an uns.</p>
          </div>
        </div>
        {premiumKarte}
      </>
    )
  }

  return (
    <>
      {nebenNamen.length > 0 && (
        <div className="max-w-3xl mx-auto px-6 pt-6">
          <div className="card p-4 text-sm">
            Submandant{nebenNamen.length > 1 ? 'en' : ''} Ihres Betriebs (ohne Aufpreis): {nebenNamen.join(', ')}.
            {/* KAN-403 (Vertrag v3, NV 2.3): Mandanten je Paket inkl. Hauptmandant */}
            {aktuellesPaket && <> Ihr Paket {PAKETE[aktuellesPaket].label} umfasst {mandantenText(aktuellesPaket)}, genutzt {nebenNamen.length + 1}.</>}
            {' '}Ein Wechsel in ein Paket mit weniger Mandanten ist erst möglich, wenn die Submandanten dazu passen.
          </div>
        </div>
      )}
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
        ohnePaket={ohnePaket}
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
      {premiumKarte}
    </>
  )
}
