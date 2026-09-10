# Anlagen & AfA (Migration 200, 10.9.2026)

Übernommen aus kps-smart-buchhaltung (Welle 7 Anlagenverzeichnis, 7b Verknüpfung
Buchung ↔ Anlage, 8 AfA-Buchung und Anlagenspiegel), angepasst an das Datenmodell
von software:112 (`ea_transaktionen`, `ea_kategorien`, Mandanten-RLS) und das
hohenstein-Designsystem.

## Was es tut

- `/buchhaltung/anlagen`: Verzeichnis mit AfA des gewählten Jahres, Buchwert 31.12.,
  Summen (Anschaffungskosten, AfA, kumulierte AfA, Buchwert) und Hinweis auf
  Anlagenkäufe ohne Eintrag (Ausgaben in Kategorien der Kontenklasse 0, konto_nr < 1000).
- `/buchhaltung/anlagen/neu`, `/buchhaltung/anlagen/[id]`: Erfassen/Bearbeiten mit
  Live-AfA-Plan; Methoden linear, degressiv (max. 30 %, automatischer Wechsel auf
  linear), GWG (bis 1.000 € netto); Halbjahresregel; Restwert; Abgang mit Erlös.
- „AfA buchen“: je Anlage eine Ausgabe „Abschreibung (AfA)“ (Konto 7010, 0 % USt,
  ohne Zahlungskonto) per 31.12.; `ea_transaktionen.anlage_id` kennzeichnet sie,
  eindeutig je Anlage und Jahr. Zurücknehmen löscht diese Buchungen. Dezember-
  Sperre über `pruefe_ea_zeitraum_offen`. Bei Doppik (Migration 197) gesperrt –
  die AfA bucht der Steuerberater, das Verzeichnis dient als Beilage.
- `/buchhaltung/anlagen/spiegel?jahr=`: druckbarer Anlagenspiegel (A4 quer) mit
  Zwischensummen je Gruppe.
- Finanzübersicht: Karte „Anlagevermögen & Ergebnis nach AfA“ (Ergebnis + Anlagen-
  käufe − AfA), AfA-Buchungen werden aus dem zahlungswirksamen Ergebnis herausgehalten.
  SVS-Einkünfte-Vorschlag verwendet das Vorjahresergebnis nach AfA.
- Buchungsliste: Badge „AfA“ (Link zur Anlage), „Anlage anlegen“ für Anlagenkäufe
  ohne Eintrag; AfA-Buchungen werden dort nicht gelöscht (nur über Anlagen & AfA).
- Fristen-Ampel/Glocke: „AfA {Vorjahr} buchen“ bis 30.4., solange Positionen offen sind.
- BMD-Übergabe: Kontonummern vierstellig (660 → 0660), AfA über 7010.

## Rechenregeln (`src/lib/ea/anlagen.ts`)

Lineare AfA § 7 Abs. 1 EStG; Halbjahresregel § 7 Abs. 2 (Inbetriebnahme im 2. Halbjahr
bzw. Abgang im 1. Halbjahr → halbe Jahres-AfA); degressiv § 7 Abs. 1a; GWG § 13.
Die elf Testfälle der KPS-Vorlage (`anlagen.test.ts`) laufen gegen den Port unverändert
durch (Feldnamen übersetzt).

## Systemkategorien

`Anlagenkauf (aktivierungspflichtig)` (Konto 0660, 20 % VSt) und
`Abschreibung (AfA)` (Konto 7010, 0 %) als Systemkategorien (tenant_id NULL).
