'use client'

import { useState } from 'react'
import Link from 'next/link'

type FAQ = { frage: string; antwort: string; kategorie: string }

const FAQS: FAQ[] = [
  // Allgemein
  { kategorie: 'Allgemein', frage: 'Wie logge ich mich ein?', antwort: 'Rufe https://software112.icp-consultants.at auf und melde dich mit deiner E-Mail-Adresse und deinem Passwort an. Alternativ funktioniert der Login auch mit Microsoft 365. Falls du dein Passwort vergessen hast, nutze „Passwort vergessen“ auf der Login-Seite – du bekommst einen Link per E-Mail.' },
  { kategorie: 'Allgemein', frage: 'Wie ändere ich mein Passwort?', antwort: 'Oben rechts im Benutzermenü auf „Mein Profil“ – dort unter „Passwort ändern“ das aktuelle und zweimal das neue Passwort eingeben (mindestens 8 Zeichen). Wer sich mit Microsoft 365 anmeldet, verwaltet sein Passwort bei Microsoft.' },
  { kategorie: 'Allgemein', frage: 'Welche Browser werden unterstützt?', antwort: 'software:112 funktioniert mit allen modernen Browsern (Chrome, Firefox, Edge, Safari). Für mobilen Einsatz empfehlen wir Chrome auf Android oder Safari auf iOS.' },
  { kategorie: 'Allgemein', frage: 'Kann ich die App am Handy verwenden?', antwort: 'Ja! Die Oberfläche ist für Tablets und Smartphones optimiert. Telefonnummern können direkt angetippt werden um einen Anruf zu starten.' },

  // CRM
  { kategorie: 'CRM', frage: 'Was ist der Unterschied zwischen Lead und Kunde?', antwort: 'Neue Kontakte starten automatisch als Lead (gelbes Badge). Sobald der erste Verkauf gebucht wird, wechselt der Status automatisch auf Kunde (grünes Badge). Der Toggle kann auch manuell umgestellt werden.' },
  { kategorie: 'CRM', frage: 'Wie finde ich schnell einen bestimmten Kontakt?', antwort: 'Nutze die Suchleiste oben in der Kontaktliste (Name, Accountnummer, E-Mail, Telefon) oder den Alphabetfilter A-Z darunter. Segment-Filter und Sortierung nach Vor-/Nachname ebenfalls verfügbar.' },
  { kategorie: 'CRM', frage: 'Wie plane ich einen Außendienstbesuch?', antwort: 'Unter Auswertungen > Besuchsplanung: Region eingeben, Segment wählen (z.B. Gastronomie), dann "Planen". Das Ergebnis zeigt PLZ-geclusterte Kontakte mit Ampelfarbe (letzter Kontakt). Klick auf "In Maps öffnen" startet die Route.' },
  { kategorie: 'CRM', frage: 'Warum erscheint eine E-Mail nicht beim Kontakt?', antwort: 'E-Mails werden nur gespeichert wenn du sie in /nachrichten öffnest UND der Absender erkannt wird: genaue E-Mail-Adresse eines Kontakts oder einer Firma, oder die Firmendomain (jede Adresse @firma.at wird der Firma zugeordnet, nicht bei gmx/gmail & Co.). Stelle sicher dass die Absender-Adresse im Kontaktdatensatz hinterlegt ist – oder lege den Absender über "Soll ein Lead angelegt werden?" direkt aus der E-Mail an.' },
  { kategorie: 'CRM', frage: 'Wie lege ich aus einer E-Mail einen Lead an?', antwort: 'E-Mail unter Nachrichten öffnen. Ist der Absender unbekannt, erscheint über der Mail die Frage "Soll ein Lead angelegt werden?" – "Ja" öffnet den Dialog, die KI belegt Name, Telefon, Position, Firma und Adresse aus der Signatur vor und fasst das Anliegen zusammen. Segment, Firma (neu/bestehend/keine), Rabattgruppe und Zahlungsziel wählst du im Dialog, dann "Als Lead speichern". Der Kontakt bekommt eine Accountnummer, die E-Mail liegt in seiner Historie.' },
  { kategorie: 'CRM', frage: 'Die Lead-Frage nervt bei Newslettern – wie werde ich sie los?', antwort: 'Im Frage-Balken "Nein, nicht mehr fragen" klicken: der Absender wird für deinen Betrieb gemerkt und löst keine Frage mehr aus. Typische Systemadressen (noreply, newsletter, mailer-daemon) und die eigenen Postfächer werden ohnehin übersprungen. "Jetzt nicht" blendet die Frage nur für die aktuelle Sitzung aus.' },
  { kategorie: 'CRM', frage: 'Wo finde ich die Notizen zu einem Kontakt?', antwort: 'In der Kontaktdetailansicht gibt es eine eigene Notizen-Karte unter den Kontaktdaten. Offene Notizen erscheinen zuerst, erledigte darunter.' },
  { kategorie: 'CRM', frage: 'Kann ich meinen Outlook-Kalender im CRM sehen?', antwort: 'Ja. Sobald du deine Mailbox unter Nachrichten mit Microsoft 365 verbindest, werden deine persönlichen Outlook-Termine automatisch – hellblau markiert mit eigenem "Outlook"-Label – zusätzlich zu deinen CRM-Terminen im Kalender (Woche/Monat/Jahr) angezeigt. Klick auf einen Outlook-Termin öffnet ein Detailfenster mit Link "In Outlook öffnen".' },
  { kategorie: 'CRM', frage: 'Warum sehe ich (noch) keine Outlook-Termine im CRM-Kalender?', antwort: 'Entweder ist deine Mailbox noch nicht verbunden (Nachrichten > "Mit Microsoft 365 verbinden"), oder deine bestehende Verbindung ist älter als die Kalenderfreigabe – in dem Fall unter Nachrichten > Einstellungen einmalig "Trennen & neu verbinden" klicken, damit die neue Berechtigung zum Kalenderzugriff wirksam wird.' },

  // Warenwirtschaft
  { kategorie: 'Warenwirtschaft', frage: 'Warum kann ich keinen Verkauf ohne Kontakt anlegen?', antwort: 'Ein Verkauf muss immer einem Kontakt oder einer Firma zugeordnet werden. Falls der Käufer noch nicht angelegt ist, zuerst einen neuen Kontakt oder eine Firma erstellen.' },
  { kategorie: 'Warenwirtschaft', frage: 'Wie storniere ich eine Rechnung?', antwort: 'In der Verkaufsdetailansicht unten auf "Stornieren" klicken. Der Bestand wird automatisch zurückgebucht. Stornierte Rechnungen bleiben sichtbar aber als "Storniert" markiert.' },
  { kategorie: 'Warenwirtschaft', frage: 'Kann ich Rabatt oder Sonderrabatt bei einem Verkauf abwählen?', antwort: 'Ja. Rabatt (aus der Rabattgruppe) und Sonderrabatt (aus dem Kontakt/der Firma) werden automatisch vorbelegt, können aber pro Position direkt auf 0 gesetzt oder geändert werden. Einfach den Wert im Positionsformular überschreiben.' },
  { kategorie: 'Warenwirtschaft', frage: 'Wie hinterlege ich Skonto für einen Kunden?', antwort: 'Im Kontakt- oder Firmendatensatz unter CRM gibt es ein Skonto-Feld (in Prozent). Dieser Wert wird automatisch in neue Verkäufe übernommen und auf der Rechnung ausgewiesen. Im Verkaufsformular kann Skonto jederzeit angepasst oder auf 0 gesetzt werden.' },
  { kategorie: 'Warenwirtschaft', frage: 'Wie erfasse ich eine Teilzahlung?', antwort: 'Im Verkaufsdetail gibt es den Bereich Zahlungen. Klick auf "Teilzahlung buchen": Betrag und Datum eingeben und speichern. Der offene Restbetrag wird sofort aktualisiert. Du kannst beliebig viele Teilzahlungen erfassen; der Posten gilt als vollständig bezahlt sobald der Gesamtbetrag erreicht ist.' },
  { kategorie: 'Warenwirtschaft', frage: 'Wie wähle ich den USt.-Satz pro Verkaufsposition?', antwort: 'Bei jeder Verkaufsposition ist der USt.-Satz einzeln wählbar (0 %, 10 %, 13 %, 20 %). Der Standard-USt.-Satz kommt aus den Mandanten-Einstellungen (Admin > Mandant > Verkauf) und wird automatisch vorbelegt – du kannst ihn aber pro Position überschreiben. Das ist nützlich wenn du z.B. Weinflaschen (13 %) und Serviceleistungen (20 %) in einer Rechnung kombinierst.' },

  { kategorie: 'Warenwirtschaft', frage: 'Wie erfasse ich einen Traubenverkauf?', antwort: 'Unter Warenwirtschaft > Verkauf > Neuer Verkauf den Positionstyp Weintrauben (kg) wählen. Ried auswählen – nur Riede mit verfügbaren Trauben (Ernte minus Pressungen minus bereits verkaufte Menge) werden angezeigt. KMW, Qualitätsstufe und Jahrgang werden automatisch aus der letzten Lese vorbelegt. Menge, Preis/kg und Gesundheit (G/K) eingeben. Beim Speichern werden Liefernummer und Rechnungsnummer automatisch vergeben.' },
  { kategorie: 'Warenwirtschaft', frage: 'Was passiert beim Stornieren eines Traubenverkaufs?', antwort: 'Beim Stornieren wird der verknüpfte BKI-Traubenverkauf-Eintrag gelöscht und die Traubenmenge wieder als verfügbar zurückgebucht. Die kg erscheinen danach wieder in der Ried-Auswahl wenn ein neuer Verkauf angelegt wird.' },
  { kategorie: 'Warenwirtschaft', frage: 'Was passiert automatisch beim Erfassen eines Zukaufs?', antwort: 'Wählst du beim Zukauf (Warenwirtschaft > Zukauf) ein Zielgebinde, legt software:112 automatisch eine neue Weinausbau-Charge mit Weinart, Rebsorte, Qualitätsstufe und Einstandspreis/Liter an. Bei Einheit „L" wird der Einstandspreis/Liter zusätzlich automatisch aus Gesamtpreis ÷ Menge berechnet.' },
  { kategorie: 'Warenwirtschaft', frage: 'Wann öffnet sich nach einem Zukauf automatisch das Verschneiden-Formular?', antwort: 'Immer dann, wenn im gewählten Zielgebinde bereits eine andere Rebsorte liegt, oder wenn zwar dieselbe Rebsorte, aber eine andere Qualitätsstufe vorhanden ist. Du wirst dann direkt zum Verschneiden-Formular der bestehenden Charge weitergeleitet, mit Quelle und Menge vorbelegt.' },

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
  { kategorie: 'KI-Modul', frage: 'Was passiert wenn mein KI-Limit erschöpft ist?', antwort: 'Du bekommst eine Meldung mit aktuellem Verbrauch und Limit (Basis 50, Standard 100, Premium unbegrenzt pro Monat). Das Limit setzt sich automatisch am Monatsersten zurück; der Morgenbericht erscheint dann ohne KI-Zusammenfassung, die Befunde bleiben. Ein Upgrade geht über Mein Betrieb > Abo & Paket.' },
  { kategorie: 'KI-Modul', frage: 'Kann ich die Ertragshistorie meiner Rieden über mehrere Jahre abfragen?', antwort: 'Ja. Frage z.B. "Wie viel kg wurden 2022 auf Grundstück 45 geerntet?" oder "Zeig mir die Ertragshistorie je GST der letzten Jahre" – die KI liefert Erntemenge, Fläche und Ertrag in kg/ha je Grundstück und Jahrgang.' },

  // Buchhaltung
  { kategorie: 'Buchhaltung', frage: 'E&A oder Doppik – was ist der Unterschied in software:112?', antwort: 'E&A: Die Einnahmen-Ausgaben-Rechnung läuft komplett in software:112 – Buchungen, Belege, UVA-Berechnung, Monatsabschluss, Finanzübersicht. Doppik: Die doppelte Buchhaltung führt die Steuerberatung in BMD; software:112 ist das Vorsystem, in dem Rechnungen und Belege erfasst und per BMD-Übergabe weitergegeben werden. Der Bereich heißt dann "Belege & BMD", UVA ist nur Vorschau, Monatsabschluss entfällt. Die Wahl trifft der Betriebsleiter beim Paketwechsel oder unter Mein Betrieb > Abo & Paket.' },
  { kategorie: 'Buchhaltung', frage: 'Warum kann ich bei Doppik keinen Monatsabschluss machen und keine AfA buchen?', antwort: 'Weil die Buchhaltung bei der Steuerberatung liegt: Sperren, Abschlüsse und die Abschreibung bucht die Kanzlei in BMD. software:112 liefert Belege und den Anlagenspiegel als Beilage – so entsteht nichts doppelt.' },
  { kategorie: 'Buchhaltung', frage: 'Wie übergebe ich Belege an meine Steuerberatung (BMD)?', antwort: 'Unter E&A-Rechnung > BMD-Übergabe (bei Doppik direkt hinter den Buchungen): Zeitraum wählen, "nur neue" lassen, Buchungsstapel erzeugen. Die CSV-Datei im BMD-NTCS-Format samt Belegdokumenten schickst du der Kanzlei; das Konten-Mapping (Erlöskonten, Sammelkonten, Steuercodes) kannst du vorher mit der Kanzlei abstimmen und im Tab Konten-Mapping anpassen. Jede Übergabe wird protokolliert.' },
  { kategorie: 'Buchhaltung', frage: 'Was zeigt die Finanzübersicht und was bedeutet "Ergebnis nach AfA"?', antwort: 'Die Finanzübersicht zeigt Ergebnis, Einnahmen, Ausgaben, Liquidität, Forderungen, UVA- und Abschlussstand gegen das Vorjahr. "Ergebnis (Einnahmen − Ausgaben)" ist die zahlungswirksame Sicht. "Ergebnis nach AfA" rechnet Anlagenkäufe (Kategorie Anlagenkauf, Kontenklasse 0) heraus und zieht stattdessen die Abschreibung laut Anlagenverzeichnis ab – eine vereinfachte steuerliche Sicht, verbindlich ist die Auswertung der Steuerberatung.' },
  { kategorie: 'Buchhaltung', frage: 'Wie erfasse ich eine Anschaffung wie Traktor oder Presse richtig?', antwort: 'Zuerst als normale Ausgabe in der Kategorie "Anlagenkauf (aktivierungspflichtig)" buchen – so stimmen Vorsteuer und BMD-Übergabe. Dann unter E&A-Rechnung > Anlagen & AfA über "Anlage anlegen" (die Buchung wird angeboten) Nutzungsdauer und Methode setzen; der AfA-Plan erscheint sofort. Nach Jahresende bucht "AfA buchen" die Jahresabschreibung als Betriebsausgabe per 31.12.; die Fristen-Ampel erinnert bis 30.4.' },
  { kategorie: 'Buchhaltung', frage: 'Was ist ein GWG?', antwort: 'Geringwertige Wirtschaftsgüter bis 1.000 € netto dürfen im Jahr der Anschaffung voll abgeschrieben werden (§ 13 EStG). Im Anlagenformular wählst du dafür die Methode "GWG – Sofortabschreibung"; über die Nutzungsdauer geht auch (Wahlrecht).' },
  { kategorie: 'Buchhaltung', frage: 'Wie funktioniert der SVS-Vergleich (Pauschalsystem oder Beitragsgrundlagenoption)?', antwort: 'Unter E&A-Rechnung > SV-Beiträge (SVS) hinterlegst du die Einheitswerte je Grundstück (manuell oder CSV-Import). software:112 rechnet daraus Versicherungswert und Beiträge im Pauschalsystem und stellt die Option gegenüber, bei der die tatsächlichen Einkünfte zählen (Vorschlag: Vorjahresergebnis nach AfA). Die Option wählt der Betriebsleiter – der Antrag bei der SVS bleibt ein eigener Schritt, der Vergleich ist eine Entscheidungshilfe.' },
  { kategorie: 'Buchhaltung', frage: 'Warum kann ich eine Buchung nicht mehr bearbeiten oder löschen?', antwort: 'Der Monat ist abgeschlossen oder der UVA-Zeitraum als übermittelt markiert – beides sperrt alle Buchungen des Zeitraums, auch neue mit einem Datum darin. AfA-Buchungen werden außerdem nur über Anlagen & AfA zurückgenommen, nicht in der Buchungsliste.' },
  { kategorie: 'Buchhaltung', frage: 'Warum werden Beträge als "€ 1.234,50" angezeigt?', antwort: 'Seit September 2026 gilt das Zahlenformat des Manuals überall: Tausenderpunkt, Dezimalkomma, Beträge mit zwei Nachkommastellen und dem €-Zeichen vorne. Mengen (Liter, Flaschen, Hektar) haben so viele Nachkommastellen wie nötig.' },

  // Abo & Paket
  { kategorie: 'Abo & Paket', frage: 'Was ist in welchem Paket enthalten?', antwort: 'Basis (€ 199/Monat, 1 Benutzer): Rieden, Kellerbuch, CRM, Morgenbericht, 50 KI-Abfragen. Standard (€ 299, 5 Benutzer): zusätzlich Newsletter, E&A-Rechnung mit BMD-Übergabe, Controlling, Wetter & Empfehlungen je Ried, 100 KI-Abfragen. Premium (€ 399, unbegrenzt Benutzer): zusätzlich bot:112 mit Sprachsteuerung, Exportaufträge, unbegrenzte KI-Abfragen. Monatlich kündbar.' },
  { kategorie: 'Abo & Paket', frage: 'Wie wechsle ich das Paket?', antwort: 'Als Betriebsleiter unter System > Mein Betrieb > Abo & Paket > "Paket wechseln". Bei Standard oder Premium fragt software:112 nach der Buchhaltungsart (E&A oder Doppik), dann geht es zur Zahlung. Zurück kommst du über "Zurück zu Mein Betrieb" oben auf der Abo-Seite.' },
  { kategorie: 'Abo & Paket', frage: 'Warum kann ich Module nicht einzeln ein- oder ausschalten?', antwort: 'Die Module werden vom Paket geführt – wer Standard bucht, bekommt genau die Standard-Module. Das hält die Pakete vergleichbar und die Abrechnung einfach. Einzige Ausnahme ist die Buchhaltungsart, die der Betrieb selbst wählt, und SumUp, das der Plattform-Admin einzeln schaltet.' },
  { kategorie: 'Abo & Paket', frage: 'Was passiert, wenn die Testphase endet?', antwort: 'Sieben Tage vorher meldet es der Morgenbericht als Hinweis. Ohne gebuchtes Paket werden die paketgesteuerten Module (Newsletter, E&A, Controlling, Export, KI) abgeschaltet; die Daten bleiben erhalten und sind nach der Buchung sofort wieder da.' },
  { kategorie: 'Abo & Paket', frage: 'Wer ist der System-Admin in meinem Betrieb und kann ich ihn entfernen?', antwort: 'Der Plattformbetreiber ist automatisch in jedem Betrieb als System-Admin Mitglied – für Support und Einrichtung. Als Betriebsleiter kannst du diese Mitgliedschaft unter Mein Betrieb > Benutzer auf Inaktiv setzen; dann hat der System-Admin keinen Zugriff auf deine Daten mehr, bis du ihn wieder aktivierst.' },

  // Morgenbericht & Wetter
  { kategorie: 'Morgenbericht & Wetter', frage: 'Was prüft der Morgenbericht genau?', antwort: 'Jeden Tag um 7 Uhr: überfällige und fällige Fristen, Gärkontrollen, Rechnungen über Zahlungsziel, Belege ohne Kategorie und erkannte Belege, Buchungen mit ungewöhnlichem Betrag, negative Bestände, Pressungen vor Ablauf einer Wartefrist, mögliche Kontakt-Dubletten, Abo-Status – und das Wetter je Ried. Die Prüfungen sind feste Regeln; nur die Zusammenfassung schreibt die KI.' },
  { kategorie: 'Morgenbericht & Wetter', frage: 'Woher kommen die Wetterdaten?', antwort: 'Von GeoSphere Austria (Open Data): Rückblick aus der INCA-Analyse mit 1 km Auflösung, Prognose aus dem AROME-Modell mit 2,5 km, jeweils für die Koordinaten deiner Rieden (auf rund 2 km zusammengefasst). Das ist eine Flächenanalyse, keine Messung am Hof – lokale Schauer können abweichen.' },
  { kategorie: 'Morgenbericht & Wetter', frage: 'Warum sehe ich kein Wetter im Morgenbericht?', antwort: 'Drei mögliche Gründe: Deine Rieden haben keine Koordinaten (unter Rieden die Lage setzen oder aus dem eAMA importieren), Wetter & Empfehlungen ist unter Mein Betrieb > Branding abgeschaltet, oder das Paket ist Basis – Wetter gibt es ab Standard. Steht "keine Prognose", war GeoSphere gerade nicht erreichbar; der nächste Lauf holt sie nach.' },
  { kategorie: 'Morgenbericht & Wetter', frage: 'Was bedeutet "Spritzbelag abgewaschen" und woher weiß das System das?', antwort: 'software:112 summiert den Regen seit deiner letzten erfassten Spritzung je Ried. Ab 25 mm (einstellbar) gilt der Belag als abgewaschen, ab 60 % davon als nachlassend – eine Faustregel, kein Infektionsmodell. Ob wirklich Risiko besteht, sagt der Pflanzenschutz-Warndienst der Landwirtschaftskammer (warndienst.at), auf den der Bericht verlinkt.' },
  { kategorie: 'Morgenbericht & Wetter', frage: 'Was ist ein Spritzfenster?', antwort: 'Ein Zeitraum in den nächsten 48 Stunden, in dem laut Prognose zwischen 5 und 20 Uhr der Wind höchstens 15 km/h (Böen 30) hat, es nicht regnet und in den drei Stunden danach kein Regen kommt – also Ausbringung ohne Abdrift und Abwaschung möglich ist. Mindestens drei Stunden am Stück.' },
  { kategorie: 'Morgenbericht & Wetter', frage: 'Kann ich den Bericht sofort neu erstellen oder abschalten?', antwort: 'Betriebsleiter und Winzer klicken auf der Übersicht "aktualisieren" – das frischt auch das Wetter auf und zählt bei KI-Zusammenfassung als eine Abfrage. Ein- und ausschalten sowie die Schwellwerte (Abwasch-Millimeter, Spritzintervall) findest du unter Mein Betrieb > Branding.' },
  { kategorie: 'Morgenbericht & Wetter', frage: 'Landen Morgenbericht-Befunde auch in der Glocke?', antwort: 'Dringende Befunde des Tages, die nicht schon als Frist oder Gärkontrolle in der Glocke stehen (z.B. abgewaschener Spritzbelag, Frostgefahr, negativer Bestand, offene Abo-Zahlung), erscheinen dort zusätzlich mit Link auf den Bericht.' },

  // Datenimport
  { kategorie: 'Datenimport', frage: 'Welche Formate werden für den CSV-Import unterstützt?', antwort: 'CSV-Dateien mit Semikolon (;) oder Komma (,) als Trennzeichen, UTF-8 Kodierung. Die meisten Excel-Exporte funktionieren direkt. Bei Problemen: in Excel "Speichern als > CSV UTF-8" wählen.' },
  { kategorie: 'Datenimport', frage: 'Was passiert mit Duplikaten beim Import?', antwort: 'Duplikate werden nicht automatisch erkannt – jede Zeile wird als neuer Datensatz angelegt. Prüfe vor dem Import deine CSV auf Duplikate, oder bereinige sie danach direkt in der Anwendung.' },

  // Maßnahmen
  { kategorie: 'Maßnahmen', frage: 'Warum sehe ich beim Toggle "Schnitt" kein BBCH-Stadium mehr?', antwort: 'Das Feld wurde für diese Maßnahmenart ausgeblendet, weil ein BBCH-Stadium beim Rebschnitt fachlich nicht relevant ist. Bei "Sonstiges" sind aus demselben Grund die Felder "Spritzmittel" und "Gesamtmenge" ausgeblendet; als Platzhalter für "Grund/Anlass" erscheint dort "z.B. Rodung".' },
  { kategorie: 'Maßnahmen', frage: 'Warum wird ein Pflanzenschutzmittel im Maßnahmenformular gesperrt?', antwort: 'Das hängt vom Bio-Status deines Betriebs ab (Administration > Mandanten > Bewirtschaftung > Bio-Status). Bei Bio-EU oder Biodynamisch werden nicht öko-zugelassene Mittel automatisch gesperrt; bei KIP oder Nachhaltig erscheint nur eine Warnung, das Mittel bleibt aber wählbar.' },
  { kategorie: 'Maßnahmen', frage: 'Was bedeutet die Hektarhöchstertrag-Warnung bei der Lese?', antwort: 'Für Qualitätswein gilt laut BKI ein Höchstertrag von 10.000 kg/ha, berechnet betriebsweit über die AMA-Gesamtfläche. Überschreitet die Summe deiner erfassten Erntemengen diesen Wert, erscheint in der Erntemeldung ein Hinweis – es handelt sich um eine reine Informations-/Warnfunktion, gespeichert wird die Menge trotzdem.' },
  { kategorie: 'Maßnahmen', frage: 'Wo pflege ich Düngemittel-Stammdaten?', antwort: 'Unter Maßnahmen > Betriebsmittel > Tab "Düngemittel": Name, Handelsname, Typ, N-P-K-Gehalt, Wartezeit, Bio-Zulassung, Einarbeitungspflicht und Preis pro Einheit hinterlegen. Diese Werte stehen danach im Maßnahmenformular und in der Kosten-Vorschlagsfunktion zur Verfügung.' },
  { kategorie: 'Maßnahmen', frage: 'Wie lege ich Stundensätze für die Kosten-Vorschlagsfunktion fest?', antwort: 'Unter Maßnahmen > Betriebsmittel > Tab "Stundensätze": je Maßnahmenart (z.B. Schnitt, Laubarbeit, Ernte) einen Hektarsatz in Euro hinterlegen. Diese Sätze werden automatisch für den Personalkosten-Anteil im Vorschlag "Kosten erfassen" herangezogen.' },
  { kategorie: 'Maßnahmen', frage: 'Wie funktioniert die Kosten-Vorschlagsfunktion im Maßnahmenformular?', antwort: 'Im Abschnitt "Kosten erfassen" (unterhalb der Ried-Auswahl) schlägt software:112 automatisch Materialkosten (Mittelpreis × eingesetzte Menge) und Personalkosten (hinterlegter Hektarsatz × bearbeitete Fläche) vor. Der Vorschlag ist frei änderbar; bestätigst du ihn, wird beim Speichern der Maßnahme automatisch ein Kosteneintrag mit anteiliger Aufteilung auf die betroffenen Weingärten in der Kostenrechnung angelegt.' },
  { kategorie: 'Maßnahmen', frage: 'Warum ist "Ried(en) auswählen" im Maßnahmenformular eingeklappt?', antwort: 'Die Ried-Auswahl ist standardmäßig eingeklappt, damit der darunterliegende Abschnitt "Kosten erfassen" besser sichtbar ist. Über den Klick auf die Kopfzeile lässt sie sich jederzeit auf-/zuklappen; bereits ausgewählte Riede bleiben in der Zusammenfassung darüber immer sichtbar, auch im eingeklappten Zustand.' },

  // Kellerbuch
  { kategorie: 'Kellerbuch', frage: 'Wie wird die Qualitätsstufe einer neuen Charge bestimmt?', antwort: 'Die Qualitätsstufe wird beim Anlegen einer Weinausbau-Charge automatisch aus dem KMW-Wert der zugehörigen Lese vorbelegt – das System wählt die entsprechende Stufe (Landwein, Qualitätswein, Kabinett, Spätlese usw.). Ein Upgrade auf eine höhere Stufe als vom KMW erlaubt ist gesperrt; ein Downgrade ist jederzeit möglich.' },
  { kategorie: 'Kellerbuch', frage: 'Was passiert beim Verschnitt?', antwort: 'Wenn du Chargen verschiedener Qualitätsstufen mischt, wird die Ziel-Charge automatisch auf die niedrigste Qualitätsstufe aller Quellen gesetzt. Du bekommst eine Bestätigungsabfrage bevor der Umzug gespeichert wird.' },
  { kategorie: 'Kellerbuch', frage: 'Wie bekomme ich ein Etikett für meinen Wein?', antwort: 'Unter Kellerbuch > Prüfnummern: Den DAC-Antrag mit Prüfnummer öffnen, oben rechts auf "Etikett" klicken. Das System generiert ein druckfertiges Etikett mit allen Pflichtangaben und deinem Logo.' },
  { kategorie: 'Kellerbuch', frage: 'Wie lege ich eine neue Charge an?', antwort: 'Gar nicht direkt – Chargen entstehen ausschließlich automatisch, entweder durch eine Pressung (Rieden > Lese > Pressung erfassen) oder durch eine Verschneidung bestehender Chargen. Der frühere Menüpunkt "Neue Charge" leitet dich automatisch zur Lese weiter.' },
  { kategorie: 'Kellerbuch', frage: 'Warum sind manche Felder in der Charge grau und nicht editierbar?', antwort: 'Stammt eine Charge aus einer Pressung, werden Jahrgang, Rebsorte, Menge, Qualitätsstufe, Weinart, Rieden und Behälter automatisch abgeleitet und sind gesperrt – ein Hinweis dazu erscheint oben im Formular. Diese Werte lassen sich nur indirekt über Umzüge, Verschneidungen bzw. eine erneute Pressungsbearbeitung ändern.' },
  { kategorie: 'Kellerbuch', frage: 'Kann ich Rotwein und Weißwein miteinander verschneiden?', antwort: 'Nein. Sobald du beim Verschneiden eine Quell-Charge mit gegensätzlicher Weinart auswählst, blockiert das System die Verschneidung mit einer roten Fehlermeldung ("Weinart-Konflikt") und der Speichern-Button ist deaktiviert.' },
  { kategorie: 'Kellerbuch', frage: 'Was bedeutet die 85%-Regel bei der Verschneidung?', antwort: 'Macht nach dem Verschnitt eine Rebsorte mindestens 85 % der Gesamtmenge aus, bleibt die Charge weiterhin sortenrein bezeichenbar ("bezeichnungsunschädlicher Verschnitt"). Liegt keine Sorte über dieser Schwelle, wird die Charge automatisch als "Sortenverschnitt" geführt – eine Live-Vorschau im Verschneiden-Formular zeigt dir das Ergebnis schon vor dem Speichern.' },
  { kategorie: 'Kellerbuch', frage: 'Wo finde ich Gebinde und Chargen, wenn sie nicht mehr in der Seitenleiste stehen?', antwort: 'Gebinde und die Chargenliste (Weinausbau) wurden aus der Kellerbuch-Sidebar entfernt, sind aber weiterhin erreichbar: über die Kacheln "Aktive Behälter" bzw. "Laufende Chargen" auf der Kellerbuch-Übersichtsseite, oder direkt über /kellerbuch/gebinde bzw. /kellerbuch/weinausbau.' },
  { kategorie: 'Kellerbuch', frage: 'Warum finde ich in der Kellerbuch-Übersicht keinen "Neue Füllung"-Button mehr?', antwort: 'Der Button wurde entfernt. Eine Charge füllst du stattdessen über den "Abfüllen"-Link direkt neben der jeweiligen Charge in der Kellerbuch-Übersicht bzw. über den "Abfüllen"-Button in der Charge-Detailseite ab.' },
  { kategorie: 'Kellerbuch', frage: 'Wie sehe ich, wie viel Platz in einem Gebinde noch frei ist?', antwort: 'Sowohl in der Kellerbuch-Übersicht (Kapazitätsbalken pro Behälter) als auch in den Behälter-Dropdowns bei Pressung, Umziehen und Verschneiden wird Kapazität, aktueller Inhalt und freier Rest in Liter direkt angezeigt.' },
  { kategorie: 'Kellerbuch', frage: 'Kann ein Gebinde auf mehreren Kellerplänen gleichzeitig stehen?', antwort: 'Nein. Ein Gebinde ist immer nur einem Standort (Kellerplan) zugeordnet – sobald es auf einem Kellerplan platziert ist, verschwindet es aus der Auswahl für alle anderen Kellerpläne, um Mehrfachzuordnungen zu vermeiden. Löschen lässt sich ein Gebinde nur, wenn keine aktive Charge mehr enthalten ist und es in keinem Kellerbuch-Eintrag mehr referenziert wird – sonst bitte über "Bearbeiten" auf "Inaktiv" setzen.' },
  { kategorie: 'Kellerbuch', frage: 'Was passiert, wenn ich im Kellerplan auf ein Gebinde klicke?', antwort: 'Ein Klick (kein Ziehen) auf ein Gebinde im Kellerplan öffnet ein Dialogfenster mit direkten Sprüngen zu "Umziehen", "Kellerbehandlungen" und – falls Wein enthalten ist – "Abfüllen". So kommst du aus der visuellen Kellerübersicht ohne Umweg direkt zur passenden Aktion.' },
  { kategorie: 'Kellerbuch', frage: 'Warum öffnet sich beim Umziehen plötzlich das Verschneiden-Formular?', antwort: 'Wenn du eine Charge in ein Gebinde umziehst, das bereits eine Charge mit einer anderen Rebsorte enthält, erkennt das System den Rebsortenmix automatisch und öffnet nach dem Buchen des Umzugs direkt das Verschneiden-Formular mit den beiden betroffenen Chargen. Dieselbe Weiterleitung passiert auch direkt nach einer Pressung, wenn der Zielbehälter bereits eine Charge enthält.' },
  { kategorie: 'Kellerbuch', frage: 'Ich sehe Gebinde mit dem Namen eines anderen Weinguts – was ist das?', antwort: 'Das sind freigegebene Gebinde einer Kellergemeinschaft: Ein Partnerbetrieb (Eigentümer) hat euch seine Gebinde zur Nutzung freigegeben (eingerichtet vom Plattform-Admin unter Administration > Kellergemeinschaft). Du kannst dort deinen eigenen Wein einlagern und umziehen; vom Wein des Eigentümers oder anderer Partner siehst du nur "belegt" samt Litern – keine Details.' },
  { kategorie: 'Kellerbuch', frage: 'Warum kann ich nicht in ein bestimmtes Gebinde umziehen?', antwort: 'Liegt in einem Gebinde Wein eines anderen Betriebs (Kellergemeinschaft), ist es für alle anderen gesperrt – es erscheint in der Gebinde-Liste als "belegt · Betrieb" und fehlt in der Ziel-Auswahl. Erst wenn der andere Betrieb das Gebinde leer gemacht hat, ist es wieder frei. Zwei eigene Chargen im selben Gebinde sind weiterhin möglich (Verschnitt-Workflow).' },
  { kategorie: 'Kellerbuch', frage: 'Was macht der bawb.at-Button im Prüfnummern-Antrag genau?', antwort: 'Er öffnet nur das externe LFRZ-Portal (bawb.at, "Weinkontrolle Online") in einem neuen Tab als Schnellzugriff. Es werden keine Daten automatisch übertragen – Status und Prüfnummer musst du nach der Prüfung im Portal weiterhin manuell im Antrag eintragen.' },

  // Administration
  { kategorie: 'Administration', frage: 'Wo trage ich die bawb.at-Zugangsdaten ein?', antwort: 'Unter Administration > Mandanten > [Betrieb] > Tab "bawb.at" hinterlegst du Kennung (Betriebsnummer) und Passwort für das LFRZ-Portal. Ein Button öffnet das Portal direkt in einem neuen Tab.' },

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
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <span>Hilfe</span>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Häufige Fragen (FAQ)</span>
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-s112-text">Häufige Fragen (FAQ)</h1>
        <p className="text-sm text-s112-muted mt-1">Antworten auf die häufigsten Fragen zu software:112 · Version 2.7 · Stand September 2026</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input value={suche} onChange={e => setSuche(e.target.value)}
          placeholder="Fragen durchsuchen…"
          className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-56" />
        <div className="flex gap-1 flex-wrap">
          {['Alle', ...KATEGORIEN].map(k => (
            <button key={k} onClick={() => setKategorie(k)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                ${kategorie === k ? 'bg-s112-teal text-white' : 'bg-s112-bg text-s112-text-2 hover:bg-s112-teal/10'}`}>
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
                <span className="text-xs bg-s112-bg border border-s112-border px-2 py-0.5 rounded text-s112-text-2 flex-shrink-0">
                  {f.kategorie}
                </span>
                <span className="text-sm font-medium text-s112-text">{f.frage}</span>
              </div>
              <span className={`text-s112-muted flex-shrink-0 ml-3 transition-transform ${offen === i ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {offen === i && (
              <div className="px-5 pb-4 pt-1 text-sm text-s112-text-2 leading-relaxed border-t border-s112-border/40">
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
        <Link href="/hilfe/handbuch" className="text-sm text-s112-blue-700 hover:underline">
          Zum vollständigen Handbuch →
        </Link>
      </div>
    </div>
  )
}
