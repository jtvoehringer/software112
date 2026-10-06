-- KAN-41 Paket 2a (06.10.2026): Zukauf Maische.
-- Entscheidungen Jörgen (06.10.2026): Maische verhält sich wie zugekaufte Trauben – ohne Zielcharge, Quelle einer
-- Pressung, Lese-Qualitätsstufen, zählt zur Zukaufsgrenze; wird nur gepresst, nicht weiterverkauft.
--  1. zukauf_posten.art: + 'maische'.
--  2. Journal der Pressung: der Zukauf-Anteil wird nach der Art des Zukaufs geteilt – Trauben → ZK_TRAUB,
--     Maische → ZK_MAISC (BSM „Zukauf Maische“). Neue Zeilenfunktion mit getrennten kg; die alte (4 Parameter)
--     entfällt. Bestehende Buchungen bleiben unverändert (es gibt noch keine Maische-Zukäufe).
--  3. charge_herkunft: ZK_MAISC ist wie ZK_TRAUB eine Wurzel (Zugang ohne Quell-Charge).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Art ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.zukauf_posten DROP CONSTRAINT zukauf_posten_art_check;
ALTER TABLE public.zukauf_posten ADD CONSTRAINT zukauf_posten_art_check
  CHECK (art = ANY (ARRAY['wein'::text, 'trauben'::text, 'most'::text, 'maische'::text]));

-- 2. Journal der Pressung ───────────────────────────────────────────────────────────────────────────────────
-- Pressung: ERNTE, anteilig ZK_TRAUB bzw. ZK_MAISC nach den kg der Traubenzeilen mit Zukauf (je Art)
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_pressung(pb jsonb, p_kg_gesamt numeric, p_kg_trauben numeric,
  p_kg_maische numeric, p_zukauf_trauben uuid, p_zukauf_maische uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wa uuid := (pb ->> 'weinausbau_id')::uuid;
  v_l  numeric := coalesce((pb ->> 'menge_liter')::numeric, 0);
  v_tr numeric := 0;
  v_ma numeric := 0;
  z    jsonb := '[]'::jsonb;
BEGIN
  IF v_wa IS NULL OR v_l <= 0 THEN
    RETURN z;
  END IF;
  IF coalesce(p_kg_gesamt, 0) > 0 AND coalesce(p_kg_trauben, 0) > 0 THEN
    v_tr := least(v_l, round(v_l * p_kg_trauben / p_kg_gesamt, 2));
  END IF;
  IF coalesce(p_kg_gesamt, 0) > 0 AND coalesce(p_kg_maische, 0) > 0 THEN
    v_ma := least(v_l - v_tr, round(v_l * p_kg_maische / p_kg_gesamt, 2));
  END IF;
  IF v_l - v_tr - v_ma > 0 THEN
    z := z || jsonb_build_object('code', 'ERNTE', 'bestand', 'offen', 'weinausbau_id', v_wa, 'liter', v_l - v_tr - v_ma);
  END IF;
  IF v_tr > 0 THEN
    z := z || jsonb_build_object('code', 'ZK_TRAUB', 'bestand', 'offen', 'weinausbau_id', v_wa, 'liter', v_tr, 'zukauf_posten_id', p_zukauf_trauben,
      'hinweis', format('Anteil zugekaufter Trauben %s %% (%s von %s kg)', round(100 * p_kg_trauben / p_kg_gesamt, 1), p_kg_trauben, p_kg_gesamt));
  END IF;
  IF v_ma > 0 THEN
    z := z || jsonb_build_object('code', 'ZK_MAISC', 'bestand', 'offen', 'weinausbau_id', v_wa, 'liter', v_ma, 'zukauf_posten_id', p_zukauf_maische,
      'hinweis', format('Anteil zugekaufter Maische %s %% (%s von %s kg)', round(100 * p_kg_maische / p_kg_gesamt, 1), p_kg_maische, p_kg_gesamt));
  END IF;
  RETURN z;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_pressung(jsonb, numeric, numeric, numeric, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_journal_pressung_stand(pb jsonb, p_datum date, p_kopf_storniert boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kg  numeric;
  v_kgt numeric;
  v_kgm numeric;
  v_zkt uuid;
  v_zkm uuid;
BEGIN
  SELECT sum(w.trauben_kg) FILTER (WHERE w.storniert_am IS NULL),
         sum(w.trauben_kg) FILTER (WHERE w.storniert_am IS NULL AND w.zukauf_posten_id IS NOT NULL AND coalesce(z.art, 'trauben') <> 'maische'),
         sum(w.trauben_kg) FILTER (WHERE w.storniert_am IS NULL AND z.art = 'maische'),
         CASE WHEN count(DISTINCT w.zukauf_posten_id) FILTER (WHERE w.storniert_am IS NULL AND coalesce(z.art, 'trauben') <> 'maische') = 1
              THEN (array_agg(w.zukauf_posten_id) FILTER (WHERE w.storniert_am IS NULL AND w.zukauf_posten_id IS NOT NULL AND coalesce(z.art, 'trauben') <> 'maische'))[1] END,
         CASE WHEN count(DISTINCT w.zukauf_posten_id) FILTER (WHERE w.storniert_am IS NULL AND z.art = 'maische') = 1
              THEN (array_agg(w.zukauf_posten_id) FILTER (WHERE w.storniert_am IS NULL AND z.art = 'maische'))[1] END
    INTO v_kg, v_kgt, v_kgm, v_zkt, v_zkm
    FROM public.pressung_weingaerten w
    LEFT JOIN public.zukauf_posten z ON z.id = w.zukauf_posten_id
   WHERE w.pressung_id = (pb ->> 'pressung_id')::uuid;
  RETURN jsonb_build_object('wirksam', pb ->> 'storniert_am' IS NULL AND NOT p_kopf_storniert, 'datum', p_datum,
    'zeilen', public.s112_journal_zeilen_pressung(pb, v_kg, v_kgt, v_kgm, v_zkt, v_zkm));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_pressung_stand(jsonb, date, boolean) FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.s112_journal_zeilen_pressung(jsonb, numeric, numeric, uuid);

-- 3. Genealogie: ZK_MAISC als Wurzel ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.charge_herkunft WITH (security_invoker = true) AS
WITH z AS (
  SELECT k.*, (k.storno_von_id IS NOT NULL) AS gb
    FROM public.kellerbuch_buchungen k
   WHERE k.buchungsart_code IN ('UMZUG', 'FILTRAT', 'VS_ZU', 'VS_AB', 'FUELLUNG')
)
SELECT n.tenant_id, n.beleg_nr, n.datum, n.buchungsart_code AS art,
       CASE WHEN n.bestand = 'offen' THEN n.weinausbau_id END AS nach_weinausbau_id,
       CASE WHEN n.bestand = 'flasche' THEN n.fuellung_id END AS nach_fuellung_id,
       v.weinausbau_id AS von_weinausbau_id,
       NULL::uuid AS zukauf_posten_id,
       round(n.menge_liter * v.menge_liter / NULLIF(sum(v.menge_liter) OVER (PARTITION BY n.id), 0), 3) AS liter,
       n.gb AS gegenbuchung, n.quelle_tabelle, n.quelle_id, n.gruppe_id, n.erstellt_am, n.id AS buchung_id
  FROM z n
  JOIN z v ON v.tenant_id = n.tenant_id AND v.beleg_nr = n.beleg_nr AND v.gb = n.gb AND v.bestand = 'offen'
          AND v.buchungsart_code = CASE n.buchungsart_code WHEN 'VS_ZU' THEN 'VS_AB' ELSE n.buchungsart_code END
          AND sign(v.menge_liter) = -sign(n.menge_liter) AND v.weinausbau_id IS DISTINCT FROM n.weinausbau_id
 WHERE ((n.menge_liter > 0) <> n.gb)
   AND ((n.buchungsart_code IN ('UMZUG', 'FILTRAT', 'VS_ZU') AND n.bestand = 'offen') OR (n.buchungsart_code = 'FUELLUNG' AND n.bestand = 'flasche'))
UNION ALL
SELECT k.tenant_id, k.beleg_nr, k.datum, k.buchungsart_code, k.weinausbau_id, NULL::uuid, NULL::uuid, k.zukauf_posten_id,
       k.menge_liter, k.storno_von_id IS NOT NULL, k.quelle_tabelle, k.quelle_id, k.gruppe_id, k.erstellt_am, k.id
  FROM public.kellerbuch_buchungen k
 WHERE k.bestand = 'offen' AND k.buchungsart_code IN ('ERNTE', 'ZK_TRAUB', 'ZK_MAISC', 'ZK_MOST', 'ZK_FASS', 'EROEFF', 'INV_PLUS');
COMMENT ON VIEW public.charge_herkunft IS
  'KAN-192: Genealogie aus dem Bewegungsjournal – Kante von_weinausbau_id → nach_weinausbau_id bzw. nach_fuellung_id je Beleg (Liter anteilig), Wurzeln ohne Quell-Charge (KAN-41: auch ZK_MAISC); Gegenbuchungen negativ';
