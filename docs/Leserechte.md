# Leserechte je Profil (KAN-412)

Stand 13.11.2026 – **Entwurf zur Abnahme** (Schritt R1). Quelle der Zuordnung: `scripts/lesebereiche.json`; der Wächter `scripts/check-lesebereiche.js` lässt keine Tabelle ohne Bereich zu.

## Worum es geht

Bisher liest jedes aktive Mitglied alles im Betrieb – nur das Schreiben ist je Modul geregelt. Neu sind zwei feste Profile für Mitarbeiter, die auch das **Lesen** beschränken. Ohne Profil bleibt alles wie bisher (Betriebsleitung, Leser, bestehende Mitarbeiter).

| Profil | liest | schreibt (Module) |
| --- | --- | --- |
| **Vertrieb** | allgemein, crm, verkauf, lager, controlling, ki, betrieb | Warenwirtschaft, CRM (Auswertungen sehen) |
| **Extern** | allgemein, rieden, massnahmen | Rieden (nur Rieden und Maßnahmen sind lesbar) |

Entscheidungen Jörgen 11.11. und 13.11.2026 (Jira KAN-412, Fragen 1–8 jeweils A).

## Bereiche und ihre Tabellen

| Bereich | Inhalt | Vertrieb | Extern | Tabellen |
| --- | --- | :-: | :-: | --- |
| `allgemein` | Allgemeines (Profil, Betrieb, Kataloge, Benachrichtigungen) – jedes Mitglied | ja | ja | benachrichtigungen, benutzer_dashboard, kat_buchungsart, kat_erzeugnis, kat_farbe, kat_land, kat_qualitaetsstufe, katalog_mapping, module_flags, plattform_admins, profiles, rebsorten, release_notes, release_notes_gesehen, tenant_einstellungen, tenant_memberships, tenants, user_email_connections, wetter_stunden |
| `rieden` | Rieden, Lagen, Grundstücke, Reifemessungen | – | ja | grundstuecke, lagen, reifemessungen, weinbaugebiete_custom, weingarten, weingarten_rebsorten |
| `massnahmen` | Maßnahmen im Weingarten | – | ja | behandlung_grundstuecke, behandlungen |
| `betriebsmittel` | Betriebsmittel, Pflanzenschutz- und Düngemittel samt Lager, Einkauf und Preisen | – | – | betriebsmittel, betriebsmittel_lager_bewegungen, duengemittel, duengemittel_lager_bewegungen, pflanzenschutzmittel, psm_lager_bewegungen, psm_uebermittlungen |
| `lese` | Lese, Jahrgänge, Erntemeldung/AMA, Pressungen, Traubenverkauf | – | – | ama_erntemeldungen, ama_meldepositionen, ernte_gst_abgeschlossen, ernte_parzellen, lesen, pressung_behaelter, pressung_weingaerten, pressungen, traubenverkauf, weinjahrgaenge |
| `keller` | Kellerbuch: Gebinde, Chargen, Kellerarbeiten, Analysen, Prüfnummern, Produktion | – | – | behaelter, charge_herkunft, charge_umstufungen, dac_antrag, keller_behandlungen, keller_behandlungstypen, keller_freigaben, keller_umzuege, keller_verarbeitungen, keller_zugangskorrekturen, kellerbuch_abschluesse, kellerbuch_buchungen, kellermittel, kellermittel_buchungen, kellerplaene, kellerplan_positionen, lohnversektungen, produktion_eingaenge, produktionen, pruefnummer_chargen, pruefnummer_ereignisse, pruefnummernantraege, v_behaelter_fuellstand, verschneidung_quellen, verschneidungen, weinanalysen, weinausbau, weinausbau_weingaerten |
| `lager` | Füllungen und Warenlager (Flaschen, Artikel, E-Labels, Zukauf) | ja | – | elabel_umleitungen, elabel_zutaten, elabels, fuellung_bewegungen, fuellung_chargen, fuellung_etikettierungen, fuellungen, sonstige_artikel, sonstige_artikel_bewegungen, transportbescheinigungen, zukauf_posten |
| `verkauf` | Verkauf: Aufträge, Lieferscheine, Rechnungen, Zahlungen, Export | ja | – | auftraege, auftrag_lieferungen, auftrag_positionen, bestellung_positionen, bestellungen, export_dokumente, export_nachweise, export_registrierungen, exportauftraege, exportauftrag_positionen, lieferadressen, rabattgruppen, rechnungen, sumup_checkouts, sumup_terminals, sumup_transaktionen, verkauf_ki_begriffe, verkauf_positionen, verkaufsposten, zahlungen |
| `crm` | CRM: Kontakte, Firmen, Aktivitäten, Pipeline | ja | – | aktivitaet_dokumente, aktivitaeten, crm_dubletten_ignoriert, crm_freigaben, datenschutz_consents, email_lead_ignoriert, firmen, kontakt_firmen, kontakt_praeferenzen, kontakte, pipeline_eintraege, pipeline_verlauf |
| `ea` | E&A-Rechnung: Buchungen, Belege, Bank/Kassa, UVA, Anlagen | – | – | buchhaltung_export_protokoll, buchhaltung_kontenmapping, ea_anlagen, ea_belege, ea_dauerauftraege, ea_dauerauftrag_log, ea_kategorien, ea_monatsabschluss, ea_transaktionen, ea_uva, konten, konto_umbuchungen, svs_parameter |
| `controlling` | Controlling und Kostenrechnung | ja | – | kostenarten, kosteneintraege, kosteneintrag_behaelter, kosteneintrag_weingaerten, kostenstellen, saetze_massnahmen, zeiterfassung |
| `ki` | Assistent und Morgenbericht | ja | – | assistent_aktionen, assistent_korrekturen, assistent_nachrichten, assistent_unterhaltungen, morgenberichte |
| `betrieb` | Betriebsweite Listen: Fristen, Checklisten | ja | – | checklisten, checklisten_punkte, fristen |
| `verwaltung` | Verwaltung und Protokolle (Änderungsprotokoll, Systemereignisse, Abrechnung der Plattform) | – | – | bestandsprotokoll, meldung_abgaben, stripe_zahlungen_log, system_ereignisse, transaktionszaehler |

## Bitte besonders ansehen

1. **Füllungen gehören zum Bereich `lager`** (für Vertrieb lesbar), obwohl sie im Keller entstehen. Charge, Gebinde, Analysen und Prüfnummernanträge (`keller`) sieht Vertrieb nicht – die Prüfnummer steht an der Füllung selbst.
2. **Traubenverkauf liegt im Bereich `lese`** (für Vertrieb nicht lesbar), weil er an Jahrgang und Lese hängt. Soll Vertrieb Traubenverkäufe sehen, müsste er nach `verkauf`.
3. **Kostensätze der Maßnahmen** (`saetze_massnahmen`) liegen im Bereich `controlling` – Extern sieht sie nicht.
4. **Reifemessungen** liegen im Bereich `rieden` – Extern sieht und erfasst sie.
5. **Fristen und Checklisten** (`betrieb`) sieht Vertrieb, Extern nicht.
6. **Änderungsprotokoll** (`verwaltung`) sieht keines der beiden Profile – es enthält Daten aller Bereiche.
7. **Mitgliederliste, Betriebsdaten ohne Geheimnisse, Kataloge, Rebsorten** (`allgemein`) sieht jedes Mitglied.
8. **Kontakte:** Extern sieht keine Kontakte und Firmen (`crm`) – auch nicht den Namen eines Verpächters am Grundstück.

## Spalten-Fälle

Die Datenbank sperrt ganze Zeilen, keine einzelnen Spalten. Wo etwas Verbotenes in derselben Tabelle steht wie etwas Erlaubtes, braucht es je Fall eine Entscheidung:

| Tabelle | Profil | Spalten | Warum | Vorschlag |
| --- | --- | --- | --- | --- |
| `grundstuecke` | extern | rechtsverhaeltnis, einheitswert, einheitswert_bescheid, einheitswert_quelle, svs_zurechnung | Pacht- bzw. Eigentumsverhältnis und Einheitswert („Rieden ohne Pacht und Kosten“) | Tabelle für Extern lesbar lassen und die Spalten in Kauf nehmen – oder Grundstücke für Extern nur über eine Funktion mit den erlaubten Spalten |
| `pflanzenschutzmittel` | extern | preis_pro_einheit | Extern braucht Name und Zulassungsdaten für die Maßnahme, aber keine Preise | Bereich betriebsmittel bleibt für Extern gesperrt; Auswahlliste über eine Funktion ohne Preis |
| `duengemittel` | extern | preis_pro_einheit | wie Pflanzenschutzmittel | Auswahlliste über eine Funktion ohne Preis |
| `betriebsmittel` | extern | preis_pro_einheit, ea_kategorie_id | wie Pflanzenschutzmittel | Auswahlliste über eine Funktion ohne Preis |

**Empfehlung:** Betriebsmittel, Pflanzenschutz- und Düngemittel bleiben für Extern gesperrt; die Auswahlliste in der Maßnahme kommt über eine Funktion, die nur Name, Einheit und Zulassungsdaten liefert (R4). Bei den Grundstücken empfehle ich dasselbe Vorgehen (Funktion ohne Rechtsverhältnis und Einheitswert) – das ist sauberer als die Spalten in Kauf zu nehmen, kostet in R4 aber rund eine Stunde mehr.

## Stand der Umsetzung

| Schritt | Inhalt | Ticket |
| --- | --- | --- |
| R1 | Profil an der Mitgliedschaft, Funktionen, diese Liste – ohne Wirkung | KAN-412 |
| R2 | Sperr-Policies auf allen Tabellen, DB-Test-Matrix | KAN-454 |
| R3 | Funktionen, KI, Suche, Exporte, Dateien | KAN-455 |
| R4 | Navigation, Seiten, Dashboard | KAN-456 |
| R5 | Vergabe in der Benutzerverwaltung, E2E, Freigabe | KAN-457 |
