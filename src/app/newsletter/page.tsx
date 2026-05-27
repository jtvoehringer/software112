// Öffentliche Newsletter-Anmeldung (kein Auth erforderlich)
// DSGVO-konform: Double Opt-in via Brevo
// TODO: Implementierung in Session Phase 2 Newsletter

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Newsletter – Weingut Gebeshuber',
  description: 'Melden Sie sich für unseren Newsletter an und erhalten Sie Neuigkeiten zu unseren Weinen.',
}

export default function NewsletterPage() {
  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-s112-border p-8 max-w-md w-full text-center">
        <p className="text-3xl mb-4">🍷</p>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Newsletter</h1>
        <p className="text-sm text-s112-muted">Wird in Kürze freigeschaltet.</p>
      </div>
    </div>
  )
}
