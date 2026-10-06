-- KAN-41 Paket 1 (06.10.2026): datierter Statuswechsel Most/Sturm ↔ Wein.
-- Der Journal-Trigger der Charge bucht beim Wechsel zwischen ernte/gaerung (Most, teilweise gegoren) und den übrigen
-- Status (Wein) ein Umstufungspaar AB_ABW/ZU_ABW (BSM: Most → Wein). Bisher immer mit dem heutigen Datum, weil nur
-- s112_charge_abstufen das Datum (s112.umstufung_datum) setzt. Diese RPC setzt den Status zu einem gewählten Tag:
-- gleiche Prüfungen wie die Abstufung (Betrieb, Abo, Schreibmodul Kellerbuch, nicht in der Zukunft, nicht im
-- abgeschlossenen Kellerbuch-Zeitraum, nicht vor die letzte Journalbuchung der Charge).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

CREATE OR REPLACE FUNCTION public.s112_charge_status_setzen(p_tenant_id uuid, p_weinausbau_id uuid, p_status text, p_datum date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_w      public.weinausbau%ROWTYPE;
  v_datum  date := coalesce(p_datum, (now() AT TIME ZONE 'Europe/Vienna')::date);
  v_heute  date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_bis    date;
  v_letzte date;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('ernte', 'gaerung', 'ausbau', 'abfuellung', 'abgeschlossen') THEN
    RAISE EXCEPTION 'Unbekannter Status „%“.', coalesce(p_status, '–') USING ERRCODE = '22023';
  END IF;
  IF v_datum > v_heute THEN
    RAISE EXCEPTION 'Das Datum des Statuswechsels liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  v_bis := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
  IF v_bis IS NOT NULL AND v_datum <= v_bis THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – der Statuswechsel kann frühestens am % gebucht werden.',
      to_char(v_bis, 'DD.MM.YYYY'), to_char(v_bis + 1, 'DD.MM.YYYY') USING ERRCODE = '42501', HINT = 'kellerbuch_abschluss';
  END IF;

  SELECT * INTO v_w FROM public.weinausbau w WHERE w.id = p_weinausbau_id AND w.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Charge nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_w.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Charge ist storniert.' USING ERRCODE = '22023';
  END IF;
  IF v_w.status IS NOT DISTINCT FROM p_status THEN
    RETURN;
  END IF;
  -- nicht vor die letzte Journalbuchung der Charge (sonst trügen spätere Bewegungen den alten Status)
  SELECT max(k.datum) INTO v_letzte FROM public.kellerbuch_buchungen k
   WHERE k.tenant_id = p_tenant_id AND k.weinausbau_id = p_weinausbau_id AND k.storno_von_id IS NULL;
  IF v_letzte IS NOT NULL AND v_datum < v_letzte THEN
    RAISE EXCEPTION 'Die Charge hat am % schon eine Bewegung – der Statuswechsel kann frühestens an diesem Tag gebucht werden.',
      to_char(v_letzte, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('s112.umstufung_datum', v_datum::text, true);
  PERFORM set_config('s112.aenderung_grund', format('Statuswechsel am %s', to_char(v_datum, 'DD.MM.YYYY')), true);
  UPDATE public.weinausbau SET status = p_status WHERE id = p_weinausbau_id;
  PERFORM set_config('s112.umstufung_datum', '', true);
  PERFORM set_config('s112.aenderung_grund', '', true);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_charge_status_setzen(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_charge_status_setzen(uuid, uuid, text, date) TO authenticated;
COMMENT ON FUNCTION public.s112_charge_status_setzen(uuid, uuid, text, date) IS
  'KAN-41: Status der Charge zu einem Datum setzen (Most/Sturm ↔ Wein bucht das Umstufungspaar an diesem Tag)';
