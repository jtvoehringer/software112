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
- DATEV-Export (erst bei Markteintritt DE; BMD-Übergabe ist seit 4.9.2026 umgesetzt)
- Weitere Zahlungsmethoden

---

## Ideen für spätere Phasen (noch nicht beschlossen)

### Flugauftrag für Agrardrohnen (Pflanzenschutz aus der Luft)

Stand 4.9.2026, Entscheidung im Jour fixe am 9.9.2026. Kein To-do.

**Verortung:** Premium-Paket, zusätzlich einmalige Einrichtungsgebühr je Betrieb
(Einmessen der Rieden, Hindernisse, Abstimmung mit dem Drohnen-Dienstleister).

**Idee:** software:112 steuert keine Drohne, sondern erzeugt aus den vorhandenen
Daten den Flugauftrag für eine Agrardrohne (Lohnunternehmer) und nimmt das
Flugprotokoll als Behandlung zurück.

- Datenbasis vorhanden: eAMA-Polygone je Weingarten und Grundstück (bei
  Gebeshuber 52 Weingärten / 234 Grundstücke), Zentrum, Fläche, Feldstück,
  Kennzeichen „spritzbar“; Behandlungen mit Mittel, Aufwandmenge, Wasseraufwand,
  BBCH, Witterung/Wind, Wartezeit. Betriebsstandort als Adresse (Startpunkt →
  einmal geokodieren).
- Stufe 1: Rieden wählen → KMZ/KML mit Polygonen + Sprühparametern
  (Aufwand l/ha, Flughöhe, Bahnabstand) + Auftragsblatt (PDF) mit Start am
  Betriebsstandort, Anzeigedatum für die Behörde, Wartezeit. Aufwand ca. 1–2 Tage.
- Stufe 2: Flugprotokoll der Drohne (DJI Agras, XAG …) importieren → Behandlung
  mit Ist-Fläche/Ist-Menge, Wartefrist-Ampel, Kupferbilanz. Aufwand je nach
  Herstellerformat.
- Je Ried zu erfassen: Zeilenrichtung/Reihenabstand, Hindernisse (Masten,
  Leitungen, Bäume), Pufferzonen, Luftraum lt. Austro-Control-Drohnenkarte.
- Vorbedingungen (nicht Software): Pflanzenschutz aus der Luft ist in der EU
  nur mit Ausnahmebewilligung erlaubt – Bewilligung der Bezirksverwaltungsbehörde
  (Landesrecht; OÖ Pflanzenschutzdrohnen-Verordnung seit 1/2024, NÖ-Praxis
  klären), Anzeige jeder Anwendung, Mittel im BAES-Register für unbemannte
  Luftfahrzeuge zugelassen, Sachkundeausweis; luftfahrtrechtlich Sprühdrohnen
  > 25 kg = „spezielle“ Kategorie (EU 2019/947) mit Austro-Control-Genehmigung.
  Realistisch fliegt ein Dienstleister, nicht der Betrieb.
- Nächster Schritt nach Beschluss: Import-/Exportformat des konkreten
  Drohnen-Dienstleisters ansehen und Stufe 1 daran ausrichten.

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
