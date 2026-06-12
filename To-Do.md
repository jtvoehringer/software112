# software:112 – Offene To-Dos

Stand: 12.06.2026 · Aktiver Tenant: **Sandbox** (`fa22dc07-eca5-43df-af96-f7b9b09f0471`) · Tenant „Weinbau Gebeshuber" wird erst nach UAT eingerichtet

---

## 🔴 Sofortmaßnahmen (diese Woche)

### Commit ausstehender Änderungen
`commit_pending.ps1` ausführen – enthält alle Änderungen seit letztem Push:
Migration 083, Auto-Weinausbau, Pressung Weinbezeichnung, KMW-Übersicht, Kellerbehandlung °C, Lesedaten kg, TypeScript-Fix.

### Bestehende Pressungen neu speichern (Gebeshuber)
Pressungen A01 + A02 in „Bearb." öffnen und speichern, damit der Auto-Weinausbau rückwirkend greift.

---

## 🟡 Kurzfristig (Phase 4 – UAT)

### UAT – Gebeshuber testet alle Module
Echtbetrieb-Test aller Module durch Familie Gebeshuber (geplant Juni 2026). Feedback sammeln, Bugs priorisieren.
Nach UAT-Abschluss: neuen Produktiv-Tenant **„Weinbau Gebeshuber"** anlegen und befüllen (Sandbox-Tenant bleibt als Testumgebung erhalten).

### Transaktionsnummern – Ausbau
Kernimplementierung (Migration 077, RPC, UI in 4 Tabellen) ist abgeschlossen. Noch offen: Anzeige in Berichten/PDF-Exporten, ggf. Erweiterung auf weitere Bewegungsarten.

### Datenhistorisierung ⚠️ *noch zu definieren*
Anforderung: Historisierung von Änderungen an Stamm- und Bewegungsdaten (z.B. wer hat wann was geändert?). Scope und Umsetzungsansatz noch offen – Klärung erforderlich:
- Welche Tabellen / Felder sollen historisiert werden?
- Audit-Log-Tabelle (einfach) oder Temporal Tables (vollständig)?
- Lesezugriff für Nutzer (UI) oder nur für Admin/Export?

### Kapazitätsdarstellung Gebinde
Analyse abgeschlossen (Optionen A–D), Entscheidung steht aus:
- **Option A** – Mini-Progress-Bar in der Gebinde-Tabelle (Füllstand %)
- **Option B** – Freier Platz im Umziehen-Dropdown (`Stahltank 1 (frei: 1.800 L)`)
- **Option C** – Fill-Level-Visualisierung im Kellerplan (Kreise mit Farbsektor)
- **Option D** – `volumen_liter` als Pflichtfeld (Voraussetzung für A–C)

Empfehlung: A + B als erster Schritt, D parallel als Datenqualitäts-Maßnahme.

---

## 🔵 Mittelfristig (vor Kunde #2)

### Stripe / Mandanten-Abrechnung
Zwingend erforderlich vor dem zweiten zahlenden Kunden: Stripe-Integration, Abo-Verwaltung, automatische Rechnungsstellung.

### Blend-Protokoll (Rückverfolgbarkeit Feature 5)
Wenn zwei Chargen gemischt werden: explizites Mischungsprotokoll (Quelle A: X%, Quelle B: Y%). Traceability bleibt bei Blends erhalten. (Features 1–4 der Rückverfolgbarkeit sind bereits abgeschlossen.)

### Testautomatisierung + Regressionstests
Smoke Tests + Playwright E2E nach UAT-Abschluss. Vor dem Launch weiterer Kunden unverzichtbar.

### SheetJS XLSX-Export
KI-Abfragen + Auswertungen als formatiertes Excel exportieren (Spaltenbreiten, Summenzeilen, Tabellenformat) – statt nur CSV.

---

## ⚪ Langfristig / optional

### Dauerauftrag-Modul
IC&P Eigenrechnung automatisieren (ca. 0,5 Tage, shared lib aus KPS-Projekt).

### EMCS-Integration via n8n
Weinexport Pro (€59/Mo). Elektronische Begleitdokumente für den Export in EU-Steuerlager.

### Kostenrechnung Multi-Weingarten
Kostenverteilung auf mehrere Weingärten (gleichmäßig oder gewichtet %) via Junction-Tabelle.

### Mobile UX / PWA
PWA oder native App – bei konkretem Kundenbedarf.

---

## ✅ Zuletzt abgeschlossen (Juni 2026)

- Kellerbuch Auto-Weinausbau: Pressung erstellt automatisch Weinausbau-Charge (Status „Gärung")
- Pressung: Bezeichnungsfeld (z.B. „Gemischter Satz") mit Badge-Anzeige · Migration 083
- Lesedaten: optionales kg-Feld in Mehrfacherfassung
- KMW-Durchschnitt in Jahrgänge-Übersicht
- Kellerbehandlung: °C als neue Einheit
- Lagen-Dropdown + lage_id-Synchronisation · Migrationen 082
- Dezimalkomma: durchgängig de-AT Formatierung
- Behandlungen: Edit-Funktionalität, Berichte ohne Grundstücke
- Transaktionsnummern: Migration 077 + RPC + UI (4 Tabellen)
- Eröffnungsbestand: Einheitspreis
- Kellerplan: Füllstand-Visualisierung + v_behaelter_fuellstand View
- Rückverfolgbarkeit: Auto-Chargennummer, Rückverfolgungsseite, QR-Code, KMW in Pressung
- KI-Modul: Token-Tracking (ki_input/output_tokens_total)
- Dashboard-Redesign: KPI-Karten, CommandPalette, Skeleton-Loading, Sidebar Collapse
- E-Mail-Client: Threading, Inline-Body, Shared Mailbox, Löschen
- Weinexport-Modul: EUR.1, V1/V2, CMR, Certificate of Origin, Lieferschein, Rechnung
