# software:112 – Projektdokumentation

Stand: 12.06.2026

---

## Zusammenarbeit Jörgen ↔ Claude

### Datenbankänderungen (Supabase)
Claude erstellt SQL-Migrations-Skripte (Dateien unter `supabase/migrations/`). Jörgen führt das SQL zusätzlich manuell im **Supabase SQL Editor** aus, damit die Änderungen sofort in der Sandbox-Datenbank aktiv sind – ohne auf einen Deployment-Zyklus warten zu müssen.

### Git / Deployments (Vercel)
Claude liefert die fertigen `git add … && git commit … && git push`-Befehle. Jörgen führt diese im **VS Code Terminal** aus – Jörgen ist immer bereits im Projektverzeichnis, daher **kein `cd`-Befehl** voranstellen. Push auf `main` löst automatisch ein Vercel-Deployment aus.

### Generelle Arbeitsweise
- Claude schreibt Code und SQL, Jörgen reviewed und führt aus.
- Pfade mit Sonderzeichen (`(dashboard)`, `[id]`) in PowerShell immer mit doppelten Anführungszeichen quoten:  
  `git add "src/app/(dashboard)/..."` statt Backtick-Escaping.

---

## Projektziele & Vision

**software:112** ist ein digitales Weingut-ERP, entwickelt für Familie Gebeshuber (Winzer in NÖ). Ziel ist die vollständige Digitalisierung der betrieblichen Abläufe: von der Lese über Keller und Weinhandel bis hin zu Behörden-Meldungen und Export.

Betreiber und Hersteller: Hohenstein Consulting Solutions (Jörgen Vöhringer)

---

## Auftraggeber & Stakeholder

| Rolle | Name | Kontakt |
|---|---|---|
| Entwickler / Betreiber | Jörgen Vöhringer | jv@icp-consultants.at |
| Endkunde (Pilot) | Familie Gebeshuber | Winzer NÖ |
| Berater / Leser | Hannes | jg@hohenstein-partner.at |
| Berater / Leser | Paul | pd@hohenstein-partner.at |

---

## Technischer Stack

| Komponente | Technologie |
|---|---|
| Framework | Next.js 16, App Router, TypeScript, Tailwind CSS |
| Datenbank | Supabase (PostgreSQL, RLS, Auth) |
| Hosting | Vercel (seit Mai 2026) |
| Auth | Supabase SSR mit `@supabase/ssr` |
| Repo | github.com/jtvoehringer/software112 |
| Supabase Projekt | zwcsgnemijkpyxrqykul.supabase.co (West EU Ireland) |

---

## Modul-Übersicht

| Modul | Pfad | Status |
|---|---|---|
| Erntemeldung / Pressungen | `/erntemeldung` | ✅ live |
| Kellerbuch | `/kellerbuch` | ✅ live |
| Kellerplan | `/kellerplan` | ✅ live |
| Lesedaten | innerhalb Erntemeldung | ✅ live |
| Weinhandel (Verkauf, Preislisten, Füllungen) | `/weinhandel` | ✅ live |
| CRM (Kontakte, Firmen, Pipeline, Kalender) | `/crm` | ✅ live |
| Weinexport (EUR.1, CMR, V1/V2, …) | `/weinexport` | ✅ live |
| E-Mail-Client / Nachrichten | `/nachrichten` | ✅ live |
| KI-Modul „Frag dein Weingut" | `/ki` | ✅ live |
| PSM-Lagerverwaltung | `/psm` | ✅ live |
| Kostenrechnung | `/kosten` | ✅ live |
| Benutzerhandbuch + FAQ | `/hilfe` | ✅ live |
| Onboarding Guide | `/admin/onboarding` | ✅ live |

---

## Aktuelle Tenants

| Tenant | ID | Zweck |
|---|---|---|
| Sandbox | `fa22dc07-eca5-43df-af96-f7b9b09f0471` | Entwicklung & UAT |
| Weinbau Gebeshuber | – | Wird nach UAT-Abschluss angelegt |

---

## Release-Historie (Kurzfassung)

| Datum | Inhalt |
|---|---|
| Jun 2026 | Phase 4: Weinexport, E-Mail-Client, KI-Modul, Dashboard-Redesign, Rückverfolgbarkeit, Transaktionsnummern |
| Mär–Mai 2026 | Phase 3: CRM, Weinhandel, Preislisten, Abfüllungen, Kellerplan |
| Jan–Feb 2026 | Phase 2: Kellerbuch, PSM, Behandlungen, Kostenrechnung |
| Nov–Dez 2025 | Phase 1: Grundgerüst, Auth, Erntemeldung, Grundstücke |
