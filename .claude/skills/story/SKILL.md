---
name: story
description: Story-Readiness und Plan für ein Jira-Ticket (KAN-…) vor jeder Umsetzung – Readiness-Score mit Gate A (unter 70 → Rückfragen, „In Abklärung“), Plan mit Tasks ≤ 1 h und Prüfbefehl je Task, Gate B (Freigabe durch Jörgen) vor dem ersten Code. Aufruf /story KAN-123.
---

# /story <KAN-Nummer>

Teil des Harness in `docs/AGENTIC_DELIVERY.md` (Schritte 1–3, Gates A und B). Ergebnis ist **kein Code**, sondern eine
Bewertung und ein Plan, den Jörgen freigibt. Jira-Site: cloudId `973775af-4f31-4d1e-8d46-07deb82043ee`.

## 1. Kontext einsammeln (deterministisch, immer alle Punkte)

1. Ticket laden: `getJiraIssue` mit `fields: ["summary","description","status","labels","attachment","comment"]`,
   `fieldsByKeys: true`. **Anhänge immer ansehen** (`downloadJiraIssueAttachment`, Bild lesen) – UAT-Befunde erklären
   sich oft nur im Screenshot. Kommentare von Jörgen sind Entscheidungen.
2. Doppel suchen: JQL auf Stichworte des Titels, auch Erledigt (`project = KAN AND text ~ "…"`).
3. Betroffenen Code finden (Grep/Glob) und die passenden Regeln aus `CLAUDE.md` nennen (z. B. Freeze, Storno,
   `alle()`, RLS, Behördenmeldung als CSV, Paket-Module).
4. Bei Datenmodell: Schema auf **Staging** lesen (`sjpeghrlhsowmquacjhb`), nie auf Produktion schreiben.

## 2. Readiness bewerten (Score 0–100)

| Kriterium | Punkte | Frage |
|---|---|---|
| Ziel klar | 0–20 | Ist klar, welches Problem für wen gelöst wird? |
| Prüfbar | 0–25 | Lassen sich Abnahmeschritte (Gherkin oder nummeriert) direkt ableiten? |
| Klein genug | 0–20 | Passt es in ≤ 1 Tag bzw. ≤ 8 Tasks à ≤ 1 h? Sonst schneiden. |
| Risiko benannt | 0–20 | Migration? Behörden-/Steuerbezug? Mandantentrennung? Produktivbetrieb Gebeshuber betroffen? |
| Testbar | 0–15 | Unit-Test, DB-Test (Staging) bzw. E2E möglich – welcher? |

Ausgabe als Tabelle mit Punkten und je einem Satz Begründung.

## 3. Gate A

- **Score < 70:** keine Umsetzung. Fragen als Jira-Kommentar (nummeriert, mit Vorschlag A/B/C wo möglich), Ticket auf
  „In Abklärung“ (Transition 2) und Jörgen zuweisen (accountId `557058:ae048ba4-28ad-4bcf-bd2b-19a911b272cc`).
- **Score ≥ 70:** weiter mit dem Plan.

## 4. Plan (Gate B vorbereiten)

- Tasks ≤ 1 h, je Task: was, welche Dateien, **Prüfbefehl** (z. B. `npm run verify`, `npm run -s test:db -- --nur 80`,
  gezielter E2E-Lauf).
- Eigener Task für jede Migration: Entwurf in `supabase/entwurf/`, Staging, DB-Test, Rollback-Probelauf auf Produktion,
  **„OK, einspielen“ durch Jörgen**, danach Datei mit Remote-Version, md5, Advisor.
- Abnahmeschritte für Jörgen (nummeriert, mit erwartetem Ergebnis).
- Metrik-Block vorbereiten (siehe `docs/AGENTIC_DELIVERY.md`, Metriken).

Plan als Jira-Kommentar „Plan (zur Freigabe)“ posten und im Chat zusammenfassen.

## 5. Gate B

Umsetzung erst nach Jörgens Freigabe („approved“, „OK“, „passt“ im Chat oder als Kommentar). Bis dahin keine Änderungen
am Code. Freigabe gilt für genau diesen Plan; größere Abweichungen neu vorlegen.
