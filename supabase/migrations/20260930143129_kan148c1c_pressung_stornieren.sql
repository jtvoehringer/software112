-- KAN-148 (Folgeticket C), Etappe C1c: Pressung stornieren – ENTWURF, erst nach „OK, einspielen“, zuerst Staging
--
-- Bisher löschte deletePressung Behälterzeilen, Chargen, Traubenzeilen und Kopf in vier einzelnen Aufrufen mit
-- händischem Rückbau (Halbzustände möglich). Neu storniert eine SECURITY-DEFINER-Funktion alles in EINER Transaktion;
-- die Zeilen bleiben mit Datum, Benutzer und Grund stehen (BKI, KAN-145).
--
--  1. s112_pressung_stornieren(p_tenant_id, p_pressung_id, p_grund) → jsonb {chargen, behaelterzeilen, traubenzeilen}
--     Reihenfolge: Zugriff (system_admin/tenant_admin/winzer – KAN-166), Abo-Schreibsperre, Schreibmodul Kellerbuch
--     oder Rieden (wie modul_update an pressungen), Grund ≥ 10 Zeichen, Pressung sperren (FOR UPDATE), nicht
--     schon storniert. Abgelehnt (42501), wenn
--       * aus einer Behälterzeile direkt verkauft wurde (verkauf_positionen.pressung_behaelter_id, Rechnung offen), oder
--       * an einer ihrer Chargen eine nicht stornierte Folgebuchung hängt: Umzug/Schwund (von/nach), Verschnitt
--         (Quelle oder Ziel), Füllung (direkt oder als Füllungscharge), Tankverkauf, Kellerbehandlung, Zukauf-Ziel.
--         (Analysen und DAC-Anträge prüft die App vorab mit verständlichem Text; sie ändern keinen Bestand.)
--     Dann: Behälterzeilen, Traubenzeilen und Kopf storniert; Chargen wie ein stornierter Eröffnungsbestand
--     (menge_liter 0, inaktiv, abgeschlossen, Storno-Kennzeichen) – der Zugang bleibt an pressung_behaelter.menge_liter.
--     Zeitpunkt und Benutzer setzt s112_storno_schutz (auth.uid()); das Protokoll hält jede Zeile fest.
--  2. v_behaelter_fuellstand: stornierte Behälterzeilen zählen nicht (Zugang und Chargen-Kontakt). Sonst identisch mit
--     kan145b3_eroeffnungsbestand_storno.
-- Kein session_replication_role (KAN-124). Keine Daten betroffen (heute keine stornierten Pressungen).

-- 1. Pressung stornieren ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_pressung_stornieren(p_tenant_id uuid, p_pressung_id uuid, p_grund text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grund   text := btrim(coalesce(p_grund, ''));
  v_datum   date;
  v_chargen uuid[];
  v_name    text;
  v_n_pb    integer;
  v_n_pw    integer;
  v_n_wa    integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['kellerbuch', 'rieden']) THEN
    RAISE EXCEPTION 'Für das Stornieren der Pressung fehlt das Schreibrecht (Modul Kellerbuch bzw. Rieden).' USING ERRCODE = '42501';
  END IF;
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;

  SELECT p.datum INTO v_datum FROM public.pressungen p
   WHERE p.id = p_pressung_id AND p.tenant_id = p_tenant_id AND p.storniert_am IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.pressungen p WHERE p.id = p_pressung_id AND p.tenant_id = p_tenant_id) THEN
      RAISE EXCEPTION 'Die Pressung ist bereits storniert – bitte die Seite neu laden.' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Pressung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;

  -- Direktverkauf aus einer Behälterzeile (offene Rechnung)
  IF EXISTS (SELECT 1 FROM public.verkauf_positionen vp
               JOIN public.verkaufsposten vs ON vs.id = vp.verkaufsposten_id
               JOIN public.pressung_behaelter pb ON pb.id = vp.pressung_behaelter_id
              WHERE pb.pressung_id = p_pressung_id AND vp.tenant_id = p_tenant_id AND NOT coalesce(vs.storniert, false)) THEN
    RAISE EXCEPTION 'Die Pressung vom % kann nicht storniert werden: Aus ihren Behältern wurde bereits direkt verkauft – bitte zuerst den Verkauf stornieren.',
      to_char(v_datum, 'DD.MM.YYYY') USING ERRCODE = '42501';
  END IF;

  -- Chargen der Pressung und ihre Folgebuchungen (nur nicht stornierte zählen)
  SELECT coalesce(array_agg(DISTINCT pb.weinausbau_id), '{}') INTO v_chargen
    FROM public.pressung_behaelter pb
   WHERE pb.pressung_id = p_pressung_id AND pb.weinausbau_id IS NOT NULL AND pb.storniert_am IS NULL;
  SELECT w.name INTO v_name
    FROM public.weinausbau w
   WHERE w.id = ANY (v_chargen) AND w.tenant_id = p_tenant_id AND (
         EXISTS (SELECT 1 FROM public.keller_umzuege ku WHERE ku.tenant_id = p_tenant_id AND ku.storniert_am IS NULL
                   AND (ku.von_weinausbau_id = w.id OR ku.nach_weinausbau_id = w.id))
      OR EXISTS (SELECT 1 FROM public.verschneidung_quellen vq JOIN public.verschneidungen v ON v.id = vq.verschneidung_id
                  WHERE vq.quell_weinausbau_id = w.id AND v.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.verschneidungen v WHERE v.ziel_weinausbau_id = w.id AND v.tenant_id = p_tenant_id AND v.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.fuellungen f WHERE f.weinausbau_id = w.id AND f.tenant_id = p_tenant_id AND f.storniert_am IS NULL AND f.aktiv)
      OR EXISTS (SELECT 1 FROM public.fuellung_chargen fc JOIN public.fuellungen f ON f.id = fc.fuellung_id
                  WHERE fc.weinausbau_id = w.id AND f.storniert_am IS NULL AND f.aktiv)
      OR EXISTS (SELECT 1 FROM public.verkauf_positionen vp JOIN public.verkaufsposten vs ON vs.id = vp.verkaufsposten_id
                  WHERE vp.weinausbau_id = w.id AND vp.typ = 'tank' AND vp.tenant_id = p_tenant_id AND NOT coalesce(vs.storniert, false))
      OR EXISTS (SELECT 1 FROM public.keller_behandlungen kb WHERE kb.weinausbau_id = w.id AND kb.tenant_id = p_tenant_id AND kb.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.zukauf_posten zp WHERE zp.ziel_weinausbau_id = w.id AND zp.tenant_id = p_tenant_id
                   AND zp.storniert_am IS NULL AND zp.aktiv))
   ORDER BY w.name
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Die Pressung vom % kann nicht storniert werden: An der Charge „%“ hängen bereits Folgebuchungen (Umzug, Verschnitt, Füllung, Verkauf, Behandlung oder Zukauf) – bitte diese zuerst stornieren.',
      to_char(v_datum, 'DD.MM.YYYY'), v_name USING ERRCODE = '42501';
  END IF;

  -- Stornieren (Zeitpunkt/Benutzer setzt s112_storno_schutz)
  UPDATE public.pressung_behaelter SET storniert_am = now(), storno_grund = v_grund
   WHERE pressung_id = p_pressung_id AND storniert_am IS NULL;
  GET DIAGNOSTICS v_n_pb = ROW_COUNT;
  UPDATE public.pressung_weingaerten SET storniert_am = now(), storno_grund = v_grund
   WHERE pressung_id = p_pressung_id AND storniert_am IS NULL;
  GET DIAGNOSTICS v_n_pw = ROW_COUNT;
  UPDATE public.weinausbau SET menge_liter = 0, aktiv = false, status = 'abgeschlossen', storniert_am = now(), storno_grund = v_grund
   WHERE id = ANY (v_chargen) AND tenant_id = p_tenant_id AND storniert_am IS NULL;
  GET DIAGNOSTICS v_n_wa = ROW_COUNT;
  UPDATE public.pressungen SET storniert_am = now(), storno_grund = v_grund
   WHERE id = p_pressung_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('chargen', v_n_wa, 'behaelterzeilen', v_n_pb, 'traubenzeilen', v_n_pw);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pressung_stornieren(uuid, uuid, text) FROM PUBLIC, anon;

-- 2. Füllstand ohne stornierte Pressungszeilen ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_behaelter_fuellstand WITH (security_invoker = true) AS
 WITH charge_kontakte AS (
         SELECT w.behaelter_id,
            w.id AS charge_id,
            w.tenant_id
           FROM weinausbau w
          WHERE (w.behaelter_id IS NOT NULL)
        UNION
         SELECT ku.nach_behaelter_id,
            ku.nach_weinausbau_id,
            ku.tenant_id
           FROM keller_umzuege ku
          WHERE ((ku.nach_behaelter_id IS NOT NULL) AND (ku.nach_weinausbau_id IS NOT NULL) AND (ku.storniert_am IS NULL))
        UNION
         SELECT ku.von_behaelter_id,
            ku.von_weinausbau_id,
            ku.tenant_id
           FROM keller_umzuege ku
          WHERE ((ku.von_behaelter_id IS NOT NULL) AND (ku.von_weinausbau_id IS NOT NULL) AND (ku.storniert_am IS NULL))
        UNION
         SELECT pb.behaelter_id,
            pb.weinausbau_id,
            p_1.tenant_id
           FROM (pressung_behaelter pb
             JOIN pressungen p_1 ON ((p_1.id = pb.pressung_id)))
          WHERE ((pb.behaelter_id IS NOT NULL) AND (pb.storniert_am IS NULL))
        ), anfangsbestand AS (
         SELECT w.behaelter_id,
            w.tenant_id,
            sum(COALESCE(w.anfangsbestand_liter, w.menge_liter, (0)::numeric)) AS liter
           FROM weinausbau w
          WHERE ((w.ist_eroeffnungsbestand = true) AND (w.behaelter_id IS NOT NULL) AND (w.storniert_am IS NULL))
          GROUP BY w.behaelter_id, w.tenant_id
        ), zukauf_ein AS (
         SELECT wa.behaelter_id,
            wa.tenant_id,
            sum(zp.menge) AS liter
           FROM (zukauf_posten zp
             JOIN weinausbau wa ON ((wa.id = zp.ziel_weinausbau_id)))
          WHERE ((zp.aktiv = true) AND (zp.storniert_am IS NULL) AND (zp.art = ANY (ARRAY['wein'::text, 'most'::text])) AND (zp.ziel_weinausbau_id IS NOT NULL) AND (wa.behaelter_id IS NOT NULL))
          GROUP BY wa.behaelter_id, wa.tenant_id
        ), pressungen_ein AS (
         SELECT pb.behaelter_id,
            p_1.tenant_id,
            sum(COALESCE(pb.menge_liter, wa.menge_liter, (0)::numeric)) AS liter
           FROM ((pressung_behaelter pb
             JOIN pressungen p_1 ON ((p_1.id = pb.pressung_id)))
             LEFT JOIN weinausbau wa ON ((wa.id = pb.weinausbau_id)))
          WHERE ((pb.behaelter_id IS NOT NULL) AND (pb.storniert_am IS NULL))
          GROUP BY pb.behaelter_id, p_1.tenant_id
        ), umzuege_ein AS (
         SELECT ku.nach_behaelter_id AS behaelter_id,
            ku.tenant_id,
            sum(
                CASE
                    WHEN (ku.brutto_liter IS NOT NULL) THEN ku.menge_liter
                    ELSE GREATEST((0)::numeric, (ku.menge_liter - COALESCE(ku.schwund_liter, (0)::numeric)))
                END) AS liter
           FROM keller_umzuege ku
          WHERE ((ku.nach_behaelter_id IS NOT NULL) AND (ku.storniert_am IS NULL))
          GROUP BY ku.nach_behaelter_id, ku.tenant_id
        ), umzuege_aus AS (
         SELECT ck.behaelter_id,
            ku.tenant_id,
            sum(
                CASE
                    WHEN (ku.zeilen_typ = 'quelle'::text) THEN ku.menge_liter
                    ELSE COALESCE(ku.brutto_liter, ku.menge_liter)
                END) AS liter
           FROM (keller_umzuege ku
             JOIN charge_kontakte ck ON ((ck.charge_id = ku.von_weinausbau_id)))
          WHERE (ku.storniert_am IS NULL)
          GROUP BY ck.behaelter_id, ku.tenant_id
        ), abfuellungen AS (
         SELECT ck.behaelter_id,
            f.tenant_id,
            sum(COALESCE(f.menge_liter_gefuellt, (((f.anzahl_flaschen)::numeric * (f.flaschengroesse_ml)::numeric) / 1000.0))) AS liter
           FROM (fuellungen f
             JOIN charge_kontakte ck ON ((ck.charge_id = f.weinausbau_id)))
          WHERE (f.storniert_am IS NULL)
          GROUP BY ck.behaelter_id, f.tenant_id
        ), verkaeufe AS (
         SELECT ck.behaelter_id,
            vs.tenant_id,
            sum(vp.menge) AS liter
           FROM ((verkauf_positionen vp
             JOIN verkaufsposten vs ON ((vs.id = vp.verkaufsposten_id)))
             JOIN charge_kontakte ck ON ((ck.charge_id = vp.weinausbau_id)))
          WHERE ((vp.typ = 'tank'::text) AND (NOT COALESCE(vs.storniert, false)))
          GROUP BY ck.behaelter_id, vs.tenant_id
        ), verschneidungen_ein AS (
         SELECT ck.behaelter_id,
            v.tenant_id,
            sum(vq.menge_liter) AS liter
           FROM ((verschneidung_quellen vq
             JOIN verschneidungen v ON ((v.id = vq.verschneidung_id)))
             JOIN charge_kontakte ck ON ((ck.charge_id = v.ziel_weinausbau_id)))
          WHERE (v.storniert_am IS NULL)
          GROUP BY ck.behaelter_id, v.tenant_id
        ), verschneidungen_aus AS (
         SELECT ck.behaelter_id,
            v.tenant_id,
            sum(vq.menge_liter) AS liter
           FROM ((verschneidung_quellen vq
             JOIN verschneidungen v ON ((v.id = vq.verschneidung_id)))
             JOIN charge_kontakte ck ON ((ck.charge_id = vq.quell_weinausbau_id)))
          WHERE (v.storniert_am IS NULL)
          GROUP BY ck.behaelter_id, v.tenant_id
        ), paare AS (
         SELECT anfangsbestand.behaelter_id,
            anfangsbestand.tenant_id
           FROM anfangsbestand
        UNION
         SELECT zukauf_ein.behaelter_id,
            zukauf_ein.tenant_id
           FROM zukauf_ein
        UNION
         SELECT pressungen_ein.behaelter_id,
            pressungen_ein.tenant_id
           FROM pressungen_ein
        UNION
         SELECT umzuege_ein.behaelter_id,
            umzuege_ein.tenant_id
           FROM umzuege_ein
        UNION
         SELECT umzuege_aus.behaelter_id,
            umzuege_aus.tenant_id
           FROM umzuege_aus
        UNION
         SELECT abfuellungen.behaelter_id,
            abfuellungen.tenant_id
           FROM abfuellungen
        UNION
         SELECT verkaeufe.behaelter_id,
            verkaeufe.tenant_id
           FROM verkaeufe
        UNION
         SELECT verschneidungen_ein.behaelter_id,
            verschneidungen_ein.tenant_id
           FROM verschneidungen_ein
        UNION
         SELECT verschneidungen_aus.behaelter_id,
            verschneidungen_aus.tenant_id
           FROM verschneidungen_aus
        UNION
         SELECT b.id,
            b.tenant_id
           FROM behaelter b
        )
 SELECT p.behaelter_id,
    p.tenant_id,
    round(((((((((COALESCE(ab.liter, (0)::numeric) + COALESCE(zk.liter, (0)::numeric)) + COALESCE(pr.liter, (0)::numeric)) + COALESCE(ue.liter, (0)::numeric)) + COALESCE(vi.liter, (0)::numeric)) - COALESCE(ua.liter, (0)::numeric)) - COALESCE(af.liter, (0)::numeric)) - COALESCE(vk.liter, (0)::numeric)) - COALESCE(vo.liter, (0)::numeric)), 2) AS liter_aktuell
   FROM (((((((((paare p
     LEFT JOIN anfangsbestand ab ON (((ab.behaelter_id = p.behaelter_id) AND (ab.tenant_id = p.tenant_id))))
     LEFT JOIN zukauf_ein zk ON (((zk.behaelter_id = p.behaelter_id) AND (zk.tenant_id = p.tenant_id))))
     LEFT JOIN pressungen_ein pr ON (((pr.behaelter_id = p.behaelter_id) AND (pr.tenant_id = p.tenant_id))))
     LEFT JOIN umzuege_ein ue ON (((ue.behaelter_id = p.behaelter_id) AND (ue.tenant_id = p.tenant_id))))
     LEFT JOIN umzuege_aus ua ON (((ua.behaelter_id = p.behaelter_id) AND (ua.tenant_id = p.tenant_id))))
     LEFT JOIN abfuellungen af ON (((af.behaelter_id = p.behaelter_id) AND (af.tenant_id = p.tenant_id))))
     LEFT JOIN verkaeufe vk ON (((vk.behaelter_id = p.behaelter_id) AND (vk.tenant_id = p.tenant_id))))
     LEFT JOIN verschneidungen_ein vi ON (((vi.behaelter_id = p.behaelter_id) AND (vi.tenant_id = p.tenant_id))))
     LEFT JOIN verschneidungen_aus vo ON (((vo.behaelter_id = p.behaelter_id) AND (vo.tenant_id = p.tenant_id))));

-- Selbstprüfung
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.s112_pressung_stornieren(uuid, uuid, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.s112_pressung_stornieren(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-148 C1c: EXECUTE-Rechte falsch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.v_behaelter_fuellstand'::regclass AND 'security_invoker=true' = ANY (c.reloptions))
     OR pg_get_viewdef('public.v_behaelter_fuellstand'::regclass) NOT LIKE '%pb.storniert_am IS NULL%'
     OR pg_get_viewdef('public.v_behaelter_fuellstand'::regclass) NOT LIKE '%w.storniert_am IS NULL%' THEN
    RAISE EXCEPTION 'KAN-148 C1c: v_behaelter_fuellstand falsch';
  END IF;
END $$;
