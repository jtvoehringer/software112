import type { Metadata } from 'next'
import RechtsSeite, { Abschnitt } from '@/components/RechtsSeite'

export const metadata: Metadata = {
  title: 'Datenschutz',
  description: 'Datenschutzerklärung von software:112 (Hohenstein Consulting OG).',
}

// Datenschutzerklärung (KAN-300, 10.11.2026) – öffentlich erreichbar (PUBLIC_ROUTES in src/proxy.ts); AGB 10.1 verweist
// auf „/datenschutz“. Gilt für die Daten, für die Hohenstein selbst Verantwortlicher ist. Für die Daten, die Betriebe in
// software:112 verarbeiten, ist Hohenstein Auftragsverarbeiter (Anlage 2 der Vertragsunterlagen, /agb).
// Empfänger hier = Anhang B der AVV, soweit sie Daten aus dieser Erklärung verarbeiten – bei Änderungen beide nachziehen.
export default function DatenschutzSeite() {
  return (
    <RechtsSeite titel="Datenschutzerklärung" stand="10. November 2026">
      <Abschnitt titel="1. Verantwortlicher">
        <p>
          Hohenstein Consulting OG, Jubiläumsstraße 43, 2352 Gumpoldskirchen, Österreich ·
          E-Mail <a href="mailto:office@hohenstein-partner.at" className="text-s112-blue-700 underline">office@hohenstein-partner.at</a>.
          Ein Datenschutzbeauftragter ist nicht bestellt, weil das Gesetz es nicht verlangt. Datenschutzanfragen richten Sie
          bitte an diese Adresse.
        </p>
      </Abschnitt>

      <Abschnitt titel="2. Geltungsbereich">
        <p>
          Diese Erklärung gilt für den Aufruf der Anwendung software:112, die Registrierung, Ihr Benutzerkonto, den Vertrag
          über die Nutzung und den Support.
        </p>
        <p>
          <strong>Daten, die Betriebe in software:112 erfassen</strong> (Kunden, Lieferanten, Mitarbeiter, Newsletter-Empfänger,
          Weingärten, Buchungen …), verarbeiten wir im Auftrag des jeweiligen Betriebs. Verantwortlich ist dafür der Betrieb;
          es gilt seine Datenschutzerklärung und unsere Vereinbarung zur Auftragsverarbeitung (Anlage 2 der{' '}
          <a href="/agb" className="text-s112-blue-700 underline">Vertragsunterlagen</a>). Das gilt auch für die öffentlichen
          Seiten eines Betriebs (Newsletter-Anmeldung, elektronisches Etikett, Weinpass).
        </p>
      </Abschnitt>

      <Abschnitt titel="3. Aufruf der Anwendung">
        <p>
          Beim Aufruf jeder Seite verarbeiten unsere Hosting-Dienstleister technisch notwendige Daten: IP-Adresse, Zeitpunkt,
          aufgerufene Adresse, Browser und Betriebssystem sowie Fehlermeldungen. Zweck ist der sichere und stabile Betrieb,
          die Abwehr von Angriffen und die Fehlersuche (Art. 6 Abs. 1 lit. f DSGVO – berechtigtes Interesse). Diese
          Protokolle werden nach höchstens 30 Tagen gelöscht.
        </p>
      </Abschnitt>

      <Abschnitt titel="4. Cookies und lokaler Speicher">
        <p>
          software:112 verwendet nur technisch notwendige Cookies: für die Anmeldung, die automatische Abmeldung nach
          Inaktivität, den gewählten Betrieb und die Anmeldung über Microsoft 365. Einstellungen der Oberfläche (z. B.
          eingeklappte Bereiche) speichert Ihr Browser lokal. Wir setzen keine Analyse-, Werbe- oder Tracking-Dienste ein.
          Eine Einwilligung ist dafür nicht nötig (§ 165 Abs. 3 TKG 2021).
        </p>
      </Abschnitt>

      <Abschnitt titel="5. Registrierung und Benutzerkonto">
        <p>
          Für die Registrierung und das Benutzerkonto verarbeiten wir Name, E-Mail-Adresse, Name des Betriebs, das gewählte
          Paket, Ihre Rolle, das Passwort (nur verschlüsselt gespeichert), Daten der Zwei-Faktor-Anmeldung und Passkeys,
          Anmeldezeitpunkte sowie Ihre Bestätigung der Vertragsunterlagen (Fassung und Zeitpunkt). Rechtsgrundlage ist die
          Erfüllung des Vertrags bzw. vorvertragliche Maßnahmen (Art. 6 Abs. 1 lit. b DSGVO). Gegen Missbrauch begrenzen wir
          Registrierungs- und Anmeldeversuche je IP-Adresse (Art. 6 Abs. 1 lit. f DSGVO).
        </p>
        <p>
          Ihr Konto bleibt bestehen, solange Sie Mitglied eines Betriebs sind. Nach Vertragsende werden die Daten nach den
          Fristen der Vertragsunterlagen gelöscht (Anlage 2, Punkt 9; Anlage 3, Punkt 7).
        </p>
      </Abschnitt>

      <Abschnitt titel="6. Vertrag und Abrechnung">
        <p>
          Für Vertrag, Rechnungen und Zahlung verarbeiten wir Firmenname, Anschrift, UID-Nummer, Ansprechperson,
          E-Mail-Adresse, gebuchtes Paket und Zahlungsstatus (Art. 6 Abs. 1 lit. b und c DSGVO). Die Zahlung wickelt Stripe
          Payments Europe Ltd. (Dublin) ab; für die Zahlungsdaten (Karte, Konto) ist Stripe selbst Verantwortlicher, wir
          sehen sie nicht. Rechnungen und Buchhaltungsunterlagen bewahren wir sieben Jahre auf (§ 132 BAO).
        </p>
      </Abschnitt>

      <Abschnitt titel="7. E-Mails der Anwendung">
        <p>
          Einladungen, E-Mails zum Festlegen des Passworts und Benachrichtigungen versenden wir über Brevo (Sendinblue GmbH,
          Berlin). Dafür verarbeitet Brevo Ihre E-Mail-Adresse, Ihren Namen und den Inhalt der E-Mail
          (Art. 6 Abs. 1 lit. b DSGVO).
        </p>
      </Abschnitt>

      <Abschnitt titel="8. Support">
        <p>
          Wenn Sie uns über „Problem melden“ in der Anwendung oder per E-Mail kontaktieren, verarbeiten wir Ihren Namen, Ihre
          E-Mail-Adresse, den Betrieb, den Inhalt der Anfrage und mitgeschickte Bildschirmfotos, um die Anfrage zu bearbeiten
          (Art. 6 Abs. 1 lit. b bzw. f DSGVO). Das Support-Portal betreibt Atlassian (Jira Service Management), E-Mails
          laufen über Microsoft 365. Anfragen löschen wir, wenn sie für die Bearbeitung und den Nachweis nicht mehr nötig
          sind, spätestens drei Jahre nach ihrem Abschluss.
        </p>
      </Abschnitt>

      <Abschnitt titel="9. Empfänger und Dienstleister">
        <p>Wir setzen folgende Dienstleister ein, mit denen Verträge nach Art. 28 DSGVO bestehen:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>IC&amp;P Consultants e.U., Gumpoldskirchen – Entwicklung, Betrieb und technischer Support</li>
          <li>Supabase, Inc. – Datenbank, Anmeldung und Dateispeicher in der EU (Irland)</li>
          <li>Vercel Inc. – Hosting der Anwendung in der EU (Frankfurt)</li>
          <li>Sendinblue GmbH (Brevo) – Versand der E-Mails der Anwendung</li>
          <li>Atlassian – Support-Portal</li>
          <li>Microsoft Ireland Operations Ltd. – E-Mail</li>
        </ul>
        <p>
          Einige dieser Unternehmen haben ihren Sitz in den USA oder greifen von dort zu. Die Übermittlung ist durch den
          Angemessenheitsbeschluss zum EU-US Data Privacy Framework bzw. durch EU-Standardvertragsklauseln
          (Art. 45 und 46 DSGVO) abgesichert. Darüber hinaus geben wir Daten nur weiter, wenn wir gesetzlich dazu verpflichtet
          sind.
        </p>
      </Abschnitt>

      <Abschnitt titel="10. Ihre Rechte">
        <p>
          Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit
          sowie – bei Verarbeitungen aufgrund berechtigter Interessen – das Recht auf Widerspruch. Schreiben Sie uns dazu an{' '}
          <a href="mailto:office@hohenstein-partner.at" className="text-s112-blue-700 underline">office@hohenstein-partner.at</a>.
        </p>
        <p>
          Sie können sich außerdem bei der Österreichischen Datenschutzbehörde beschweren: Barichgasse 40–42, 1030 Wien,{' '}
          <a href="https://www.dsb.gv.at" target="_blank" rel="noopener" className="text-s112-blue-700 underline">www.dsb.gv.at</a>.
        </p>
        <p>
          Die Angabe der Daten für Registrierung und Vertrag ist für den Vertragsabschluss erforderlich; ohne sie können wir
          software:112 nicht bereitstellen. Eine automatisierte Entscheidungsfindung oder Profilbildung findet nicht statt.
        </p>
      </Abschnitt>
    </RechtsSeite>
  )
}
