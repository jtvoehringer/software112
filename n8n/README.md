# n8n Workflows – software:112

## Setup

1. **n8n-Instanz:** Self-hosted oder n8n Cloud (https://n8n.io)
2. **Umgebungsvariablen** in n8n Settings → Environment Variables:
   ```
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```

## Workflows

| Datei | Workflow | Trigger | Status |
|---|---|---|---|
| `01_ama_erntemeldung.json` | AMA Jahres-Erntemeldung | Webhook (manuell aus UI) | Template |
| `02_oewm_analysen_import.json` | ÖWM Weinanalyse-Import | Cron täglich 06:00 | Template |

## Import

1. n8n öffnen → Workflows → Import from File
2. JSON-Datei hochladen
3. Credentials konfigurieren
4. Workflow aktivieren

## Geplante Workflows (Phase 2+)

- `03_wartezeiten_check.json` – Täglich prüfen ob Wartezeiten eingehalten (Pflanzenschutz → Ernte)
- `04_dauerauftrag_rechnungen.json` – Monatliche Rechnungsstellung
- `05_bmd_export.json` – BMD NTCS Buchhaltungs-Export
- `06_finanzOnline.json` – FinanzOnline Meldungen
