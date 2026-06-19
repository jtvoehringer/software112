'use client'

import { useState } from 'react'
import Link from 'next/link'

type Abschnitt = { titel: string; inhalt: string }
type Kapitel = { id: string; icon: string; titel: string; abschnitte: Abschnitt[] }

const KAPITEL: Kapitel[] = [
  {
    id: 'weingarten', icon: '🌿', titel: 'Rieden',
    abschnitte: [
      { titel: 'Rieden anlegen', inhalt: 'Navigiere zu Rieden > Neue Riede. Pflichtfelder: Name, Rebsorte, Fläche (ha), Gemeinde/Lage. Die Riede erscheint in allen Behandlungs- und Erntemasken.' },
      { titel: 'Behandlung erfassen', inhalt: 'Unter Rieden > Behandlungen > Neue Behandlung: Datum, Riede, PSM-Mittel und Aufwandmenge eintragen. Das System berechnet automatisch den frühesten Erntetermin nach Wartezeit.' },
      { titel: 'PSM-Lager', inhalt: 'Unter Behandlungen > PSM-Lager pflegst du Anfangsbestand und Einkäufe. Das Lager wird bei jeder Behandlung automatisch reduziert. Inventurkorrekturen sind jederzeit möglich.' },
      { titel: 'Lese erfassen', inhalt: 'Unter Rieden > Lese wählst du den Jahrgang und trägst Datum, Riede, Menge (kg + hl) und Grad KMW ein. Diese Daten bilden die Basis für die AMA-Erntemeldung.' },
    ],
  },
  {
    id: 'kellerbuch', icon: '🍷', titel: 'Kellerbuch',
    abschnitte: [
      { titel: 'Weinausbau-Charge anlegen', inhalt: 'Unter Kellerbuch > Vinifizierung > Neue Charge: Name, Jahrgang, Rebsorte, Qualitätsstufe und Behälter festlegen. Die Qualitätsstufe wird automatisch aus dem Lese-KMW vorbelegt (Landwein, Qualitätswein, Kabinett, Spätlese …). Ein Upgrade auf eine höhere Stufe ist gesperrt – nur Downgrade ist möglich. Die Charge verfolgt Menge und Qualität durch alle Keller-Operationen.' },
      { titel: 'Umziehen (n:n)', inhalt: 'Unter Kellerbuch > Umziehen kannst du mehrere Quell-Chargen in mehrere Zielbehälter umziehen. Der Schwund wird automatisch berechnet. Bei Verschnitt sinkt die Qualitätsstufe auf das niedrigste Level.' },
      { titel: 'Abfüllen', inhalt: 'Unter Kellerbuch > Füllen wählst du die Weinausbau-Charge, Flaschengröße, Anzahl Flaschen und VK-Preis. Die Füllung erscheint danach im Warenwirtschaft-Lager.' },
      { titel: 'Kellerplan', inhalt: 'Der Kellerplan zeigt eine visuelle Übersicht aller Behälter mit aktueller Belegung. Nützlich für Bio-Kontrolle und Raumplanung.' },
    ],
  },
  {
    id: 'warenwirtschaft', icon: '🛒', titel: 'Warenwirtschaft',
    abschnitte: [
      { titel: 'Verkauf anlegen', inhalt: 'Unter Warenwirtschaft > Verkauf > Neuer Verkauf: zuerst Kontakt oder Firma wählen (Pflicht!), dann Positionen hinzufügen. Rabattgruppe und Sonderrabatt werden automatisch vorbelegt. Den USt.-Satz kannst du pro Position einzeln wählen (0 %, 10 %, 13 %, 20 %); Standard ist der im Mandanten hinterlegte Wert.' },
      { titel: 'Rechnung drucken', inhalt: 'In der Verkaufsdetailansicht auf Rechnung klicken. Das System druckt ein PDF mit Briefkopf, USt-Aufschlüsselung und Bankdaten. Rechnungsnummer wird automatisch vergeben.' },
      { titel: 'Bezahlt markieren', inhalt: 'In der Verkaufsdetailansicht oder unter Offene Posten auf "Als bezahlt markieren" klicken. Das Datum wird gespeichert und der Eintrag verschwindet aus den offenen Posten.' },
      { titel: 'Rabatt & Sonderrabatt', inhalt: 'Beim Anlegen einer Verkaufsposition wird Rabatt aus der Rabattgruppe und Sonderrabatt aus dem Kontakt/der Firma automatisch vorbelegt. Beide Werte können direkt in der Position geändert oder auf 0 gesetzt werden, um keinen Rabatt anzuwenden.' },
      { titel: 'Skonto', inhalt: 'Unter CRM > Kontakt/Firma kann ein Skonto-Prozentsatz hinterlegt werden. Dieser erscheint automatisch in neuen Verkäufen und wird auf der Rechnung ausgewiesen. Im Verkaufsformular ist Skonto jederzeit anpassbar.' },
      { titel: 'Teilzahlungen', inhalt: 'Im Verkaufsdetail kannst du Teilzahlungen erfassen: Betrag und Datum eingeben. Der offene Restbetrag wird automatisch aktualisiert. Der Posten gilt erst als vollständig bezahlt wenn der Gesamtbetrag beglichen ist.' },
      { titel: 'Preislisten', inhalt: 'Unter Warenwirtschaft > Preisliste: mehrere aktive Preislisten gleichzeitig (z.B. Ab-Hof, Gastronomie, Export). Beim neuen Verkauf wählst du die passende Preisliste.' },
    ],
  },
  {
    id: 'weinexport', icon: '🚢', titel: 'Weinexport',
    abschnitte: [
      { titel: 'Exportauftrag anlegen', inhalt: 'Unter Weinexport > Neuer Auftrag: Importeur (Kontakt oder Firma), Incoterms, Transportart, Destination und EORI-Nummer des Importeurs eintragen. Weinpositionen aus dem Füllungslager wählen – TARIC-Code wird automatisch gesetzt (2204.21 für Weinflaschen).' },
      { titel: 'Exportdokumente generieren', inhalt: 'Im Exportauftrag rechts unter "Dokumente": Status je Dokument pflegen (Ausstehend → Beantragt → Ausgestellt). Klick auf "PDF" öffnet das druckfertige Dokument: V1/V2 Begleitdokument, EUR.1 Ursprungszeugnis, CMR Frachtbrief, Certificate of Origin, Lieferschein (DE/EN), Exportrechnung (DE/EN).' },
      { titel: 'EMCS – e-AD Dokument', inhalt: 'Im Exportauftrag rechts unter "EMCS": ARC-Nummer und Status eintragen sobald bekannt. "e-AD XML Download" erstellt ein maschinenlesbares XML-Dokument das in EMCS AT (BMF FinanzOnline) importiert werden kann. Vollzugriff auf das EMCS-System benötigst du über das BMF-Portal.' },
      { titel: 'Auftragsstatus verfolgen', inhalt: 'Jeder Exportauftrag durchläuft: Entwurf → Bestätigt → Versendet → Abgeschlossen. Status oben rechts im Auftrag ändern. Die Dokumenten-Checkliste zeigt den Fortschritt als Fortschrittsbalken.' },
    ],
  },
  {
    id: 'crm', icon: '👥', titel: 'CRM',
    abschnitte: [
      { titel: 'Kontakt anlegen', inhalt: 'Unter CRM > Kontakte > Neuer Kontakt. Neue Kontakte starten als Lead (gelb). Nach dem ersten Verkauf werden sie automatisch zu Kunden (grün). Telefonvorwahl wählen: Land wird automatisch ausgefüllt.' },
      { titel: 'Notizen', inhalt: 'In der Kontakt- oder Firmendetailansicht gibt es eine eigene Notizen-Karte. Neue Notiz eingeben und + klicken. Offene Notizen erscheinen oben, erledigte darunter. Erledigte Notizen mit dem Häkchen abhaken.' },
      { titel: 'E-Mails im CRM', inhalt: 'Gesendete und empfangene E-Mails erscheinen im Aktivitäten-Tab des Kontakts/der Firma. Betreff anklicken klappt den E-Mail-Inhalt auf – dauerhaft gespeichert, auch wenn die E-Mail in der Mailbox gelöscht wurde. Verwandte E-Mails (gleicher Betreff) werden als Thread zusammengefasst.' },
      { titel: 'E-Mail direkt senden', inhalt: 'In der Kontaktdetailansicht neben der E-Mail-Adresse auf Senden klicken. Betreff und Text eingeben, absenden. Die E-Mail erscheint sofort als Aktivität beim Kontakt.' },
      { titel: 'Kalender nutzen', inhalt: 'Unter CRM > Kalender: Klick auf freien Zeitslot öffnet schnell eine neue Aktivität. Unerledigte Ganztags-Aktivitäten rollen automatisch auf heute.' },
      { titel: 'Besuchsplanung', inhalt: 'Unter Auswertungen > Besuchsplanung: Region + Segment eingeben, das System clustert Kontakte nach PLZ. Route direkt in Google Maps öffnen.' },
    ],
  },
  {
    id: 'nachrichten', icon: '📬', titel: 'E-Mail (Nachrichten)',
    abschnitte: [
      { titel: 'Mailbox verbinden', inhalt: 'Unter Nachrichten auf "Mit Microsoft 365 verbinden" klicken. Microsoft-Login erscheint: mit dem Weingut-Outlook-Konto anmelden und Berechtigungen erteilen. Die Verbindung ist pro Benutzer – jeder muss sein eigenes Konto verbinden.' },
      { titel: 'E-Mails lesen und navigieren', inhalt: 'Die linke Sidebar zeigt alle Ordner (Posteingang, Gesendet, Entwürfe, Gelöschte Elemente, ...). Ordner anklicken wechselt die Ansicht. E-Mail in der Liste anklicken zeigt den vollständigen Inhalt rechts.' },
      { titel: 'Antworten, Weiterleiten, Löschen', inhalt: 'Im E-Mail-Detail: "Antworten" öffnet ein Compose-Formular mit vorausgefüllter Adresse und Betreff. "Weiterleiten" öffnet dasselbe mit leerem Empfänger. Das Papierkorb-Icon verschiebt die E-Mail in Gelöschte Elemente.' },
      { titel: 'Neue E-Mail verfassen', inhalt: 'Oben links in der Sidebar auf "Verfassen" klicken. An, Betreff und Nachrichtentext eintragen. Bei verbundener Shared Mailbox: Absender wählen (eigene Mailbox oder z.B. office@weingut.at).' },
      { titel: 'Shared Mailbox einrichten', inhalt: 'Unter Nachrichten > Einstellungen (unten in der Sidebar): E-Mail-Adresse der Shared Mailbox eintragen (z.B. office@weingut.at). Speichern – Seite lädt mit der Shared Mailbox. Voraussetzung: Exchange Send-As-Berechtigung auf die Shared Mailbox.' },
      { titel: 'E-Mails und CRM', inhalt: 'Öffnest du eine E-Mail in Nachrichten und der Absender ist ein hinterlegter Kontakt, wird die E-Mail automatisch dauerhaft im CRM gespeichert (Aktivitäten-Tab des Kontakts). Klick auf den Kontakt-Badge führt direkt zur Kontaktdetailansicht.' },
    ],
  },
  {
    id: 'ki', icon: '🤖', titel: 'Frag dein Weingut (KI)',
    abschnitte: [
      { titel: 'Abfrage stellen', inhalt: 'Unter "Frag dein Weingut" in der Seitenleiste: Frage in natürlicher Sprache eingeben, z.B. "Welche Gastronomie-Kunden haben wir in Wien?" oder "Zeig mir Rotwein-Füllungen mit mehr als 200 Flaschen". Die KI (Claude Haiku) interpretiert die Frage und zeigt eine gefilterte Tabelle mit Zusammenfassung.' },
      { titel: 'Beispiel-Fragen', inhalt: 'Klick auf einen der Beispiel-Chips startet sofort die Abfrage. Weitere Beispiele: "Wer hat noch keinen Stammkunden-Status?", "Offene Pipeline-Einträge im Stadium Angebot", "Weinausbau mit mehr als 1000 Liter aktuell im Keller".' },
      { titel: 'Abfrage-Limit', inhalt: 'Das KI-Modul hat ein monatliches Abfrage-Limit (Basic: 100, Standard: 200, Unlimited: unbegrenzt). Der aktuelle Verbrauch wird oben rechts angezeigt. Bei Limit-Erreichen bitte den Administrator kontaktieren.' },
    ],
  },
  {
    id: 'datenimport', icon: '📥', titel: 'Datenimport',
    abschnitte: [
      { titel: 'CSV-Datei vorbereiten', inhalt: 'Exportiere deine bestehenden Daten aus Excel oder einem anderen System als CSV (Trennzeichen: Semikolon oder Komma, Kodierung: UTF-8). Spaltenbezeichnungen können frei gewählt werden – du ordnest sie im nächsten Schritt zu.' },
      { titel: 'Import durchführen', inhalt: 'Unter Administration > Datenimport: Import-Typ wählen (Kontakte, Firmen oder Füllungen/Weinlager). CSV-Datei öffnen – eine Vorschau der ersten 3 Zeilen erscheint. Dann jede Spalte dem richtigen Feld zuordnen (Auto-Erkennung wenn Spaltenname passt). "Importieren" startet den Prozess.' },
      { titel: 'Pflichtfelder', inhalt: 'Kontakte: Nachname (Pflicht). Firmen: Name (Pflicht). Füllungen: Bezeichnung (Pflicht). Alle anderen Felder sind optional. Fehlermeldungen werden zeilengenau angezeigt – fehlerhafte Zeilen werden übersprungen, gültige werden importiert.' },
      { titel: 'Nach dem Import', inhalt: 'Importierte Kontakte starten als Leads, importierte Firmen ebenfalls. Füllungen werden mit dem angegebenen Lagerbestand angelegt. Alle Einträge können nach dem Import normal bearbeitet werden.' },
    ],
  },
  {
    id: 'auswertungen', icon: '📋', titel: 'Auswertungen',
    abschnitte: [
      { titel: 'Behörden-Dokumente', inhalt: 'Unter Auswertungen > Behörden: AMA Erntemeldung (je Jahrgang), Weinbauliches Behandlungsprotokoll (je Saison), Cu-Bilanz Jahresbericht nach EU-Bio-VO 2018/848. Alle druckfertig mit Briefkopf.' },
      { titel: 'Datenexport', inhalt: 'Unter Controlling > Datenexport: Kontakte, Firmen, Lagerbestand und Verkaufshistorie als Excel-kompatible CSV herunterladen. BOM-kodiert für österreichische Excel-Einstellungen.' },
      { titel: 'BMD NTCS Export', inhalt: 'Unter Controlling > BMD NTCS: Verkaufsdaten im BMD-Buchungsformat exportieren. Zeitraum wählen, Exportdatei herunterladen und in BMD importieren.' },
      { titel: 'Kostenrechnung', inhalt: 'Unter Controlling > Kostenrechnung: Kostenstellen und Kostenarten verwalten, Kostenbuchungen erfassen. Auswertung nach Kostenstelle und Zeitraum.' },
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
        <p className="text-sm text-s112-muted mt-1">software:112 – Weinbau-Management · Version 2.1 · Stand Juni 2026</p>
      </div>

      <div className="flex gap-6">
        <div className="w-52 flex-shrink-0">
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
                                                            