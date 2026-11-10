import type { Metadata } from 'next'
import RechtsSeite, { Abschnitt } from '@/components/RechtsSeite'

export const metadata: Metadata = {
  title: 'Impressum',
  description: 'Impressum und Offenlegung von software:112 (Hohenstein Consulting OG).',
}

// Impressum (KAN-300, 10.11.2026): Informationspflichten nach § 5 ECG und Offenlegung nach § 25 MedienG –
// öffentlich erreichbar (PUBLIC_ROUTES in src/proxy.ts). Daten wie in AGB 1.1 und im Nutzungsvertrag.
export default function ImpressumSeite() {
  return (
    <RechtsSeite titel="Impressum" stand="10. November 2026">
      <Abschnitt titel="Anbieter und Medieninhaber">
        <p>
          <strong>Hohenstein Consulting OG</strong><br />
          Jubiläumsstraße 43, 2352 Gumpoldskirchen, Österreich<br />
          E-Mail: <a href="mailto:office@hohenstein-partner.at" className="text-s112-blue-700 underline">office@hohenstein-partner.at</a>
        </p>
        <p>
          Firmenbuchnummer: FN 582923 s · Firmenbuchgericht: Landesgericht Wiener Neustadt<br />
          UID-Nummer: ATU78564457<br />
          Vertretungsbefugte Gesellschafter: Paul Derstroff, Johannes Gebeshuber, Jörgen Vöhringer
        </p>
        <p>Unternehmensgegenstand: Entwicklung, Vertrieb und Betrieb der Software software:112 für Weinbaubetriebe.</p>
      </Abschnitt>

      <Abschnitt titel="Technischer Betrieb">
        <p>
          IC&amp;P Consultants e.U., Inhaber Jörgen Vöhringer, Wienerstraße 103, 2352 Gumpoldskirchen ·
          FN 415469 i · UID-Nummer: ATU68587567
        </p>
      </Abschnitt>

      <Abschnitt titel="Grundlegende Richtung">
        <p>Information über die Software software:112 und ihre Nutzung durch Weinbaubetriebe.</p>
      </Abschnitt>

      <Abschnitt titel="Streitbeilegung">
        <p>
          software:112 richtet sich ausschließlich an Unternehmer. Wir sind nicht verpflichtet und nicht bereit, an
          Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </Abschnitt>
    </RechtsSeite>
  )
}
