import type { Metadata } from 'next'
import RechtsSeite, { Abschnitt } from '@/components/RechtsSeite'
import { VERTRAG_DATUM, VERTRAG_FASSUNG, VERTRAG_PDF } from '@/lib/vertrag/fassung'

export const metadata: Metadata = {
  title: 'AGB',
  description: 'Allgemeine Geschäftsbedingungen, Vereinbarung zur Auftragsverarbeitung und Leistungsbeschreibung von software:112.',
}

// AGB (KAN-300, 10.11.2026) – öffentlich erreichbar (PUBLIC_ROUTES in src/proxy.ts). Inhalt ist die PDF der
// Endfassung (lib/vertrag/fassung.ts); die Seite selbst gibt nur Fassung, Aufbau und den Download an.
export default function AgbSeite() {
  return (
    <RechtsSeite titel="Allgemeine Geschäftsbedingungen" stand={`Version ${VERTRAG_FASSUNG} vom ${VERTRAG_DATUM}`}>
      <Abschnitt titel="Vertragsunterlagen">
        <p>
          Für die Nutzung von software:112 gelten die folgenden Unterlagen der Hohenstein Consulting OG. Sie sind in einem
          Dokument zusammengefasst:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Anlage 1</strong> – Allgemeine Geschäftsbedingungen (AGB)</li>
          <li><strong>Anlage 2</strong> – Vereinbarung zur Auftragsverarbeitung nach Art. 28 DSGVO (AVV) mit den Subauftragsverarbeitern und den technischen und organisatorischen Maßnahmen</li>
          <li><strong>Anlage 3</strong> – Leistungsbeschreibung und Service Levels</li>
        </ul>
        <p>
          <a href={VERTRAG_PDF} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-s112-blue-700 font-medium underline">
            Vertragsunterlagen herunterladen (PDF, Version {VERTRAG_FASSUNG})
          </a>
        </p>
      </Abschnitt>

      <Abschnitt titel="Vertragsabschluss">
        <p>
          Der Vertrag kommt mit der Unterzeichnung des Nutzungsvertrags oder mit der Buchung eines Pakets in der Anwendung
          zustande. Bei der Registrierung bestätigen Sie, dass Sie diese Unterlagen gelesen haben; die Bestätigung bei der
          Buchung gilt als Unterzeichnung der Vereinbarung zur Auftragsverarbeitung. software:112 richtet sich
          ausschließlich an Unternehmer.
        </p>
      </Abschnitt>

      <Abschnitt titel="Fragen">
        <p>
          Fragen zum Vertrag beantworten wir unter{' '}
          <a href="mailto:office@hohenstein-partner.at" className="text-s112-blue-700 underline">office@hohenstein-partner.at</a>.
        </p>
      </Abschnitt>
    </RechtsSeite>
  )
}
