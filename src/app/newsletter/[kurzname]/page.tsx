import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import NewsletterForm from '../NewsletterForm'
import NewsletterRahmen from '../NewsletterRahmen'
import { ladeNewsletterBetrieb } from '@/lib/newsletter/betrieb'

// Öffentliche Newsletter-Anmeldung je Betrieb (23.9.2026): /newsletter/<kurzname>.
// Kurzname, Brevo-Zugang und Texte: Administration › Mandant › Brevo.

export async function generateMetadata({ params }: { params: Promise<{ kurzname: string }> }): Promise<Metadata> {
  const { kurzname } = await params
  const b = await ladeNewsletterBetrieb(kurzname)
  if (!b?.aktiv) return { title: 'Newsletter' }
  return {
    title: `Newsletter – ${b.name}`,
    description: b.einleitung ?? `Melden Sie sich für den Newsletter von ${b.name} an.`,
  }
}

export default async function NewsletterBetriebSeite({ params }: { params: Promise<{ kurzname: string }> }) {
  const { kurzname } = await params
  const betrieb = await ladeNewsletterBetrieb(kurzname)
  if (!betrieb?.aktiv || !betrieb.kurzname) notFound()

  return (
    <NewsletterRahmen betrieb={betrieb} untertitel="Newsletter-Anmeldung">
      <h2 className="text-lg font-semibold text-s112-text mb-1">Bleiben Sie informiert</h2>
      <p className="text-sm text-s112-muted mb-6 whitespace-pre-line">
        {betrieb.einleitung ?? 'Neuigkeiten zu unseren Weinen, Jahrgängen und Verkostungsterminen – direkt in Ihr Postfach.'}
      </p>

      <NewsletterForm kurzname={betrieb.kurzname} farbe={betrieb.farbe} betriebName={betrieb.name} datenschutzUrl={betrieb.datenschutzUrl} />

      <p className="mt-5 text-xs text-s112-muted leading-relaxed">
        Mit der Anmeldung erhalten Sie zunächst eine Bestätigungs-E-Mail (Double Opt-in).
        Ihre Daten werden ausschließlich für den Newsletter verwendet und nicht an Dritte weitergegeben.
        Sie können sich jederzeit abmelden.
      </p>
    </NewsletterRahmen>
  )
}
