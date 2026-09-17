# Kundennummern für Mandanten (17.9.2026)

**Anlass:** „Wir brauchen noch Kundennummern für unsere Mandanten für künftige Support- oder sonstige Prozesse.“

## Format

`S112-AT-<K><NNNN>`

| Teil | Bedeutung |
|---|---|
| `S112` | software:112 |
| `AT` | Land (Österreich); DE, CH, IT … folgen, sobald die ersten Betriebe dort sind |
| `K` | Nummernkreis = erste Ziffer der Betriebs-Postleitzahl (Einteilung der Österreichischen Post): 1 Wien · 2 östl. Niederösterreich · 3 westl. Niederösterreich · 4 Oberösterreich · 5 Salzburg · 6 Tirol/Vorarlberg · 7 Burgenland · 8 Steiermark · 9 Kärnten/Osttirol |
| `NNNN` | laufende Nummer je Kreis ab 0001 |

Der Kreis liefert damit auch das Bundesland (etwa für landesrechtliche Weinbestimmungen) – `lib/tenant/kundennummer.ts` (`bundeslandAusKundennummer`, `bundeslandAusPlz`).

## Vergabe

- Migration 209: Spalte `tenants.kundennummer` (eindeutig), Funktion `kundennummer_vergeben(tenant_id, kreis?)` (SECURITY DEFINER, Advisory-Lock je Kreis gegen Doppelvergabe), Trigger auf `tenant_einstellungen.betrieb_plz` – die Nummer entsteht automatisch, sobald die PLZ des Betriebs gespeichert wird (Signup fragt keine Adresse ab, daher nicht bei Anlage).
- Einmal vergeben, ist die Nummer unveränderlich (Trigger `kundennummer_unveraenderlich_trg`); eine Korrektur geht nur bewusst per SQL mit deaktiviertem Trigger.
- Ohne PLZ zeigt Administration › Mandanten „noch keine – PLZ fehlt“.

## Bestand

| Betrieb | PLZ | Kundennummer |
|---|---|---|
| Weingut Johannes Gebeshuber | 2352 | S112-AT-20001 |
| Spaetrot Gebeshuber GmbH | (Gumpoldskirchen, Adresse noch nicht hinterlegt) | S112-AT-20002 |
| Sandbox | 2352 | S112-AT-20003 |
| Weingut Musterhof (Demo) | 3500 | S112-AT-30001 |

## Anzeige

Administration › Mandanten (Spalte + Kopf der Detailseite, Tooltip mit Bundesland), System › Mein Betrieb (Kopfzeile), Abo-Seite; als Metadaten `kundennummer` und Beschreibung am Stripe-Kunden (`lib/stripe/kundennummer.ts`, beim Anlegen des Stripe-Kunden und nach dem Speichern der Betriebsadresse).
