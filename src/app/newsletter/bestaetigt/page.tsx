import { newsletterBestaetigen } from '../actions'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Wine, CheckCircle2, AlertTriangle } from 'lucide-react'

export const metadata: Metadata = { title: 'Newsletter bestätigt – Weingut Gebeshuber' }

export default async function BestaetigtPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const result = await newsletterBestaetigen(token ?? '')

  return (
    <div className="min-h-screen bg-gradient-to-b from-s112-bg to-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mb-3 flex justify-center">
            <Wine className="w-12 h-12 text-s112-teal" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Weingut Gebeshuber</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-s112-border p-8 text-center">
          {result.ok ? (
            <>
              <div className="mb-4 flex justify-center">
                <CheckCircle2 className="w-12 h-12 text-green-600" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Willkommen, {result.name}!
              </h2>
              <p className="text-sm text-s112-muted mb-6">
                Ihre Newsletter-Anmeldung ist bestätigt. Sie erhalten ab sofort
                Neuigkeiten zu unseren Weinen und Verkostungen.
              </p>
              <div className="bg-s112-bg rounded-xl p-4 text-xs text-s112-muted">
                Sie möchten sich abmelden?{' '}
                Jeder Newsletter enthält am Ende einen Abmelde-Link.
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 flex justify-center">
                <AlertTriangle className="w-12 h-12 text-amber-500" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Link ungültig</h2>
              <p className="text-sm text-s112-muted mb-6">{result.error}</p>
              <Link href="/newsletter"
                className="inline-block bg-s112-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
                Erneut anmelden
              </Link>
            </>
          )}
        </div>

        <p className="text-center text-xs text-s112-muted mt-6">
          Weingut Gebeshuber · Niederösterreich
        </p>
      </div>
    </div>
  )
}
