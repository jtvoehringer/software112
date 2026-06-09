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
| 003       | Kellerbuch: Behälter, Weinausbau-Chargen |
| 004–012   | DAC, Prüfnummern, Erntemeldung, PSM, Behandlungen, Rebsorten, Jahrgänge, Analysen, Grundstücke |
| 013       | Lagen-Tabelle (Rieden) + Grundstücke-Status |
| 014       | Behandlungen auf Grundstück-Ebene (Junction-Tabelle) |
| 015       | Behandlungen Erweiterung: art, menge, cu_gehalt_pct, flaeche_ha Snapshot |
| 016       | PSM-Lagerverwaltung: Anfangsbestand, Einkauf, Inventurkorrektur |
| 017       | Qualitätsstufe in weinausbau + Umziehen-Protokoll |
| 018       | Pressungen (Lese → Most → Behälter) |
| 019       | CRM Stammdaten: kontakte, firmen, Kundensegmente |
| 020       | CRM Bewegung: aktivitaeten, pipeline_eintraege, Preislisten |
| 021       | Tenant-Einstellungen: Branding, Module-Toggles, Brevo-Key |
| 022       | Weinhandel: fuellungen (Abfüllungsereignisse = Weinlager-Artikel) |
| 023       | Kellerplan: kellerplaene + kellerplan_positionen (Behälter-Grundriss) |
| 024       | Weinhandel: preislisten + preislisten_positionen (Mehrere Preislisten gleichzeitig aktiv) |
| 025       | Weinhandel: verkaufsposten + verkauf_positionen (Flasche/Tank/Sonstiges, Bestandsreduktion) |
| 026       | Rechnungsnummer: rechnung_prefix/zaehler/stellen in tenant_einstellungen + get_next_rechnungsnummer() RPC |
| 027       | Stornierung: storniert/storniert_am in verkaufsposten; Kundennummern in kontakte/firmen; kunden_prefix/zaehler/stellen + get_next_kundennummer() RPC; aktivitaeten.art += 'verkauf' |
| 028       | CRM Erweiterungen: aktivitaeten += ganztags/uhrzeit_von/uhrzeit_bis; pipeline_eintraege += kategorie/erledigt/erledigt_am |
| 029       | Pipeline Uhrzeit: pipeline_eintraege += ganztags/uhrzeit_von/uhrzeit_bis |
| 030       | Betriebsdaten + Rechnung: tenant_einstellungen += betrieb_*/rechnung_*; verkauf_positionen += ust_satz |
| 031       | Bezahlt-Status + Rabattgruppen: verkaufsposten += bezahlt/bezahlt_am; neue Tabelle rabattgruppen; kontakte/firmen += rabattgruppe_id; verkauf_positionen += rabatt_pct/sonderrabatt_pct |
