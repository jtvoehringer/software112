-- @bereich: E-Label-Umleitung (KAN-219)
-- @ziel: Der QR-Code eines freigegebenen E-Labels lässt sich nur über s112_elabel_umleiten (Grund ≥ 10, protokolliert) auf
-- @ziel: ein anderes freigegebenes E-Label desselben Betriebs umleiten – nicht direkt per Update (auch nicht im Entwurf),
-- @ziel: nicht auf sich selbst, nicht im Kreis, nicht auf einen Entwurf oder fremden Betrieb; Leser dürfen nicht umleiten.
-- @mutation ohne_schutz: Trigger b_elabel_umleitung entfernt | rot: kein_direktes_update
-- @mutation ohne_schleifenpruefung: Schleifenprüfung in s112_elabel_umleiten ausgeschaltet | rot: keine_schleife
-- @mutation ohne_grund: Grundprüfung in s112_elabel_umleiten ausgeschaltet | rot: grund_pflicht
-- @mutation archiv_ohne_umleitung: Archiv nimmt den Inhalt des eigenen statt des Ziel-E-Labels | rot: archiv_inhalt_ziel
-- @ziel: Archiv: s112_elabel_archivieren kopiert freigegebene E-Labels (Inhalt des Umleitungsziels, 5 Jahre), nur Service-Role.
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 65 (Stand 07.10.2026, KAN-219). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t65_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't65_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

CREATE FUNCTION pg_temp.t65_elabel(p_tenant uuid, p_status text) RETURNS uuid LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (pg_temp.s112_beispiel('elabels', p_tenant, NULL, jsonb_build_object(
    'status', p_status, 'umleitung_auf', NULL,
    'zutaten_ids', '{' || (SELECT z.id FROM public.elabel_zutaten z WHERE z.aktiv ORDER BY z.sortierung, z.id LIMIT 1) || '}',
    'energie_kj', 300, 'energie_kcal', 72, 'kohlenhydrate_g', 2.5, 'zucker_g', 0.4, 'freigegeben_am', now())) ->> 'id')::uuid;
END $f$;

DO $test$
DECLARE
  c_datei constant text := '65_elabel_umleitung';
  c_rpc   constant text := 'SELECT public.s112_elabel_umleiten(%L::uuid, %L::uuid, %L::uuid, %L)';
  c_grund constant text := 'S112TEST Nachfolgefüllung';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_alt   uuid;   -- freigegeben, gedruckt
  v_neu   uuid;   -- Nachfolger, freigegeben
  v_dritt uuid;   -- weiteres freigegebenes
  v_entw  uuid;   -- Entwurf
  v_fremd uuid;   -- freigegeben im Musterhof
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_alt := pg_temp.t65_elabel(v_b, 'freigegeben');
  v_neu := pg_temp.t65_elabel(v_b, 'freigegeben');
  v_dritt := pg_temp.t65_elabel(v_b, 'freigegeben');
  v_entw := pg_temp.t65_elabel(v_b, 'entwurf');
  v_fremd := pg_temp.t65_elabel(v_m, 'freigegeben');

  PERFORM pg_temp.s112_mutiere('ohne_schutz', $m$DROP TRIGGER b_elabel_umleitung ON public.elabels$m$);
  PERFORM pg_temp.s112_mutiere('ohne_schleifenpruefung', $m$SELECT pg_temp.t65_ersetze('public.s112_elabel_umleiten(uuid, uuid, uuid, text)'::regprocedure,
    $r$IF v_schritt = p_elabel_id OR v_n > 5 THEN$r$, $r$IF false THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_grund', $m$SELECT pg_temp.t65_ersetze('public.s112_elabel_umleiten(uuid, uuid, uuid, text)'::regprocedure,
    $r$IF length\(btrim\(coalesce\(p_grund, ''\)\)\) < 10 THEN$r$, $r$IF false THEN$r$)$m$);

  PERFORM pg_temp.s112_mutiere('archiv_ohne_umleitung', $m$SELECT pg_temp.t65_ersetze('public.s112_elabel_archivieren(uuid, integer)'::regprocedure,
    $r$v_ziel := v_id;$r$, $r$v_ziel := r.id;$r$)$m$);

  -- ── 1. Direktes Setzen gesperrt (freigegeben und Entwurf) ──────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('kein_direktes_update',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.elabels SET umleitung_auf = %L WHERE id = %L', v_neu, v_entw)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('freigegeben_gesperrt',
    pg_temp.s112_fehlertext(format('UPDATE public.elabels SET umleitung_auf = %L WHERE id = %L', v_neu, v_alt)) <> 'ok', true);

  -- ── 2. Regeln der RPC ──────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('grund_pflicht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, v_neu, 'kurz')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('nicht_auf_entwurf',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, v_entw, c_grund)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('entwurf_nicht_umleitbar',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_entw, v_neu, c_grund)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('nicht_selbst',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, v_alt, c_grund)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremdes_ziel',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, v_fremd, c_grund)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremdes_elabel',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_fremd, v_neu, c_grund)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('umleiten_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, v_neu, c_grund)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('kette_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_neu, v_dritt, c_grund)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('keine_schleife',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_dritt, v_alt, c_grund)), ':', 1), '22023');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_dritt, NULL, c_grund)), ':', 1), '42501');

  -- ── 3. Protokoll ───────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_lesbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.elabel_umleitungen WHERE elabel_id IN (%L, %L)', v_alt, v_neu)), '2');
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_nicht_schreibbar',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.elabel_umleitungen (tenant_id, elabel_id, grund) VALUES (%L, %L, %L)', v_b, v_alt, c_grund)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('aufheben_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, NULL, 'S112TEST Umleitung zurück')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('stand',
    (SELECT coalesce(a.umleitung_auf::text, '-') || '|' || coalesce(n.umleitung_auf::text, '-')
       FROM public.elabels a, public.elabels n WHERE a.id = v_alt AND n.id = v_neu), '-|' || v_dritt::text);

  -- ── 4. Archiv (gelöschter Betrieb): Inhalt des Umleitungsziels, 5 Jahre, für Benutzer nicht lesbar ─────────
  v_erg := v_erg || pg_temp.s112_erwarte('archiv_anzahl', public.s112_elabel_archivieren(v_b, 5) >= 3, true);
  v_erg := v_erg || pg_temp.s112_erwarte('archiv_inhalt_ziel',
    (SELECT a.inhalt -> 'f' ->> 'name' FROM s112_archiv.elabel_archiv a JOIN public.elabels e ON e.code = a.code WHERE e.id = v_neu),
    (SELECT f.name FROM public.elabels e JOIN public.fuellungen f ON f.id = e.fuellung_id WHERE e.id = v_dritt));
  v_erg := v_erg || pg_temp.s112_erwarte('archiv_frist',
    (SELECT a.gueltig_bis FROM s112_archiv.elabel_archiv a JOIN public.elabels e ON e.code = a.code WHERE e.id = v_alt)
      = ((now() AT TIME ZONE 'Europe/Vienna')::date + interval '5 years')::date, true);
  v_erg := v_erg || pg_temp.s112_erwarte('kein_archiv_entwurf',
    (SELECT count(*) FROM s112_archiv.elabel_archiv a JOIN public.elabels e ON e.code = a.code WHERE e.id = v_entw), 0::bigint);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('archiv_nicht_lesbar',
    split_part(pg_temp.s112_fehlertext('SELECT count(*) FROM s112_archiv.elabel_archiv'), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('archivieren_nicht_aufrufbar',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_elabel_archivieren(%L, 5)', v_b)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('archiv_lesen_nicht_aufrufbar',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_elabel_archiv_lesen(%L)', (SELECT e.code FROM public.elabels e WHERE e.id = v_alt))), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('archiv_lesen',
    public.s112_elabel_archiv_lesen((SELECT e.code FROM public.elabels e WHERE e.id = v_alt)) ? 'katalog', true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 23);
END $test$;
