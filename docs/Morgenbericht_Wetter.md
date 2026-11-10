# Morgenbericht & Wetter (Migration 201, 10.9.2026)

Beschluss Jour fixe 9.9.2026. Ersetzt auf der Übersicht die Karte „Datenfluss statt
Zettelwirtschaft“. Konzept: Software112_Entwicklungspfad.md (Ideen → beschlossen).

## Ablauf

1. **Cron** `/api/cron/taeglich`, täglich 05:00 UTC (= 07:00 MESZ, vercel.json; unter Vercel Hobby waren nur zwei
   Cron-Jobs erlaubt – seit dem Wechsel auf Pro (23.9.2026) gelten bis 100 Cron-Jobs, bis einmal pro Minute, minutengenau,
   `maxDuration` bis 800 s; der Sammel-Cron bleibt trotzdem: erst Daueraufträge, dann E-Mail-Spiegelung, dann Morgenbericht;
   `/api/cron/morgenbericht` nur manuell),
   Auth über `CRON_SECRET` (System-Admin kann manuell per POST auslösen). Je aktivem
   Betrieb mit `morgenbericht_aktiv`: Wetter auffrischen → Prüfungen → KI-Zusammenfassung
   → Upsert `morgenberichte (tenant_id, datum)`. Zeitbudget, Reihenfolge und Parallelität: siehe
   „Zeitbudget (KAN-123)“. Der Demo-Musterhof bekommt kein tägliches Update.
2. **Manuell**: „aktualisieren“ / „Jetzt erstellen“ (Betriebsleiter, Winzer) → Server-Aktion
   `dashboard/morgenbericht/actions.ts` → gleiche Pipeline mit Service-Role, ohne Zeitgrenze je
   Betrieb und mit KI-Wiederholungen wie bisher; die Grenzen je Abruf (3 Wetterpunkte gleichzeitig,
   Start-Takt, KI 20 s je Versuch) gelten auch hier (auch im Demo-Musterhof möglich).
3. **Anzeige**: Karte auf `/dashboard` (Zusammenfassung, Zähler, 6 wichtigste Befunde,
   Wetterstreifen), Detail unter `/dashboard/morgenbericht` (alle Befunde nach Stufe,
   Rieden-Tabelle, Spritzfenster, Regeln). Glocke: dringende Befunde des Tages, die nicht
   schon als Frist/Gärkontrolle gelistet sind.

## Zeitbudget (KAN-123, 25.9.2026)

Bis 25.9.2026 lief der Cron mit `maxDuration = 60` in das Zeitlimit: Betriebe nacheinander nach
`created_at`, Budget nur vor jedem Betrieb geprüft, Wetterpunkte nacheinander (bis 25 s je Abruf),
KI ohne Zeitlimit – den letzten Betrieb traf es, und ausgelassene Betriebe zählten nicht als Fehler.
Regeln und Grenzen jetzt zentral in `src/lib/morgenbericht/zeitplan.ts` (ohne `@/`-Importe, Tests in
`scripts/tests/kan123-morgenbericht.test.mjs`):

- **Budget:** `maxDuration = 800` in beiden Cron-Routen; die Morgenberichte bekommen `maxDuration`
  abzüglich 30 s Reserve (Bereinigung, Protokoll) und der schon verstrichenen Zeit. Die
  E-Mail-Spiegelung davor behält ihr festes Budget von 22 s.
- **Reihenfolge:** Betriebe ohne Cron-Bericht bzw. mit dem ältesten letzten Cron-Bericht
  (`morgenberichte.ausloeser = 'cron'`, letzte 14 Tage) zuerst – wer gestern ausgelassen wurde, kommt
  heute zuerst dran. Bei Gleichstand zuerst, wessen letzter Bericht überhaupt (auch manuell) älter ist,
  dann nach `created_at`. Hintergrund: „Jetzt aktualisieren“ überschreibt die Cron-Zeile des Tages per
  Upsert (`ausloeser = 'manuell'`) – ohne den zweiten Schlüssel käme ein Betrieb mit Cron- und manuellem
  Bericht vor einem wirklich ausgelassenen. Bewusst hingenommen: ein Betrieb, der jeden Tag nach dem
  Cron manuell aktualisiert, gilt als „ohne Cron-Bericht“ und kommt früh dran (wird also nie ausgelassen).
- **Parallelität:** höchstens 2 Betriebe gleichzeitig (`lauf.ts`), je Betrieb höchstens 3 Wetterpunkte
  gleichzeitig (`lib/wetter/daten.ts`). GeoSphere erlaubt laut Doku 5 Anfragen je Sekunde und 240 je
  Stunde und Nutzer ([Request Limit](https://dataset.api.hub.geosphere.at/v1/docs/user-guide/request-limit.html),
  sonst HTTP 429); `geosphere.ts` taktet deshalb höchstens 4 Starts je Sekunde. Das Stundenlimit gilt
  für alle Abrufe der App zusammen (Cron über alle Betriebe plus manuelle Aktualisierungen), nicht je
  Betrieb – derzeit 6 Punkte × 2 Abrufe = 12 im Cron. **Skalierungsgrenze:** bei 12 Punkten × 2 Abrufen
  je Betrieb reicht es für etwa 10 Betriebe mit Wetter; davor ein gemeinsames Stundenbudget, einen
  betriebsübergreifenden Punkte-Cache oder einen eigenen API-Zugang klären.
- **Zeitgrenze je Betrieb:** 120 s (Gebeshuber brauchte bisher höchstens 46 s), nie über das Laufende;
  ein Betrieb beginnt nur mit mindestens 15 s Restzeit, sonst „Zeitbudget erschöpft“.
  Wetter: nach Grenze minus 30 s (Prüfungen, KI, Speichern) keine neuen Punkte, laufende Abrufe werden
  abgebrochen, der Cache bleibt (best effort); Zeitlimit je GeoSphere-Abruf weiter 25 s (einzelne Abrufe
  brauchen gemessen bis 28 s; die Gesamtzeit begrenzt die Grenze des Betriebs). KI: nur mit mindestens
  22 s Restzeit, sonst Fallback-Text – dann auch keine Zählung im KI-Kontingent; im Cron ohne
  Wiederholungen. Der Bericht wird immer gespeichert. Überzieht ein Betrieb seine Grenze trotzdem um
  mehr als 10 s (hängende Abfrage), meldet der Lauf ihn als Fehler, sein Platz im Pool bleibt aber belegt, bis er
  fertig ist (höchstens bis zum Laufende) – es laufen also nie mehr als 2 Betriebe gleichzeitig; die
  Meldung sagt, ob der Bericht verspätet gespeichert wurde oder bis zum Laufende nicht fertig war.
- **Auslassungen:** „Morgenbericht deaktiviert“, „Abo gesperrt (Nur-Lesen-Modus)“ und
  „Demo-Betrieb: kein tägliches Update“ (Musterhof, Einmaldaten reichen) sind bewusst und zählen im
  Cron-Protokoll nicht als Fehler. „Zeitbudget erschöpft“, wegen der Zeitgrenze gekürzte Berichte
  (Wetter unvollständig, KI ausgelassen) und Betriebe über der Zeitgrenze zählen als Fehler.
  Wetterpunkte, deren Abruf aus anderen Gründen scheitert (GeoSphere-Zeitlimit, HTTP 429/5xx), nennt die
  Meldung („N Wetterpunkte nicht abrufbar“, Details im Protokoll) – ohne sie als Fehler zu zählen, der
  Bericht nutzt dann die Werte aus dem Cache.
- **Sichtbarkeit:** `/admin/system` zeigt einen Hinweis, wenn es nach 05:30 UTC noch keinen
  Protokolleintrag des täglichen Crons von heute gibt (Abbruch vor dem Protokoll). Der
  Sandbox-Morgenbericht meldet „Betriebe ohne Morgenbericht am Vortag“ (siehe Prüfungen).

## Prüfungen (`src/lib/morgenbericht/pruefungen.ts`, deterministisch)

| Prüfung | Stufe | Quelle |
|---|---|---|
| Fristen überfällig / fällig (UVA, BMD-Übergabe, Erntemeldung, AfA, eigene) | hoch / mittel | `ladeFristen` |
| Chargen in Gärung ohne Messung | mittel | `ladeKeller` |
| Rechnungen über Zahlungsziel (≥ 5: hoch) | mittel / hoch | verkaufsposten |
| Buchungen ohne Kategorie (90 Tage), erkannte Belege | info | ea_transaktionen, ea_belege |
| Ungewöhnlicher Betrag: ≥ € 500 und > 5× Median der Kategorie (12 Monate, ≥ 6 Buchungen) | mittel | ea_transaktionen |
| Negative Bestände (Flaschen, Chargen) | hoch | fuellungen, weinausbau |
| Pressung vor Ablauf einer Wartefrist | hoch | behandlungen, pressungen |
| Kontakt-Dubletten (E-Mail oder Name) | info | kontakte |
| Abo: Zahlung offen (`past_due`/`unpaid`), Testphase endet ≤ 7 Tage (nur Altfälle vor KAN-402, neue Abos ohne Testphase) | hoch / mittel | tenants |
| Nur Sandbox: Server-/Browser-Fehler aller Betriebe (24 h) | mittel / hoch (≥ 10) | system_ereignisse |
| Nur Sandbox: Betriebe ohne Morgenbericht am Vortag (jede Zeile zählt, auch manuell; ohne Demo, inaktive, deaktivierte, gesperrte und erst am Vortag angelegte Betriebe) | mittel | morgenberichte, tenants |
| Wetter-Empfehlungen (siehe unten) | hoch / mittel / info | Regelmaschine |

## Wetter (`src/lib/wetter/*`)

- **Quelle:** GeoSphere Austria Data Hub (Open Data, CC BY 4.0). Rückblick INCA-Analyse
  1 km / 1 h (`RR, T2M, RH2M, UU, VV`), Prognose NWP/AROME 2,5 km / 1 h (~55 h,
  `t2m, rr_acc, rh2m, u10m, v10m, ugust, vgust`). Zeitreihen je Koordinate, keine Stationssuche.
- **Punkte:** Rieden-Koordinaten (`weingarten.zentrum_lat/lon`) auf 0,02° (≈ 2 km)
  zusammengefasst, max. 12 Punkte je Betrieb und Lauf. Cache `wetter_stunden`, Rückblick
  35 Tage; Auffrischen bei Aufruf, wenn Rückblick ≥ 90 min bzw. Prognose ≥ 3 h alt.
- **Regeln** (Schwellen je Betrieb unter Mein Betrieb → Branding & Regeln):
  - Regen seit letzter Spritzung (`behandlungen.art = 'spritzung'`, 45 Tage): ≥ `wetter_abwasch_mm`
    (Standard 25) → *abgewaschen* (hoch); ≥ 60 % davon → *nachlassend* (mittel). Nur April–September.
  - Spritzintervall: > `wetter_intervall_tage` (14) ohne Behandlung, Mai–August → mittel.
  - Spritzfenster: zusammenhängende Stunden 5–20 Uhr mit Wind ≤ 4 m/s, Böen ≤ 8 m/s, ≤ 0,1 mm
    und < 1 mm in den folgenden 3 h; mindestens 3 h; höchstens 4 Fenster.
  - Feuchte Witterung (Apr–Sep): ≥ 10 mm/72 h, Ø ≥ 12 °C, Ø ≥ 80 % rF → mittel, Link warndienst.at.
  - Prognose 48 h: Frost ≤ 0 °C (März–Mai) hoch · Hitze ≥ 33 °C info · Böen ≥ 60 km/h mittel ·
    Regen ≥ 10 mm vor der Lese (Sep–Okt) mittel.
  - Wartezeit (Mittel `wartezeit_tage` bzw. `ernte_fruehesteins`) endet in ≤ 14 Tagen (Aug–Okt) → info.
- **Verortung:** Standard/Premium (`stripe_plan` ≠ basis; ohne Plan = erlaubt, Testphase),
  Weingarten-Modul, `wetter_aktiv`. Basis sieht den Morgenbericht ohne Wetterteil.
- Keine Infektionsmodelle – die liefern die Warndienste; Texte weisen darauf hin.

## KI-Zusammenfassung (`src/lib/morgenbericht/ki.ts`)

3–5 Sätze aus den geprüften Befunden (System-Prompt verbietet Erfindungen). Zählt über
`check_und_increment_ki_abfrage` als eine Abfrage; Tokens über `increment_ki_tokens`.
Modell: `MORGENBERICHT_MODEL` → `KI_ABFRAGE_MODEL` → Sonnet 4.5. Ohne Schlüssel, ohne
KI-Modul oder bei erreichtem Limit: deterministischer Ein-Satz-Fallback. Aufruf mit Zeitlimit 20 s
je Versuch (KAN-123); im Cron ohne Wiederholungen und nur mit genug Restzeit (siehe Zeitbudget), sonst
Fallback; manuell wie bisher mit zwei Wiederholungen. Scheitert der Aufruf, bleibt `ki_modell` leer –
der Fallback-Text erscheint nicht als KI-Zusammenfassung (die Abfrage ist trotzdem gezählt).

## Offen / Ideen

- Warndienst-Daten je Weinbau-Wetterstation, sobald eine API verfügbar ist (derzeit Link).
- Hagel-/Gewitterwarnung (GeoSphere Warnungen-API).
