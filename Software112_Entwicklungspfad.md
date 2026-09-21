# Software:112 – Entwicklungspfad

**Stand:** Mai 2026 | **Autor:** IC&P Consultants e.U.  
**Projektstart:** Dienstag, 27. Mai 2026

---

## Phase 0 – Fundament & Setup ⬅️ Start Dienstag

**Ziel:** Projekt-Infrastruktur steht, bevor die erste Zeile Produktivcode geschrieben wird.

| Aufgabe | Details |
|---|---|
| Anforderungen & Scope klären | Was löst Software:112? Zielgruppe, Kernfunktionen, Abgrenzung |
| Datenmodell & Wireframes | Kernentitäten definieren, UI-Flows skizzieren |
| Supabase-Projekt anlegen | DB, Auth, RLS-Grundstruktur, Umgebungsvariablen |
| **Vercel-Projekt anlegen** | **Deployment-Pipeline von Anfang an aktiv — nicht erst später!** |
| Next.js-Scaffold aufsetzen | App Router, TypeScript, Tailwind, Supabase-Client |
| Stripe-Integration vorbereiten | Stripe-Account, API-Keys, Webhook-Endpoint anlegen |
| CI/CD: GitHub → Vercel | Automatisches Deploy bei Push auf `main` |
| Umgebungsvariablen | `.env.local` + Vercel-Dashboard komplett befüllen |

> **Warum Vercel in Phase 0?**  
> Bei KPS Smart Buchhaltung wurde Vercel erst spät eingeplant — das kostet Zeit bei der Konfiguration (Umgebungsvariablen, Cron-Jobs, Domain). Software:112 startet von Anfang an deployed, sodass jede Phase sofort in der echten Umgebung testbar ist.

---

## Phase 1 – MVP Core

Kernfunktionen des Produkts (je nach Scope-Definition in Phase 0).

- Authentifizierung (Rollen je nach Bedarf)
- Hauptdatenerfassung (produktspezifisch)
- Basis-Dashboard
- Stripe-Zahlungsintegration (Kreditkarte / SEPA)

---

## Phase 2 – Automatische Rechnungsstellung (Daueraufträge)

**⚠️ Bereits in Phase 2 einplanen — nicht als Nachgedanke!**

Das Dauerauftrag-Modul aus KPS Smart Buchhaltung wird als **shared library** wiederverwendet:

```
src/lib/dauerauftraege/          ← aus KPS Smart Buchhaltung übernehmen
  ├── verarbeitung.ts
  ├── faelligkeit.ts
  └── types.ts
```

Komponenten:
- DB-Tabellen `dauerauftraege` + `dauerauftrag_log` (identisches Schema)
- Vercel Cron Job `/api/cron/dauerauftraege` (täglich 05:00 UTC)
- UI: Dauerauftrag-Konfiguration je Mandant/Kunde
- IC&P Eigenrechnung (monatliche Honorarrechnung automatisch)

**Aufwand:** ~0,5 Tage (weil shared lib bereits fertig) vs. 5 Tage bei Neuentwicklung.

---

## Phase 3 – Polish & Scale

- Mobile UX
- Erweiterte Auswertungen
- DATEV-Export (erst bei Markteintritt DE; BMD-Übergabe ist seit 4.9.2026 umgesetzt)
- ✅ Anlagenverzeichnis, AfA-Buchung und Anlagenspiegel (10.9.2026, aus kps-smart-buchhaltung Welle 7/8 übernommen – Migration 200)
- ✅ Morgenbericht und Wetteranbindung (beschlossen Jour fixe 9.9.2026, ausgeliefert 10.9.2026 – Migration 201, docs/Morgenbericht_Wetter.md; ersetzt die Karte „Datenfluss“ auf der Übersicht)
- ✅ E-Mail: Unterordner, Allen antworten, Original zitiert (Graph createReply), ältere Nachrichten nachladen, tägliche CRM-Spiegelung (Migration 205); Autorefresh; Performance-Paket (Migration 206 RLS/Indizes, Link-Prefetch aus, paralleles alle()) – docs/Performance_2026-09-17.md (17.9.2026)
- ✅ Performance-Paket 2: Kontakte/Firmen serverseitig gefiltert & seitenweise (lib/crm/liste.ts, RPC crm_zaehler Migration 207, URL-Filter), Layout-Cache (lib/tenant/kopf.ts), Auth pro Request dedupliziert, Policies zusammengelegt (Migration 208), loading.tsx je Bereich; E-Mail: eingebettete Bilder + Anhänge-Download (17.9.2026). Kundenauswahl im Verkauf/Zukauf serverseitig (PartnerSuche); E-Mail-Thread-Verlauf repariert. Offen: Vercel Pro/Supabase Small bei mehr Betrieben
- ✅ Kundennummern für Mandanten (Migration 209): S112-AT-<PLZ-Kreis><lfd. Nr.>, automatische Vergabe bei PLZ-Eingabe, unveränderlich; Anzeige Administration › Mandanten, Mein Betrieb, Abo; Stripe-Metadaten (17.9.2026). Offen: Nummernkreise für DE/CH/IT
- ✅ E-Mail: Upsert der E-Mail-Aktivitäten repariert (Migration 212, voller Unique-Index tenant_id+email_id statt partiellem); Nachrichten-Rahmen misst die sichtbare Höhe (MacBook/Firefox: „Ältere Nachrichten laden“ war unter dem Fensterrand) (18.9.2026)
- ✅ CRM/E-Mail: mehrere Adressen je Kontakt/Firma (Migration 211, Standard + weitere), Absender-Erkennung über alle Adressen; Hinweis „bereits unter anderer Adresse im CRM“ mit 1-Klick-Hinzufügen; Spiegelung repariert (lief im Cron-Timeout nie), jetzt vor dem Morgenbericht mit festem Budget + nebenbei beim Öffnen von Nachrichten (18.9.2026)
- ✅ Betriebsmittel-Lager: Buchungen scheiterten still (Migration 219: sechs Policies mit „tenant_id = (SELECT … LIMIT 1)“ nahmen bei Mehrfach-Mitgliedschaft einen zufälligen Betrieb – jetzt s112_meine_tenants()); Lager-Actions werfen DB-Fehler und die Formulare zeigen sie; /api/verkauf-stammdaten und AMA-Auswertung filterten ernte_parzellen/pressung_* nach nicht vorhandener tenant_id (seit 92ad74b) – jetzt über Jahrgang/Pressung (!inner) (20.9.2026)
- ✅ Code-Sweep nach den Vorfällen der Woche: scripts/check-schema.js prüft bei jedem Build alle Supabase-Aufrufe gegen das exportierte DB-Schema (scripts/schema.json, Export-SQL scripts/schema.sql) – unbekannte Tabellen/Spalten in Filtern, order, select; tf() auf Tabellen ohne tenant_id; .eq(x, null); .limit(>1000); Schreibaufrufe ohne error-Auswertung. Funde behoben: Weinexport-Detail und AMA-Auswertung (tenant_id auf Kind-Tabellen), E-Mail-Poll (Dedupe über email_id statt Notiz-Text), Export-Dokumente (rechnung_iban/bic statt nicht vorhandener Spalten), Lead-Vorschlag und Morgenbericht (alle() statt limit), 132 stille Schreibaufrufe in 41 Dateien werfen jetzt bzw. loggen; Zombie-Seiten weinhandel/preisliste (Modul am 7.8. entfernt, durch cba7dd9 wieder eingeschleust) samt KI-Referenzen entfernt. DB: plpgsql_check (Migration 220) meldet keine Fehler; Policy-Audit: gesperrte Mitgliedschaft (aktiv = false) sperrt jetzt alle 77 Tabellen mit tenant_id über eine restriktive Policy (Migration 221, vorher nur ~30 Tabellen) (20.9.2026)
- ✅ Fehlerweg und Systembericht: Next.js maskiert in Produktion jede aus einer Server-Action geworfene Meldung („An error occurred in the Server Components render …“) – alle 326 Throws in Actions werfen jetzt AktionsFehler (lib/fehler.ts, Meldung im durchgereichten digest), 43 Catch-Stellen im Client zeigen sie über fehlerText(); src/instrumentation.ts (onRequestError) protokolliert jeden nicht gefangenen Serverfehler, (dashboard)/error.tsx zeigt eine deutsche Fehlerseite und meldet Browserfehler (/api/system/ereignis), 43 stille DB-Fehler in Routen/Libs melden ins Protokoll; Tabelle system_ereignisse (Migration 222, nur Service-Role, 30 Tage); /admin/system: Systembericht (24 h / 7 / 30 Tage, gruppiert nach Meldung, Cron-Läufe mit Details) + Smoke-Test der Zugriffsrechte (Migration 223, s112_smoke_test: je Rolle Lesen, Schreiben je Modul, Mandantentrennung, Sperre – alles zurückgerollt); täglicher Cron schreibt sein Ergebnis ins Protokoll; Morgenbericht der Sandbox meldet Fehler der letzten 24 h aller Betriebe (20.9.2026)
- ✅ CRM E-Mail-Hygiene: lib/crm/email.ts prüft und bereinigt E-Mail-Felder beim Speichern von Kontakten/Firmen, beim „E-Mail hinzufügen“, beim Lead aus E-Mail und im CSV-Import – Anzeigenamen („Name <adresse>“) werden herausgelöst, mehrere Adressen im Standardfeld auf Standard + weitere aufgeteilt, ungültige Eingaben mit klarer Meldung abgelehnt (Import: in die Notiz). Bestand Gebeshuber bereinigt (48 Datensätze: aufgeteilt, korrigiert oder mit Notiz geleert); Gerhard Dorner und Lindenhof Lentsch aus der DKB-Konditionenliste angelegt (20.9.2026)
- ✅ Weinart-Sperre beim Umziehen (Musterhof: Zweigelt Reserve ließ sich in den Veltliner-Tank umziehen): die Rot/Weiß-Regel griff nur im Verschneiden-Schritt, der Umzug war da schon gebucht, und die beim Umzug neu angelegte Charge kam ohne Weinart/Herkunft („unbekannt“), womit auch die Verschneiden-Sperre ins Leere lief. Jetzt lib/keller/weinart.ts (Rot+Weiß und Weiß+Rosé unvereinbar, Rot+Rosé zulässig, Chargen ohne Weinart über rebsorten.farbe eingeordnet): Prüfung im Umziehen VOR der ersten Buchung (Quellen untereinander und gegen Inhalt jedes Ziel-Gebindes), Vorschau mit gesperrtem Speichern in beiden Umzieh-Formularen, Verschneiden-Guard mit derselben Logik; neue Chargen übernehmen weinart und herkunft_code (21.9.2026)
- ✅ CRM-Listen: Suchfeld repariert – Next baut die Seite bei jeder ?q=-Änderung neu auf (Suchparameter im Segment-Key), Text/Fokus/Cursor sprangen zurück; Tippstand lebt jetzt in lib/crm/listenSuche.ts außerhalb des Bausteins und wird nach dem Neuaufbau wiederhergestellt (20.9.2026)
- ✅ Release Notes: Seite System › Neuerungen (alle Notes nachlesbar, Link im Einstiegsfenster), Administration: „Erneut anzeigen“ setzt Gesehen-Vermerke zurück, Zähler „n× gesehen“ (19.9.2026)
- ✅ Benutzerkonzept (Migration 218, Beschluss Mgmt-Team 19.9.): Super-Admin / Betriebs-Manager / Mitarbeiter / Leser; Mitarbeiter mit Modulmatrix (rieden, kellerbuch, warenwirtschaft, crm, ea, auswertungen) in tenant_memberships.schreibmodule, Vorlagen „Rieden & Keller“ und „Vertrieb“; DB-seitig s112_darf_schreiben + restriktive modul_*-Policies auf 82 Tabellen (schließt auch 22 Tabellen, in die bisher jedes Mitglied inkl. Leser schreiben konnte); canWrite(role, modul) an allen Aufrufstellen, Controlling/KI nur mit „auswertungen“ (Navigation + Layout-Guards + API) (19.9.2026)
- ✅ Demo-Reset Musterhof repariert (Migrationen 215–217: Spalten seit 187 umbenannt, ID-Kollision im Herbst-Block seit 1.9.); Nachrichten: E-Mail-Aktivität mit .is(null) statt .eq(null) (uuid-Fehler im Postgres-Log); Release Note 2.3.0 „Neues im September 2026“ (19.9.2026)
- ✅ CRM › Dubletten (Migration 213): Liste aller Kontakte mit gleicher E-Mail/gleichem Namen (RPC crm_dubletten, serverseitig über den gesamten Bestand), Zusammenführen per RPC kontakte_zusammenfuehren (Verweise dynamisch über alle Fremdschlüssel umgehängt, Felder ergänzt, E-Mails gesammelt, Rest deaktiviert), „Keine Dublette“-Markierung; Morgenbericht verlinkt dorthin. Einstufung sicher/prüfen/unwahrscheinlich (Migration 214, fuzzystrmatch/Levenshtein, Namensvarianten, Adresse/Telefon/Domain), Morgenbericht zählt nur sicher+prüfen, Sammel-Markierung für unwahrscheinliche (18.9.2026)
- ✅ Frag dein Weingut: Ergebniszeilen anklickbar (KI liefert <tabelle>_id-Spalten, UI blendet sie aus und verlinkt Detailseiten; Chips für weitere Ziele) (18.9.2026)
- ✅ Ladebalken + Tab-Spinner bei jedem Seitenwechsel (Link.tsx/NavigationsBalken.tsx); Controlling › Auswertungen parallelisiert, Filterwerte per RPC (Migration 210) (17.9.2026)
- ✅ Kellergemeinschaft: Gebinde von n Mandanten nutzbar, Inhalte mandantengetrennt („belegt · Betrieb · Liter“), Sperre bei fremder Belegung (DB-Trigger), Administration › Kellergemeinschaft; 173 Gebinde Gebeshuber aus DKB importiert (16.9.2026 – Migration 203, docs/Kellergemeinschaft.md)
- ✅ E-Mail → Lead: Absender-Erkennung (Kontakt/Firma/Lead, Firmendomain) unter Nachrichten und Dialog „Soll ein Lead angelegt werden?“ mit KI-Vorbelegung aus der Signatur wie beim Visitenkarten-Scan (15.9.2026 – Migration 202, docs/Email_Lead.md)
- Weitere Zahlungsmethoden

---

## Ideen für spätere Phasen (noch nicht beschlossen)

### Flugauftrag für Agrardrohnen (Pflanzenschutz aus der Luft)

Stand 4.9.2026, Entscheidung im Jour fixe am 9.9.2026. Kein To-do.

**Verortung:** Premium-Paket, zusätzlich einmalige Einrichtungsgebühr je Betrieb
(Einmessen der Rieden, Hindernisse, Abstimmung mit dem Drohnen-Dienstleister).

**Idee:** software:112 steuert keine Drohne, sondern erzeugt aus den vorhandenen
Daten den Flugauftrag für eine Agrardrohne (Lohnunternehmer) und nimmt das
Flugprotokoll als Behandlung zurück.

- Datenbasis vorhanden: eAMA-Polygone je Weingarten und Grundstück (bei
  Gebeshuber 52 Weingärten / 234 Grundstücke), Zentrum, Fläche, Feldstück,
  Kennzeichen „spritzbar“; Behandlungen mit Mittel, Aufwandmenge, Wasseraufwand,
  BBCH, Witterung/Wind, Wartezeit. Betriebsstandort als Adresse (Startpunkt →
  einmal geokodieren).
- Stufe 1: Rieden wählen → KMZ/KML mit Polygonen + Sprühparametern
  (Aufwand l/ha, Flughöhe, Bahnabstand) + Auftragsblatt (PDF) mit Start am
  Betriebsstandort, Anzeigedatum für die Behörde, Wartezeit. Aufwand ca. 1–2 Tage.
- Stufe 2: Flugprotokoll der Drohne (DJI Agras, XAG …) importieren → Behandlung
  mit Ist-Fläche/Ist-Menge, Wartefrist-Ampel, Kupferbilanz. Aufwand je nach
  Herstellerformat.
- Je Ried zu erfassen: Zeilenrichtung/Reihenabstand, Hindernisse (Masten,
  Leitungen, Bäume), Pufferzonen, Luftraum lt. Austro-Control-Drohnenkarte.
- Vorbedingungen (nicht Software): Pflanzenschutz aus der Luft ist in der EU
  nur mit Ausnahmebewilligung erlaubt – Bewilligung der Bezirksverwaltungsbehörde
  (Landesrecht; OÖ Pflanzenschutzdrohnen-Verordnung seit 1/2024, NÖ-Praxis
  klären), Anzeige jeder Anwendung, Mittel im BAES-Register für unbemannte
  Luftfahrzeuge zugelassen, Sachkundeausweis; luftfahrtrechtlich Sprühdrohnen
  > 25 kg = „spezielle“ Kategorie (EU 2019/947) mit Austro-Control-Genehmigung.
  Realistisch fliegt ein Dienstleister, nicht der Betrieb.
- Nächster Schritt nach Beschluss: Import-/Exportformat des konkreten
  Drohnen-Dienstleisters ansehen und Stufe 1 daran ausrichten.

### Morgenbericht – täglicher Scan auf Unregelmäßigkeiten je Betrieb

**Beschlossen im Jour fixe 9.9.2026, umgesetzt 10.9.2026 (Migration 201, docs/Morgenbericht_Wetter.md).** Ursprüngliches Konzept:

**Verortung:** Basisfunktion für alle Pakete (deterministische Prüfungen);
die KI-Zusammenfassung und bot:112-Ausgabe zählen gegen das KI-Kontingent
des Pakets (Standard/Premium-Argument).

- Vercel-Cron einmal täglich (05:00 UTC, damit der Bericht um 7 Uhr früh
  lokal vorliegt), je Mandant: Chargen in Gärung ohne Messung, Rechnungen
  über Zahlungsziel, Belege ohne Kategorie oder mit ungewöhnlichem Betrag,
  negative Bestände, Wartefrist-Konflikte bei geplanten Behandlungen,
  doppelte Kontakte, Abo mit offener Zahlung, nicht übergebene Belege (Doppik).
- Ausgabe: Glocke und Dashboard (baut auf den bestehenden Hinweisen Fristen /
  Gärkontrolle auf), optional E-Mail und bot:112.
- Prüfungen deterministisch (nachvollziehbar), KI nur für Zusammenfassung und
  Priorisierung.
- Aufwand: ca. 1 Woche für Cron, Prüfregeln und Anzeige.

### Wetteranbindung und Maßnahmen-Empfehlungen

**Beschlossen im Jour fixe 9.9.2026, umgesetzt 10.9.2026 (GeoSphere INCA/AROME je Rieden-Koordinate, Regelmaschine, Migration 201).** Ursprüngliches Konzept:

**Verortung:** Standard/Premium (Weingarten-Modul + KI); liefert in den
Morgenbericht.

- Quellen (frei): GeoSphere Austria Data Hub (TAWES-Stationen, 10-Minuten-
  Werte: Temperatur, Niederschlag, Feuchte, Wind, Strahlung; Open Data CC BY),
  Pflanzenschutz-Warndienst der Landwirtschaftskammern (warndienst.at,
  VitiMeteo-Modelle Peronospora/Oidium/Botrytis je Weinbau-Wetterstation),
  rebschutzdienst.at. Infektionsmodelle NICHT nachbauen - Fachstellen nutzen.
- Unser Mehrwert = Verknüpfung mit Betriebsdaten: letzte Behandlung je Ried,
  Niederschlag seit der Behandlung (Belag ab ca. 20-30 mm abgewaschen), BBCH,
  Wartezeit bis Ernte, Kupferbilanz, Zulassung des Mittels, Kennzeichen
  "spritzbar". Ergebnis z. B. "Ried X: Risiko hoch lt. Warndienst, letzte
  Behandlung vor 11 Tagen, seither 34 mm - Schutz nicht mehr gegeben".
- Regelteil deterministisch (haftungsrelevant), KI formuliert, priorisiert
  und beantwortet Rückfragen in "Frag dein Weingut".
- Technik: nächste Station je Betrieb aus den Rieden-Koordinaten, stündlicher
  Abruf in eine Wettertabelle, Regelmaschine gegen Behandlungen, Anzeige im
  Dashboard "Weingarten & Ernte". Warndienst-API prüfen, sonst Verlinkung.
- Aufwand: ca. 1-2 Wochen für eine erste brauchbare Version.

### Betreiber-Check (intern, kein Produktfeature)

Tägliche geplante Aufgabe bei Claude (05:00 UTC): Vercel-Fehler, Supabase-
Advisor (Sicherheit/Performance), fehlgeschlagene Cron-Läufe und Webhooks,
KI-Verbrauch je Mandant, ungewöhnliche Datenmengen -> Kurzbericht an Jörgen.
Einrichtung ca. 1 Stunde, jederzeit möglich.

---

## Technischer Stack

| Komponente | Technologie |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS |
| Backend/DB | Supabase (PostgreSQL + Auth + RLS) |
| Hosting | **Vercel (ab Phase 0)** |
| Zahlungen | Stripe (Kreditkarte + SEPA) |
| Rechnungsversand | Resend (E-Mail) |
| Automatisierung | Vercel Cron Jobs |
| Entwicklungspartner | Claude (Anthropic) |

---

## Wichtige Abgrenzung

- **Stripe** → NUR Software:112 (nicht KPS Smart Buchhaltung)
- **Chargebee** → NUR KPS Smart Buchhaltung (falls SEPA-Einzug gewünscht, Phase 3+)
- **Dauerauftrag-Modul** → beide Projekte, shared library

---

*Dokument erstellt mit IC&P Consultants e.U. – Software:112 Projektstart*
