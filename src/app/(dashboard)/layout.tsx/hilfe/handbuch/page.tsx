'use client'

import { useState } from 'react'
import Link from 'next/link'

type Abschnitt = { titel: string; inhalt: string }
type Kapitel = { id: string; icon: string; titel: string; abschnitte: Abschnitt[] }

const KAPITEL: Kapitel[] = [
  {
    id: 'weingarten', icon: '🌿', titel: 'Weingarten',
    abschnitte: [
      { titel: 'Weingärten anlegen', inhalt: 'Navigiere zu Weingarten > Weingärten > Neuer Weingarten. Pflichtfelder: Name, Rebsorte, Fläche (ha), Gemeinde/Lage. Der Weingarten erscheint in allen Behandlungs- und Erntemasken.' },
      { titel: 'Behandlung erfassen', inhalt: 'Unter Weingarten > Behandlungen > Neue Behandlung: Datum, Weingarten, PSM-Mittel und Aufwandmenge eintragen. Das System berechnet automatisch den frühesten Erntetermin nach Wartezeit.' },
      { titel: 'PSM-Lager', inhalt: 'Unter Behandlungen > PSM-Lager pflegst du Anfangsbestand und Einkäufe. Das Lager wird bei jeder Behandlung automatisch reduziert. Inventurkorrekturen sind jederzeit möglich.' },
      { titel: 'Lese erfassen', inhalt: 'Unter Weingarten > Lese wählst du den Jahrgang und trägst Datum, Weingarten, Menge (kg + hl) und Grad KMW ein. Diese Daten bilden die Basis für die AMA-Erntemeldung.' },
    ],
  },
  {
    id: 'kellerbuch', icon: '🍷', titel: 'Kellerbuch',
    abschnitte: [
      { titel: 'Weinausbau-Charge anlegen', inhalt: 'Unter Kellerbuch > Vinifizierung > Neue Charge: Name, Jahrgang, Rebsorte, Qualitätsstufe und Behälter festlegen. Die Charge verfolgt Menge und Qualität durch alle Keller-Operationen.' },
      { titel: 'Umziehen (n:n)', inhalt: 'Unter Kellerbuch > Umziehen kannst du mehrere Quell-Chargen in mehrere Zielbehälter umziehen. Der Schwund wird automatisch berechnet. Bei Verschnitt sinkt die Qualitätsstufe auf das niedrigste Level.' },
      { titel: 'Abfüllen', inhalt: 'Unter Kellerbuch > Füllen wählst du die Weinausbau-Charge, Flaschengröße, Anzahl Flaschen und VK-Preis. Die Füllung erscheint danach im Warenwirtschaft-Lager.' },
      { titel: 'Kellerplan', inhalt: 'Der Kellerplan zeigt eine visuelle Übersicht aller Behälter mit aktueller Belegung. Behälter können per Drag & Drop verschoben werden. Nützlich für Bio-Kontrolle und Raumplanung.' },
    ],
  },
  {
    id: 'warenwirtschaft', icon: '🛒', titel: 'Warenwirtschaft',
    abschnitte: [
      { titel: 'Verkauf anlegen', inhalt: 'Unter Warenwirtschaft > Verkauf > Neuer Verkauf: zuerst Kontakt oder Firma wählen (Pflicht!), dann Positionen hinzufügen. Rabattgruppe und Sonderrabatt werden automatisch vorbelegt.' },
      { titel: 'Rechnung drucken', inhalt: 'In der Verkaufsdetailansicht auf Rechnung klicken. Das System druckt ein PDF mit Briefkopf, USt-Aufschlüsselung und Bankdaten. Rechnungsnummer wird automatisch vergeben.' },
      { titel: 'Bezahlt markieren', inhalt: 'In der Verkaufsdetailansicht oder unter Offene Posten auf "Als bezahlt markieren" klicken. Das Datum wird gespeichert und der Eintrag verschwindet aus den offenen Posten.' },
      { titel: 'Preislisten', inhalt: 'Unter Warenwirtschaft > Preisliste: mehrere aktive Preislisten gleichzeitig (z.B. Ab-Hof, Gastronomie, Export). Beim neuen Verkauf wählst du die passende Preisliste.' },
    ],
  },
  {
    id: 'crm', icon: '👥', titel: 'CRM',
    abschnitte: [
      { titel: 'Kontakt anlegen', inhalt: 'Unter CRM > Kontakte > Neuer Kontakt. Neue Kontakte starten als Lead (gelb). Nach dem ersten Verkauf werden sie automatisch zu Kunden (grün). Telefonvorwahl wählen: Land wird automatisch ausgefüllt.' },
      { titel: 'E-Mail senden', inhalt: 'In der Kontaktdetailansicht neben der E-Mail-Adresse auf Senden klicken. Wenn M365 konfiguriert ist, sendet die E-Mail aus dem verbundenen Outlook. Die E-Mail erscheint automatisch als Aktivität.' },
      { titel: 'Kalender nutzen', inhalt: 'Unter CRM > Kalender: Klick auf freien Zeitslot öffnet schnell eine neue Aktivität. Klick auf Ganztags-Zeile legt eine Ganztags-Aktivität an. Aktivitäten per Drag & Drop verschieben. Unerledigte Ganztags-Aktivitäten rollen automatisch auf heute.' },
      { titel: 'Besuchsplanung', inhalt: 'Unter Auswertungen > Besuchsplanung: Region + Segment eingeben, das System clustert Kontakte nach PLZ mit Ampelfarbe (letzter Kontakt). Route direkt in Google Maps öffnen.' },
    ],
  },
  {
    id: 'email', icon: '✉️', titel: 'E-Mail-Integration',
    abschnitte: [
      { titel: 'M365 verbinden', inhalt: 'Unter Admin > M365: Azure AD Tenant-ID + Client-ID + Client Secret eintragen, speichern, dann "Mit Microsoft 365 verbinden" klicken. Microsoft-Login erscheint: mit dem Weingut-Outlook-Konto anmelden.' },
      { titel: 'Webhook registrieren', inhalt: 'Nach der M365-Verbindung den Button "Webhook registrieren" klicken. Ab dann kommen eingehende E-Mails von bekannten Kontakten automatisch als Aktivitäten an - in Echtzeit.' },
      { titel: 'E-Mail-Matching', inhalt: 'Das System gleicht die Absender-Adresse mit allen Kontakten und Firmen ab. Nur hinterlegte Adressen werden automatisch zugeordnet. Antworten werden dem gleichen Thread zugeordnet.' },
    ],
  },
  {
    id: 'auswertungen', icon: '📋', titel: 'Auswertungen',
    abschnitte: [
      { titel: 'Frag dein Weingut (KI)', inhalt: 'Unter Auswertungen > Frag dein Weingut: Fragen in natürlicher Sprache wie "Gastronomie-Kunden in Salzburg" oder "Welcher Wein hat den höchsten Bestand?". Die KI liefert eine gefilterte Tabelle mit Zusammenfassung.' },
      { titel: 'Behörden-Dokumente', inhalt: 'Unter Auswertungen > Behörden: AMA Erntemeldung (je Jahrgang), Weinbauliches Behandlungsprotokoll (je Saison), Cu-Bilanz Jahresbericht nach EU-Bio-VO 2018/848. Alle druckfertig mit Briefkopf.' },
      { titel: 'Datenexport', inhalt: 'Unter Controlling > Datenexport: Kontakte, Firmen, Lagerbestand und Verkaufshistorie als Excel-kompatible CSV herunterladen. BOM-kodiert für österreichische Excel-Einstellungen.' },
    ],
  },
]

export default function HandbuchPage() {
  const [aktiv, setAktiv] = useState(KAPITEL[0].id)
  const kapitel = KAPITEL.find(k => k.id === aktiv) ?? KAPITEL[0]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Benutzerhandbuch</h1>
        <p className="text-sm text-s112-muted mt-1">software:112 – Weinbau-Management · Version 2.0</p>
      </div>

      <div className="flex gap-6">
        {/* Kapitel-Navigation */}
        <div className="w-48 flex-shrink-0">
          <nav className="space-y-1">
            {KAPITEL.map(k => (
              <button key={k.id} onClick={() => setAktiv(k.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-left transition-colors
                  ${aktiv === k.id ? 'bg-s112-teal text-white' : 'text-gray-600 hover:bg-s112-bg hover:text-gray-900'}`}>
                <span>{k.icon}</span>
                {k.titel}
              </button>
            ))}
          </nav>
          <div className="mt-4 pt-4 border-t border-s112-border">
            <Link href="/hilfe/faq" className="flex items-center gap-2 px-3 py-2 text-sm text-s112-teal hover:underline">
              ❓ FAQ ansehen
            </Link>
          </div>
        </div>

        {/* Inhalt */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-5">
            <span className="text-3xl">{kapitel.icon}</span>
            <h2 className="text-xl font-bold text-gray-900">{kapitel.titel}</h2>
          </div>
          <div className="space-y-3">
            {kapitel.abschnitte.map((a, i) => (
              <div key={i} className="card p-5">
                <h3 className="font-semibold text-gray-800 mb-2">{a.titel}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{a.inhalt}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
