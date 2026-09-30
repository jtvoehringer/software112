-- KAN-127: RPC get_behandlungen_fuer_grundstuecke entfernen (ENTWURF – erst nach „OK, einspielen“, zuerst Staging)
--
-- Einziger Aufrufer war src/lib/wein/weinbuch.ts; seit KAN-127 holt das Weinbuch die Feldbehandlungen über den
-- gemeinsamen Kern der Rückverfolgung (ladeRvWeingarten → ladeMassnahmenZuLesezeilen, RLS + tenant_id-Filter).
-- Die Funktion ist SECURITY DEFINER ohne pruefe_tenant_zugriff (bekannte Lücke B4 der DB-Tests: inaktive Mitglieder
-- lesen Behandlungen, keine Zwei-Faktor-Stufe) und weicht von migrations_legacy/090 ab (Drift, Neuaufbau erzeugte
-- Dubletten). Entfernen schließt B4 und beseitigt die Drift.
--
-- Voraussetzung: Die App-Version ohne RPC-Aufruf (PR KAN-127) ist in Produktion ausgeliefert
-- (Production-Deploy des Merge-SHA prüfen, memory vercel-produktion-deploy-pruefen) – sonst zeigt ein altes
-- Weinbuch keine Feldbehandlungen mehr (der Aufruf liefert dann einen Fehler, die Liste bleibt leer).
-- Abhängigkeiten laut pg_depend (Produktion, 30.09.2026): keine.
-- DB-Tests: im selben PR die Ratschen B4 (01_katalog_invarianten, 13_inaktive_mitgliedschaft, 18_rpc_security_definer,
-- _helfer s112_soll_rpc, README) auf „Funktion entfernt“ umstellen.

DROP FUNCTION IF EXISTS public.get_behandlungen_fuer_grundstuecke(uuid[], uuid);

-- Selbstprüfung
DO $$
BEGIN
  IF to_regprocedure('public.get_behandlungen_fuer_grundstuecke(uuid[], uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'KAN-127: get_behandlungen_fuer_grundstuecke existiert noch';
  END IF;
END $$;

-- ── Rollback (Live-Fassung aus Produktion vom 30.09.2026, pg_get_functiondef – NICHT die aus 090) ──────────
-- CREATE OR REPLACE FUNCTION public.get_behandlungen_fuer_grundstuecke(p_grundstueck_ids uuid[], p_tenant_id uuid)
--  RETURNS TABLE(behandlung_id uuid, datum date, art text, psm_name text, aufwandmenge numeric, aufwandmenge_einheit text,
--                bbch_stadium text, schaderreger text, notizen text, weingarten_name text, flaeche_ha_gesamt numeric)
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
--   select
--     b.id                          as behandlung_id,
--     b.datum,
--     b.art,
--     psm.name                      as psm_name,
--     b.aufwandmenge,
--     b.aufwandmenge_einheit,
--     b.bbch_stadium,
--     b.schaderreger,
--     b.notizen,
--     wg.name                       as weingarten_name,
--     sum(bg.flaeche_ha)            as flaeche_ha_gesamt
--   from behandlung_grundstuecke bg
--   join behandlungen b       on b.id  = bg.behandlung_id
--   left join pflanzenschutzmittel psm on psm.id = b.psm_id
--   left join weingarten wg   on wg.id = b.weingarten_id
--   where bg.grundstueck_id = any(p_grundstueck_ids)
--     and b.tenant_id = p_tenant_id
--     and p_tenant_id in (select get_user_tenant_ids())
--   group by b.id, b.datum, b.art, psm.name, b.aufwandmenge, b.aufwandmenge_einheit,
--            b.bbch_stadium, b.schaderreger, b.notizen, wg.name
--   order by b.datum
-- $function$;
-- REVOKE EXECUTE ON FUNCTION public.get_behandlungen_fuer_grundstuecke(uuid[], uuid) FROM PUBLIC, anon;
-- GRANT EXECUTE ON FUNCTION public.get_behandlungen_fuer_grundstuecke(uuid[], uuid) TO authenticated, service_role;
-- (Rechte live: postgres, authenticated, service_role)
