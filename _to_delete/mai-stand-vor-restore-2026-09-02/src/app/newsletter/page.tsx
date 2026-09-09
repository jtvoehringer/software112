import type { Metadata } from 'next'
import NewsletterForm from './NewsletterForm'

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
          <div className="text-5xl mb-3">🍷</div>
          <h1 className="text-2xl font-bold text-gray-900">Weingut Gebeshuber</h1>
          <p className="text-s112-muted text-sm mt-1">Newsletter-Anmeldung</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-s112-border p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Bleiben Sie informiert</h2>
          <p className="text-sm text-s112-muted mb-6">
            Neuigkeiten zu unseren Weinen, Jahrgängen und Verkostungsterminen – direkt in Ihr Postfach.
          </p>

          <NewsletterForm />

          <p className="mt-5 text-xs text-s112-muted leading-relaxed">
            Mit der Anmeldung erhalten Sie zunächst eine Bestätigungs-E-Mail (Double Opt-in).
            Ihre Daten werden ausschließlich für den Newsletter verwendet und nicht an Dritte weitergegeben.
            Sie können sich jederzeit abmelden.{' '}
            <span className="text-gray-400">· DSGVO-konform</span>
          </p>
        </div>

        <p className="text-center text-xs text-s112-muted mt-6">
          Weingut Gebeshuber · Niederösterreich
        </p>
      </div>
    </div>
  )
}
