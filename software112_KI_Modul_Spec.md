# software:112 – KI-Modul „Frag dein Weingut"
**Phase 3 Feature · Stand: 30. Mai 2026**

## Produktbeschreibung

Separates Zusatzmodul mit Claude Haiku (Anthropic API) als KI-Engine.
Ermöglicht natürlichsprachliche Abfragen auf die eigenen Betriebsdaten – ohne SQL-Kenntnisse.

---

## Lizenzmodell (Zusatz zur Basis-Lizenz)

| Paket | Abfragen/Monat | Preis | API-Kosten ca. | Marge |
|-------|---------------|-------|----------------|-------|
| **Basic** | 100 | **+€ 9/Monat** | ~€ 0,04 | ~99 % |
| **Standard** | 200 | **+€ 19/Monat** | ~€ 0,08 | ~99 % |
| **Unlimited** | unbegrenzt | **+€ 49/Monat** | ~€ 0,20 (ø 500) | ~99 % |

*Haiku Pricing: $0.25/M input tokens · $1.25/M output tokens. Ø Abfrage ~600 tokens = $0.00038 ≈ €0.00035*

---

## Features

### 1. Smart Query (KI-Abfrage)

Freitexteingabe → Claude Haiku → strukturierte Supabase-Query → Tabelle + KI-Zusammenfassung

**Beispiele:**
- „Gastronomie-Kunden in Salzburg, letzter Besuch > 3 Monate"
- „Alle offenen Rechnungen über 500€ diese Woche"  
- „Welche Rebsorte hat den höchsten Umsatz im letzten Quartal?"
- „Leads in Wien mit Segment Handel"

**Flow:**
```
Benutzer tippt Text
  → Server Action ruft Claude Haiku an
    (Prompt: Schema + User-Query + Kontext)
  → Haiku gibt strukturierte Parameter zurück (JSON, kein SQL)
  → Supabase-Query über authenticierte Session (RLS aktiv!)
  → Tabellen-Ergebnis + KI-generierte Zusammenfassung
```

### 2. Besuchsplanung

Dedizierte Seite für Außendienst-Tourenplanung.

**Inputs:**
- Region / PLZ-Bereich
- Segment-Filter (Gastronomie, Handel, Privat, …)
- Zeitraum (nächste Woche, diesen Monat)
- Nur Kunden / Nur Leads / Beides

**Output:**
- PLZ-geclusterte Besuchsliste
- Letzter Kontakt-Termin pro Eintrag
- Offene Pipeline-Einträge
- Optionale Karten-Visualisierung (Leaflet.js, OpenStreetMap – kostenlos)

### 3. Statische Reports (ohne KI, immer inkludiert)

| Report | Beschreibung |
|--------|-------------|
| Monatsumsatz | Verkauf nach Monat, Vergleich Vorjahr |
| Lagerbestand | Top-Weine, Bestand je Füllung |
| Behandlungsübersicht | PSM je Parzelle, Cu-Bilanz |
| Lead-Pipeline | Funnel nach Stufe + Segment |
| Kundenkontaktfrequenz | Tage seit letztem Kontakt |
| Offene Posten | Überfällige Rechnungen |

---

## Technische Architektur

### Neue Datenbank-Felder (tenant_einstellungen)
```sql
ALTER TABLE tenant_einstellungen
  ADD COLUMN ki_abfragen_aktiv       boolean DEFAULT false,
  ADD COLUMN ki_abfragen_paket       varchar(10) DEFAULT 'basic', -- basic|standard|unlimited
  ADD COLUMN ki_abfragen_zaehler     integer DEFAULT 0,
  ADD COLUMN ki_abfragen_reset_datum date DEFAULT current_date;
```

### RPC: Zähler + Limit-Check (atomar)
```sql
CREATE OR REPLACE FUNCTION check_und_increment_ki_abfrage(p_tenant_id uuid)
RETURNS jsonb AS $$
DECLARE
  limit_map jsonb := '{"basic":100,"standard":200,"unlimited":999999}'::jsonb;
  rec record;
BEGIN
  SELECT ki_abfragen_aktiv, ki_abfragen_paket, ki_abfragen_zaehler, ki_abfragen_reset_datum
  INTO rec FROM tenant_einstellungen WHERE tenant_id = p_tenant_id FOR UPDATE;
  
  -- Monats-Reset
  IF rec.ki_abfragen_reset_datum < date_trunc('month', current_date) THEN
    UPDATE tenant_einstellungen SET ki_abfragen_zaehler = 0, ki_abfragen_reset_datum = current_date
    WHERE tenant_id = p_tenant_id;
    rec.ki_abfragen_zaehler := 0;
  END IF;
  
  -- Limit-Prüfung
  IF rec.ki_abfragen_zaehler >= (limit_map->>rec.ki_abfragen_paket)::int THEN
    RETURN jsonb_build_object('erlaubt', false, 'verbraucht', rec.ki_abfragen_zaehler);
  END IF;
  
  -- Zähler erhöhen
  UPDATE tenant_einstellungen SET ki_abfragen_zaehler = ki_abfragen_zaehler + 1
  WHERE tenant_id = p_tenant_id;
  
  RETURN jsonb_build_object('erlaubt', true, 'verbraucht', rec.ki_abfragen_zaehler + 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Server Action (Next.js)
```typescript
'use server'
import Anthropic from '@anthropic-ai/sdk'

export async function smartQuery(fragetext: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  
  // 1. Limit prüfen (atomar)
  const { data: check } = await supabase.rpc('check_und_increment_ki_abfrage', 
    { p_tenant_id: tenantId })
  if (!check.erlaubt) throw new Error('Abfrage-Limit erreicht')
  
  // 2. Claude Haiku aufrufen
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Du bist ein Weinbau-ERP-Assistent. Übersetze folgende Frage in strukturierte Query-Parameter (JSON).
Schema: kontakte(id, vorname, nachname, segment, ort, plz, land, is_lead), firmen(id, name, segment, ort, plz, is_lead), aktivitaeten(datum, art, erledigt), verkaufsposten(datum, bezahlt, storniert)
Antwort NUR als JSON ohne Erklärung.
Frage: "${fragetext}"`
    }]
  })
  
  // 3. Parameter parsen + Query ausführen (über RLS)
  const params = JSON.parse(response.content[0].text)
  // ... Query-Ausführung ...
}
```

---

## Zeitplan (Phase 3)

| Sprint | Thema | Aufwand |
|--------|-------|---------|
| Phase 3 Start | Statische Reports (6 Templates) | 2–3 Tage |
| Phase 3 Mitte | Smart Query + Haiku-Integration | 2 Tage |
| Phase 3 Ende | Besuchsplanung + Leaflet-Karte | 2–3 Tage |
| Admin | Paket-Zuweisung + Verbrauchsanzeige | 1 Tag |

**Gesamt: ~8 Tage | starker USP + dauerhafter Umsatzbeitrag**
