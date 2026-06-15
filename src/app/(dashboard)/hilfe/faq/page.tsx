'use client'

import { useState } from 'react'
import Link from 'next/link'

type FAQ = { frage: string; antwort: string; kategorie: string }

const FAQS: FAQ[] = [
  // Allgemein
  { kategorie: 'Allgemein', frage: 'Wie logge ich mich ein?', antwort: 'Rufe https://software112.icp-consultants.at auf und melde dich mit deiner E-Mail-Adresse und deinem Passwort an. Alternativ funktioniert der Login auch mit Microsoft 365. Falls du dein Passwort vergessen hast, kontaktiere den Administrator.' },
  { kategorie: 'Allgemein', frage: 'Welche Browser werden unterstützt?', antwort: 'software:112 funktioniert mit allen modernen Browsern (Chrome, Firefox, Edge, Safari). Für mobilen Einsatz empfehlen wir Chrome auf Android oder Safari auf iOS.' },
  { kategorie: 'Allgemein', frage: 'Kann ich die App am Handy verwenden?', antwort: 'Ja! Die Oberfläche ist für Tablets und Smartphones optimiert. Telefonnummern können direkt angetippt werden um einen Anruf zu starten.' },

  // CRM
  { kategorie: 'CRM', frage: 'Was ist der Unterschied zwischen Lead und Kunde?', antwort: 'Neue Kontakte starten automatisch als Lead (gelbes Badge). Sobald der erste Verkauf gebucht wird, wechselt der Status automatisch auf Kunde (grünes Badge). Der Toggle kann auch manuell umgestellt werden.' },
  { kategorie: 'CRM', frage: 'Wie finde ich schnell einen bestimmten Kontakt?', antwort: 'Nutze die Suchleiste oben in der Kontaktliste (Name, Kundennummer, E-Mail, Telefon) oder den Alphabetfilter A-Z darunter. Segment-Filter und Sortierung nach Vor-/Nachname ebenfalls verfügbar.' },
  { kategorie: 'CRM', frage: 'Wie plane ich einen Außendienstbesuch?', antwort: 'Unter Auswertungen > Besuchsplanung: Region eingeben, Segment wählen (z.B. Gastronomie), dann "Planen". Das Ergebnis zeigt PLZ-geclusterte Kontakte mit Ampelfarbe (letzter Kontakt). Klick auf "In Maps öffnen" startet die Route.' },
  { kategorie: 'CRM', frage: 'Warum erscheint eine E-Mail nicht beim Kontakt?', antwort: 'E-Mails werden nur gespeichert wenn du sie in /nachrichten öffnest UND der Absender mit einer gespeicherten E-Mail-Adresse übereinstimmt. Stelle sicher dass die Absender-Adresse im Kontaktdatensatz hinterlegt ist.' },
  { kategorie: 'CRM', frage: 'Wo finde ich die Notizen zu einem Kontakt?', antwort: 'In der Kontaktdetailansicht gibt es eine eigene Notizen-Karte unter den Kontaktdaten. Offene Notizen erscheinen zuerst, erledigte darunter.' },

  // Warenwirtschaft
  { kategorie: 'Warenwirtschaft', frage: 'Warum kann ich keinen Verkauf ohne Kontakt anlegen?', antwort: 'Ein Verkauf muss immer einem Kontakt oder einer Firma zugeordnet werden. Falls der Käufer noch nicht angelegt ist, zuerst einen neuen Kontakt oder eine Firma erstellen.' },
  { kategorie: 'Warenwirtschaft', frage: 'Wie storniere ich eine Rechnung?', antwort: 'In der Verkaufsdetailansicht unten auf "Stornieren" klicken. Der Bestand wird automatisch zurückgebucht. Stornierte Rechnungen bleiben sichtbar aber als "Storniert" markiert.' },
  { kategorie: 'Warenwirtschaft', frage: 'Kann ich Rabatt oder Sonderrabatt bei einem Verkauf abwählen?', antwort: 'Ja. Rabatt (aus der Rabattgruppe) und Sonderrabatt (aus dem Kontakt/der Firma) werden automatisch vorbelegt, können aber pro Position direkt auf 0 gesetzt oder geändert werden. Einfach den Wert im Positionsformular überschreiben.' },
  { kategorie: 'Warenwirtschaft', frage: 'Wie hinterlege ich Skonto für einen Kunden?', antwort: 'Im Kontakt- oder Firmendatensatz unter CRM gibt es ein Skonto-Feld (in Prozent). Dieser Wert wird automatisch in neue Verkäufe übernommen und auf der Rechnung ausgewiesen. Im Verkaufsformular kann Skonto jederzeit angepasst oder auf 0 gesetzt werden.' },
  { kategorie: 'Warenwirtschaft', frage: 'Wie erfasse ich eine Teilzahlung?', antwort: 'Im Verkaufsdetail gibt es den Bereich Zahlungen. Klick auf "Teilzahlung buchen": Betrag und Datum eingeben und speichern. Der offene Restbetrag wird sofort aktualisiert. Du kannst beliebig viele Teilzahlungen erfassen; der Posten gilt als vollständig bezahlt sobald der Gesamtbetrag erreicht ist.' },
  { kategorie: 'Warenwirtschaft', frage: 'Wie wähle ich den USt.-Satz pro Verkaufsposition?', antwort: 'Bei jeder Verkaufsposition ist der USt.-Satz einzeln wählbar (0 %, 10 %, 13 %, 20 %). Der Standard-USt.-Satz kommt aus den Mandanten-Einstellungen (Admin > Mandant > Verkauf) und wird automatisch vorbelegt – du kannst ihn aber pro Position überschreiben. Das ist nützlich wenn du z.B. Weinflaschen (13 %) und Serviceleistungen (20 %) in einer Rechnung kombinierst.' },

  // E-Mail
  { kategorie: 'E-Mail', frage: 'Wie verbinde ich meine Mailbox?', antwort: 'Unter Nachrichten: "Mit Microsoft 365 verbinden" klicken und mit dem Weingut-Outlook-Konto anmelden. Jeder Benutzer verbindet sein eigenes Konto – die Verbindung ist persönlich, nicht geteilt.' },
  { kategorie: 'E-Mail', frage: 'Was ist eine Shared Mailbox und wie richte ich sie ein?', antwort: 'Eine Shared Mailbox ist eine gemeinsam genutzte E-Mail-Adresse (z.B. office@weingut.at). Unter Nachrichten > Einstellungen: Adresse eintragen und speichern. Voraussetzung: dein Exchange-Administrator muss dir "Send As"-Rechte auf die Shared Mailbox geben.' },
  { kategorie: 'E-Mail', frage: 'Werden E-Mails dauerhaft gespeichert?', antwort: 'Ja! Wenn du eine E-Mail in /nachrichten öffnest und der Absender ist ein Kontakt, wird die E-Mail dauerhaft im CRM gespeichert – auch wenn du sie später in der Mailbox löschst. Der Inhalt ist jederzeit unter den Aktivitäten des Kontakts abrufbar.' },
  { kategorie: 'E-Mail', frage: 'Warum sehe ich "Aktualisieren" und "Einstellungen" nicht?', antwort: 'Diese Buttons befinden sich am unteren Ende der Ordner-Sidebar. Falls du viele Ordner hast, scrolle im linken Bereich nach unten.' },
  { kategorie: 'E-Mail', frage: 'Ich sehe nach dem Löschen eine E-Mail noch kurz – ist das normal?', antwort: 'Die E-Mail wird sofort aus der Ansicht entfernt. Falls sie kurz wieder erscheint und dann weg ist, handelt es sich um ein kurzes Cache-Phänomen. Die E-Mail ist tatsächlich in "Gelöschte Elemente" verschoben.' },

  // Weinexport
  { kategorie: 'Weinexport', frage: 'Welche Exportdokumente kann software:112 generieren?', antwort: 'V1/V2 Simplified Accompanying Document, EUR.1 Warenverkehrsbescheinigung, CMR Internationaler Frachtbrief, Certificate of Origin, Lieferschein (DE/EN) und Exportrechnung/Commercial Invoice (DE/EN). Alle werden als druckfertiges HTML-Dokument geöffnet.' },
  { kategorie: 'Weinexport', frage: 'Was ist das EMCS und wie nutze ich es in software:112?', antwort: 'EMCS (Electronic Movement and Control System) ist das EU-Zollsystem für Weinbewegungen. In software:112 kannst du die ARC-Nummer erfassen und den Status verfolgen. Mit "e-AD XML Download" erhältst du ein Dokument das in EMCS AT (BMF FinanzOnline) importiert werden kann.' },
  { kategorie: 'Weinexport', frage: 'Was bedeuten die Incoterms?', antwort: 'Incoterms regeln wer Transportkosten und Risiko trägt. Häufige Werte: EXW (ab Werk, Käufer zahlt alles), DAP (geliefert am Bestimmungsort, du zahlt Transport), CIF (du zahlt Transport + Versicherung bis Zielhafen). Die Wahl beeinflusst das Exportdokument.' },

  // KI
  { kategorie: 'KI-Modul', frage: 'Was kann ich "Frag dein Weingut" fragen?', antwort: 'Alles rund um deine Betriebsdaten: Kontakte nach Segment/Region, Weinbestände, offene Rechnungen, Kellerchargen, Behandlungen, Pipeline-Einträge. Formuliere in natürlicher Sprache auf Deutsch, z.B. "Welche Gastro-Kunden kommen aus Deutschland?"' },
  { kategorie: 'KI-Modul', frage: 'Was passiert wenn mein KI-Limit erschöpft ist?', antwort: 'Du bekommst eine Meldung mit aktuellem Verbrauch und Limit. Das Limit setzt sich automatisch am Monatsersten zurück. Für ein Upgrade des Pakets den Administrator kontaktieren.' },

  // Datenimport
  { kategorie: 'Datenimport', frage: 'Welche Formate werden für den CSV-Import unterstützt?', antwort: 'CSV-Dateien mit Semikolon (;) oder Komma (,) als Trennzeichen, UTF-8 Kodierung. Die meisten Excel-Exporte funktionieren direkt. Bei Problemen: in Excel "Speichern als > CSV UTF-8" wählen.' },
  { kategorie: 'Datenimport', frage: 'Was passiert mit Duplikaten beim Import?', antwort: 'Duplikate werden nicht automatisch erkannt – jede Zeile wird als neuer Datensatz angelegt. Prüfe vor dem Import deine CSV auf Duplikate, oder bereinige sie danach direkt in der Anwendung.' },

  // Kellerbuch
  { kategorie: 'Kellerbuch', frage: 'Wie wird die Qualitätsstufe einer neuen Charge bestimmt?', antwort: 'Die Qualitätsstufe wird beim Anlegen einer Weinausbau-Charge automatisch aus dem KMW-Wert der zugehörigen Lese vorbelegt – das System wählt die entsprechende Stufe (Landwein, Qualitätswein, Kabinett, Spätlese usw.). Ein Upgrade auf eine höhere Stufe als vom KMW erlaubt ist gesperrt; ein Downgrade ist jederzeit möglich.' },
  { kategorie: 'Kellerbuch', frage: 'Was passiert beim Verschnitt?', antwort: 'Wenn du Chargen verschiedener Qualitätsstufen mischt, wird die Ziel-Charge automatisch auf die niedrigste Qualitätsstufe aller Quellen gesetzt. Du bekommst eine Bestätigungsabfrage bevor der Umzug gespeichert wird.' },
  { kategorie: 'Kellerbuch', frage: 'Wie bekomme ich ein Etikett für meinen Wein?', antwort: 'Unter Kellerbuch > Prüfnummern: Den DAC-Antrag mit Prüfnummer öffnen, oben rechts auf "Etikett" klicken. Das System generiert ein druckfertiges Etikett mit allen Pflichtangaben und deinem Logo.' },

  // Technik
  { kategorie: 'Technik', frage: 'Ich sehe "This page could not load" - was tun?', antwort: 'Seite neu laden (F5). Falls es weiterhin passiert, melde dich aus- und wieder ein. Wenn das Problem bleibt, bitte den Administrator kontaktieren mit URL und Uhrzeit des Fehlers.' },
  { kategorie: 'Technik', frage: 'Funktioniert software:112 auch ohne Internet?', antwort: 'Nein, eine aktive Internetverbindung ist erforderlich. Alle Daten werden sicher in der Cloud (Supabase/Vercel, EU-Region Irland) gespeichert.' },
  { kategorie: 'Technik', frage: 'Wie exportiere ich meine Daten?', antwort: 'Unter Controlling > Datenexport: Kontakte, Firmen, Lagerbestand und Verkaufshistorie als CSV herunterladen. Die Dateien öffnen direkt in Excel (BOM-kodiert).' },
]

const KATEGORIEN = [...new Set(FAQS.map(f => f.kategorie))]

export default function FAQPage() {
  const [offen, setOffen] = useState<number | null>(null)
  const [suche, setSuche] = useState('')
  const [kategorie, setKategorie] = useState('Alle')

  const gefiltert = FAQS.filter(f =>
    (kategorie === 'Alle' || f.kategorie === kategorie) &&
    (!suche || f.frage.toLowerCase().includes(suche.toLowerCase()) || f.antwort.toLowerCase().includes(suche.toLowerCase()))
  )

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Häufige Fragen (FAQ)</h1>
        <p className="text-sm text-s112-muted mt-1">Antworten auf die häufigsten Fragen zu software:112 · Stand Juni 2026</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input value={suche} onChange={e => setSuche(e.target.value)}
          placeholder="Fragen durchsuchen…"
          className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-56" />
        <div className="flex gap-1 flex-wrap">
          {['Alle', ...KATEGORIEN].map(k => (
            <button key={k} onClick={() => setKategorie(k)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                ${kategorie === k ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:bg-s112-teal/10'}`}>
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {gefiltert.map((f, i) => (
          <div key={i} className="card overflow-hidden">
            <button onClick={() => setOffen(offen === i ? null : i)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-s112-bg/50 transition-colors">
              <div className="flex items-center gap-3">
                <span className="text-xs bg-s112-bg border border-s112-border px-2 py-0.5 rounded text-gray-500 flex-shrink-0">
                  {f.kategorie}
                </span>
                <span className="text-sm font-medium text-gray-800">{f.frage}</span>
              </div>
              <span className={`text-s112-muted flex-shrink-0 ml-3 transition-transform ${offen === i ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {offen === i && (
              <div className="px-5 pb-4 pt-1 text-sm text-gray-600 leading-relaxed border-t border-s112-border/40">
                {f.antwort}
              </div>
            )}
          </div>
        ))}
        {gefiltert.length === 0 && (
          <p className="text-center text-s112-muted py-8">Keine Fragen gefunden.</p>
        )}
      </div>

      <div className="text-center pt-2">
        <Link href="/hilfe/handbuch" className="text-sm text-s112-teal hover:underline">
          Zum vollständigen Handbuch →
        </Link>
      </div>
    </div>
  )
}
