---
name: review
description: Adversariales Review eines PR bzw. des aktuellen Diffs gegen die Guard Rails und Projektregeln von software:112 (Mandantentrennung, RLS, Migrationen, Storno/Freeze, Behördenmeldungen, Tests) mit festem Ausgabeformat und Metrik-Block. Aufruf /review <PR-Nummer> oder /review (aktueller Branch).
---

# /review [PR-Nummer]

Teil des Harness in `docs/AGENTIC_DELIVERY.md` (Schritt 5 Self-Review bzw. Review vor Jörgens Freigabe). Ziel: Fehler
finden, nicht bestätigen. Jede Prüfung mit Beleg (Datei:Zeile), sonst gilt sie als nicht gemacht.

## 1. Diff holen (deterministisch)

- PR: `"/c/Program Files/GitHub CLI/gh.exe" pr diff <nr>` und `pr view <nr> --json title,body,files`.
- Ohne Nummer: `git diff origin/main...HEAD` plus nicht committete Änderungen.
- Verlinktes Jira-Ticket laden (Kommentare und Anhänge) – das sind die Anforderungen.

## 2. Checkliste (jede Zeile beantworten: ok / Befund / nicht betroffen)

**Anforderung**
1. Erfüllt der Diff jedes Akzeptanzkriterium des Tickets? Fehlt etwas Angefragtes, ist etwas Ungefragtes dabei?

**Mandantentrennung und Rechte**
2. Jede Abfrage auf Mandantendaten mit `.eq('tenant_id', …)` bzw. RLS; Service-Role nur nach Berechtigungsprüfung.
3. Server Actions: `pruefeSeitenBetrieb` vor `canWrite`, `pruefeSchreibzugriff`; API-Routen: `pruefeZweiFaktor`.
4. Neue Policies `TO authenticated`; neue Funktionen `REVOKE … FROM PUBLIC, anon`, `SET search_path = public`,
   `pruefe_tenant_zugriff`; schreibende RPCs `s112_pruefe_abo_schreibsperre`, Paket-Modul-Prüfung.
5. Neue FK-Spalte: Trigger `z_fremdverweis_<spalte>`, Index, Eintrag in `scripts/fremdschluessel.json`.

**Daten und Buchungen**
6. Berichtsrelevantes wird storniert, nicht gelöscht; Freeze-Sperren respektiert (`s112.freeze_frei` nur in RPCs).
7. Große Tabellen über `alle()` mit `.order()`; lange `.in()`-Listen über `inBloecke`.
8. Datum als Wiener Datum (kein `current_date`, kein `toISOString()` für Kalendertage); Rundung über `runden()`.
9. Behördenmeldung: Druck und CSV aus derselben Ladefunktion, Katalog- und Register-Eintrag.

**Migration** (falls vorhanden)
10. Erst Staging, DB-Test (`npm run test:db`), Rollback-Probelauf; Produktion nur nach „OK, einspielen“; Datei mit
    Remote-Version, md5 gleich, Security Advisor ohne neue Befunde; `s112_soll_rpc` bzw. `s112_soll()` ergänzt.

**Qualität**
11. Test für neues Verhalten bzw. Regressionstest, der ohne den Fix rot wäre; keine abgeschwächten Tests.
12. `npm run verify` grün (Zahl der Tests nicht gesunken); Umlaute in deutschen Texten; keine neuen Lint-Warnungen.
13. UI: Barrierefreiheit (Beschriftungen, Tastatur), Handy-Breite, lange Formulare mit `data-ungespeichert`.

## 3. Ausgabe (festes Format)

```
## Review <PR/Branch> – <Datum>
Ergebnis: freigabefähig | Nacharbeit nötig
| # | Schwere (blocker/major/minor) | Datei:Zeile | Befund | Vorschlag |
Checkliste: 1 ok · 2 ok · … (Befunde mit Nummer)

story: KAN-…
readiness: <Score aus /story>
time_to_pr: <h:mm>
hook_failures: <Anzahl Blockaden Guard/Stopp-Gate>
ci_rounds: <Anzahl CI-Läufe bis grün>
review_findings: <n> (<blocker>/<major>/<minor>)
```

Befunde nicht selbst still beheben: Liste vorlegen; Jörgen entscheidet, was nachgearbeitet wird. PR-Kommentar auf
GitHub nur nach ausdrücklichem Wunsch.
