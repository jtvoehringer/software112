-- KAN-415 (UAT 12.11.2026): Einen angehängten Beleg wieder von der Buchung lösen.
--
-- Bisher war ein angehängter Beleg „verbucht“ und damit unveränderlich (Trigger a_ea_abschluss_schutz). Laut Plan
-- (freigegeben 11.11.2026) soll das Entfernen möglich sein, solange der Monat der Buchung offen ist. „Entfernen“ löst
-- den Beleg von der Buchung: Er liegt danach wieder bei den nicht verbuchten Belegen (dort verwerfen oder neu
-- zuordnen) – die Datei bleibt erhalten. Im abgeschlossenen Monat bzw. übermittelten UVA-Zeitraum bleibt der Beleg
-- als Nachweis an der Buchung (§ 132 BAO). Der Grund steht im Änderungsprotokoll.

-- 1. Schutz: Ausnahme nur für die RPC (transaktionslokales Kennzeichen)
DO $kan415$
DECLARE
  v_def text;
  c_alt constant text := 'IF TG_OP IN (''UPDATE'', ''DELETE'') AND v_alt ->> ''status'' = ''verbucht'' THEN';
BEGIN
  SELECT pg_get_functiondef('public.s112_ea_abschluss_schutz'::regproc) INTO v_def;
  IF (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-415: s112_ea_abschluss_schutz – Stelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt,
    'IF TG_OP IN (''UPDATE'', ''DELETE'') AND v_alt ->> ''status'' = ''verbucht''
       AND COALESCE(current_setting(''s112.beleg_frei'', true), '''') <> ''ja'' THEN   -- KAN-415: s112_ea_beleg_loesen');
END
$kan415$;

-- 2. Beleg lösen
CREATE FUNCTION public.s112_ea_beleg_loesen(p_tenant_id uuid, p_beleg_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b      record;
  v_t      record;
  v_grund  text := btrim(coalesce(p_grund, ''));
  v_sperre text;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_ea');
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für das Entfernen angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  SELECT id, dateiname, status, ea_transaktion_id INTO v_b FROM public.ea_belege WHERE id = p_beleg_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Beleg nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.status <> 'verbucht' OR v_b.ea_transaktion_id IS NULL THEN
    RAISE EXCEPTION 'Der Beleg „%“ hängt an keiner Buchung.', v_b.dateiname USING ERRCODE = '23514';
  END IF;
  SELECT id, datum INTO v_t FROM public.ea_transaktionen WHERE id = v_b.ea_transaktion_id AND tenant_id = p_tenant_id;
  IF FOUND THEN
    v_sperre := public.s112_ea_zeitraum_sperrgrund(p_tenant_id, v_t.datum);
    IF v_sperre IS NOT NULL THEN
      RAISE EXCEPTION 'Der Beleg „%“ bleibt als Nachweis an der Buchung vom %: %', v_b.dateiname, to_char(v_t.datum, 'DD.MM.YYYY'), v_sperre
        USING ERRCODE = '42501', HINT = 'periodensperre';
    END IF;
  END IF;
  PERFORM set_config('s112.aenderung_grund', left('Beleg von der Buchung gelöst: ' || v_grund, 500), true);
  PERFORM set_config('s112.beleg_frei', 'ja', true);
  UPDATE public.ea_belege SET status = 'erkannt', ea_transaktion_id = NULL, verbucht_am = NULL
   WHERE id = p_beleg_id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.beleg_frei', '', true);
  PERFORM set_config('s112.aenderung_grund', '', true);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_ea_beleg_loesen(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_ea_beleg_loesen(uuid, uuid, text) TO authenticated, service_role;
