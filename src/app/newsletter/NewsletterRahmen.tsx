// Gemeinsamer Rahmen der öffentlichen Newsletter-Seiten: Logo/Name des Betriebs, Karte, Fußzeile.
import type { ReactNode } from 'react'
import { Wine } from 'lucide-react'
import type { NewsletterBetrieb } from '@/lib/newsletter/betrieb'

export default function NewsletterRahmen({ betrieb, untertitel, children }: {
  betrieb: NewsletterBetrieb | null
  untertitel?: string
  children: ReactNode
}) {
  const name = betrieb?.name ?? 'Newsletter'
  return (
    <main id="inhalt" className="min-h-screen bg-linear-to-b from-s112-bg to-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mb-3 flex justify-center">
            {betrieb?.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={betrieb.logoUrl} alt="" className="h-14 w-auto max-w-[220px] object-contain" />
              : <Wine className="w-12 h-12" style={{ color: betrieb?.farbe ?? '#2F63AC' }} aria-hidden="true" />}
          </div>
          <h1 className="text-2xl font-semibold text-s112-text">{name}</h1>
          {untertitel && <p className="text-s112-muted text-sm mt-1">{untertitel}</p>}
        </div>

        <div className="bg-white rounded-xl shadow-xs border border-s112-border p-8">
          {children}
        </div>

        <p className="text-center text-xs text-s112-muted mt-6">
          {name}
          {betrieb?.datenschutzUrl && <> · <a href={betrieb.datenschutzUrl} target="_blank" rel="noreferrer" className="underline">Datenschutz</a></>}
          {' · '}<a href="/barrierefreiheit" className="underline">Barrierefreiheit</a>
        </p>
      </div>
    </main>
  )
}
