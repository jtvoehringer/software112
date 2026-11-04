# Verfügbarkeitsmonitor und Ausfallprotokoll (KAN-401)

Grundlage: Anlage 3 der Vertragsunterlagen (Leistungsbeschreibung und Service Levels), Punkt 3.

- 3.1: 99,0 % je Kalendermonat
- 3.3: Überwachung mindestens alle fünf Minuten, Protokoll der Ausfälle auf Anfrage des Kunden
- 3.5: Gutschriften
- 3.6: Sonderkündigung bei < 95 % in zwei aufeinanderfolgenden Monaten oder in drei Monaten innerhalb von zwölf

## Prüf-Endpunkt

`GET https://software112.icp-consultants.at/api/health`

| Antwort | Bedeutung |
|---|---|
| `200 {"ok":true,"teile":{"app":"ok","db":"ok","auth":"ok"}}` | Anwendung, Datenbank (PostgREST) und Anmeldedienst (Supabase Auth) antworten |
| `503 {"ok":false,"teile":{…}}` | mindestens ein Teil antwortet nicht innerhalb von 5 s; `teile` zeigt, welcher |

- Ohne Anmeldung, nur GET, `Cache-Control: no-store`.
- Prüft mit dem öffentlichen Anon-Schlüssel (eine Zeile aus `rebsorten`), ohne Service-Role, ohne Mandantendaten, ohne Fehlertexte.
- Code: `src/lib/system/verfuegbarkeit.ts`, Route `src/app/api/health/route.ts`, Test `scripts/tests/kan401-health.test.mjs`.

## Externer Dienst (Einrichtung durch Jörgen)

Empfehlung: **Better Stack (Uptime)** oder **UptimeRobot**, Konto auf die Firmen-E-Mail des Anbieters, Zwei-Faktor-Anmeldung an.

1. Monitor „software:112 – health“: HTTP(S), URL siehe oben, Intervall **1 min** (mindestens 5 min), erwarteter Status 200, Zeitlimit 10 s, Bestätigung erst nach 2 Fehlschlägen (vermeidet Fehlalarme).
2. Monitor „software:112 – Login“: `https://software112.icp-consultants.at/login`, Status 200, Schlüsselwort „Anmelden“.
3. Alarm: E-Mail und Push-App an Jörgen und die Vertretung im Support.
4. Prüfstandorte in Europa wählen.
5. Optional eine Statusseite (z. B. `status.software112.at`) – erst nach dem Domainwechsel (KAN-221).

Probe der Alarmierung: einen dritten, vorübergehenden Monitor auf `https://software112.icp-consultants.at/api/health-gibt-es-nicht` anlegen. Er muss binnen 5 Minuten alarmieren; danach wieder löschen.

## Ausfallprotokoll

- **Monatlich**, bis zum 5. des Folgemonats: Bericht des Vormonats (Verfügbarkeit in %, Liste der Ausfälle mit Beginn, Ende und Dauer) als CSV/PDF exportieren und ablegen unter `Verträge/software112/Verfügbarkeit/JJJJ-MM` (Ablage des Anbieters, nicht im Repository).
- **Aufbewahrung mindestens 13 Monate**, wegen „drei Monate innerhalb von zwölf“ in 3.6.
- **Wartungsfenster** (Anlage 3, Punkt 4) im Dienst als Wartung eintragen, damit sie nicht als Ausfall zählen; die Ankündigung (48 h, App und E-Mail) im selben Ordner ablegen.
- **Anfrage eines Kunden:** den Bericht der gewünschten Monate per E-Mail an den Betriebs-Manager-Zugang schicken.
- **Gutschrift** (3.5): Der Kunde beantragt sie bis Ende des Folgemonats; der Monatsbericht ist der Nachweis.

## Grenzen

- Der Endpunkt prüft Erreichbarkeit, nicht jede Fachfunktion. Funktionsfehler nach einem Update fallen über den Systembericht und Störungsmeldungen auf (Anlage 3, 9.2).
- Der Monitordienst verarbeitet keine Kundendaten (nur Antwortzeiten und Status). Er ist kein Subauftragsverarbeiter, wird aber im Verzeichnis des Anbieters geführt.
