-- KAN-439 (13.11.2026): Weinexport E2 – Steuerfall in der UVA (Kennzahlen 011 und 017).
--
-- Bisher kannte die UVA nur die Summe der Umsätze zu 0 % – ohne Kennzahl, mit dem Hinweis, sie von Hand aufzuteilen.
-- Seit KAN-436 E1 trägt ein Verkauf aus dem Exportauftrag seinen Steuerfall (igl = innergemeinschaftliche Lieferung,
-- ausfuhr = Ausfuhrlieferung). Entscheidungen Jörgen 13.11.2026 (alle Fragen A):
--   1A in 011/017 zählen nur Verkäufe mit gespeichertem Steuerfall – übrige 0-%-Umsätze bleiben ohne Kennzahl
--   2A E&A-Betriebe nach Zahlungseingang (wie die übrige UVA), Doppik-Vorschau nach Rechnungsdatum
-- bmgl_0 bleibt die Summe aller 0-%-Umsätze (wie bisher); bmgl_ausfuhr und bmgl_igl sind Teilmengen davon.
-- Schon gespeicherte UVA behalten 0 in den neuen Spalten, bis sie neu berechnet werden; übermittelte bleiben unverändert.

ALTER TABLE public.ea_uva
  ADD COLUMN bmgl_ausfuhr numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN bmgl_igl     numeric(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.ea_uva.bmgl_ausfuhr IS 'KAN-439: Ausfuhrlieferungen (Kennzahl 011) – Teil von bmgl_ust_0, nur Verkäufe mit Steuerfall „ausfuhr“';
COMMENT ON COLUMN public.ea_uva.bmgl_igl IS 'KAN-439: innergemeinschaftliche Lieferungen (Kennzahl 017) – Teil von bmgl_ust_0, nur Verkäufe mit Steuerfall „igl“';

-- Der Rückgabetyp ändert sich (zwei Spalten mehr) – dafür muss die Funktion neu angelegt werden
DROP FUNCTION public.berechne_ea_uva(uuid, smallint, text);
CREATE FUNCTION public.berechne_ea_uva(p_tenant_id uuid, p_jahr smallint, p_zeitraum text)
 RETURNS TABLE(bmgl_0 numeric, bmgl_10 numeric, bmgl_13 numeric, bmgl_20 numeric, ust_10 numeric, ust_13 numeric, ust_20 numeric, vst_10 numeric, vst_13 numeric, vst_20 numeric, bmgl_ausfuhr numeric, bmgl_igl numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_von    date;
  v_bis    date;
  v_doppik boolean;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id);

  IF p_zeitraum IN ('Q1','Q2','Q3','Q4') THEN
    v_von := make_date(p_jahr, (CASE p_zeitraum WHEN 'Q1' THEN 1 WHEN 'Q2' THEN 4 WHEN 'Q3' THEN 7 ELSE 10 END), 1);
    v_bis := (v_von + INTERVAL '3 months' - INTERVAL '1 day')::date;
  ELSE
    v_von := make_date(p_jahr, p_zeitraum::smallint, 1);
    v_bis := (v_von + INTERVAL '1 month' - INTERVAL '1 day')::date;
  END IF;

  SELECT coalesce(e.buchhaltungsart = 'doppik', false) INTO v_doppik
  FROM tenant_einstellungen e WHERE e.tenant_id = p_tenant_id;
  v_doppik := coalesce(v_doppik, false);

  RETURN QUERY
  WITH ea AS (
    -- KAN-439: Steuerfall des Verkaufs, zu dem die Einnahme gehört (E&A: nach Zahlungseingang)
    SELECT t.typ, t.ust_satz::numeric AS satz, t.betrag_netto AS netto, t.ust_betrag AS ust, vk.steuerfall AS sf
    FROM ea_transaktionen t
    LEFT JOIN verkaufsposten vk ON vk.id = t.verkaufsposten_id AND vk.tenant_id = t.tenant_id
    WHERE t.tenant_id = p_tenant_id
      AND t.datum BETWEEN v_von AND v_bis
      AND NOT (v_doppik AND t.typ = 'einnahme' AND t.import_quelle = 'verkauf')
  ),
  -- Doppik: Rechnungen nach Rechnungsdatum, Netto je Rechnung, Satz und Steuerfall gerundet
  re AS (
    SELECT r.id, coalesce(p.ust_satz, 13)::numeric AS satz, v.steuerfall AS sf,
           round(sum(p.preis_brutto * p.menge * (1 - coalesce(p.rabatt_pct, 0) / 100) * (1 - coalesce(p.sonderrabatt_pct, 0) / 100)
                     / (1 + coalesce(p.ust_satz, 13)::numeric / 100)), 2) AS netto
    FROM rechnungen r
    JOIN verkaufsposten v ON v.rechnung_id = r.id AND v.tenant_id = r.tenant_id
    JOIN verkauf_positionen p ON p.verkaufsposten_id = v.id
    WHERE v_doppik
      AND r.tenant_id = p_tenant_id
      AND r.art = 'rechnung'
      AND r.aktiv AND NOT r.storniert
      AND r.datum BETWEEN v_von AND v_bis
      AND p.preis_brutto IS NOT NULL
    GROUP BY r.id, coalesce(p.ust_satz, 13), v.steuerfall
  ),
  -- KAN-379: Positionen stornierter Rechnungen mit Stornobeleg (Momentaufnahme) – Original +1 in seinem Zeitraum,
  -- Stornobeleg −1 im Zeitraum seines Datums; Altfälle (storniert ohne Stornobeleg) zählen wie bisher nicht.
  -- KAN-439: Die Momentaufnahme kennt den Steuerfall nicht – er kommt vom Lieferschein der Original-Rechnung
  -- (eine Rechnung aus dem Exportauftrag hat genau einen).
  mp AS (
    SELECT o.id AS beleg, 1 AS vz, x.pos,
           (SELECT max(v.steuerfall) FROM verkaufsposten v WHERE v.rechnung_id = o.id AND v.tenant_id = o.tenant_id) AS sf
    FROM rechnungen o CROSS JOIN LATERAL jsonb_array_elements(o.storno_positionen) AS x(pos)
    WHERE v_doppik AND o.tenant_id = p_tenant_id AND o.art = 'rechnung' AND o.aktiv
      AND o.storniert AND o.storniert_durch_id IS NOT NULL
      AND o.datum BETWEEN v_von AND v_bis
    UNION ALL
    SELECT s.id, -1, x.pos,
           (SELECT max(v.steuerfall) FROM verkaufsposten v WHERE v.rechnung_id = o.id AND v.tenant_id = o.tenant_id)
    FROM rechnungen s
    JOIN rechnungen o ON o.id = s.storno_von_id AND o.tenant_id = s.tenant_id
    CROSS JOIN LATERAL jsonb_array_elements(o.storno_positionen) AS x(pos)
    WHERE v_doppik AND s.tenant_id = p_tenant_id AND s.art = 'storno' AND s.aktiv
      AND s.datum BETWEEN v_von AND v_bis
  ),
  st AS (
    SELECT m.beleg, coalesce((m.pos ->> 'ust_satz')::numeric, 13) AS satz, m.sf,
           m.vz * round(sum((m.pos ->> 'preis_brutto')::numeric * (m.pos ->> 'menge')::numeric
                            * (1 - coalesce((m.pos ->> 'rabatt_pct')::numeric, 0) / 100)
                            * (1 - coalesce((m.pos ->> 'sonderrabatt_pct')::numeric, 0) / 100)
                            / (1 + coalesce((m.pos ->> 'ust_satz')::numeric, 13) / 100)), 2) AS netto
    FROM mp m
    WHERE m.pos ->> 'preis_brutto' IS NOT NULL
    GROUP BY m.beleg, m.vz, coalesce((m.pos ->> 'ust_satz')::numeric, 13), m.sf
  ),
  alle_zeilen AS (
    SELECT typ, satz, netto, ust, sf FROM ea
    UNION ALL
    SELECT 'einnahme', satz, netto, round(netto * satz / 100, 2), sf FROM re
    UNION ALL
    SELECT 'einnahme', satz, netto, round(netto * satz / 100, 2), sf FROM st
  )
  SELECT
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=0  THEN a.netto ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=10 THEN a.netto ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=13 THEN a.netto ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=20 THEN a.netto ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=10 THEN a.ust ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=13 THEN a.ust ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=20 THEN a.ust ELSE 0 END),
    SUM(CASE WHEN a.typ='ausgabe' AND a.satz=10 THEN a.ust ELSE 0 END),
    SUM(CASE WHEN a.typ='ausgabe' AND a.satz=13 THEN a.ust ELSE 0 END),
    SUM(CASE WHEN a.typ='ausgabe' AND a.satz=20 THEN a.ust ELSE 0 END),
    -- KAN-439: Teilmengen der 0-%-Umsätze nach gespeichertem Steuerfall (Kennzahlen 011 und 017)
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=0 AND a.sf='ausfuhr' THEN a.netto ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=0 AND a.sf='igl' THEN a.netto ELSE 0 END)
  FROM alle_zeilen a;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.berechne_ea_uva(uuid, smallint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.berechne_ea_uva(uuid, smallint, text) TO authenticated, service_role;
