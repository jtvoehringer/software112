# Leserechte je Profil (KAN-412)

Stand 13.11.2026 – Zuordnung von Jörgen abgenommen (13.11.2026), Sperre in der Datenbank seit Schritt R2 (KAN-454). Quelle der Zuordnung: `scripts/lesebereiche.json`; der Wächter `scripts/check-lesebereiche.js` lässt keine Tabelle ohne Bereich zu.

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
| `allgemein` | Allgemeines (Profil, Betrieb, Kataloge, Benachrichtigungen) – jedes Mitglied | ja | ja | benachrichtigungen, benutzer_dashboard, elabel_zutaten, kat_buchungsart, kat_erzeugnis, kat_farbe, kat_land, kat_qualitaetsstufe, katalog_mapping, module_flags, plattform_admins, profiles, rebsorten, release_notes, release_notes_gesehen, svs_parameter, tenant_einstellungen, tenant_memberships, tenants, user_email_connections, wetter_stunden |
| `rieden` | Rieden, Lagen, Grundstücke, Reifemessungen | – | ja | grundstuecke, lagen, reifemessungen, weinbaugebiete_custom, weingarten, weingarten_rebsorten |
| `massnahmen` | Maßnahmen im Weingarten | – | ja | behandlung_grundstuecke, behandlungen |
| `betriebsmittel` | Betriebsmittel, Pflanzenschutz- und Düngemittel samt Lager, Einkauf und Preisen | – | – | betriebsmittel, betriebsmittel_lager_bewegungen, duengemittel, duengemittel_lager_bewegungen, pflanzenschutzmittel, psm_lager_bewegungen, psm_uebermittlungen |
| `lese` | Lese, Jahrgänge, Erntemeldung/AMA, Pressungen, Traubenverkauf | – | – | ama_erntemeldungen, ama_meldepositionen, ernte_gst_abgeschlossen, ernte_parzellen, lesen, pressung_behaelter, pressung_weingaerten, pressungen, traubenverkauf, weinjahrgaenge |
| `keller` | Kellerbuch: Gebinde, Chargen, Kellerarbeiten, Analysen, Prüfnummern, Produktion | – | – | behaelter, charge_herkunft, charge_umstufungen, dac_antrag, keller_behandlungen, keller_behandlungstypen, keller_freigaben, keller_umzuege, keller_verarbeitungen, keller_zugangskorrekturen, kellerbuch_abschluesse, kellerbuch_buchungen, kellermittel, kellermittel_buchungen, kellerplaene, kellerplan_positionen, lohnversektungen, produktion_eingaenge, produktionen, pruefnummer_chargen, pruefnummer_ereignisse, pruefnummernantraege, v_behaelter_fuellstand, verschneidung_quellen, verschneidungen, weinanalysen, weinausbau, weinausbau_weingaerten |
| `lager` | Füllungen und Warenlager (Flaschen, Artikel, E-Labels, Zukauf) | ja | – | elabel_umleitungen, elabels, fuellung_bewegungen, fuellung_chargen, fuellung_etikettierungen, fuellungen, sonstige_artikel, sonstige_artikel_bewegungen, transportbescheinigungen, zukauf_posten |
| `verkauf` | Verkauf: Aufträge, Lieferscheine, Rechnungen, Zahlungen, Export | ja | – | auftraege, auftrag_lieferungen, auftrag_positionen, bestellung_positionen, bestellungen, export_dokumente, export_nachweise, export_registrierungen, exportauftraege, exportauftrag_positionen, lieferadressen, rabattgruppen, rechnungen, sumup_checkouts, sumup_terminals, sumup_transaktionen, verkauf_ki_begriffe, verkauf_positionen, verkaufsposten, zahlungen |
| `crm` | CRM: Kontakte, Firmen, Aktivitäten, Pipeline | ja | – | aktivitaet_dokumente, aktivitaeten, crm_dubletten_ignoriert, crm_freigaben, datenschutz_consents, email_lead_ignoriert, firmen, kontakt_firmen, kontakt_praeferenzen, kontakte, pipeline_eintraege, pipeline_verlauf |
| `ea` | E&A-Rechnung: Buchungen, Belege, Bank/Kassa, UVA, Anlagen; Rechtsverhältnis und Einheitswert der Grundstücke | – | – | buchhaltung_export_protokoll, buchhaltung_kontenmapping, grundstueck_recht, ea_anlagen, ea_belege, ea_dauerauftraege, ea_dauerauftrag_log, ea_kategorien, ea_monatsabschluss, ea_transaktionen, ea_uva, konten, konto_umbuchungen |
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
| `pflanzenschutzmittel` | extern | preis_pro_einheit | Extern braucht Name und Zulassungsdaten für die Maßnahme, aber keine Preise | Bereich betriebsmittel bleibt für Extern gesperrt; Auswahlliste über eine Funktion ohne Preis |
| `duengemittel` | extern | preis_pro_einheit | wie Pflanzenschutzmittel | Auswahlliste über eine Funktion ohne Preis |
| `betriebsmittel` | extern | preis_pro_einheit, ea_kategorie_id | wie Pflanzenschutzmittel | Auswahlliste über eine Funktion ohne Preis |

**Empfehlung:** Betriebsmittel, Pflanzenschutz- und Düngemittel bleiben für Extern gesperrt; die Auswahlliste in der Maßnahme kommt über eine Funktion, die nur Name, Einheit und Zulassungsdaten liefert (R4). Bei den Grundstücken empfehle ich dasselbe Vorgehen (Funktion ohne Rechtsverhältnis und Einheitswert) – das ist sauberer als die Spalten in Kauf zu nehmen, kostet in R4 aber rund eine Stunde mehr.

## So sperrt die Datenbank (R2, KAN-454)

Jede Tabelle außerhalb von `allgemein` hat die RESTRICTIVE-Policy `lesebereich` (`TO authenticated`; seit KAN-459, Migration `kan459a_lesebereich_schreiben`, für alle Befehle: derselbe Ausdruck als `USING` und `WITH CHECK`). Sie kommt in drei Formen, die `scripts/lesebereich-sql.js` aus der Liste ableitet:

| Form | Tabellen | Bedingung |
| --- | --- | --- |
| Betrieb | 106 Tabellen mit `tenant_id` | der Betrieb der Zeile ist für den Benutzer im Bereich der Tabelle nicht gesperrt (`s112_lesegesperrte_tenants('<bereich>')`) |
| Kind | 17 Tabellen ohne `tenant_id` (`kinder` in der Liste) | die Elternzeile ist sichtbar – sie trägt die Sperre |
| Freigabe | `keller_freigaben`, `crm_freigaben` | keiner der beiden Betriebe der Freigabe ist gesperrt |

- **Ohne Policy** bleiben der Bereich `allgemein` und die Sichten `charge_herkunft`, `v_behaelter_fuellstand` (security_invoker – es gelten die Policies der Tabellen darunter).
- **Gemeinschaften:** Wer einen Partnerbetrieb nur über einen Betrieb erreicht, in dem der Bereich für ihn gesperrt ist, sieht auch die Daten des Partners nicht.
- **Nach `allgemein` verschoben** (gegenüber dem ersten Entwurf): `elabel_zutaten` (globaler Katalog ohne Betrieb) und `svs_parameter` (globale Beitragssätze ohne Betrieb) – beide enthalten keine Betriebsdaten.
- **Wirkung heute:** keine. Noch hat niemand ein Profil und die App vergibt keines (R5); für Mitglieder ohne Profil ist die Menge der gesperrten Betriebe leer.
- **Nicht erfasst:** Schreiben (regeln die Schreibmodule), Service-Role und SECURITY-DEFINER-Funktionen – siehe nächster Abschnitt (R3, KAN-455).
- **Neue Tabelle:** Bereich in `scripts/lesebereiche.json` eintragen (ohne `tenant_id` zusätzlich unter `kinder`) und die Policy `lesebereich` in derselben Migration anlegen. DB-Test 02 prüft jede Tabelle im Katalog und liest als „Extern“ und „Vertrieb“ gegen einen Mitarbeiter ohne Profil.
- **Schreiben nur mit Leserecht (KAN-459):** Die Schreibmodule eines Profils reichen in Tabellen außerhalb seiner Lesebereiche („Extern“ mit Modul Rieden: 25 Tabellen, u. a. `grundstueck_recht`, Mittel samt Lager, Lese, Kostenstellen; „Vertrieb“: `keller_umzuege`, `traubenverkauf`). Solange die Policy nur für SELECT galt, konnte ein Profil dort über die Datenschnittstelle anlegen und – ohne Filter, also ohne eine Spalte zu lesen – ändern und löschen. Deshalb `FOR ALL`, auch auf `storage.objects`. DB-Test `07_lesebereich_schreiben`. Schreibende SECURITY-DEFINER-Funktionen laufen an den Policies vorbei: Migration `kan459b_schreibwege_lesebereich` ergänzt die Leseprüfung in `s112_privat_bloecke` (crm), `setze_kontobewegung_abgeglichen` (ea), `s112_fuellung_nachtragen` (keller) und `s112_storniert_loeschen` (Bereich der Tabelle). Bewusst ohne bleiben `s112_zukauf_buchen`, `s112_zahlung_stornieren`, `s112_kontakt_personendaten_loeschen` und `get_next_transaktionsnr` (Folgebuchung bzw. Nummernkreis). Neue Storno-Tabelle in `s112_storniert_loeschen` → dort auch den Bereich eintragen (Test `kan459-lesebereich-schreiben` vergleicht mit der Liste).

## Lesewege an den Policies vorbei (R3, KAN-455)

**Datenbank (Migration `kan412c_lesewege`):**

| Weg | Lösung |
| --- | --- |
| Lesende Funktionen mit SECURITY DEFINER | Leseprüfung am Anfang: `berechne_ea_uva` (ea), `journal_konsistenz` (keller), `s112_stammdaten_bezuege` (Bereich der Tabelle), `ki_readonly_query` (ki) → Fehler 42501 mit HINT `lesebereich`; `crm_dubletten`, `crm_filterwerte`, `crm_zaehler`, `lade_crmgemeinschaft` (crm), `lade_behaelter`, `lade_kellergemeinschaft` (keller) → 0 Zeilen |
| Schreibende Funktionen, die ein Profil über sein Schreibmodul erreicht | „Extern“ (Modul Rieden): Erntemeldung/AMA und Pressung (lese), Einkauf, Storno und Übermittlung von Mitteln (betriebsmittel), Storno des Traubenverkaufs samt Rechnung (verkauf). „Vertrieb“ (Modul Warenwirtschaft): Schwund und Journal-Abgleich (keller) |
| KI-Abfrage | Bereich `ki` („Extern“ gesperrt); die Abfrage selbst läuft als Rolle `ki_abfrage` unter den Policies – „Vertrieb“ bekommt aus gesperrten Tabellen 0 Zeilen |
| Storage | Sperr-Policy `lesebereich` auf `storage.objects`: `analysen` = keller, `ea-belege` = ea, `export-nachweise` = verkauf, `aktivitaet-dokumente` = crm, `fuellung-bilder` und `etiketten` = lager, `dokumente` = betrieb; `mandant-logos` bleibt öffentlich |

- **Bewusst offen:** `pruefe_ea_zeitraum_offen` (liefert nur „offen/gesperrt“ samt Grund; der Verkauf braucht es), die Rechte-Helfer und die Nummernkreise.
- **Neue Funktion** mit `p_tenant_id` und SECURITY DEFINER: nach der Zugriffsprüfung `PERFORM public.s112_pruefe_lesen(p_tenant_id, '<bereich>');`, wenn sie Daten eines Bereichs liefert oder ein Profil sie über sein Schreibmodul erreicht – und in DB-Test 07 einstufen (`c_soll` bzw. `c_frei`); ohne Einstufung ist der Test rot.
- **Grenze des Tests:** Die sechs SQL-Funktionen mit eigener Mitgliedsprüfung lassen die Sitzung „postgres“ durch und sind im Testrahmen nur statisch geprüft (die Bedingung steht im Zweig der Mitgliedschaft).
**API-Routen (`scripts/lesebereich-routen.json`, Wächter `scripts/check-lesebereich-routen.js`):**

Jede der 91 Routen unter `src/app/api` hat einen Bereich oder eine begründete Ausnahme. 65 Routen prüfen direkt nach `getCurrentMembership()` mit `leseKonflikt(membership, '<bereich>')` (`src/lib/api/lesebereich.ts`, HTTP 403) – unabhängig davon, ob sie per Service-Role oder mit dem Benutzer-Client laden.

| Bereich | Routen |
| --- | --- |
| crm | `crm/*`, Postfach (`nachrichten/*`, `email/*`, `m365/*`, `auth/m365`), Besuchsplanung, Visitkarte, Export Kontakte/Firmen |
| verkauf | `weinhandel/*` (Angebot, Auftrag, Verkauf, Rechnung), `weinexport/*`, SumUp-Checkout, Verkaufs-Stammdaten, Umsatz-Reports, Export Verkauf |
| lager | Füllungsbilder und Datenblatt, Zukauf-Stammdaten, Export Lager und Datenblätter |
| ea | `buchhaltung/*`, BMD-Export |
| keller | Export Journal, Report Weinbücher; Assistent (zusätzlich ki) |
| ki / controlling / rieden / betriebsmittel | KI-Abfrage / Kostenrechnung / Export Rieden-Geodaten / PSM-Übermittlung |

- **Ausnahmen (26):** Webhooks, Cron und OAuth-Rückkehr (ohne Benutzersitzung), Routen im Bereich `allgemein` (Profil, Betrieb, Support, Benachrichtigungen, Release-Notes) sowie globale Suche und Import – beide laden nur mit dem Benutzer-Client, die Policies filtern.
- **Service-Role außerhalb von `/api`** (Dashboard, CRM, Buchhaltung, Betrieb, Benutzer, Morgenbericht, E-Mail, Newsletter): durchgesehen am 13.11.2026 – dort werden nur Tabellen des Bereichs `allgemein` (Betriebseinstellungen, Mitgliedschaften, Postfach-Verbindungen) bzw. im Cron ohne Benutzer gelesen; kein Befund.
- **Neue Route:** Eintrag in `scripts/lesebereich-routen.json` und Aufruf von `leseKonflikt` – der Wächter (prebuild) meldet beides.
**Behördenmeldungen (`src/lib/behoerden/bereich.ts`):** `zugriffsFehler` prüft nach den Modulen den Lesebereich der Meldung – für die CSV-Route, die Übersichten („Meldungen & Fristen“, Tab „Behörden“) und die BKI-Schnittstelle.

| Gruppe | Bereich | abweichend je Meldung |
| --- | --- | --- |
| Ernte & Lese | lese | Bestandsmeldung, BSM, BSM-Kontrolljournal → keller |
| Pflanzenschutz & Düngung | betriebsmittel | – |
| Weinverkehr & Export | verkauf | Transportbescheinigung(en) → lager; Prüfnummernantrag, DAC-Anträge → keller |
| Kellerbuch | keller | Änderungsprotokoll → verwaltung |
| Buchhaltung & Steuer | ea | – |
| Flächen & Kataster | rieden | – |

- „Extern“ bekommt damit nur das Flächenverzeichnis, „Vertrieb“ Transportbescheinigungen, Exportaufträge, EMCS-Datenblatt und die Zusammenfassende Meldung.
- **Neue Meldung:** Bereich der Gruppe gilt; liegt sie fachlich woanders, `bereich: '<bereich>'` am Katalog-Eintrag. Neue Gruppe → `GRUPPEN_BEREICH`.

**Benachrichtigungen:** Aufgaben, Termine und Erwähnungen aus dem CRM gehen (App und Mail) nur an Empfänger, die den Bereich `crm` lesen dürfen (`bereich` am Ereignis, `sendeBenachrichtigung`). Den Morgenbericht gibt es nur als Tabelle im Bereich `ki` – ihn sperrt die Policy, einen Mailversand gibt es nicht.

## Oberfläche (R4, KAN-456)

**Eine Liste für alles:** `src/lib/navigation/seitenBereich.ts` ordnet jeder Seite ihren Lesebereich zu (längster Pfad gewinnt).

- **Navigation und Befehlspalette:** `buildNav` blendet Einträge gesperrter Bereiche aus; die fest eingebauten Aktionen der Befehlspalette („Neuer Verkauf“ …) ebenso. Die globale Suche filtern die Policies.
- **Seiten-Guards:** `await requireLesen('<bereich>')` (`src/lib/auth/lesen.ts`) im `layout.tsx` eines Verzeichnisses bzw. in der Seite selbst, wenn das Verzeichnis gemischt ist (`/weinhandel`, `/behandlungen`, `/weingarten`, `/reports`). Wer eine gesperrte Seite direkt aufruft, landet auf der Übersicht mit dem Hinweis „Für die aufgerufene Seite fehlt dir das Leserecht“.
- **Wächter** `scripts/check-lesebereich-seiten.js` (prebuild; `--liste` zeigt jede Seite mit Bereich und Ort des Guards): Seite ohne Regel, ohne Guard oder mit anderem Bereich als die Regel.
- **Was die Profile sehen:** „Extern“ – Übersicht, Sicht „Weingarten & Ernte“, Rieden, Rebsorten prüfen, Maßnahmen, dazu Hilfe und Profil. „Vertrieb“ – Übersicht, Sichten Verkauf und Fristen, Warenwirtschaft samt Zukauf und Exportaufträgen, CRM samt Postfach, Controlling, Frag dein Weingut.
- **Morgenbericht:** für beide Profile gesperrt – er fasst Befunde aller Bereiche zusammen. Seite und Tabelle `morgenberichte` liegen im Bereich `verwaltung` (Tabelle seit Migration `kan412d_extern_mittel`).
- **Dashboard:** ein Widget der Übersicht gibt es nur mit Leserecht auf alle seine Datenquellen (`QUELLEN_BEREICH` in `src/lib/dashboard/widgets.ts`); Schnellaktionen und Schnellzugriff nur in lesbare Bereiche.
- **Maßnahmen für „Extern“ (Migration `kan412d_extern_mittel`):** „Extern“ liest die Mittel-Tabellen nicht (Lager, Einkauf, Preise). Die Funktionen `s112_psm_ohne_preis`, `s112_duengemittel_ohne_preis` und `s112_betriebsmittel_ohne_preis` liefern die Mittel des Betriebs (und des Katalogs) mit allen Spalten außer dem Preis – für Mitglieder mit Lesebereich `massnahmen`. `profilClient()` (`src/lib/auth/profilClient.ts`) lenkt in Formular, Bearbeiten und der Server Action `.from('<mittel-tabelle>')` für solche Mitglieder auf die Funktion; `psmNachtragen()` ergänzt eingebettete Mittel in Liste und Bearbeiten. Der Lagerverbrauch ergibt sich wie bisher aus den Maßnahmen (keine eigene Buchung); Kosten erfasst „Extern“ nicht (Feld nur mit Lesebereich `controlling`). Neue Spalte in einer Mittel-Tabelle → Funktion nachziehen (DB-Test `07_extern_massnahme` und Test `kan456-extern-mittel` melden es).
- **Neue Seite:** in einem bestehenden Verzeichnis gilt dessen Guard; in einem neuen Verzeichnis Regel eintragen und Guard anlegen – der Wächter meldet beides.
- **Grundstücke ohne Pacht und Einheitswert (KAN-458):** Rechtsverhältnis, Einheitswert samt Bescheid und Quelle und die SVS-Zurechnung liegen in `grundstueck_recht` (höchstens eine Zeile je Grundstück, Bereich `ea`). `grundstuecke` bleibt im Bereich `rieden` und für „Extern“ lesbar – auch eingebettet in seine Maßnahmen. Lesen: Einbettung `RECHT_EINBETTUNG` + `mitRecht()`, Schreiben: `speichereGrundstueckRecht()` (`src/lib/wein/grundstueckRecht.ts`). Das Flächenverzeichnis enthält das Rechtsverhältnis und liegt deshalb im Bereich `ea` – „Extern“ exportiert damit keine Behördenmeldung mehr. Seit Migration `kan458b_grundstuecke_ohne_recht` (14.11.2026) gibt es die fünf Spalten in `grundstuecke` nicht mehr; die Zeile in `grundstueck_recht` entsteht erst beim Speichern (ohne Zeile: keine Angabe, SVS-Zurechnung „eigen“). Die Demo-Funktionen schreiben das Rechtsverhältnis in die neue Tabelle.
- **„Vertrieb“ ohne Kellerbuch und Lese (KAN-456 PR 4):** Aus gesperrten Bereichen kommen 0 Zeilen, ohne Fehler – eine Prüfung, die solche Daten braucht, fiele still falsch aus (Zukauf von Trauben ändern/stornieren trotz Pressung, Storno eines Verkaufs mit Trauben ohne den Traubenverkauf, Zukaufsgrenze mit 0 ha, E-Label mit leerem Zutaten-Vorschlag). Regel in `src/lib/auth/profilGrenzen.ts`: Was Daten eines Bereichs braucht, gibt es nur mit Leserecht dort – in der Oberfläche ausgeblendet **und** in der Server Action abgelehnt (dieselbe Funktion). „Vertrieb“ verkauft Flaschen und Artikel (kein Tank, keine Trauben), kauft Flaschen zu (kein Wein/Most/Trauben/Maische), legt keine Füllung an, trägt weder Charge noch Prüfnummer nach und sieht das E-Label nur an. Formulare bekommen die erlaubten Typen bzw. Arten vom Server (`typen_erlaubt`, `arten_erlaubt`).
- **Durchsicht je Profil:** `e2e/profile.spec.ts` (Playwright-Projekte `extern` und `vertrieb`, Testbenutzer im Staging-Testbetrieb): jede Seite der Navigation, gesperrte Seiten, Gegenprobe über die Datenschnittstelle (0 Zeilen, Anlegen abgelehnt).

## Stand der Umsetzung

| Schritt | Inhalt | Ticket |
| --- | --- | --- |
| R1 | Profil an der Mitgliedschaft, Funktionen, diese Liste – ohne Wirkung (erledigt) | KAN-412 |
| R2 | Sperr-Policies auf allen Tabellen, DB-Test-Matrix (umgesetzt) | KAN-454 |
| R3 | Funktionen, KI, Suche, Exporte, Dateien (umgesetzt) | KAN-455 |
| R4 | Navigation, Seiten, Dashboard (Navigation und Guards umgesetzt) | KAN-456 |
| R5 | Vergabe in der Benutzerverwaltung, E2E, Freigabe | KAN-457 |
