# software:112 – Weinexport-Modul
**Phase 4 Epic · Stand: Juni 2026**

## Produktbeschreibung

Modul für den professionellen Weinexport – EU-Binnenmarkt und Drittländer.
Verwaltung aller Export-relevanten Dokumente, Akkreditive und Zollformalitäten.

## Scope

### EU-Binnenmarkt
- **V1/V2-Begleitdokumente** (Simplified Accompanying Document) für Weinbewegungen
- **EUR.1 Ursprungszeugnis** (Präferenzhandel mit Partnerländern)
- **EMCS-Integration** (Electronic Movement and Control System) via n8n
- Lieferschein + Rechnung in Exportformat (Mehrsprachig: DE/EN)

### Drittländer (Weltweit)
- **Akkreditiv-Management (L/C)** – Letter of Credit Verwaltung: Eröffnung, Dokumente, Fristen
- **CMR-Frachtbrief** (Convention Marchandise Routière) – Straßentransport
- **Certificate of Origin** – Handelsursprungszeugnis (Wirtschaftskammer AT)
- **Phytosanitäres Zertifikat** (für bestimmte Zielmärkte)
- **TARIC-Codes** – Zolltarifnummern für Wein (2204.xx)
- **Exportkreditversicherung** (OeKB) – Verknüpfung mit Akkreditiv

### Verwaltung
- Exportkunden (Importeure/Distributoren) – spezifische Felder: Importlizenz, Zollnummer, L/C-Bank
- Exportaufträge mit Lieferterminen, Incoterms, Versicherungswert
- Dokumenten-Checkliste je Export (was fehlt noch?)
- Exportstatistiken (Menge, Wert, Destination)

## Lizenzmodell

Separates Modul (nur für exportierende Betriebe):
- **Weinexport Basic**: EU-Dokumente (V1/V2, EUR.1) → +€ 29/Monat
- **Weinexport Pro**: + Drittländer, Akkreditiv-Management → +€ 59/Monat

## Technischer Aufwand

| Schritt | Aufwand |
|---------|---------|
| Datenmodell (Exportaufträge, Akkreditive, Dokumente) | 2 Tage |
| EU-Dokumente (V1/V2, EUR.1) als druckbare PDFs | 3 Tage |
| CMR-Frachtbrief + Certificate of Origin | 2 Tage |
| Akkreditiv-Management UI | 3 Tage |
| EMCS-Integration via n8n | 3 Tage |
| **Gesamt Basic** | **~5 Tage** |
| **Gesamt Pro** | **~13 Tage** |

## Phase

Phase 4 – nach Abschluss Phase 3 (Vollversion)
