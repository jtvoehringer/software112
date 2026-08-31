'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { createOwnStripePortalSession } from './actions'

// Rückmeldung 31.8.2026 ("die Plattform soll sich selber abrechnen können,
// damit wir zu unserem Geld kommen"): Selbstverwaltungsseite für Mandanten
// mit Zahlungsproblem (siehe (dashboard)/layout.tsx, das hierher umleitet
// bzw. warnt) - Layout/Stil analog (auth)/betrieb-waehlen/page.tsx.

export default function AboClient({
  hardBlocked,
  trialAbgelaufen,
  warned,
  darfVerwalten,
  hasCustomer,
  planLabel,
  statusLabel,
}: {
  hardBlocked:     boolean
  trialAbgelaufen: boolean
  warned:          boolean
  darfVerwalten:   boolean
  hasCustomer:     boolean
  planLabel:       string | null
  statusLabel:     string | null
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handlePortal() {
    setLoading(true)
    setError(null)
    const res = await createOwnStripePortalSession()
    if ('error' in res && res.error) {
      setError(res.error)
      setLoading(false)
      return
    }
    if ('url' in res && res.url) {
      window.location.href = res.url
      return
    }
    setLoading(false)
  }

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-s112-teal inline-flex items-baseline gap-0">
            software<span className="text-s112-yellow">:</span>112
          </h1>
          <p className="text-s112-muted text-sm mt-1">Abo & Zahlung</p>
        </div>

        <div className="card space-y-4">
          {hardBlocked && trialAbgelaufen ? (
            <div className="px-4 py-3 rounded-lg bg-s112-err-bg text-s112-err-fg text-sm">
              <p className="font-semibold mb-1">Testphase abgelaufen</p>
              <p>
                Ihre kostenlose 14-tägige Testphase ist beendet. Bitte hinterlegen Sie Ihre Zahlungsdaten,
                um software:112 weiter zu nutzen.
              </p>
            </div>
          ) : hardBlocked ? (
            <div className="px-4 py-3 rounded-lg bg-s112-err-bg text-s112-err-fg text-sm">
              <p className="font-semibold mb-1">Zugriff derzeit gesperrt</p>
              <p>
                Ihr Betrieb hat aktuell kein aktives Abo{statusLabel ? ` (Status: ${statusLabel})` : ''}.
                Bitte aktualisieren Sie Ihre Zahlungsdaten, um software:112 wieder zu nutzen.
              </p>
            </div>
          ) : warned ? (
            <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              <p className="font-semibold mb-1">Problem mit der letzten Zahlung</p>
              <p>
                Bitte aktualisieren Sie Ihre Zahlungsdaten zeitnah, um eine Sperre zu vermeiden.
              </p>
            </div>
          ) : (
            <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
              <p className="font-semibold">Ihr Abo ist aktiv.</p>
              {planLabel && <p className="mt-0.5">Aktueller Plan: {planLabel}</p>}
            </div>
          )}

          {darfVerwalten ? (
            hasCustomer ? (
              <button
                onClick={handlePortal}
                disabled={loading}
                className="w-full bg-s112-teal text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-60"
              >
                {loading ? 'Wird geöffnet…' : 'Zahlungsdaten verwalten'}
              </button>
            ) : (
              <p className="text-sm text-s112-muted">
                Für Ihren Betrieb ist noch kein Zahlungskonto hinterlegt. Bitte kontaktieren Sie uns, damit wir Ihr Abo einrichten.
              </p>
            )
          ) : (
            <p className="text-sm text-s112-muted">
              Nur der Betriebsleiter kann die Zahlungsdaten verwalten. Bitte wenden Sie sich an Ihren Betriebsleiter.
            </p>
          )}

          {error && (
            <p className="text-sm text-s112-err-fg">{error}</p>
          )}

          <button
            onClick={handleLogout}
            className="w-full text-center text-xs text-s112-muted hover:text-s112-teal transition-colors pt-2"
          >
            Abmelden
          </button>
        </div>
      </div>
    </div>
  )
}
