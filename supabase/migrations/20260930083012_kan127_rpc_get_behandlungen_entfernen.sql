-- KAN-127: RPC get_behandlungen_fuer_grundstuecke entfernen (OK Jörgen 30.09.2026; zuerst Staging, dann Produktion)
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
