import { newsletterAbmelden } from '../actions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Newsletter abmelden – Weingut Gebeshuber' }

export default async function AbmeldenPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email } = await searchParams
  let result = { ok: false }

  if (email) {
    result = await newsletterAbmelden(decodeURIComponent(email))
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-s112-bg to-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🍷</div>
          <h1 className="text-2xl font-bold text-gray-900">Weingut Gebeshuber</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-s112-border p-8 text-center">
          {result.ok ? (
            <>
              <div className="text-4xl mb-3">👋</div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Abgemeldet</h2>
              <p className="text-sm text-s112-muted">
                Sie wurden vom Newsletter abgemeldet. Wir löschen Ihre Anmeldedaten gemäß DSGVO.
              </p>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3">⚠️</div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Ungültiger Link</h2>
              <p className="text-sm text-s112-muted">
                Die Abmeldung konnte nicht verarbeitet werden. Bitte kontaktieren Sie uns direkt.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
