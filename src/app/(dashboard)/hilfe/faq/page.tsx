'use client'

import { useState } from 'react'
import Link from 'next/link'

type FAQ = { frage: string; antwort: string; kategorie: string }

const FAQS: FAQ[] = [
  // Allgemein
  { kategorie: 'Allgemein', frage: 'Wie logge ich mich ein?', antwort: 'Rufe https://software112.icp-consultants.at auf und melde dich mit deiner E-Mail-Adresse und deinem Passwort an. Falls du dein Passwort vergessen hast, kontaktiere den Administrator.' },
  { kategorie: 'Allgemein', frage: 'Welche Browser werden unterstützt?', antwort: 'software:112 funktioniert mit allen modernen Browsern (Chrome, Firefox, Edge, Safari). Für mobilen Einsatz empfehlen wir Chrome auf Android oder Safari auf iOS.' },
  { kategorie: 'Allgemein', frage: 'Kann ich die App am Handy verwenden?', antwort: 'Ja! Die Oberfläche ist für Tablets und Smartphones optimiert. Telefonnummern können direkt angetippt werden um einen Anruf zu starten. Die Besuchsplanung öffnet Google Maps nativ.' },

  // CRM
  { kategorie: 'CRM', frage: 'Was ist der Unterschied zwischen Lead und Kunde?', antwort: 'Neue Kontakte starten automatisch als Lead (gelbes Badge). Sobald der erste Verkauf gebucht wird, wechselt der Status automatisch auf Kunde (grünes Badge). Der Toggle kann auch manuell umgestellt werden.' },
  { kategorie: 'CRM', frage: 'Warum erscheint eine E-Mail nicht beim Kontakt?', antwort: 'Das E-Mail-Matching läuft über die exakte E-Mail-Adresse. Stelle sicher dass die Absender-Adresse im Kontaktdatensatz hinterlegt ist. Groß-/Kleinschreibung wird ignoriert.' },
  { kategorie: 'CRM', frage: 'Wie finde ich schnell einen bestimmten Kontakt?', antwort: 'Nutze die Suchleiste oben in der Kontaktliste (Name, Kundennummer, E-Mail, Telefon) oder den Alphabetfilter A-Z darunter. Segment-Filter und Sortierung nach Vor-/Nachname ebenfalls verfügbar.' },
  { kategorie: 'CRM', frage: 'Wie plane ich einen Außendienstbesuch?', antwort: 'Unter Auswertungen > Besuchsplanung: Region eingeben, Segment wählen (z.B. Gastronomie), dann "Planen". Das Ergebnis zeigt PLZ-geclusterte Kontakte mit Ampelfarbe (letzter Kontakt). Klick auf "In Maps öffnen" startet die Route.' },

  // Warenwirtschaft
  { kategorie: 'Warenwirtschaft', frage: 'Warum kann ich keinen Verkauf ohne Kontakt anlegen?', antwort: 'Ein Verkauf muss immer einem Kontakt oder einer Firma zugeordnet werden. Falls der Käufer noch nicht angelegt ist, zuerst einen neuen Kontakt oder eine Firma erstellen.' },
  { kategorie: 'Warenwirtschaft', frage: 'Wie storniere ich eine Rechnung?', antwort: 'In der Verkaufsdetailansicht unten auf "Stornieren" klicken. Der Bestand wird automatisch zurückgebucht. Stornierte Rechnungen bleiben sichtbar aber als "Storniert" markiert.' },
  { kategorie: 'Warenwirtschaft', frage: 'Wie setze ich die USt. auf 20%?', antwort: 'Unter Admin > Mandant > Verkauf: im Bereich "Standard-Umsatzsteuer" auf 20% (Weinhändler) umstellen. Gilt als Standard für neue Positionen. Einzelne Positionen können beim Verkauf überschrieben werden.' },

  // Kellerbuch
  { kategorie: 'Kellerbuch', frage: 'Was passiert beim Verschnitt?', antwort: 'Wenn du Chargen verschiedener Qualitätsstufen mischt, wird die Ziel-Charge automatisch auf die niedrigste Qualitätsstufe aller Quellen gesetzt. Du bekommst eine Bestätigungsabfrage bevor der Umzug gespeichert wird.' },
  { kategorie: 'Kellerbuch', frage: 'Wie bekomme ich ein Etikett für meinen Wein?', antwort: 'Unter Kellerbuch > Prüfnummern: Den DAC-Antrag öffnen der eine Prüfnummer hat. Oben rechts auf "Etikett" klicken. Das System generiert ein druckfertiges Etikett mit allen Pflichtangaben und deinem Logo.' },

  // Technik
  { kategorie: 'Technik', frage: 'Ich sehe "This page could not load" - was tun?', antwort: 'Seite neu laden (F5). Falls es weiterhin passiert, melde dich aus- und wieder ein. Wenn das Problem bleibt, bitte den Administrator kontaktieren mit URL und Uhrzeit des Fehlers.' },
  { kategorie: 'Technik', frage: 'Wie exportiere ich meine Daten?', antwort: 'Unter Controlling > Datenexport: Kontakte, Firmen, Lagerbestand und Verkaufshistorie als CSV herunterladen. Die Dateien öffnen direkt in Excel (BOM-kodiert).' },
  { kategorie: 'Technik', frage: 'Funktioniert software:112 auch ohne Internet?', antwort: 'Nein, eine aktive Internetverbindung ist erforderlich. Alle Daten werden sicher in der Cloud (Supabase/Vercel, EU-Region Irland) gespeichert.' },
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
        <p className="text-sm text-s112-muted mt-1">Antworten auf die häufigsten Fragen zu software:112</p>
      </div>

      {/* Filter */}
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

      {/* FAQ Liste */}
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
              <span className={`text-gray-400 flex-shrink-0 ml-2 transition-transform ${offen === i ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {offen === i && (
              <div className="px-5 pb-4 pt-1 border-t border-s112-border/40">
                <p className="text-sm text-gray-600 leading-relaxed">{f.antwort}</p>
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
          Ausführliches Handbuch ansehen →
        </Link>
      </div>
    </div>
  )
}
