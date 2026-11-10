# Verfügbarkeitsmonitor und Ausfallprotokoll (KAN-401)

Grundlage: Anlage 3 der Vertragsunterlagen, Endfassung Version 3 vom 10. November 2026 (`docs/Vertrag/AGB_AVV_Leistungsbeschreibung_software112_v3_Endfassung`), Punkt 3 „Betrieb und Verfügbarkeit“.

- 3.1: Betrieb rund um die Uhr, **keine zugesagte Verfügbarkeit in Prozent**, keine Gutschriften, kein Sonderkündigungsrecht wegen der Verfügbarkeit (bis Version 2: 99,0 % je Kalendermonat mit Gutschriften und Sonderkündigung).
- 3.2: Ein Ausfall (Anmeldung unmöglich oder Anwendung insgesamt nicht nutzbar, Anlage 3 Punkt 1) ist eine Störung der Klasse 1 nach 5.2: Reaktion 4 Stunden, Behebung 1 Werktag (Servicezeit). Wird die Frist überschritten, gilt die Entgeltminderung nach Nutzungsvertrag 8.1. Ausfälle der Rechenzentrums- und Hostingbetreiber, die der Anbieter weder verursacht hat noch abwenden kann, gelten als höhere Gewalt – Nachweis mit der Störungsmeldung des Betreibers.
- 3.3: Überwachung mindestens alle fünf Minuten, Protokoll der Ausfälle 13 Monate aufbewahren und dem Kunden auf Anfrage geben.

## Prüf-Endpunkt

`GET https://software112.icp-consultants.at/api/health`

| Antwort | Bedeutung |
|---|---|
| `200 {"ok":true,"teile":{"app":"ok","db":"ok","auth":"ok"}}` | Anwendung, Datenbank (PostgREST) und Anmeldedienst (Supabase Auth) antworten |
| `503 {"ok":false,"teile":{…}}` | mindestens ein Teil antwortet nicht innerhalb von 5 s; `teile` zeigt, welcher |

- Ohne Anmeldung, nur GET, `Cache-Control: no-store`.
- Prüft mit dem öffentlichen Anon-Schlüssel (eine Zeile aus `rebsorten`), ohne Service-Role, ohne Mandantendaten, ohne Fehlertexte.
- Code: `src/lib/system/verfuegbarkeit.ts`, Route `src/app/api/health/route.ts`, Test `scripts/tests/kan401-health.test.mjs`.

## Externer Dienst (eingerichtet)

**Better Stack (Uptime)**, Gratisplan, eingerichtet von Jörgen (Stand 10.11.2026). **Vor dem ersten zahlenden Kunden (spätestens 01.01.2027) auf einen Bezahlplan wechseln** – der Gratisplan ist nur für private Projekte gedacht.

1. Monitor „software:112 – health“: `/api/health`, Schlüsselwort `"ok":true`, Intervall 3 min (Grenze des Gratisplans; Vertrag: mindestens alle 5 min), Bestätigung nach 1 min, Prüfregionen Europa und Nordamerika.
2. Monitor „software:112 – Login“: `https://software112.icp-consultants.at/login`, Schlüsselwort „Anmelden“, gleiche Einstellungen.
3. Alarm: E-Mail an Jörgen und Slack-Kanal `#s112-ausfaelle`; die Vertretung im Support kommt dazu, sobald sie feststeht.
4. Optional eine Statusseite (z. B. `status.software112.at`) – erst nach dem Domainwechsel (KAN-221).

Probe der Alarmierung: einen dritten, vorübergehenden Monitor auf `https://software112.icp-consultants.at/api/health-gibt-es-nicht` anlegen. Er muss binnen 5 Minuten alarmieren; danach wieder löschen.

## Ausfallprotokoll

- **Monatlich**, bis zum 5. des Folgemonats: Bericht des Vormonats (Verfügbarkeit in %, Liste der Ausfälle mit Beginn, Ende und Dauer) als CSV/PDF exportieren und ablegen unter `Verträge/software112/Verfügbarkeit/JJJJ-MM` (Ablage des Anbieters, nicht im Repository).
- **Aufbewahrung mindestens 13 Monate** (zugesagt in 3.3).
- **Wartungsfenster** (Anlage 3, Punkt 4) im Dienst als Wartung eintragen, damit sie im Protokoll nicht als Ausfall erscheinen; die Ankündigung (48 h, App und E-Mail) im selben Ordner ablegen.
- **Anfrage eines Kunden:** den Bericht der gewünschten Monate per E-Mail an den Betriebs-Manager-Zugang schicken.
- **Ausfall im Vormonat:** festhalten, ob Reaktion (4 h) und Behebung (1 Werktag) innerhalb der Servicezeit eingehalten wurden – sonst kann der Kunde das Entgelt nach Nutzungsvertrag 8.1 mindern. Bei einem Ausfall eines Vorleisters (Supabase, Vercel) dessen Störungsmeldung von der Statusseite zum Bericht legen (höhere Gewalt nach 3.2).

## Grenzen

- Der Endpunkt prüft Erreichbarkeit, nicht jede Fachfunktion. Funktionsfehler nach einem Update fallen über den Systembericht und Störungsmeldungen auf (Anlage 3, 9.2).
- Der Monitordienst verarbeitet keine Kundendaten (nur Antwortzeiten und Status). Er ist kein Subauftragsverarbeiter, wird aber im Verzeichnis des Anbieters geführt.
