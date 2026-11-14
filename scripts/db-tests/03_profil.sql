-- @bereich: Profile „Vertrieb“ und „Extern“ (KAN-412 R1) – Grundlage der Leserechte
-- @ziel: tenant_memberships.profil gibt es nur für Mitarbeiter (winzer) und nur mit den Werten vertrieb/extern. Die
-- @ziel: Funktion s112_lesegesperrte_tenants(bereich) nennt für den angemeldeten Benutzer die Betriebe, in denen er den
-- @ziel: Bereich wegen seines Profils nicht lesen darf – ohne Profil keinen. s112_darf_lesen prüft dasselbe je Betrieb.
-- @ziel: Ein Benutzer kann sich sein Profil nicht selbst nehmen oder ändern. Anonym ist nichts ausführbar.
-- @ziel: Seit KAN-457 folgen die Schreibmodule dem Profil (Trigger z_profil_module); ein Rollenwechsel weg vom
-- @ziel: Mitarbeiter leert das Profil.
-- @mutation ohne_profilpruefung: mit Profil ist kein Bereich gesperrt | rot: extern_.*gesperrt|vertrieb_.*gesperrt|darf_lesen_extern
-- @mutation profil_fuer_jede_rolle: ein Profil auch für Betriebsleitung und Leser | rot: profil_nur_.*
-- @mutation ohne_modulabgleich: der Trigger z_profil_module fehlt | rot: module_.*|rollenwechsel_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 03 (Stand 13.11.2026, KAN-412). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '03_profil';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_bl    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_profilpruefung', $m$DO $d$ BEGIN
    EXECUTE replace(pg_get_functiondef('public.s112_lesegesperrte_tenants(text)'::regprocedure),
      $a$AND NOT (p_bereich = ANY$a$, $a$AND false AND NOT (p_bereich = ANY$a$);
  END $d$$m$);

  PERFORM pg_temp.s112_mutiere('profil_fuer_jede_rolle', $m$ALTER TABLE public.tenant_memberships DROP CONSTRAINT tenant_memberships_profil_rolle_chk$m$);
  PERFORM pg_temp.s112_mutiere('ohne_modulabgleich', $m$DROP TRIGGER z_profil_module ON public.tenant_memberships$m$);

  -- ── 1. Rechte und Regeln der Spalte ─────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('rechte',
    concat_ws('|', has_function_privilege('authenticated', 'public.s112_lesegesperrte_tenants(text)', 'EXECUTE'),
      has_function_privilege('anon', 'public.s112_lesegesperrte_tenants(text)', 'EXECUTE'),
      has_function_privilege('anon', 'public.s112_darf_lesen(uuid, text)', 'EXECUTE'),
      has_function_privilege('anon', 'public.s112_profil_bereiche(text)', 'EXECUTE')), 't|f|f|f');
  v_erg := v_erg || pg_temp.s112_erwarte('profil_nur_mitarbeiter',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.tenant_memberships SET profil = %L WHERE tenant_id = %L AND user_id = %L', 'extern', v_b, v_bta)), ': ', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('profil_nur_leser_nicht',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.tenant_memberships SET profil = %L WHERE tenant_id = %L AND user_id = %L', 'vertrieb', v_b, v_bl)), ': ', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('profil_unbekannt',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.tenant_memberships SET profil = %L WHERE tenant_id = %L AND user_id = %L', 'chef', v_b, v_bw)), ': ', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('bereiche',
    concat_ws('|', array_length(public.s112_profil_bereiche('vertrieb'), 1), array_length(public.s112_profil_bereiche('extern'), 1),
      public.s112_profil_bereiche(NULL) IS NULL, public.s112_profil_bereiche('chef') IS NULL), '7|3|t|t');

  -- ── 2. Ohne Profil ist nichts gesperrt (wie bisher) ────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_profil_frei',
    (SELECT count(*) FROM unnest(ARRAY['allgemein', 'rieden', 'crm', 'ea', 'verwaltung']) b WHERE EXISTS (SELECT 1 FROM public.s112_lesegesperrte_tenants(b))), 0);
  v_erg := v_erg || pg_temp.s112_erwarte('darf_lesen_ohne_profil', public.s112_darf_lesen(v_b, 'ea'), true);

  -- ── 3. Extern: nur allgemein, rieden, massnahmen ────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_memberships SET profil = 'extern' WHERE tenant_id = v_b AND user_id = v_bw;
  v_erg := v_erg || pg_temp.s112_erwarte('module_folgen_extern', (SELECT array_to_string(m.schreibmodule, ',') FROM public.tenant_memberships m WHERE m.tenant_id = v_b AND m.user_id = v_bw), 'rieden');   -- KAN-457
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('extern_frei',
    (SELECT count(*) FROM unnest(ARRAY['allgemein', 'rieden', 'massnahmen']) b WHERE EXISTS (SELECT 1 FROM public.s112_lesegesperrte_tenants(b))), 0);
  v_erg := v_erg || pg_temp.s112_erwarte('extern_gesperrt',
    (SELECT string_agg(b, ',' ORDER BY b) FROM unnest(ARRAY['betriebsmittel', 'lese', 'keller', 'lager', 'verkauf', 'crm', 'ea', 'controlling', 'ki', 'betrieb', 'verwaltung']) b
      WHERE v_b IN (SELECT public.s112_lesegesperrte_tenants(b))),
    'betrieb,betriebsmittel,controlling,crm,ea,keller,ki,lager,lese,verkauf,verwaltung');
  v_erg := v_erg || pg_temp.s112_erwarte('darf_lesen_extern',
    concat_ws('|', public.s112_darf_lesen(v_b, 'rieden'), public.s112_darf_lesen(v_b, 'crm'), public.s112_darf_lesen(v_b, 'ea')), 't|f|f');
  -- sich selbst das Profil nehmen: als Benutzer nicht möglich
  v_erg := v_erg || pg_temp.s112_erwarte('profil_selbst_entfernen',
    pg_temp.s112_versuch(format('UPDATE public.tenant_memberships SET profil = NULL WHERE tenant_id = %L AND user_id = %L', v_b, v_bw)) IN ('k0', 'G', 'R'), true);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('profil_bleibt',
    (SELECT m.profil FROM public.tenant_memberships m WHERE m.tenant_id = v_b AND m.user_id = v_bw), 'extern');

  -- ── 4. Vertrieb: nicht keller, rieden, massnahmen, betriebsmittel, lese, ea, verwaltung ──────────────────────────
  UPDATE public.tenant_memberships SET profil = 'vertrieb' WHERE tenant_id = v_b AND user_id = v_bw;
  v_erg := v_erg || pg_temp.s112_erwarte('module_folgen_vertrieb', (SELECT array_to_string(m.schreibmodule, ',') FROM public.tenant_memberships m WHERE m.tenant_id = v_b AND m.user_id = v_bw), 'warenwirtschaft,crm,auswertungen');   -- KAN-457
  -- mit Profil lassen sich die Module nicht frei setzen
  UPDATE public.tenant_memberships SET schreibmodule = ARRAY['rieden', 'kellerbuch', 'warenwirtschaft', 'crm', 'ea', 'auswertungen'] WHERE tenant_id = v_b AND user_id = v_bw;
  v_erg := v_erg || pg_temp.s112_erwarte('module_bei_profil_fest', (SELECT array_to_string(m.schreibmodule, ',') FROM public.tenant_memberships m WHERE m.tenant_id = v_b AND m.user_id = v_bw), 'warenwirtschaft,crm,auswertungen');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_frei',
    (SELECT count(*) FROM unnest(ARRAY['allgemein', 'crm', 'verkauf', 'lager', 'controlling', 'ki', 'betrieb']) b WHERE EXISTS (SELECT 1 FROM public.s112_lesegesperrte_tenants(b))), 0);
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_gesperrt',
    (SELECT string_agg(b, ',' ORDER BY b) FROM unnest(ARRAY['rieden', 'massnahmen', 'betriebsmittel', 'lese', 'keller', 'ea', 'verwaltung']) b
      WHERE v_b IN (SELECT public.s112_lesegesperrte_tenants(b))),
    'betriebsmittel,ea,keller,lese,massnahmen,rieden,verwaltung');

  -- ── 5. Das Profil eines anderen wirkt nicht auf mich; die Betriebsleitung liest alles ─────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('betriebsleitung_frei',
    concat_ws('|', (SELECT count(*) FROM public.s112_lesegesperrte_tenants('ea')), public.s112_darf_lesen(v_b, 'keller')), '0|t');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 6. KAN-457: Rollenwechsel weg vom Mitarbeiter leert das Profil; ohne Profil sind die Module wieder frei ─────
  UPDATE public.tenant_memberships SET role = 'leser', schreibmodule = NULL WHERE tenant_id = v_b AND user_id = v_bw;
  v_erg := v_erg || pg_temp.s112_erwarte('rollenwechsel_leert_profil',
    (SELECT concat_ws('|', m.role, coalesce(m.profil, '-')) FROM public.tenant_memberships m WHERE m.tenant_id = v_b AND m.user_id = v_bw), 'leser|-');
  UPDATE public.tenant_memberships SET role = 'winzer', schreibmodule = ARRAY['kellerbuch', 'ea'] WHERE tenant_id = v_b AND user_id = v_bw;
  v_erg := v_erg || pg_temp.s112_erwarte('module_ohne_profil_frei', (SELECT array_to_string(m.schreibmodule, ',') FROM public.tenant_memberships m WHERE m.tenant_id = v_b AND m.user_id = v_bw), 'kellerbuch,ea');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 20);
END
$test$;
