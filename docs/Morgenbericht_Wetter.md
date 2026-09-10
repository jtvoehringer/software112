# Morgenbericht & Wetter (Migration 201, 10.9.2026)

Beschluss Jour fixe 9.9.2026. Ersetzt auf der Übersicht die Karte „Datenfluss statt
Zettelwirtschaft“. Konzept: Software112_Entwicklungspfad.md (Ideen → beschlossen).

## Ablauf

1. **Cron** `/api/cron/taeglich`, täglich 05:00 UTC (= 07:00 MESZ, vercel.json; Vercel Hobby erlaubt zwei
   Cron-Jobs, daher ein Sammel-Cron: erst Daueraufträge, dann Morgenbericht; `/api/cron/morgenbericht` nur manuell),
   Auth über `CRON_SECRET` (System-Admin kann manuell per POST auslösen). Je aktivem
   Betrieb mit `morgenbericht_aktiv`: Wetter auffrischen → Prüfungen → KI-Zusammenfassung
   → Upsert `morgenberichte (tenant_id, datum)`. Zeitbudget 60 s, Betriebe nacheinander.
2. **Manuell**: „aktualisieren“ / „Jetzt erstellen“ (Betriebsleiter, Winzer) → Server-Aktion
   `dashboard/morgenbericht/actions.ts` → gleiche Pipeline mit Service-Role.
3. **Anzeige**: Karte auf `/dashboard` (Zusammenfassung, Zähler, 6 wichtigste Befunde,
   Wetterstreifen), Detail unter `/dashboard/morgenbericht` (alle Befunde nach Stufe,
   Rieden-Tabelle, Spritzfenster, Regeln). Glocke: dringende Befunde des Tages, die nicht
   schon als Frist/Gärkontrolle gelistet sind.

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
| Abo: Zahlung offen (`past_due`/`unpaid`), Testphase endet ≤ 7 Tage | hoch / mittel | tenants |
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
KI-Modul oder bei erreichtem Limit: deterministischer Ein-Satz-Fallback.

## Offen / Ideen

- Warndienst-Daten je Weinbau-Wetterstation, sobald eine API verfügbar ist (derzeit Link).
- Hagel-/Gewitterwarnung (GeoSphere Warnungen-API).
