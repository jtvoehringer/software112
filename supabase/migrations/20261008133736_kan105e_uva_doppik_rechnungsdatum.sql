-- KAN-105 Teil B (08.10.2026, Entscheidung Jörgen): USt-Zeitpunkt in der UVA
--
-- E&A-Betriebe (buchhaltungsart 'ea'): unverändert – Umsätze nach Zahlung (Ist), je Zahlung am Zahlungstag
--   (ea_transaktionen mit import_quelle 'verkauf', KAN-149 D2b).
-- Doppik beim Steuerberater (buchhaltungsart 'doppik'): Die UVA-Kontroll-Vorschau rechnet die Umsätze aus den
--   Rechnungen nach Rechnungsdatum (Soll, wie die BMD-Übergabe mit Belegdatum = Rechnungsdatum): nicht stornierte,
--   aktive Rechnungen des Zeitraums mit den Positionen aller ihrer Lieferscheine, Netto je Rechnung und Satz auf
--   Cent gerundet (wie Rechnungsjournal und Rechnungsdruck). Die Zahlungseinnahmen (import_quelle 'verkauf') zählen
--   dort nicht, damit nichts doppelt ist; alle übrigen Einnahmen und die Vorsteuer weiter aus ea_transaktionen.
-- Gesperrte (übermittelte) UVAs berechnet die App ohnehin nicht neu.

CREATE OR REPLACE FUNCTION public.berechne_ea_uva(p_tenant_id uuid, p_jahr smallint, p_zeitraum text)
 RETURNS TABLE(bmgl_0 numeric, bmgl_10 numeric, bmgl_13 numeric, bmgl_20 numeric, ust_10 numeric, ust_13 numeric, ust_20 numeric, vst_10 numeric, vst_13 numeric, vst_20 numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
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
    SELECT t.typ, t.ust_satz::numeric AS satz, t.betrag_netto AS netto, t.ust_betrag AS ust
    FROM ea_transaktionen t
    WHERE t.tenant_id = p_tenant_id
      AND t.datum BETWEEN v_von AND v_bis
      AND NOT (v_doppik AND t.typ = 'einnahme' AND t.import_quelle = 'verkauf')
  ),
  -- Doppik: Rechnungen nach Rechnungsdatum, Netto je Rechnung und Satz gerundet
  re AS (
    SELECT r.id, coalesce(p.ust_satz, 13)::numeric AS satz,
           round(sum(p.preis_brutto * p.menge * (1 - coalesce(p.rabatt_pct, 0) / 100) * (1 - coalesce(p.sonderrabatt_pct, 0) / 100)
                     / (1 + coalesce(p.ust_satz, 13)::numeric / 100)), 2) AS netto
    FROM rechnungen r
    JOIN verkaufsposten v ON v.rechnung_id = r.id AND v.tenant_id = r.tenant_id
    JOIN verkauf_positionen p ON p.verkaufsposten_id = v.id
    WHERE v_doppik
      AND r.tenant_id = p_tenant_id
      AND r.aktiv AND NOT r.storniert
      AND r.datum BETWEEN v_von AND v_bis
      AND p.preis_brutto IS NOT NULL
    GROUP BY r.id, coalesce(p.ust_satz, 13)
  ),
  alle_zeilen AS (
    SELECT typ, satz, netto, ust FROM ea
    UNION ALL
    SELECT 'einnahme', satz, netto, round(netto * satz / 100, 2) FROM re
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
    SUM(CASE WHEN a.typ='ausgabe' AND a.satz=20 THEN a.ust ELSE 0 END)
  FROM alle_zeilen a;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.berechne_ea_uva(uuid, smallint, text) FROM PUBLIC, anon;
