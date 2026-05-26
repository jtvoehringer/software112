# Software:112 – Entwicklungspfad

**Stand:** Mai 2026 | **Autor:** IC&P Consultants e.U.  
**Projektstart:** Dienstag, 27. Mai 2026

---

## Phase 0 – Fundament & Setup ⬅️ Start Dienstag

**Ziel:** Projekt-Infrastruktur steht, bevor die erste Zeile Produktivcode geschrieben wird.

| Aufgabe | Details |
|---|---|
| Anforderungen & Scope klären | Was löst Software:112? Zielgruppe, Kernfunktionen, Abgrenzung |
| Datenmodell & Wireframes | Kernentitäten definieren, UI-Flows skizzieren |
| Supabase-Projekt anlegen | DB, Auth, RLS-Grundstruktur, Umgebungsvariablen |
| **Vercel-Projekt anlegen** | **Deployment-Pipeline von Anfang an aktiv — nicht erst später!** |
| Next.js-Scaffold aufsetzen | App Router, TypeScript, Tailwind, Supabase-Client |
| Stripe-Integration vorbereiten | Stripe-Account, API-Keys, Webhook-Endpoint anlegen |
| CI/CD: GitHub → Vercel | Automatisches Deploy bei Push auf `main` |
| Umgebungsvariablen | `.env.local` + Vercel-Dashboard komplett befüllen |

> **Warum Vercel in Phase 0?**  
> Bei KPS Smart Buchhaltung wurde Vercel erst spät eingeplant — das kostet Zeit bei der Konfiguration (Umgebungsvariablen, Cron-Jobs, Domain). Software:112 startet von Anfang an deployed, sodass jede Phase sofort in der echten Umgebung testbar ist.

---

## Phase 1 – MVP Core

Kernfunktionen des Produkts (je nach Scope-Definition in Phase 0).

- Authentifizierung (Rollen je nach Bedarf)
- Hauptdatenerfassung (produktspezifisch)
- Basis-Dashboard
- Stripe-Zahlungsintegration (Kreditkarte / SEPA)

---

## Phase 2 – Automatische Rechnungsstellung (Daueraufträge)

**⚠️ Bereits in Phase 2 einplanen — nicht als Nachgedanke!**

Das Dauerauftrag-Modul aus KPS Smart Buchhaltung wird als **shared library** wiederverwendet:

```
src/lib/dauerauftraege/          ← aus KPS Smart Buchhaltung übernehmen
  ├── verarbeitung.ts
  ├── faelligkeit.ts
  └── types.ts
```

Komponenten:
- DB-Tabellen `dauerauftraege` + `dauerauftrag_log` (identisches Schema)
- Vercel Cron Job `/api/cron/dauerauftraege` (täglich 05:00 UTC)
- UI: Dauerauftrag-Konfiguration je Mandant/Kunde
- IC&P Eigenrechnung (monatliche Honorarrechnung automatisch)

**Aufwand:** ~0,5 Tage (weil shared lib bereits fertig) vs. 5 Tage bei Neuentwicklung.

---

## Phase 3 – Polish & Scale

- Mobile UX
- Erweiterte Auswertungen
- DATEV/BMD-Export (falls relevant)
- Weitere Zahlungsmethoden

---

## Technischer Stack

| Komponente | Technologie |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS |
| Backend/DB | Supabase (PostgreSQL + Auth + RLS) |
| Hosting | **Vercel (ab Phase 0)** |
| Zahlungen | Stripe (Kreditkarte + SEPA) |
| Rechnungsversand | Resend (E-Mail) |
| Automatisierung | Vercel Cron Jobs |
| Entwicklungspartner | Claude (Anthropic) |

---

## Wichtige Abgrenzung

- **Stripe** → NUR Software:112 (nicht KPS Smart Buchhaltung)
- **Chargebee** → NUR KPS Smart Buchhaltung (falls SEPA-Einzug gewünscht, Phase 3+)
- **Dauerauftrag-Modul** → beide Projekte, shared library

---

*Dokument erstellt mit IC&P Consultants e.U. – Software:112 Projektstart*
