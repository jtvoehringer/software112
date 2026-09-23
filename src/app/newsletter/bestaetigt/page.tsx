import { newsletterBestaetigen } from '../actions'
import type { Metadata } from 'next'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import NewsletterRahmen from '../NewsletterRahmen'

export const metadata: Metadata = { title: 'Newsletter-Anmeldung bestätigen' }
export const dynamic = 'force-dynamic'

export default async function BestaetigtPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const result = await newsletterBestaetigen(token ?? '')
  const b = result.betrieb

  return (
    <NewsletterRahmen betrieb={b}>
      <div className="text-center">
        {result.ok ? (
          <div role="status">
            <div className="mb-4 flex justify-center">
              <CheckCircle2 className="w-12 h-12 text-s112-ok-fg" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-s112-text mb-2">
              {result.name ? `Willkommen, ${result.name}!` : 'Willkommen!'}
            </h2>
            <p className="text-sm text-s112-muted mb-6">
              Ihre Newsletter-Anmeldung ist bestätigt. Sie erhalten ab sofort unsere Neuigkeiten.
            </p>
            <div className="bg-s112-bg rounded-xl p-4 text-xs text-s112-muted">
              Sie möchten sich abmelden? Jeder Newsletter enthält am Ende einen Abmelde-Link.
            </div>
          </div>
        ) : (
          <div role="alert">
            <div className="mb-4 flex justify-center">
              <AlertTriangle className="w-12 h-12 text-s112-warn-fg" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-s112-text mb-2">Link ungültig</h2>
            <p className="text-sm text-s112-muted mb-6">{result.error}</p>
            {b?.aktiv && b.kurzname && (
              <a href={`/newsletter/${b.kurzname}`} style={{ backgroundColor: b.farbe }}
                className="inline-block text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
                Erneut anmelden
              </a>
            )}
          </div>
        )}
      </div>
    </NewsletterRahmen>
  )
}
