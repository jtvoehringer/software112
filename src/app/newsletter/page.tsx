import type { Metadata } from 'next'
import NewsletterForm from './NewsletterForm'
import { Wine } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Newsletter – Weingut Gebeshuber',
  description: 'Melden Sie sich für unseren Newsletter an und erhalten Sie Neuigkeiten zu unseren Weinen, Jahrgängen und Verkostungsterminen.',
}

export default function NewsletterPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-s112-bg to-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="mb-3 flex justify-center">
            <Wine className="w-12 h-12 text-s112-blue-700" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold text-s112-text">Weingut Gebeshuber</h1>
          <p className="text-s112-muted text-sm mt-1">Newsletter-Anmeldung</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-s112-border p-8">
          <h2 className="text-lg font-semibold text-s112-text mb-1">Bleiben Sie informiert</h2>
          <p className="text-sm text-s112-muted mb-6">
            Neuigkeiten zu unseren Weinen, Jahrgängen und Verkostungsterminen – direkt in Ihr Postfach.
          </p>

          <NewsletterForm />

          <p className="mt-5 text-xs text-s112-muted leading-relaxed">
            Mit der Anmeldung erhalten Sie zunächst eine Bestätigungs-E-Mail (Double Opt-in).
            Ihre Daten werden ausschließlich für den Newsletter verwendet und nicht an Dritte weitergegeben.
            Sie können sich jederzeit abmelden.{' '}
            <span className="text-s112-tertiary">· DSGVO-konform</span>
          </p>
        </div>

        <p className="text-center text-xs text-s112-muted mt-6">
          Weingut Gebeshuber · Niederösterreich
        </p>
      </div>
    </div>
  )
}
