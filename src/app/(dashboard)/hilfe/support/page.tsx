import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Headset, Mail, Phone, ShieldCheck } from 'lucide-react'
import { PREMIUM_SUPPORT, premiumSupportStand, supportKontakt, tagText } from '@/lib/abo/premiumSupport'
import { jsmKonfiguriert } from '@/lib/support/jsm'
import SupportAnfrage from './SupportAnfrage'

export const metadata: Metadata = { title: 'Support – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-226 (08.10.2026): Support-Kontakt für alle, Premium-Support-Leistungen für Betriebe mit gebuchtem Paket.
// KAN-230: „Problem melden“ und „Meine Anfragen“ über Jira Service Management, sobald JSM_API_* gesetzt ist.
export default async function SupportPage() {
  const membership = await getCurrentMembership()
  const supabase = await createSupabaseServerClient()
  // Fehlertolerant: vor der Migration KAN-226 gibt es die Spalten nicht – dann wie „nicht gebucht“
  const { data } = membership
    ? await (supabase.from('tenants') as R)
      .select('premium_support_seit, premium_support_bis').eq('id', membership.tenantId).maybeSingle()
    : { data: null }
  const t = data as R | null
  const stand = premiumSupportStand({ seit: t?.premium_support_seit ?? null, bis: t?.premium_support_bis ?? null })
  const premium = stand.status === 'aktiv'
  const kontakt = supportKontakt()

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/hilfe/handbuch" className="hover:text-s112-blue-700 transition-colors">Hilfe</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Support</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Support</h1>
        <p className="text-sm text-s112-muted mt-0.5">So erreichen Sie uns bei Fragen und Problemen</p>
      </div>

      <div className="space-y-4 max-w-3xl">
        {jsmKonfiguriert() && <SupportAnfrage emailFallback={kontakt.email} />}
        {premium ? (
          <section className="card p-5 space-y-3 border-s112-ok">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-s112-ok-fg" aria-hidden />
              <h2 className="text-base font-semibold text-s112-text">Premium-Support aktiv</h2>
            </div>
            <p className="text-sm text-s112-text-2">
              Wir reagieren innerhalb von <strong>{PREMIUM_SUPPORT.reaktionszeit}</strong> ({PREMIUM_SUPPORT.servicezeiten}).
              {stand.bis && <> Gebucht bis {tagText(stand.bis)}.</>}
            </p>
            <ul className="text-sm space-y-2">
              {kontakt.telefon && (
                <li className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-s112-muted" aria-hidden />
                  <a href={`tel:${kontakt.telefon.replace(/[^+\d]/g, '')}`} className="font-medium text-s112-blue-700 hover:underline">{kontakt.telefon}</a>
                  <span className="text-s112-muted">– wir legen die Anfrage für Sie an und schicken Ihnen den Link per E-Mail</span>
                </li>
              )}
              {kontakt.email && (
                <li className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-s112-muted" aria-hidden />
                  <a href={`mailto:${kontakt.email}?subject=${encodeURIComponent('Premium-Support')}`} className="font-medium text-s112-blue-700 hover:underline">{kontakt.email}</a>
                </li>
              )}
            </ul>
          </section>
        ) : (
          <section className="card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Headset className="w-5 h-5 text-s112-muted" aria-hidden />
              <h2 className="text-base font-semibold text-s112-text">Kontakt</h2>
            </div>
            {kontakt.email ? (
              <p className="text-sm text-s112-text-2">
                Schreiben Sie uns an{' '}
                <a href={`mailto:${kontakt.email}?subject=${encodeURIComponent('Support software:112')}`} className="font-medium text-s112-blue-700 hover:underline">{kontakt.email}</a>
                {' '}– wir melden uns so rasch wie möglich.
              </p>
            ) : (
              <p className="text-sm text-s112-text-2">Wenden Sie sich bitte an Ihre Ansprechperson bei software:112.</p>
            )}
            <p className="text-sm text-s112-text-2">
              Viele Fragen beantworten auch das <Link href="/hilfe/handbuch" className="text-s112-blue-700 hover:underline">Handbuch</Link> und
              die <Link href="/hilfe/faq" className="text-s112-blue-700 hover:underline">FAQ</Link>.
            </p>
          </section>
        )}

        {!premium && (
          <section className="card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-s112-muted" aria-hidden />
              <h2 className="text-base font-semibold text-s112-text">Premium-Support</h2>
            </div>
            <p className="text-sm text-s112-text-2">
              Zu jedem Paket dazubuchbar: <strong>{PREMIUM_SUPPORT.preisMonatNetto} € netto pro Monat</strong>, monatlich kündbar.
              {stand.status === 'geplant' && <> Ihr Premium-Support beginnt am {tagText(stand.seit)}.</>}
            </p>
            <ul className="text-sm list-disc ml-5 text-s112-text-2 space-y-1">
              {PREMIUM_SUPPORT.leistungen.map(l => <li key={l}>{l}</li>)}
            </ul>
            <p className="text-sm text-s112-text-2">
              Buchen über <Link href="/abo" className="text-s112-blue-700 hover:underline">Abo &amp; Zahlung</Link>.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
