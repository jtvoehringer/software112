# software:112 – Projektdokumentation

Stand: 12.06.2026

---

## Zusammenarbeit Jörgen ↔ Claude

### Datenbankänderungen (Supabase)
Claude erstellt SQL-Migrations-Skripte (Dateien unter `supabase/migrations/`). Jörgen führt das SQL zusätzlich manuell im **Supabase SQL Editor** aus, damit die Änderungen sofort in der Sandbox-Datenbank aktiv sind – ohne auf einen Deployment-