# AGENTIC_DELIVERY · software:112

Harness für Claude Code nach dem Stripe-Minions-Muster und Proof Case für RBI/ATHENA: ein echtes Produkt (ERP für
Weinbaubetriebe, Next.js + Supabase + Vercel, Produktivbetrieb seit 14.08.2026), in dem Stories von Agents geliefert und
von einem Menschen abgenommen werden.

**Stand 12.10.2026.** Jede Aussage ist markiert: ✅ heute so umgesetzt · 🟡 teilweise · ⬜ Ziel (noch nicht umgesetzt).
Diese Datei ist bewusst **nicht** in `CLAUDE.md` eingebunden: Verbindlich für Agent-Läufe sind `CLAUDE.md`, die
Hooks in `.claude/settings.json` und die Skills in `.claude/skills/`. Ziele werden erst verbindlich, wenn sie umgesetzt sind.

Reifegrad: **Level 3 (Harnessed)** in Teilen erreicht, Level 4 (One-Shot) als Pilot.

---

## 0. Grundsatz

Das Modell entscheidet über das *Wie* des Codes. Der Harness entscheidet, *ob* Tests laufen, *ob* ein PR entsteht und
*was* in die Produktion darf – in Hooks, Prüfskripten, CI und Branch-Regeln, nicht nur im Prompt.

| Regel | Stand |
|---|---|
| Kein Merge ohne grünes Gate: Ruleset auf `main` verlangt die Checks „check“ (verify) und „abhaengigkeiten“ | ✅ |
| Merge = Produktion: Vercel deployt `main` automatisch; Staging-Spiegel und E2E laufen nach jedem Merge | ✅ |
| Agent setzt Auto-Merge auf seinen PR – gemergt wird erst, wenn die Pflicht-Checks grün sind | ✅ (entschieden 12.10.2026: bleibt so) |
| Kontrolle durch den Menschen liegt **nach** dem Merge (Abnahme am Ticket) und **vor** jeder Produktions-Migration – nicht am Merge-Knopf | ✅ entschieden 12.10.2026 |
| Ausnahme: Änderungen am Harness selbst (Hooks, Regeln, Skills) merged Jörgen nach Review | ✅ |
| Abnahme durch Jörgen: Ticket „In Überprüfung“ mit Abnahmeschritten, „Erledigt“ setzt nur Jörgen | ✅ |
| Produktions-Migration nur nach ausdrücklichem „OK, einspielen“ (nach Staging, DB-Tests, Rollback-Probelauf) | ✅ Ablauf · `apply_migration` bleibt bewusst in der Allow-Liste (entschieden 12.10.2026): das OK kommt im Chat, eine zweite Bestätigung im Werkzeug brächte nur Klick-Müdigkeit |

---

## 1. Artefakte

| Artefakt | Rolle | Stand |
|---|---|---|
| `CLAUDE.md` | Projektregeln (Stack, Konventionen, Sicherheits- und Buchungsregeln) | ✅ – ca. 200 Zeilen, bewusst detailreich (Freeze, Storno, RLS, Behördenmeldungen) |
| Jira-Projekt KAN | Stories und Befunde (Label `claude`, UAT-Befunde `uat-wochenende`), Entscheidungen als Kommentar, Abnahme als Kommentar | ✅ |
| Confluence SOFTWAREEN | Projekt-Wiki, UAT-Drehbuch, Analysen | ✅ |
| `STABILITAET.md` | Testabdeckung je Bereich, Lücken nach Risiko, manuelle Szenarien | ✅ |
| `docs/requirements.md` (REQ-xxx mit Gherkin) | fachliche Anforderungen je Modul | ⬜ heute in Jira-Tickets und Confluence |
| `docs/system-design.md` (Architektur, Datenmodell, ADR) | | ⬜ heute in `CLAUDE.md`, Migrationskommentaren und Confluence |
| `docs/tasks.md` (Story → Tasks → Metriken) | | ⬜ heute Plan als Jira-Kommentar (`/story`) |
| Scoped Rules `.claude/rules/*.md` | Regeln je Bereich statt global | ⬜ |

---

## 2. Blueprint „Story → PR“ (agentisch ○ / deterministisch ●)

```
● 1  Kontext            Jira-Ticket inkl. Kommentare und Anhänge, Doppel-Suche, betroffener Code   ✅ (/story)
○ 2  Evaluate           Readiness-Score (Ziel, Prüfbarkeit, Größe, Risiko, Testbarkeit)              ✅ (/story)
●    Gate A             Score < 70 → Fragen am Ticket, „In Abklärung“, kein Code                   ✅ (/story)
○ 3  Plan               Tasks ≤ 1 h mit Prüfbefehl, Migrations-Task mit OK-Gate                     ✅ (/story)
●    Gate B             Jörgen gibt den Plan frei                                                   ✅ (/story, Ablauf)
○ 4  Implement          eigener Worktree (.claude/worktrees/…), Branch claude/…                    ✅
●    PreToolUse-Hook    Blockliste: Force-Push, reset --hard, clean -f, rm -rf im Repo,             ✅ (guard.js)
                        .env*, eingespielte Migrationen, Schlüssel/Tokens, Produktion per CLI
●    PostToolUse-Hook   schnelle Prüfung je Änderung (tsc/eslint inkrementell)                      ⬜ (tsc dauert hier Minuten)
○ 5  Self-Review        Diff gegen Ticket und Guard Rails, festes Format                            ✅ (/review)
●    Stop-Hook          „fertig“ nur mit grünem `npm run verify` für genau diesen Stand             ✅ (done-gate.js)
● 6  CI                 GitHub Actions: volles verify-Gate je PR; Vercel-Preview                    ✅
●    nach Merge         Staging-Spiegel → E2E (Playwright) inkl. Mandantentrennung                  ✅
●    Gate C             max. 2 CI-Runden, danach Mensch                                             ✅ Regel + Metrik (siehe 8, Nr. 6)
● 7  PR                 Beschreibung mit Inhalt, Prüfung; Metrik-Block                              🟡 Metrik-Block neu (/review)
○/● 8 Abnahme           Jörgen prüft nach den Schritten am Ticket, setzt „Erledigt“                 ✅
```

---

## 3. Deterministische Gates, die es heute gibt ✅

Das ist der eigentliche Kern des Harness – älter als diese Datei und im Alltag bewährt:

- **`npm run verify`** (lokal und in der CI, Pflicht-Check auf `main`): Typprüfung des ganzen Programms, ESLint mit
  Baseline je Regel (keine neuen Warnungen), über 3.200 Unit-Tests (`node:test`, `scripts/tests/`), rund 30 Prüfskripte
  im prebuild, u. a.:
  - Mandantentrennung und Rechte: Zwei-Faktor in jeder API-Route, Betrieb der Seite vor Schreibrechten,
    Abo-Schreibsperre, Paket-Module
  - Buchungsregeln: Stornieren statt Löschen, keine ungeprüften Löschungen, keine `replica`-Tricks
  - Datenqualität: vollständige Mengen über `alle()`, PostgREST-Einbettungen gegen echte Fremdschlüssel,
    keine Typumwandlung in Filtern, Wiener Datum, kaufmännisches Runden
  - Behörden: jede Meldung auch als CSV, gleiche Ladefunktion für Druck und CSV
  - Oberfläche: Barrierefreiheit, Hauptüberschrift je Seite, Schutz ungespeicherter Formulare, Zahlenfelder
- **DB-Testsuite** (`npm run test:db`, nur Staging): rund 75 Testdateien zu RLS, Rollen, Freeze, Storno, RPC-Rechten (inkl.
  IDOR mit fremden Objekten), jede Datei zurückgerollt, **Mutationsprüfung** (Schutz entfernen → Test muss rot werden).
- **Migrationsablauf:** Entwurf → Staging → DB-Tests → Rollback-Probelauf auf Produktion → „OK, einspielen“ →
  `apply_migration` → Datei mit Remote-Version, md5-Vergleich Produktion/Staging, Security Advisor.
- **E2E nach jedem Merge** gegen Staging: Smoke, Rollen, Verkauf/Umzug/Füllung mit Storno, Druck = CSV,
  Mandantentrennung über Seiten, Suche, Exporte und API mit einem eigenen Fremdbetrieb.

---

## 4. Skills ✅ / ⬜

| Command | Zweck | Stand |
|---|---|---|
| `/story KAN-…` | Kontext, Readiness-Score, Gate A, Plan, Gate B | ✅ `.claude/skills/story/SKILL.md` |
| `/review [PR]` | Adversariales Review gegen Ticket und Guard Rails, festes Format, Metrik-Block | ✅ `.claude/skills/review/SKILL.md` |
| `/implement` | Tasks abarbeiten im Worktree | ⬜ heute direkt nach Gate B |
| `/acceptance` | Abnahmeschritte erzeugen | 🟡 Teil von `/story` (Plan) |
| `/status` | offene Tickets und Metriken | ⬜ |

---

## 5. Hooks ✅

`.claude/settings.json`:

- **PreToolUse** (`Bash|PowerShell|Read|Write|Edit|MultiEdit|NotebookEdit`) → `scripts/hooks/guard.js`, Blockliste
  versioniert in `scripts/hooks/regeln.json`. Treffer: Exit 2 mit Begründung, der Agent muss einen anderen Weg wählen.
  Produktion per CLI ist nur als Probelauf erlaubt (SQL-Datei endet mit `ROLLBACK`, kein `COMMIT`).
- **Stop** → `scripts/hooks/done-gate.js`: Sind Dateien unter `src/`, `scripts/`, `e2e/`, `supabase/migrations/` oder
  `package.json` geändert, muss der Stempel des letzten grünen `npm run verify` (`.claude/verify-stempel`, geschrieben
  von `scripts/hooks/verify-stempel.js` als letzter Schritt von verify) zu genau diesem Stand passen – sonst arbeitet der
  Agent weiter. Bewusst unfertig: lokale Datei `.claude/done-gate-aus`.
- Tests: `scripts/tests/hooks-guard.test.mjs` (echte Befehle aus den Sitzungen, erlaubt und blockiert).

---

## 6. MCP und Werkzeuge

| Server | Zweck | Stand |
|---|---|---|
| Supabase MCP | Schema, Logs, Advisor; `apply_migration` | ✅ · Schreiben auf Staging frei, auf Produktion nur nach „OK, einspielen“ (Ablauf; Allow-Liste bewusst beibehalten) |
| Atlassian MCP | Jira-Tickets, Kommentare, Übergänge, Anhänge; Confluence | ✅ |
| GitHub | `gh` CLI: PR, Checks, Auto-Merge | ✅ |
| Vercel MCP | Deployments, Laufzeitfehler | ✅ lesend |
| Protokoll je Run (`runs/<id>/tools.log`) | Audit-Trail | ⬜ heute: Sitzungsprotokolle von Claude Code, Bestandsprotokoll in der DB |

---

## 7. Isolation

- ✅ Git-Worktree je Arbeitsstrang (`.claude/worktrees/…`), parallele Sitzungen ohne Konflikte.
- ✅ Staging-Projekt (`sjpeghrlhsowmquacjhb`) mit Demo- und Fremdbetrieb; DB-Tests und schreibende E2E nur dort.
- 🟡 Produktivdaten: Agent liest bei Befunden gezielt Produktion (z. B. Ursache eines Fehlers), schreibt dort nur über
  freigegebene Migrationen. ⬜ Ziel: Lesen nur über eine anonymisierte Kopie.
- ⬜ Sandbox-Container ohne Internet statt Worktree.

---

## 8. Guard Rails

| # | Regel | Durchgesetzt durch | Stand |
|---|---|---|---|
| 1 | Kein Zugriff auf `.env*`, Schlüssel, Tokens | guard.js (Dateien, Befehle, Inhalte) | ✅ |
| 2 | Keine Migration ohne RLS/REVOKE/search_path; Advisor nach jeder Migration | Prüfskripte, DB-Tests 01/18, Ablauf | ✅ |
| 3 | Keine destruktiven Git-/Shell-Befehle, keine Force-Pushes | guard.js | ✅ |
| 4 | Eingespielte Migrationen und `migrations_legacy/` unveränderlich | guard.js | ✅ |
| 5 | „Fertig“ nur mit grünem verify | done-gate.js, CI-Pflicht-Check | ✅ |
| 6 | Max. 2 CI-Runden, danach Mensch: nach dem zweiten roten „check“ auf demselben PR kein weiterer Push – Befund als Jira-Kommentar, Ticket „In Abklärung“, Jörgen zuweisen | Regel in `/review`, Metrik `ci_rounds` | ✅ Regel · bewusst nicht technisch (siehe unten) |
| 7 | Je Run: Ticket, Regel-Version, Tool-Calls, Dauer, Tokens protokolliert | – | ⬜ (Regel-Version steht in jeder Guard-Meldung) |
| 8 | Personenbezogene Daten nur synthetisch in Tests | Testdaten „E2E-Test …“, Fremdbetrieb | ✅ Tests · 🟡 Analyse von Befunden |
| 9 | Externe Netzzugriffe nur auf freigegebene Hosts | – | ⬜ |

**Gate C – warum nur Regel (Entscheidung 12.10.2026):** Rote CI-Läufe sind selten, weil der Stop-Hook schon lokal
ein grünes `verify` für genau diesen Stand verlangt – die CI wiederholt dasselbe Gate. Eine technische Sperre bräuchte
entweder einen zusätzlichen Workflow (kostet GitHub-Actions-Minuten, die knapp sind) oder einen `gh`-Aufruf im
Guard-Hook vor jedem `git push` (Netzwerk, Verzögerung, Fehlerquelle). Die Metrik `ci_rounds` zeigt, ob das reicht:
Liegt sie im Schnitt über 1,5, wird Gate C technisch (Guard-Hook zählt rote Läufe des Branches vor dem Push).

---

## 9. Metriken je Story

Block im PR bzw. aus `/review`:

```
story: KAN-326
readiness: 85
time_to_pr: 2h10
hook_failures: 0
ci_rounds: 1
review_findings: 0
```

⬜ Auswertung über Wochen (Ziel im Pilot: 20 Stories evaluiert, ≥ 12 umgesetzt, CI-Runden Ø ≤ 1,5).

---

## 10. Vorzeigbar

- ✅ Live: `/story KAN-…` → Readiness und Plan; Umsetzung im Worktree mit Guard-Alarm (z. B. `git push --force` oder
  `cat .env.local` wird geblockt) und Stopp-Gate; PR mit grünem verify; E2E nach Merge; Abnahme am Ticket.
- ✅ Belege aus dem Betrieb: UAT 11.10.2026 – sieben Befunde (KAN-324 bis -330) am selben Tag behoben, davon eine
  Migration mit Staging, DB-Test, Rollback-Probelauf und OK; ein Befund im zweiten Anlauf (ehrlich dokumentiert).
- Übertragbar auf ATHENA: gleiche Struktur, andere deterministische Knoten (Gradle/ktlint/detekt statt tsc/eslint,
  Angular-Tests statt node:test, Jira-Trigger bleibt).

---

## 11. Nächste Stufe → Level 4

- ⬜ Trigger aus Jira (Label `claude`) statt manuellem Aufruf.
- ⬜ Evaluator-Agent als eigener Lauf vor der Umsetzung.
- ⬜ Gate C technisch – nur falls `ci_rounds` im Schnitt über 1,5 liegt.
- ✅ Entschieden 12.10.2026: Auto-Merge bleibt; `apply_migration` bleibt in der Allow-Liste; Gate C als Regel + Metrik.
- ⬜ Regeln aus Review-Befunden vorschlagen (Agent öffnet PR auf Prüfskripte/Regeln) – heute gelebt als „Sweep“:
  Fehlerklasse finden, beheben, Prüfskript dagegen.
