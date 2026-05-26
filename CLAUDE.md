# software:112 – Projektkontext für Claude

## Über den Auftraggeber

- **Name:** Jörgen Vöhringer (IC&P Consultants e.U.)
- **Anrede:** Du (wir sind per Du)
- **E-Mail:** jv@icp-consultants.at
- Wenn der vollständige Name verwendet werden muss/soll: **Jörgen Vöhringer**

## Projekt

**software:112** – Digitales Weingut-ERP für Familie Gebeshuber (Winzer in NÖ)

- **Tenant-ID Gebeshuber:** `fa22dc07-eca5-43df-af96-f7b9b09f0471`
- **Produktions-URL:** https://software112.icp-consultants.at
- **GitHub:** https://github.com/jtvoehringer/software112
- **Supabase Projekt:** zwcsgnemijkpyxrqykul.supabase.co (Region: West EU Ireland)

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Datenbank:** Supabase (PostgreSQL + RLS + Auth)
- **Hosting:** Vercel (migriert von Netlify, Mai 2026)
- **Auth:** Supabase SSR mit `@supabase/ssr`

## Konventionen

- TypeScript: `(supabase.from('table') as any)` um `never`-Type-Fehler zu vermeiden
- Alle Server Components mit `export const dynamic = 'force-dynamic'` wenn nötig
- CSS-Klassen: `s112-teal`, `s112-muted`, `s112-border`, `s112-bg` (siehe tailwind.config.ts)
- Rollenmodell: `leser` / `winzer` / `tenant_admin`

## Aktuelle Nutzer

| Name   | E-Mail                          | Rolle          |
|--------|---------------------------------|----------------|
| Jörgen | jv@icp-consultants.at           | tenant_admin   |
| Hannes | jg@hohenstein-partner.at        | leser          |
| Paul   | pd@hohenstein-partner.at        | leser          |

## Migrations-Übersicht

| Migration | Inhalt |
|-----------|--------|
| 001       | Initial Schema |
| 002       | RLS Policies |
| 003       | Kellerbuch (Behälter, Chargen) |
| 004–012   | DAC, Prüfnummern, Erntemeldung, PSM, Behandlungen |
| 015       | Behandlungen Erweiterung: art, menge, cu_gehalt_pct, flaeche_ha Snapshot |
