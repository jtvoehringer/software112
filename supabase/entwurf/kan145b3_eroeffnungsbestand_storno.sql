-- KAN-145 Block B, Etappe 3b: Eröffnungsbestand stornieren – ENTWURF, erst nach „OK, einspielen“, zuerst Staging
--
-- Vorgabe (Ticket B Nr. 6): Eröffnungsbestand „Wert bleibt, Storno statt 0 L“. Bisher setzte das Löschen
-- anfangsbestand_liter auf 0 – der ursprüngliche Anfangsbestand ging verloren (nur im Protokoll). Neu bleibt er stehen,
-- die Charge wird mit Grund als storniert gekennzeichnet (menge 0, inaktiv, abgeschlossen).
--
--  1. storniert_am, storniert_von, storniert_von_name, storno_grund an weinausbau (wie B1), CHECK, Schutz-Trigger
--     a_storno_schutz (Zeitpunkt/Benutzer setzt die DB, stornierte Zeile unveränderlich; läuft vor den übrigen
--     BEFORE-Triggern).
--  2. z_protokoll_aendern an weinausbau überwacht zusätzlich storniert_am und storno_grund.
--  3. v_behaelter_fuellstand: stornierter Eröffnungsbestand zählt nicht (sonst stiege der Füllstand um den stehen
--     gebliebenen Anfangsbestand). Sonst identisch mit kan145b2_fuellstand_ohne_storno.
-- Rein additiv; heute ohne Wirkung (keine stornierten Chargen). Kein session_replication_role (KAN-124).

-- 1. Spalten und Schutz ────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.weinausbau
  ADD COLUMN IF NOT EXISTS storniert_am timestamptz,
  ADD COLUMN IF NOT EXISTS storniert_von uuid,
  ADD COLUMN IF NOT EXISTS storniert_von_name text,
  ADD COLUMN IF NOT EXISTS storno_grund text;
ALTER TABLE public.weinausbau DROP CONSTRAINT IF EXISTS weinausbau_storno_chk;
ALTER TABLE public.weinausbau ADD CONSTRAINT weinausbau_storno_chk CHECK (
  (storniert_am IS NULL AND storniert_von IS NULL AND storniert_von_name IS NULL AND storno_grund IS NULL)
  OR (storniert_am IS NOT NULL AND length(btrim(coalesce(storno_grund, ''))) >= 10));
COMMENT ON COLUMN public.weinausbau.storniert_am IS 'KAN-145: Zeitpunkt des Stornos (Eröffnungsbestand; Charge bleibt stehen, zählt in keinem Bestand); setzt s112_storno_schutz';
COMMENT ON COLUMN public.weinausbau.storniert_von IS 'KAN-145: Benutzer (auth.uid(), ohne FK)';
COMMENT ON COLUMN public.weinausbau.storniert_von_name IS 'KAN-145: Name des Benutzers als Momentaufnahme';
COMMENT ON COLUMN public.weinausbau.storno_grund IS 'KAN-145: Grund des Stornos (mind. 10 Zeichen)';

DROP TRIGGER IF EXISTS a_storno_schutz ON public.weinausbau;
CREATE TRIGGER a_storno_schutz BEFORE INSERT OR UPDATE ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_storno_schutz();

-- 2. Änderungsprotokoll ───────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.weinausbau;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge_liter, anfangsbestand_liter, behaelter_id, aktiv, status,
  qualitaetsstufe, herkunft_code, weinart, rebsorte, jahrgang, ist_eroeffnungsbestand, tenant_id, kmw, oechsle,
  mostgewicht_einheit, storniert_am, storno_grund ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge_liter', 'anfangsbestand_liter', 'behaelter_id',
  'aktiv', 'status', 'qualitaetsstufe', 'herkunft_code', 'weinart', 'rebsorte', 'jahrgang', 'ist_eroeffnungsbestand',
  'tenant_id', 'kmw', 'oechsle', 'mostgewicht_einheit', 'storniert_am', 'storno_grund');

-- 3. Füllstand ohne stornierten Eröffnungsbestand ─────────────────────────────────────────────────────────
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
          WHERE (pb.behaelter_id IS NOT NULL)
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
          WHERE (pb.behaelter_id IS NOT NULL)
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
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'weinausbau'
       AND column_name IN ('storniert_am', 'storniert_von', 'storniert_von_name', 'storno_grund')) <> 4 THEN
    RAISE EXCEPTION 'KAN-145 B3: Storno-Spalten an weinausbau unvollständig';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a_storno_schutz' AND tgrelid = 'public.weinausbau'::regclass) THEN
    RAISE EXCEPTION 'KAN-145 B3: a_storno_schutz fehlt an weinausbau';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.v_behaelter_fuellstand'::regclass AND 'security_invoker=true' = ANY (c.reloptions))
     OR pg_get_viewdef('public.v_behaelter_fuellstand'::regclass) NOT LIKE '%w.storniert_am IS NULL%' THEN
    RAISE EXCEPTION 'KAN-145 B3: v_behaelter_fuellstand falsch';
  END IF;
END $$;
