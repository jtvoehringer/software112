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
- **Sprache:** In allen deutschen Texten (UI-Labels, Kommentare, Fehlermeldungen) immer Umlaute verwenden: ä/ö/ü/Ä/Ö/Ü – niemals ae/oe/ue als Ersatz
- **Skript-Sprache:** Python bevorzugt für Datei- und Datenoperationen; Node.js wenn npm-Pakete nötig (z.B. docx); Bash nur für einfache Einzeiler

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
| 032       | Standard-USt pro Mandant: tenant_einstellungen += ust_satz_standard (13% Weinproduzent / 20% Weinhändler) |
| 033       | Sonderrabatt auf Kontakt/Firma: kontakte/firmen += sonderrabatt_pct; wird im Verkaufsformular auto-vorbelegt |
| 034       | Lead-Feld: kontakte/firmen += is_lead (DEFAULT true); neue Datensätze starten als Lead; erster Verkauf → automatisch Kunde |
| 035       | Telefonvorwahl: kontakte += telefon_vorwahl/mobil_vorwahl; firmen += telefon_vorwahl (DEFAULT '+43') |

## Phase 4 – Epics (geplant)

1. **Benutzerhandbuch + FAQs** – In-App Hilfe-Bereich `/hilfe/handbuch` + `/hilfe/faq`, eigener Menüpunkt
2. **Onboarding Guide** – `/admin/onboarding` Checkliste für neue Mandanten
3. **Feature-Rollout-Manager** – Erweiterung modul_*-Toggles: neue Features per Flag, Standard = deploy-to-all
4. **Weinexport-Modul** – EUR.1, CMR, Akkreditiv, V1/V2 (Basic €29/Mo, Pro €59/Mo)
5. **Multi-User E-Mail-Boxen** – user_email_connections Tabelle, mehrere Mailboxen pro Mandant
6. **E-Mail-Threading UI** – verwandte E-Mails via conversationId als Thread-Ansicht
7. **Integrierter E-Mail-Client** – `/nachrichten` Outlook-ähnliche UI (Posteingang, Senden, Ordner), funktioniert mit M365 Graph API + IMAP/SMTP; Auto-Matching gegen Kontakte; inkludiert in E-Mail-Modul-Lizenz

## KI-Modul „Smart Query" (Phase 3 – geplant)

**Produkt:** Separates Zusatzmodul – „Frag dein Weingut" (AI-gestützte Abfragen via Claude Haiku)

**Lizenzmodell:**
| Paket     | Abfragen/Monat | Preis/Monat | Marge (bei ~€0.04 API-Kosten/100 Queries) |
|-----------|---------------|-------------|-------------------------------------------|
| Basic     | 100           | +€ 9        | ~€ 8,96 |
| Standard  | 200           | +€ 19       | ~€ 18,92 |
| Unlimited | unbegrenzt    | +€ 49       | ~€ 48,80 (bei ø 500 Abfragen) |

**Technische Umsetzung (geplant):**
- `tenant_einstellungen` += `ki_abfragen_aktiv` (bool), `ki_abfragen_paket` (basic|standard|unlimited), `ki_abfragen_zaehler_monat` (int), `ki_abfragen_reset_datum` (date)
- Supabase RPC `check_und_increment_ki_abfrage(p_tenant_id)` → atomarer Zähler + Limit-Check
- Claude Haiku API-Call (Server Action) → strukturierte Query-Parameter (kein rohes SQL)
- RLS greift automatisch → kein Datenleck zwischen Mandanten
- Admin-Tab in Mandantenverwaltung: Paket zuweisen, Verbrauch einsehen

**Features im Modul:**
1. **Smart Query** – Freitexteingabe → KI → gefilterte Tabelle + Zusammenfassung
2. **Besuchsplanung** – Region + Segment + Zeitraum → PLZ-geclusterte Besuchsliste + Karte (Leaflet.js)
3. **Statische Reports** – Monatsumsatz, Lagerbestand, Behandlungsübersicht (ohne KI, immer inkludiert)
