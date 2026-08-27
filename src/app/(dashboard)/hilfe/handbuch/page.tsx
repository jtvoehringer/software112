'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LayoutDashboard, Sprout, Wine, ShoppingCart, Truck, Users, Mail, Bot, Upload, Settings, BarChart3, type LucideIcon } from 'lucide-react'

type Abschnitt = { titel: string; inhalt: string }
type Kapitel = { id: string; icon: LucideIcon; titel: string; abschnitte: Abschnitt[] }

const KAPITEL: Kapitel[] = [
  {
    id: 'navigation', icon: LayoutDashboard, titel: 'Navigation & Dashboard',
    abschnitte: [
      { titel: 'Hauptnavigation (zwei Zeilen)', inhalt: 'Seit dem Dashboard-Relaunch (August 2026) gibt es keine linke Seitenleiste mehr. Unter der dunklen Kopfleiste zeigt die erste Zeile die Bereiche (Übersicht, Rieden, Kellerbuch, Warenwirtschaft, CRM, E&A-Rechnung, Controlling, Auswertungen, Frag dein Weingut, System), die zweite Zeile die Seiten des gewählten Bereichs. Auf schmalen Bildschirmen lassen sich beide Zeilen seitlich scrollen. Welche Bereiche und Seiten sichtbar sind, hängt wie bisher von Rolle und aktivierten Modulen ab.' },
      { titel: 'Kopfleiste', inhalt: 'Links steht software:112, daneben der aktive Betrieb (Logo und Name aus "Mein Betrieb" > Branding). Rechts: Suchen oder Befehl (Strg K), Benachrichtigungen und das Benutzermenü mit Profil, Betrieb wechseln (bei mehreren Betrieben) und Abmelden.' },
      { titel: 'Strg K – Suchen oder Befehl', inhalt: 'Die Befehlspalette öffnet sich mit Strg K (Mac: ⌘K) oder über den Knopf in der Kopfleiste. Tippe einen Seitennamen ("Offene Posten"), eine Aktion ("Neuer Verkauf", "Maßnahme erfassen", "Abmelden") oder einen Suchbegriff – ab zwei Zeichen werden Kontakte, Firmen, Rechnungen, Füllungen, Chargen, Rieden, Grundstücke und Jahrgänge durchsucht. Mit ↑↓ wählen, ↵ öffnen, Esc schließen.' },
      { titel: 'Dashboard mit fünf Sichten', inhalt: 'Der Bereich "Übersicht" hat fünf Sichten: Übersicht (Kellerbestand, Flaschenlager, Offene Posten, Offene Aufgaben, "Nächste Schritte" über alle Module, Stand der Anbindungen), Kellerbuch (Chargen-Pipeline als Kanban mit Detail-Modal und bot:112-Aktionen), Verkauf & CRM (Umsatz, Aufträge, Leads, überfällige Rechnungen, Aktivitäten – das bisherige Dashboard), Weingarten & Ernte (Rieden mit AMA-Feldstücken, Wartefristen, Lesevorbereitungs-Checkliste) und Meldungen & Fristen (Ampel über UVA, Erntemeldung, Prüfnummernanträge, Wartefristen und betriebseigene Fristen).' },
      { titel: 'Lesevorbereitungs-Checkliste', inhalt: 'Unter Übersicht > Weingarten & Ernte lässt sich je Saison eine Checkliste aus einer Vorlage anlegen (Betriebsleiter/Winzer). Punkte können abgehakt, ergänzt und gelöscht werden; der Fortschritt erscheint als Balken und zählt in die "Offenen Aufgaben" der Übersicht.' },
      { titel: 'Meldungen & Fristen', inhalt: 'Systemfristen (UVA je Voranmeldungszeitraum, Erntemeldung des laufenden Jahrgangs, offene Prüfnummernanträge, Wartefristen Pflanzenschutz) werden automatisch aus den Modulen abgeleitet. Betriebseigene Fristen (z.B. Bestandsmeldung, Inventur) legst du selbst an oder übernimmst die Standardvorlage; jährliche Fristen werden beim Erledigen automatisch für das Folgejahr neu angelegt. Ampel: überfällig, fällig (Vorwarnung standardmäßig 30 Tage), offen, laufend, erledigt. Die Termine sind Betriebs-Stammdaten, keine Rechtsberatung.' },
      { titel: 'Dashboard-Regeln je Betrieb', inhalt: 'Unter System > Mein Betrieb > Branding lassen sich zwei Schwellwerte einstellen: „Gärkontrolle fällig nach (Tage)“ – eine Charge in Gärung ohne Weinanalyse seit so vielen Tagen gilt als „Messung fällig“ (Kellerbuch-Kanban, Übersicht, Glocke) – und „Fristen-Vorwarnung (Tage)“, ab wann eine Frist von „offen“ auf „fällig“ springt. Standard: 3 bzw. 30 Tage.' },
      { titel: 'Betriebsbeginn der E&A-Rechnung', inhalt: 'Unter System > Mein Betrieb > Betrieb lässt sich ein Betriebsbeginn (Systemstart) für die E&A-Rechnung eintragen, z.B. 01.09.2026 bei einem Rumpfjahr. Monate, die vollständig davor enden, gelten nicht als offen: Sie brauchen keinen Monatsabschluss, erscheinen nicht in der UVA-Zeitraumwahl und nicht als fällige UVA in der Fristen-Ampel oder in der Glocke. Leer lassen = keine Einschränkung.' },
    ],
  },
  {
    id: 'weingarten', icon: Sprout, titel: 'Rieden',
    abschnitte: [
      { titel: 'Rieden anlegen', inhalt: 'Navigiere zu Rieden > Neue Ried. Pflichtfelder: Name, Rebsorte, Fläche (ha), Gemeinde/Lage. Die Ried erscheint in allen Maßnahmen- und Erntemasken.' },
      { titel: 'Lage & Koordinaten einer Ried', inhalt: 'In der Ried-Detailseite zeigt die Karte „Lage & Koordinaten“ (Luftbild oder Karte von basemap.at) den Mittelpunkt der Ried. Pin setzen: auf die Karte klicken, Koordinaten eintippen (Breite, Länge – z.B. 48,05123, 16,28456) oder am Handy „Aktueller Standort“ übernehmen, dann Speichern. Die Koordinaten gelten für die ganze Ried (alle Weingärten derselben Ried). Buttons: Google Maps öffnen, Navigation starten, GPX/KML herunterladen. In der Rieden-Übersicht öffnet das Pin-Symbol neben dem Riednamen Google Maps; „Wegpunkte“ exportiert alle Rieden als GPX (GPS-Gerät, Handy-App, Traktor-Terminal), KML (Google Earth) oder GeoJSON (QGIS, Farmsoftware). Umrisse der Feldstücke folgen mit dem eAMA-GIS-Import.' },
      { titel: 'Maßnahme erfassen', inhalt: 'Unter Rieden > Maßnahmen > Neue Maßnahme: Datum, Ried, PSM-Mittel und Aufwandmenge eintragen. Das System berechnet automatisch den frühesten Erntetermin nach Wartezeit.' },
      { titel: 'Kontextsensitive Felder im Maßnahmenformular', inhalt: 'Die angezeigten Felder passen sich automatisch an die gewählte Maßnahmenart an: Beim Toggle "Schnitt" entfällt das Feld BBCH-Stadium, beim Toggle "Sonstiges" entfallen "Spritzmittel" und "Gesamtmenge" (Beispieltext bei "Grund/Anlass" ist dann "z.B. Rodung"). So bleibt das Formular für jede Art nur mit den fachlich relevanten Feldern übersichtlich.' },
      { titel: 'Ried(en)-Auswahl ein-/aufklappen', inhalt: 'Der Abschnitt "Ried(en) auswählen" ist im Maßnahmenformular standardmäßig eingeklappt, damit der darunterliegende Abschnitt "Kosten erfassen" besser sichtbar ist. Auf die Kopfzeile klicken klappt die Auswahl auf/zu – bereits ausgewählte Riede bleiben in der Zusammenfassung darüber unabhängig vom Zustand sichtbar.' },
      { titel: 'Kosten gleich mit erfassen', inhalt: 'Im Abschnitt "Kosten erfassen" schlägt software:112 automatisch Materialkosten (Mittelpreis × eingesetzte Menge, aus PSM- bzw. Düngemittel-Stammdaten) und Personalkosten (hinterlegter Hektarsatz × bearbeitete Fläche, siehe Betriebsmittel > Stundensätze) vor. Der Vorschlag ist frei anpassbar; bestätigst du ihn, legt software:112 beim Speichern automatisch einen Kosteneintrag mit anteiliger Aufteilung auf die betroffenen Weingärten in der Kostenrechnung an.' },
      { titel: 'Betriebsmittel-Lagerverwaltung', inhalt: 'Unter Rieden > Betriebsmittel gibt es vier Tabs: „Bestand & Bewegungen" (Anfangsbestand, Einkäufe, automatische Reduktion je Maßnahme, Inventurkorrekturen), „PSM-Stammdaten" (Pflanzenschutzmittel mit Wirkstoff, Cu-Gehalt, Grenzwerten, Bio-Zulassung), „Düngemittel" (N-P-K-Gehalt, Wartezeit, Bio-Zulassung, Preis pro Einheit) und „Stundensätze" (Hektarsätze je Maßnahmenart für die Kosten-Vorschlagsfunktion).' },
      { titel: 'Lese erfassen', inhalt: 'Unter Rieden > Lese wählst du den Jahrgang und trägst Datum, Ried, Menge (kg + hl) und Grad KMW ein. Diese Daten bilden die Basis für die AMA-Erntemeldung. Für Qualitätswein zeigt software:112 zusätzlich eine betriebsweite Hektarhöchstertrag-Prüfung (10.000 kg/ha × AMA-Gesamtfläche): Wird dieser Wert durch die Summe deiner Erntemengen überschritten, erscheint ein Hinweis – die Menge wird trotzdem gespeichert, es handelt sich um eine reine Informationsfunktion.' },
    ],
  },
  {
    id: 'kellerbuch', icon: Wine, titel: 'Kellerbuch',
    abschnitte: [
      { titel: 'Chargen entstehen automatisch', inhalt: 'Eine Weinausbau-Charge legst du nicht mehr manuell an – der frühere Menüpunkt "Neue Charge" leitet automatisch zur Lese weiter. Chargen entstehen ausschließlich durch eine Pressung (Rieden > Lese > Pressung erfassen) oder durch eine Verschneidung bestehender Chargen. Rebsorte, Jahrgang und Menge werden dabei übernommen und sind in der Charge-Detailseite gesperrt, sofern die Charge aus einer Pressung stammt.' },
      { titel: 'Pressung erfassen', inhalt: 'Unter Rieden > Lese > Pressungen erfasst du Datum, Mostausbeute, gelesene GST/Rieden und Zielbehälter. Der °KMW-Wert wird live als gewichteter Durchschnitt berechnet; ein Klick auf den vorgeschlagenen Qualitätsstufen-Button übernimmt die Stufe, manuelle Überschreibung bleibt möglich. Eine Live-Vorschau zeigt schon während der Eingabe den Namen der entstehenden Charge.' },
      { titel: 'Behälter-Auswahl bei Pressung, Umziehen und Verschneiden', inhalt: 'Die Behälter-Dropdowns zeigen zu jedem Gebinde Kapazität, aktuellen Inhalt und freien Rest sowie in eckigen Klammern die bereits enthaltenen Chargen/Rebsorten. Bei Auswahl eines belegten Behälters erscheint automatisch ein Kapazitäts-Check (Rest nach der Buchung) sowie ggf. eine Rebsortenmix-Warnung oder eine rote Sperre bei Weinart-Konflikt (Rot- und Weißwein dürfen nicht gemeinsam in einem Gebinde verschnitten werden).' },
      { titel: 'Umziehen und Verschneiden (aus der Charge-Detailseite)', inhalt: 'Umziehen und Verschneiden startest du direkt oben in der Charge-Detailseite (Kellerbuch > Weinausbau > Charge öffnen) über die Buttons "Umziehen" und "Verschneiden" – eigene Auslöse-Buttons in Listen gibt es nicht mehr. Presst du in einen bereits belegten Behälter oder ziehst du in ein Gebinde mit anderer Rebsorte um, bietet software:112 danach automatisch an, die beiden Chargen zu verschneiden.' },
      { titel: 'Qualitätsstufen- und Weinart-Regeln beim Verschnitt', inhalt: 'Mischst du Chargen verschiedener Qualitätsstufen, wird die Ziel-Charge automatisch auf die niedrigste beteiligte Stufe gesetzt (Bestätigungsabfrage vor dem Speichern); ein Upgrade über die höchste Quell-Stufe hinaus ist nie möglich. Enthalten Quelle und Ziel unterschiedliche Rebsorten, prüft eine Live-Vorschau die 85 %-Regel: Macht eine Sorte mindestens 85 % der Gesamtmenge aus, bleibt sie sortenrein bezeichenbar, sonst gilt die Charge als "Sortenverschnitt". Rotwein und Weißwein lassen sich grundsätzlich nicht miteinander verschneiden (Weinart-Konflikt, Speichern-Button gesperrt).' },
      { titel: 'Kapazität und Standort von Gebinden', inhalt: 'Bei Umziehen, Verschneiden und Pressung wird die Kapazität des Zielgebindes live geprüft; bei Überschreitung wird die Buchung blockiert. Ein Gebinde kann außerdem nur einem Kellerplan (Standort) zugeordnet sein – ist es dort bereits platziert, verschwindet es aus der Auswahl anderer Kellerpläne. Löschen ist nur ohne aktive Charge und ohne bestehende Referenzen möglich, sonst über "Bearbeiten" auf "Inaktiv" setzen.' },
      { titel: 'Abfüllen', inhalt: 'Eine Charge füllst du über den "Abfüllen"-Link in der Kellerbuch-Übersicht bzw. den "Abfüllen"-Button in der Charge-Detailseite ab: Flaschengröße, Anzahl Flaschen und VK-Preis wählen. Die Füllung erscheint danach im Warenwirtschaft-Lager. Der frühere eigenständige "Neue Füllung"-Button in der Übersicht wurde entfernt.' },
      { titel: 'Kellerbuch-Übersicht und Navigation', inhalt: 'Gebinde und die Chargenliste (Weinausbau) wurden aus der Navigation entfernt, sind aber über die Kacheln "Aktive Behälter" bzw. "Laufende Chargen" auf der Kellerbuch-Übersichtsseite weiterhin erreichbar (bzw. direkt über /kellerbuch/gebinde und /kellerbuch/weinausbau). Chargen-Zeilen sind komplett anklickbar und führen zur Charge-Detailseite; ein Weinart-Badge (Weiß/Rot/Rosé) sowie ein Kapazitätsbalken je Behälter geben einen schnellen Überblick.' },
      { titel: 'Kellerplan', inhalt: 'Der Kellerplan zeigt eine visuelle Übersicht aller Behälter mit aktueller Belegung. Ein Klick (kein Ziehen) auf ein Gebinde öffnet ein Dialogfenster mit direkten Sprüngen zu "Umziehen", "Kellerbehandlungen" und – falls Wein enthalten ist – "Abfüllen". Nützlich auch für Bio-Kontrolle und Raumplanung.' },
      { titel: 'bawb.at im Prüfnummern-Antrag', inhalt: 'Im Prüfnummern-Antrag (Kellerbuch > Prüfnummern) öffnet der Button "bawb.at öffnen" das LFRZ-Portal "Weinkontrolle Online" als Schnellzugriff in einem neuen Tab. Es findet keine automatische Datenübertragung statt – Status und Prüfnummer aus dem Portal trägst du weiterhin manuell in den Antrag ein.' },
    ],
  },
  {
    id: 'warenwirtschaft', icon: ShoppingCart, titel: 'Warenwirtschaft',
    abschnitte: [
      { titel: 'Verkauf anlegen', inhalt: 'Unter Warenwirtschaft > Verkauf > Neuer Verkauf: zuerst Kontakt oder Firma wählen (Pflicht!), dann Positionen hinzufügen. Rabattgruppe und Sonderrabatt werden automatisch vorbelegt. Den USt.-Satz kannst du pro Position einzeln wählen (0 %, 10 %, 13 %, 20 %); Standard ist der im Mandanten hinterlegte Wert.' },
      { titel: 'Rechnung drucken', inhalt: 'In der Verkaufsdetailansicht auf Rechnung klicken. Das System druckt ein PDF mit Briefkopf, USt-Aufschlüsselung und Bankdaten. Rechnungsnummer wird automatisch vergeben.' },
      { titel: 'Bezahlt markieren', inhalt: 'In der Verkaufsdetailansicht oder unter Offene Posten auf "Als bezahlt markieren" klicken. Das Datum wird gespeichert und der Eintrag verschwindet aus den offenen Posten.' },
      { titel: 'Rabatt & Sonderrabatt', inhalt: 'Beim Anlegen einer Verkaufsposition wird Rabatt aus der Rabattgruppe und Sonderrabatt aus dem Kontakt/der Firma automatisch vorbelegt. Beide Werte können direkt in der Position geändert oder auf 0 gesetzt werden, um keinen Rabatt anzuwenden.' },
      { titel: 'Skonto', inhalt: 'Unter CRM > Kontakt/Firma kann ein Skonto-Prozentsatz hinterlegt werden. Dieser erscheint automatisch in neuen Verkäufen und wird auf der Rechnung ausgewiesen. Im Verkaufsformular ist Skonto jederzeit anpassbar.' },
      { titel: 'Teilzahlungen', inhalt: 'Im Verkaufsdetail kannst du Teilzahlungen erfassen: Betrag und Datum eingeben. Der offene Restbetrag wird automatisch aktualisiert. Der Posten gilt erst als vollständig bezahlt wenn der Gesamtbetrag beglichen ist.' },
      { titel: 'Traubenverkauf', inhalt: 'Unter Warenwirtschaft > Verkauf > Neuer Verkauf den Positionstyp Weintrauben (kg) wählen. Im Formular Ried auswählen – es werden nur Riede mit noch verfügbaren (nicht gepressten oder bereits verkauften) Trauben angezeigt. Das System befüllt KMW, Qualitätsstufe und Jahrgang automatisch aus der letzten Lese. Optional ein Grundstück (Parzelle) für parzellengenaue Abrechnung wählen. Menge (kg), Preis pro kg und Gesundheitszustand (G = gesund / K = krank) eintragen. Beim Speichern wird automatisch eine Liefernummer und Rechnungsnummer vergeben. Beim Stornieren werden die kg wieder als verfügbar zurückgebucht. BKI-Datenblätter unter Rieden > Traubenverkauf.' },
      { titel: 'Zukauf erfassen', inhalt: 'Unter Warenwirtschaft > Zukauf > Neuer Zukauf erfasst du eine Transportbescheinigung gem. Weingesetz: Datum/Uhrzeit, Art (Wein, Traubenmost oder Trauben), Lieferant, Transportmittel sowie Warenangaben wie Weinart, Rebsorte, Jahrgang, Herkunft, Qualitätsstufe, °KMW und Prüfnummer. Der Preis pro Einheit wird automatisch aus Gesamtpreis ÷ Menge berechnet; bei Einheit „L" übernimmt software:112 daraus zusätzlich automatisch den Einstandspreis/Liter. Optional füllst du den Zukauf direkt in ein bestehendes Gebinde – das Dropdown zeigt je Behälter Kapazität, Inhalt (inkl. enthaltener Rebsorten) und Restkapazität, inklusive Warnung bei drohender Überfüllung.' },
      { titel: 'Automatische Verschneidung nach dem Zukauf', inhalt: 'Enthält das gewählte Zielgebinde beim Zukauf bereits eine andere Rebsorte, erscheint vor dem Speichern eine Warnung "Rebsortenverschnitt". Nach dem Speichern legt software:112 die Zukaufsmenge als eigene Charge im Gebinde an und leitet automatisch zum Verschneiden-Formular der bestehenden Charge weiter (Quelle und Menge vorbelegt) – dieselbe automatische Weiterleitung erfolgt auch bei gleicher Rebsorte, aber unterschiedlicher Qualitätsstufe.' },
    ],
  },
  {
    id: 'weinexport', icon: Truck, titel: 'Weinexport',
    abschnitte: [
      { titel: 'Exportauftrag anlegen', inhalt: 'Unter Weinexport > Neuer Auftrag: Importeur (Kontakt oder Firma), Incoterms, Transportart, Destination und EORI-Nummer des Importeurs eintragen. Weinpositionen aus dem Füllungslager wählen – TARIC-Code wird automatisch gesetzt (2204.21 für Weinflaschen).' },
      { titel: 'Exportdokumente generieren', inhalt: 'Im Exportauftrag rechts unter "Dokumente": Status je Dokument pflegen (Ausstehend → Beantragt → Ausgestellt). Klick auf "PDF" öffnet das druckfertige Dokument: V1/V2 Begleitdokument, EUR.1 Ursprungszeugnis, CMR Frachtbrief, Certificate of Origin, Lieferschein (DE/EN), Exportrechnung (DE/EN).' },
      { titel: 'EMCS – e-AD Dokument', inhalt: 'Im Exportauftrag rechts unter "EMCS": ARC-Nummer und Status eintragen sobald bekannt. "e-AD XML Download" erstellt ein maschinenlesbares XML-Dokument das in EMCS AT (BMF FinanzOnline) importiert werden kann. Vollzugriff auf das EMCS-System benötigst du über das BMF-Portal.' },
      { titel: 'Auftragsstatus verfolgen', inhalt: 'Jeder Exportauftrag durchläuft: Entwurf → Bestätigt → Versendet → Abgeschlossen. Status oben rechts im Auftrag ändern. Die Dokumenten-Checkliste zeigt den Fortschritt als Fortschrittsbalken.' },
    ],
  },
  {
    id: 'crm', icon: Users, titel: 'CRM',
    abschnitte: [
      { titel: 'Kontakt anlegen', inhalt: 'Unter CRM > Kontakte > Neuer Kontakt. Neue Kontakte starten als Lead (gelb). Nach dem ersten Verkauf werden sie automatisch zu Kunden (grün). Telefonvorwahl wählen: Land wird automatisch ausgefüllt.' },
      { titel: 'Notizen', inhalt: 'In der Kontakt- oder Firmendetailansicht gibt es eine eigene Notizen-Karte. Neue Notiz eingeben und + klicken. Offene Notizen erscheinen oben, erledigte darunter. Erledigte Notizen mit dem Häkchen abhaken.' },
      { titel: 'E-Mails im CRM', inhalt: 'Gesendete und empfangene E-Mails erscheinen im Aktivitäten-Tab des Kontakts/der Firma. Betreff anklicken klappt den E-Mail-Inhalt auf – dauerhaft gespeichert, auch wenn die E-Mail in der Mailbox gelöscht wurde. Verwandte E-Mails (gleicher Betreff) werden als Thread zusammengefasst.' },
      { titel: 'E-Mail direkt senden', inhalt: 'In der Kontaktdetailansicht neben der E-Mail-Adresse auf Senden klicken. Betreff und Text eingeben, absenden. Die E-Mail erscheint sofort als Aktivität beim Kontakt.' },
      { titel: 'Kalender nutzen', inhalt: 'Unter CRM > Kalender: Klick auf freien Zeitslot öffnet schnell eine neue Aktivität. Unerledigte Ganztags-Aktivitäten rollen automatisch auf heute.' },
      { titel: 'Outlook-Kalender spiegeln', inhalt: 'Sobald deine Mailbox unter Nachrichten mit Microsoft 365 verbunden ist, zeigt der CRM-Kalender automatisch auch deine persönlichen Outlook-Termine an – hellblau markiert und mit eigenem "Outlook"-Eintrag in der Legende, in allen drei Ansichten (Woche/Monat/Jahr). Klick auf einen Outlook-Termin öffnet ein Detailfenster mit Link "In Outlook öffnen". War deine Mailbox schon vor dieser Funktion verbunden, musst du sie unter Nachrichten > Einstellungen einmalig trennen und neu verbinden, damit die Kalenderberechtigung wirksam wird.' },
      { titel: 'Besuchsplanung', inhalt: 'Unter Auswertungen > Besuchsplanung: Region + Segment eingeben, das System clustert Kontakte nach PLZ. Route direkt in Google Maps öffnen.' },
    ],
  },
  {
    id: 'nachrichten', icon: Mail, titel: 'E-Mail (Nachrichten)',
    abschnitte: [
      { titel: 'Mailbox verbinden', inhalt: 'Unter Nachrichten auf "Mit Microsoft 365 verbinden" klicken. Microsoft-Login erscheint: mit dem Weingut-Outlook-Konto anmelden und Berechtigungen erteilen (E-Mail und persönlicher Kalender, siehe CRM > Outlook-Kalender spiegeln). Die Verbindung ist pro Benutzer – jeder muss sein eigenes Konto verbinden.' },
      { titel: 'E-Mails lesen und navigieren', inhalt: 'Die linke Sidebar zeigt alle Ordner (Posteingang, Gesendet, Entwürfe, Gelöschte Elemente, ...). Ordner anklicken wechselt die Ansicht. E-Mail in der Liste anklicken zeigt den vollständigen Inhalt rechts.' },
      { titel: 'Antworten, Weiterleiten, Löschen', inhalt: 'Im E-Mail-Detail: "Antworten" öffnet ein Compose-Formular mit vorausgefüllter Adresse und Betreff. "Weiterleiten" öffnet dasselbe mit leerem Empfänger. Das Papierkorb-Icon verschiebt die E-Mail in Gelöschte Elemente.' },
      { titel: 'Neue E-Mail verfassen', inhalt: 'Oben links in der Sidebar auf "Verfassen" klicken. An, Betreff und Nachrichtentext eintragen. Bei verbundener Shared Mailbox: Absender wählen (eigene Mailbox oder z.B. office@weingut.at).' },
      { titel: 'Shared Mailbox einrichten', inhalt: 'Unter Nachrichten > Einstellungen (unten in der Sidebar): E-Mail-Adresse der Shared Mailbox eintragen (z.B. office@weingut.at). Speichern – Seite lädt mit der Shared Mailbox. Voraussetzung: Exchange Send-As-Berechtigung auf die Shared Mailbox.' },
      { titel: 'E-Mails und CRM', inhalt: 'Öffnest du eine E-Mail in Nachrichten und der Absender ist ein hinterlegter Kontakt, wird die E-Mail automatisch dauerhaft im CRM gespeichert (Aktivitäten-Tab des Kontakts). Klick auf den Kontakt-Badge führt direkt zur Kontaktdetailansicht.' },
      { titel: 'Verbindung trennen & neu verbinden', inhalt: 'Unter Nachrichten > Einstellungen: "Trennen & neu verbinden" klicken, um die Microsoft-365-Verbindung neu herzustellen – z.B. wenn eine neue Berechtigung (wie der Kalenderzugriff) freigegeben wurde und die bestehende Verbindung sie noch nicht kennt.' },
    ],
  },
  {
    id: 'ki', icon: Bot, titel: 'Frag dein Weingut (KI)',
    abschnitte: [
      { titel: 'Abfrage stellen', inhalt: 'Unter "Frag dein Weingut" in der Hauptnavigation: Frage in natürlicher Sprache eingeben, z.B. "Welche Gastronomie-Kunden haben wir in Wien?" oder "Zeig mir Rotwein-Füllungen mit mehr als 200 Flaschen". Die KI (Claude Haiku) interpretiert die Frage und zeigt eine gefilterte Tabelle mit Zusammenfassung.' },
      { titel: 'Beispiel-Fragen', inhalt: 'Klick auf einen der Beispiel-Chips startet sofort die Abfrage. Weitere Beispiele: "Wer hat noch keinen Stammkunden-Status?", "Offene Pipeline-Einträge im Stadium Angebot", "Weinausbau mit mehr als 1000 Liter aktuell im Keller".' },
      { titel: 'Ertragshistorie je Grundstück abfragen', inhalt: 'Die KI kann jetzt auch Erntemengen je Grundstück (GST) über mehrere Jahrgänge auswerten, inkl. Ertrag in kg/ha. Beispiel-Fragen: "Wie war die Ertragshistorie für GST 123 in den letzten Jahren?" oder "Zeig mir den Ertrag pro Hektar je Ried für 2023".' },
      { titel: 'Abfrage-Limit', inhalt: 'Das KI-Modul hat ein monatliches Abfrage-Limit (Basic: 100, Standard: 200, Unlimited: unbegrenzt). Der aktuelle Verbrauch wird oben rechts angezeigt. Bei Limit-Erreichen bitte den Administrator kontaktieren.' },
    ],
  },
  {
    id: 'datenimport', icon: Upload, titel: 'Datenimport',
    abschnitte: [
      { titel: 'CSV-Datei vorbereiten', inhalt: 'Exportiere deine bestehenden Daten aus Excel oder einem anderen System als CSV (Trennzeichen: Semikolon oder Komma, Kodierung: UTF-8). Spaltenbezeichnungen können frei gewählt werden – du ordnest sie im nächsten Schritt zu.' },
      { titel: 'Import durchführen', inhalt: 'Unter Administration > Datenimport: Import-Typ wählen (Kontakte, Firmen oder Füllungen/Weinlager). CSV-Datei öffnen – eine Vorschau der ersten 3 Zeilen erscheint. Dann jede Spalte dem richtigen Feld zuordnen (Auto-Erkennung wenn Spaltenname passt). "Importieren" startet den Prozess.' },
      { titel: 'Pflichtfelder', inhalt: 'Kontakte: Nachname (Pflicht). Firmen: Name (Pflicht). Füllungen: Bezeichnung (Pflicht). Alle anderen Felder sind optional. Fehlermeldungen werden zeilengenau angezeigt – fehlerhafte Zeilen werden übersprungen, gültige werden importiert.' },
      { titel: 'Nach dem Import', inhalt: 'Importierte Kontakte starten als Leads, importierte Firmen ebenfalls. Füllungen werden mit dem angegebenen Lagerbestand angelegt. Alle Einträge können nach dem Import normal bearbeitet werden.' },
    ],
  },
  {
    id: 'administration', icon: Settings, titel: 'Administration',
    abschnitte: [
      { titel: 'Bio-Status setzen', inhalt: 'Unter Administration > Mandanten > [Betrieb] > Bewirtschaftung > Bio-Status wählst du zwischen Konventionell, KIP, Nachhaltig, Bio-EU und Biodynamisch. Der Status steuert die Warn-/Sperrlogik bei der Mittelwahl im Maßnahmenformular: bei Bio-EU/Biodynamisch wird ein nicht öko-zugelassenes Mittel gesperrt, bei KIP/Nachhaltig erscheint nur eine Warnung.' },
      { titel: 'bawb.at-Zugangsdaten hinterlegen', inhalt: 'Unter Administration > Mandanten > [Betrieb] > Tab "bawb.at" trägst du Kennung (Betriebsnummer) und Passwort für das LFRZ-Portal "Weinkontrolle Online" (bawb.at) ein. Ein Button öffnet das Portal direkt in einem neuen Tab – auch im Prüfnummern-Antrag verfügbar (siehe Kellerbuch).' },
    ],
  },
  {
    id: 'auswertungen', icon: BarChart3, titel: 'Auswertungen',
    abschnitte: [
      { titel: 'Behörden-Dokumente', inhalt: 'Unter Auswertungen > Behörden: AMA Erntemeldung (je Jahrgang), Weinbauliches Behandlungsprotokoll (je Saison), Cu-Bilanz Jahresbericht nach EU-Bio-VO 2018/848. Alle druckfertig mit Briefkopf.' },
      { titel: 'Datenexport', inhalt: 'Unter Controlling > Datenexport: Kontakte, Firmen, Lagerbestand und Verkaufshistorie als Excel-kompatible CSV herunterladen. BOM-kodiert für österreichische Excel-Einstellungen.' },
      { titel: 'BMD NTCS Export', inhalt: 'Unter Controlling > BMD NTCS: Verkaufsdaten im BMD-Buchungsformat exportieren. Zeitraum wählen, Exportdatei herunterladen und in BMD importieren.' },
      { titel: 'Kostenrechnung', inhalt: 'Unter Controlling > Kostenrechnung: Kostenstellen und Kostenarten verwalten, Kostenbuchungen erfassen. Auswertung nach Kostenstelle und Zeitraum. Kosteneinträge können auch automatisch aus der Kosten-Vorschlagsfunktion im Maßnahmenformular entstehen (siehe Rieden).' },
    ],
  },
]

export default function HandbuchPage() {
  const [aktiv, setAktiv] = useState(KAPITEL[0].id)
  const kapitel = KAPITEL.find(k => k.id === aktiv) ?? KAPITEL[0]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <span>Hilfe</span>
        <span>/</span>
        <span className="text-gray-700 font-medium">Benutzerhandbuch</span>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Benutzerhandbuch</h1>
        <p className="text-sm text-s112-muted mt-1">software:112 – Weinbau-Management · Version 2.3 · Stand Juli 2026</p>
      </div>

      <div className="flex gap-6">
        <div className="w-52 flex-shrink-0">
          <nav className="space-y-1">
            {KAPITEL.map(k => (
              <button key={k.id} onClick={() => setAktiv(k.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-left transition-colors
                  ${aktiv === k.id ? 'bg-s112-teal text-white' : 'text-gray-600 hover:bg-s112-bg hover:text-gray-900'}`}>
                <k.icon size={16} />
                {k.titel}
              </button>
            ))}
          </nav>
          <div className="mt-4 pt-4 border-t border-s112-border">
            <Link href="/hilfe/faq" className="flex items-center gap-2 px-3 py-2 text-sm text-s112-teal hover:underline">
              FAQ ansehen
            </Link>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-5">
            <kapitel.icon className="text-s112-teal" size={30} />
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
