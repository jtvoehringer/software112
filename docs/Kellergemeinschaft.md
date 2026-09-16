# Kellergemeinschaft – Gebinde mit Partnerbetrieben teilen (Stand 16.9.2026)

Mehrere Mandanten nutzen denselben Keller (Anlass: Weingut Gebeshuber). Gebinde gehören genau einem Betrieb, können aber von Partnerbetrieben befüllt werden. **Inhalte bleiben mandantengetrennt**, ein fremd belegtes Gebinde ist für alle anderen gesperrt.

## Datenmodell (Migration 203)

| Objekt | Zweck |
|---|---|
| `behaelter.gemeinsam` (bool, default true) | Eigentümer nimmt einzelne Gebinde von der Freigabe aus |
| `behaelter.stapler`, `behaelter.notizen` | DKB-Felder „Stapler“/„Bemerkung“ |
| `keller_freigaben` (eigentuemer_tenant_id, nutzer_tenant_id, aktiv) | Freigabe je Paar, Pflege nur system_admin (Service-Role), lesbar für beide Seiten |
| RLS `behaelter_select` | eigene Gebinde **oder** `gemeinsam` + aktive Freigabe an einen meiner Betriebe (Joins `behaelter:behaelter_id(name)` funktionieren damit auch für Partner) |
| RPC `lade_behaelter(p_tenant_id)` | eigene + freigegebene Gebinde mit `eigentuemer_name`, `fremd`, `eigen_liter`, `fremd_liter`, `fremd_betrieb` – SECURITY DEFINER, prüft Mitgliedschaft; liefert nie fremde Chargen |
| RPC `lade_kellergemeinschaft(p_tenant_id)` | Partnerliste (Rolle eigentuemer/nutzer, Name) |
| Funktion `behaelter_nutzbar(behaelter, tenant)` | Hilfsprüfung |
| Trigger `weinausbau_gebinde_pruefen_trg` | BEFORE INSERT/UPDATE auf `weinausbau`: lehnt ab, wenn Gebinde nicht freigegeben ist oder ein anderer Betrieb aktiven Wein (> 0 l) darin hat. Mengenänderung einer bereits liegenden eigenen Charge bleibt erlaubt. Fehlertexte deutsch („Gebinde „a1“ ist durch Weingut X belegt – …“) |

Der Trigger wirkt für alle Wege, die Wein in ein Gebinde bringen: Umzug (beide Aktionen), Eröffnungsbestand, Pressung, Verschnitt, Zukauf, Bot-Tool. Die Umzugs-Aktionen prüfen Ziele zusätzlich **vor** dem Reduzieren der Quellen (`ladeBehaelter(..., { nurAktiv })` → `gesperrt`), damit kein halber Umzug entsteht.

## App (`src/lib/keller/behaelter.ts`)

`ladeBehaelter(client, tenantId, { nurAktiv?, alsZiel? })` ersetzt alle direkten `behaelter`-Selects (Gebinde, Kellerbuch-Übersicht, Umziehen, Umzug bearbeiten, Eröffnungsbestand, Charge-Detail, Pressung, Kellerplan, Kellerauswertung, Zukauf-Stammdaten, Kostenrechnung, Datenimport, Bot-Kontext/-Tools, Gebinde-Unterseiten). Rückgabe `BehaelterZeile` mit `fremd`, `gesperrt`, `anzeigeName` („a1 · Weingut X“). `alsZiel` filtert aktive, nicht gesperrte Gebinde.

Oberfläche:
- Gebinde-Liste/Kellerbuch: Badge mit Eigentümer, „belegt · Betrieb · Liter“ (Warnfarbe), Füllstand inkl. fremder Liter; bearbeiten/löschen nur Eigentümer; Schalter „für Partnerbetriebe freigegeben“ nur, wenn Freigaben bestehen; „mit Stapler versetzbar“, Notizen.
- Ziel-Dropdowns: gesperrte Gebinde fehlen; fremde heißen „a1 · Weingut X“.
- Kellerplan: fremd belegte Gebinde zeigen „belegt · Betrieb“ als Beschriftung.
- Administration › Kellergemeinschaft (system_admin): Freigabe Eigentümer → Partner anlegen, pausieren, löschen; Zähler freigegebener Gebinde.

## Import Gebeshuber

173 Gebinde aus „Gebinde mit Inhalt aus DKB.xlsx“ (830.414 l, 69 mit Stapler) per SQL angelegt (`supabase/import_gebeshuber_gebinde.sql`, `import_quelle` gesetzt). Typ-Mapping: Tank → stahltank, Immervoll → immervolltank, Faß → holzfass, Bottich → bottich, Presse → presse, Barrique/Doppelbarrique, Sonstiger Behälter und Trauben-Sammelbehälter → sonstiges (Notiz). Standorte: Keller, Barriquekeller, Füllstraße.

## Chargen-Import Gebeshuber / Spaetrot (16.9.2026)

„fassweinliste komplett NEU 09-2026.xlsx“ (96 Chargen, 116.403,5 l) als Eröffnungsbestand (`weinausbau`, `ist_eroeffnungsbestand`, Buchung 1.1.2026) importiert – `supabase/import_gebeshuber_chargen.sql`:

- Spalte „bio/konv.“ = **konv.** → Mandant **Spaetrot Gebeshuber GmbH** (neu angelegt, `0569d025-…`, Jörgen als System-Admin-Mitglied; Freigabe Gebeshuber → Spaetrot aktiv): 19 Chargen, 33.864,5 l, EB-2026-0001…0019.
- BIO / UM → **Weingut Johannes Gebeshuber**: 77 Chargen, 82.539 l, EB-2026-0001…0077.
- Mapping: Sorte RG Rotgipfler, ZF Zierfandler, SL St. Laurent, BB Blauburgunder, SW Sortenverschnitt weiß, SO Sortenverschnitt rot, GW Gemischter Satz, CS Cabernet Sauvignon, CH Chardonnay · Qual. DAC → dac, QUW → qualitaetswein, SOE → sonstiges · Herkunft WLNO → wlnoe, WLTH → thermenregion_riedenwein (DAC + „ried …“) sonst thermenregion_gebietswein (Beschluss 16.9.: auch für QUW) · Farbe W/R → weiss/rot · KMW → kmw · DKB-Chargennummer → referenz_altsystem · Name = Bezeichnung (ohne Anführungszeichen), sonst „Sorte Jahrgang“.
- Notizen je Charge: DKB-Codes, Bio-Status/Zertifizierung, Alkohol, Produkt (Destillat), „DKB %-FJ“.
- Ergebnis aus Sicht beider Mandanten (RPC): 173 Gebinde sichtbar, 77 bzw. 19 eigene belegt, der Rest des jeweils anderen als „belegt · Betrieb“.
