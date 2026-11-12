-- @bereich: Nummernkreise – Zähler über der eingestellten Stellenzahl (KAN-422)
-- @ziel: Eine laufende Nummer wird mit Nullen aufgefüllt, aber nie gekürzt: nach 999 kommt bei 3 Stellen 1000 und 1001,
-- @ziel: nicht zweimal „100“ (Musterhof-Reset 12.11.2026: 23505 auf der Chargennummer). Keine Nummernfunktion in public
-- @ziel: baut ihre Nummer mehr direkt mit lpad(zähler, stellen); anon darf die Hilfsfunktion nicht ausführen.
-- @mutation kuerzt_wieder: s112_nummer_text füllt wieder mit lpad (kürzt) | rot: (text_ueber_stellen|weinausbau_1000|weinausbau_1001|charge_1000)
-- @mutation nicht_umgestellt: s112_naechste_weinausbau_nummer baut die Nummer wieder direkt mit lpad | rot: (weinausbau_1000|weinausbau_1001|keine_lpad_nummer)
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 94 (Stand 12.11.2026, KAN-422). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '94_nummernkreis_ueberlauf';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;

  PERFORM pg_temp.s112_mutiere('kuerzt_wieder',
    $m$CREATE OR REPLACE FUNCTION public.s112_nummer_text(p_zahl bigint, p_stellen integer) RETURNS text LANGUAGE sql IMMUTABLE
       SET search_path = public AS $f$ SELECT lpad(p_zahl::text, p_stellen, '0') $f$$m$);

  PERFORM pg_temp.s112_mutiere('nicht_umgestellt',
    $m$DO $d$ BEGIN
         EXECUTE replace(pg_get_functiondef('public.s112_naechste_weinausbau_nummer(uuid, timestamptz)'::regprocedure),
                         'public.s112_nummer_text(v_zaehler, v_stellen)', 'lpad(v_zaehler::text, v_stellen, ''0'')');
       END $d$$m$);

  -- ── 1. Hilfsfunktion ────────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('text_auffuellen', public.s112_nummer_text(7, 3), '007');
  v_erg := v_erg || pg_temp.s112_erwarte('text_genau', public.s112_nummer_text(999, 3), '999');
  v_erg := v_erg || pg_temp.s112_erwarte('text_ueber_stellen', public.s112_nummer_text(1000, 3) || '/' || public.s112_nummer_text(12345, 4), '1000/12345');
  v_erg := v_erg || pg_temp.s112_erwarte('anon_darf_nicht',
    has_function_privilege('anon', 'public.s112_nummer_text(bigint, integer)', 'EXECUTE'), false);

  -- ── 2. Chargennummer des Weinausbaus über 999 (der Fall vom 12.11.2026) ─────────────────────────────────────
  UPDATE public.tenant_einstellungen SET weinausbau_zaehler = 1000, weinausbau_stellen = 3, charge_zaehler = 1000, charge_stellen = 3
   WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('weinausbau_1000',
    split_part(public.s112_naechste_weinausbau_nummer(v_b, now()), '-', 3), '1000');
  v_erg := v_erg || pg_temp.s112_erwarte('weinausbau_1001',
    split_part(public.s112_naechste_weinausbau_nummer(v_b, now()), '-', 3), '1001');
  v_erg := v_erg || pg_temp.s112_erwarte('charge_1000',
    split_part(public.get_next_chargennummer(v_b), '-', 3), '1000');

  -- ── 3. Keine Nummernfunktion kürzt mehr direkt ──────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('keine_lpad_nummer',
    (SELECT coalesce(string_agg(p.proname, ', ' ORDER BY p.proname), '')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname <> 's112_nummer_text'
        AND p.prosrc ~* 'lpad\((v_[a-z_]+)::text,\s*(v_[a-z_]+|3),\s*''0''\)'), '');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 8);
END $test$;
