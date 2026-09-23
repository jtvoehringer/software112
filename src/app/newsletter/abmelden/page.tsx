import { newsletterAbmelden } from '../actions'
import type { Metadata } from 'next'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import NewsletterRahmen from '../NewsletterRahmen'

export const metadata: Metadata = { title: 'Newsletter abmelden' }
export const dynamic = 'force-dynamic'

// Abmeldung per signiertem Link (?k=<kontakt-id>&t=<signatur>, 23.9.2026).
// Alte Links mit ?email= werden nicht mehr angenommen – damit konnte jeder jede Adresse abmelden.
export default async function AbmeldenPage({
  searchParams,
}: {
  searchParams: Promise<{ k?: string; t?: string }>
}) {
  const { k, t } = await searchParams
  const result = k && t ? await newsletterAbmelden(k, t) : { ok: false, betrieb: null }

  return (
    <NewsletterRahmen betrieb={result.betrieb}>
      <div className="text-center">
        {result.ok ? (
          <div role="status">
            <div className="mb-3 flex justify-center">
              <CheckCircle2 className="w-9 h-9 text-s112-ok-fg" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold text-s112-text mb-2">Abgemeldet</h2>
            <p className="text-sm text-s112-muted">
              Sie wurden vom Newsletter abgemeldet und erhalten keine weiteren Ausgaben.
            </p>
          </div>
        ) : (
          <div role="alert">
            <div className="mb-3 flex justify-center">
              <AlertTriangle className="w-9 h-9 text-s112-warn-fg" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold text-s112-text mb-2">Ungültiger Link</h2>
            <p className="text-sm text-s112-muted">
              Die Abmeldung konnte nicht verarbeitet werden. Bitte nutzen Sie den Abmelde-Link am Ende
              des Newsletters oder wenden Sie sich direkt an den Betrieb.
            </p>
          </div>
        )}
      </div>
    </NewsletterRahmen>
  )
}
